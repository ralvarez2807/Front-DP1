// Panel de control de visualización del mapa (sugerencia del profesor):
// filtro de aeropuertos/aviones/rutas por su color de estado y zoom a regiones.
//
// Este módulo es lógica PURA (sin JSX) — lo comparten SimulationDashboardView y
// DailyOperationsView, que hasta ahora tenían copias separadas del render del mapa.
// Al vivir aquí, los umbrales de color y la matemática de encuadre no se pueden
// desincronizar entre las dos vistas (ya pasó una vez con AnimatedPlane).

import { MAP_VIEWBOX } from '../providers/MapProvider';

// ── Buckets de color ────────────────────────────────────────────────────────
// Cada bucket corresponde 1:1 con un color visible en el mapa, para que filtrar
// oculte EXACTAMENTE lo que se está pintando.

// Aeropuertos — por ocupación de almacén (umbrales 70/50, igual que el render).
export type HubBucket = 'empty' | 'optimal' | 'alert' | 'critical';
// Aviones — por carga (umbrales 70/50, igual que getPlaneColor). 'empty' = avión
// gris (viaja vacío / sin dato de capacidad).
export type PlaneBucket = 'empty' | 'normal' | 'high' | 'critical';
// Rutas — activa (hay avión) vs disponible (línea de fondo).
export type RouteBucket = 'active' | 'available';
// Vuelos/rutas conectados a un aeropuerto oculto (por el filtro de arriba) —
// a diferencia de los otros grupos, aquí `true` OCULTA (no muestra).
export type HubFlightDirection = 'hideIncoming' | 'hideOutgoing';

export interface MapFilters {
  hubs: Record<HubBucket, boolean>;
  planes: Record<PlaneBucket, boolean>;
  routes: Record<RouteBucket, boolean>;
  hubFlights: Record<HubFlightDirection, boolean>;
}

// Estado inicial: todo visible (el filtro solo resta).
export const DEFAULT_MAP_FILTERS: MapFilters = {
  hubs:   { empty: true, optimal: true, alert: true, critical: true },
  planes: { empty: true, normal: true, high: true, critical: true },
  routes: { active: true, available: true },
  hubFlights: { hideIncoming: false, hideOutgoing: false },
};

/**
 * Bucket de color de un aeropuerto según su ocupación de almacén.
 * Debe coincidir con el `storageColor` inline de las vistas:
 *   pct>=70 rojo · pct>=50 ámbar · storage==0 gris · resto verde.
 */
export function hubColorBucket(pct: number, currentStorage: number): HubBucket {
  if (pct >= 70) return 'critical';
  if (pct >= 50) return 'alert';
  if (currentStorage <= 0) return 'empty';
  return 'optimal';
}

/**
 * Si un aeropuerto queda oculto por el filtro de "Aeropuertos" (checkbox de su
 * bucket de color destildado). Se usa para, además de ocultar el marcador,
 * ocultar los vuelos entrantes/salientes de ese aeropuerto (ver `hubFlights`).
 */
export function isHubHiddenByFilter(
  pct: number,
  currentStorage: number,
  filters: MapFilters,
): boolean {
  return !filters.hubs[hubColorBucket(pct, currentStorage)];
}

/**
 * Bucket de color de un avión según su carga.
 * Debe coincidir con `getPlaneColor` (umbrales 70/50). El avión gris (viaja vacío,
 * occupied<=0) y el azul poco frecuente de "sin dato de capacidad" (capacity<=0) se
 * agrupan en 'empty' — ambos representan "sin carga útil" y se filtran juntos.
 */
export function planeColorBucket(occupied: number, capacity: number): PlaneBucket {
  if (capacity <= 0) return 'empty';   // azul "sin datos" — raro en la práctica
  if (occupied <= 0) return 'empty';   // gris "vacío"
  const pct = (occupied / capacity) * 100;
  if (pct >= 70) return 'critical';
  if (pct >= 50) return 'high';
  return 'normal';
}

/**
 * Si un avión queda oculto en el mapa por los filtros actuales — por su color de
 * carga (checkbox del bucket destildado) o por tocar un aeropuerto oculto con los
 * checkboxes "Ocultar vuelos entrantes/salientes". Debe coincidir 1:1 con las
 * condiciones que descartan el avión en el render de ambas vistas.
 *
 * Se usa además para NO pintar la línea roja de "ruta activa" de un vuelo cuyo
 * avión está filtrado: si ningún avión visible cubre ese par origen-destino, la
 * ruta deja de considerarse activa (el usuario filtró justamente ese vuelo).
 */
export function isPlaneHiddenByFilter(
  occupied: number,
  capacity: number,
  fromIcao: string,
  toIcao: string,
  filters: MapFilters,
  hiddenHubIds: Set<string>,
): boolean {
  if (!filters.planes[planeColorBucket(occupied, capacity)]) return true;
  if (filters.hubFlights.hideOutgoing && hiddenHubIds.has(fromIcao)) return true;
  if (filters.hubFlights.hideIncoming && hiddenHubIds.has(toIcao)) return true;
  return false;
}

// ── Zoom a regiones ─────────────────────────────────────────────────────────

export interface ViewTransform { x: number; y: number; k: number }
interface ProjectedPoint { projectedX?: number; projectedY?: number }

/**
 * Calcula el `viewTransform` que encuadra un grupo de hubs (una región) dentro
 * del viewBox del mapa, centrado y con un pequeño margen. Reutiliza el `clamp`
 * de la vista para respetar sus mismos límites de pan/zoom (k ≤ 12).
 *
 * `hubs` deben venir ya proyectados (con projectedX/projectedY). Si el grupo está
 * vacío o degenerado, cae a la vista base (reset).
 */
export function computeRegionTransform(
  hubs: ProjectedPoint[],
  clamp: (x: number, y: number, k: number) => ViewTransform,
): ViewTransform {
  const pts = hubs.filter(
    h => typeof h.projectedX === 'number' && typeof h.projectedY === 'number',
  );
  if (pts.length === 0) return clamp(0, 0, 1);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const h of pts) {
    minX = Math.min(minX, h.projectedX!); maxX = Math.max(maxX, h.projectedX!);
    minY = Math.min(minY, h.projectedY!); maxY = Math.max(maxY, h.projectedY!);
  }

  const W = MAP_VIEWBOX.width;
  const H = MAP_VIEWBOX.height;
  // Ancho/alto mínimos: un solo hub (o hubs muy juntos) no debe pedir un zoom
  // infinito; se asume un recuadro de al menos ~18% del viewBox alrededor.
  const boxW = Math.max(maxX - minX, W * 0.18);
  const boxH = Math.max(maxY - minY, H * 0.18);

  // 0.82 deja aire alrededor de la región para no pegarla a los bordes.
  const k = Math.min((W / boxW) * 0.82, (H / boxH) * 0.82);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return clamp(W / 2 - cx * k, H / 2 - cy * k, k);
}
