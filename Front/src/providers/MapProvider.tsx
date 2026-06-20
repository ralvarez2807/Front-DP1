import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { Hub, Flight } from '../models/infrastructure';
import { hubService } from '../services/hubService';
import { flightService } from '../services/flightService';
import { useAuthContext } from './AuthProvider';

interface MapContextType {
  worldData: any;
  projection: d3.GeoProjection;
  pathGenerator: d3.GeoPath;
  projectedHubs: Hub[];
  projectedFlights: Flight[];
  isLoading: boolean;
}

const MapContext = createContext<MapContextType | null>(null);

// Proyección compartida — dimensiones del viewBox del SVG del mapa
const MAP_WIDTH  = 1200;
const MAP_HEIGHT = 800;

// Margen (en unidades del viewBox) alrededor de los aeropuertos extremos.
const FIT_PADDING = 60;

/**
 * Proyección Mercator encuadrada en la región operativa.
 *
 * Si hay aeropuertos cargados, `fitExtent` escala y centra el mapa para que el
 * lienzo (MAP_WIDTH×MAP_HEIGHT) contenga EXACTAMENTE el bounding box de los
 * aeropuertos (= los extremos de los vuelos). Así, zonas sin operación (EE.UU.,
 * Rusia, Australia…) quedan fuera del lienzo: no se ven ni se puede arrastrar
 * hasta ellas. Sin aeropuertos aún, cae a una vista mundial mientras carga.
 */
function buildProjection(hubs: Hub[]) {
  const projection = d3.geoMercator();
  if (hubs.length >= 2) {
    const points = {
      type: 'MultiPoint' as const,
      coordinates: hubs.map(h => [h.lng, h.lat]),
    };
    projection.fitExtent(
      [[FIT_PADDING, FIT_PADDING], [MAP_WIDTH - FIT_PADDING, MAP_HEIGHT - FIT_PADDING]],
      points as any,
    );
  } else {
    projection.scale(185).translate([MAP_WIDTH / 2, MAP_HEIGHT / 1.55]);
  }
  return projection;
}

// Bezier cuadrático — control point simétrico para que A→B y B→A
// sigan exactamente la misma curva visual (solo en dirección opuesta).
function arcPath(
  x1: number, y1: number,
  x2: number, y2: number
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - dist * 0.2;
  return `M${x1},${y1}Q${mx},${my} ${x2},${y2}`;
}

export const MapProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, user } = useAuthContext();
  const [worldData,   setWorldData]   = useState<any>(null);
  const [fetchedHubs, setFetchedHubs] = useState<Hub[]>([]);
  const [fetchedFlights, setFetchedFlights] = useState<Flight[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ── Proyección encuadrada en la región operativa ─────────────────────────
  // Depende de los aeropuertos: al cargarlos, el mapa se re-encuadra en su
  // bounding box (ignora continentes sin vuelos).
  const projection = useMemo(() => buildProjection(fetchedHubs), [fetchedHubs]);
  const pathGenerator = useMemo(() => d3.geoPath().projection(projection), [projection]);

  // ── Cargar mapa mundial ──────────────────────────────────────────────────
  useEffect(() => {
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then(r => r.json())
      .then(data => {
        setWorldData(topojson.feature(data, data.objects.countries));
      })
      .catch(err => console.error('[MapProvider] world map failed', err))
      .finally(() => setIsLoading(false));
  }, []);

  // ── Cargar aeropuertos y rutas con reintentos ────────────────────────────
  // Solo cuando el usuario está autenticado: estos endpoints requieren JWT, y
  // dispararlos antes del login (o con un token expirado) producía 401 y, tras
  // agotar los reintentos, el mapa quedaba sin ciudades para siempre.
  // Al volver a iniciar sesión (isAuthenticated → true) se reintenta la carga.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;

    async function fetchWithRetry<T>(
      fetcher: () => Promise<T>,
      setter: (v: T) => void,
      label: string,
      maxRetries = 6,
      delay = 600,
    ) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (cancelled) return;
        try {
          const data = await fetcher();
          if (!cancelled) setter(data);
          return;
        } catch (err: any) {
          if (cancelled) return;
          if (attempt < maxRetries) {
            // Reintento ante cualquier error (auth no lista, red, servidor frío)
            await new Promise(r => setTimeout(r, delay * (attempt + 1)));
          } else {
            console.warn(`[MapProvider] ${label} falló tras ${attempt + 1} intentos:`, err);
          }
        }
      }
    }

    fetchWithRetry(() => hubService.getAll(),     setFetchedHubs,    'airports');
    fetchWithRetry(() => flightService.getAll(),  setFetchedFlights, 'routes');

    return () => { cancelled = true; };
    // `user` en deps: cada login (token nuevo) reintenta, incluso si isAuthenticated
    // ya estaba en true con un token previo expirado.
  }, [isAuthenticated, user]);

  // ── Proyectar hubs y rutas ───────────────────────────────────────────────
  const { projectedHubs, projectedFlights } = useMemo(() => {
    const hubs = fetchedHubs.length > 0 ? fetchedHubs : [];

    const pHubs: Hub[] = hubs.map(hub => {
      const [px, py] = projection([hub.lng, hub.lat]) ?? [0, 0];
      return { ...hub, projectedX: px, projectedY: py };
    });

    // Índice rápido por ICAO
    const hubIndex = new Map(pHubs.map(h => [h.id, h]));

    const pFlights: Flight[] = fetchedFlights.map(f => {
      const o = hubIndex.get(f.originId);
      const d = hubIndex.get(f.destinationId);
      const path = (o && d)
        ? arcPath(o.projectedX!, o.projectedY!, d.projectedX!, d.projectedY!)
        : '';
      return { ...f, projectedPath: path };
    });

    return { projectedHubs: pHubs, projectedFlights: pFlights };
  }, [projection, fetchedHubs, fetchedFlights]);

  return (
    <MapContext.Provider value={{
      worldData,
      projection,
      pathGenerator,
      projectedHubs,
      projectedFlights,
      isLoading,
    }}>
      {children}
    </MapContext.Provider>
  );
};

export const useMap = () => {
  const ctx = useContext(MapContext);
  if (!ctx) throw new Error('useMap must be used within a MapProvider');
  return ctx;
};

// Exporta constantes de dimensión para que los mapas usen el mismo viewBox
export const MAP_VIEWBOX = { width: MAP_WIDTH, height: MAP_HEIGHT };
