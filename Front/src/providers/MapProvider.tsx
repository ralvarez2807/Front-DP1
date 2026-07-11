import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { Hub, Flight } from '../models/infrastructure';
import { hubService } from '../services/hubService';
import { flightService } from '../services/flightService';
import { useAuthContext } from './AuthProvider';

interface MapContextType {
  worldData: any;
  pathGenerator: d3.GeoPath;
  projectedHubs: Hub[];
  projectedFlights: Flight[];
  isLoading: boolean;
}

const MapContext = createContext<MapContextType | null>(null);

// Proyección compartida — dimensiones del viewBox del SVG del mapa
const MAP_WIDTH  = 1200;
const MAP_HEIGHT = 800;

// Proyección resultante: una función puntual `project([lng,lat]) → [x,y]` (para
// ubicar hubs/aviones) y una proyección `pathProjection` compatible con d3.geoPath
// (para dibujar países). Ambas comparten el mismo mapeo, así todo queda alineado.
interface MapProjection {
  project: (coords: [number, number]) => [number, number] | null;
  pathProjection: any;
}

/**
 * Proyección Mercator que ESTIRA el grupo de aeropuertos para que ocupe TODA la
 * pantalla (pedido del profesor: Copenhague pegado arriba, Montevideo abajo, etc.).
 *
 * Se parte de un Mercator encuadrado (`fitExtent`, uniforme) y luego se escala de
 * forma NO uniforme en X e Y para que el bounding box de los hubs llene exactamente
 * el viewBox (menos un pequeño margen para las etiquetas). El estiramiento se hornea
 * en las coordenadas proyectadas, de modo que países, hubs, rutas y aviones quedan
 * consistentes y el zoom/pan (escala uniforme) sigue funcionando igual encima.
 * Sin hubs aún (login inicial) usa el mundo estándar como fallback.
 */
function buildProjection(hubs: Hub[]): MapProjection {
  if (hubs.length === 0) {
    const merc = d3.geoMercator()
      .scale(185)
      .translate([MAP_WIDTH / 2, MAP_HEIGHT / 1.55]);
    return { project: (c) => merc(c) ?? null, pathProjection: merc };
  }

  // Margen para que los marcadores y sus etiquetas no se corten en los bordes.
  const pad = 46;
  const points = {
    type: 'MultiPoint' as const,
    coordinates: hubs.map(h => [h.lng, h.lat]),
  };
  const merc = d3.geoMercator().fitExtent(
    [[pad, pad], [MAP_WIDTH - pad, MAP_HEIGHT - pad]],
    points as any,
  );

  // Bounding box de los hubs ya proyectados (uniforme).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const h of hubs) {
    const p = merc([h.lng, h.lat]);
    if (!p) continue;
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  // Escalas independientes para llenar el viewBox (menos el margen) en ambos ejes.
  const sx = (MAP_WIDTH  - 2 * pad) / spanX;
  const sy = (MAP_HEIGHT - 2 * pad) / spanY;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const tx = MAP_WIDTH / 2,     ty = MAP_HEIGHT / 2;

  const stretch = (p: [number, number]): [number, number] =>
    [tx + (p[0] - cx) * sx, ty + (p[1] - cy) * sy];

  const project = (c: [number, number]): [number, number] | null => {
    const p = merc(c);
    return p ? stretch(p as [number, number]) : null;
  };

  // Para dibujar países se COMPONEN dos streams: primero Mercator (con su recorte
  // del antimeridiano intacto), y después un post-transform que estira las
  // coordenadas planas ya proyectadas. Así se evitan artefactos y se mantiene el
  // mismo mapeo que `project`.
  const post = d3.geoTransform({
    point(x: number, y: number) {
      const s = stretch([x, y]);
      (this as any).stream.point(s[0], s[1]);
    },
  });
  const pathProjection = { stream: (sink: any) => merc.stream(post.stream(sink)) };

  return { project, pathProjection };
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
  const mapProjection = useMemo(() => buildProjection(fetchedHubs), [fetchedHubs]);
  const pathGenerator = useMemo(() => d3.geoPath(mapProjection.pathProjection), [mapProjection]);

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
      const [px, py] = mapProjection.project([hub.lng, hub.lat]) ?? [0, 0];
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
  }, [mapProjection, fetchedHubs, fetchedFlights]);

  return (
    <MapContext.Provider value={{
      worldData,
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
