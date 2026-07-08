import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import {
  Map as MapIcon, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, LayoutGrid, XCircle, FileText,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useMap, MAP_VIEWBOX } from '../providers/MapProvider';
import { useOperationsContext, OpsPlane } from '../providers/OperationsProvider';
import { AnimatedPlane } from '../components/map/AnimatedPlane';
import { SimulationInfoPanel } from './SimulationInfoPanel';
import { FlightCancelModal } from '../components/FlightCancelModal';
import { SummaryReportModal } from '../components/SummaryReportModal';
import { SlaAlertsButton } from '../components/SlaAlertsButton';
import { simulationService } from '../services/simulationService';
import { operationsSocket } from '../services/operationsService';
import type { SimAirport, SimFlight, SimShipment, ShipmentRouteLeg } from '../services/simulationService';
import { cn } from '../lib/utils';

function LegendRow({ dot, label }: { dot: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={cn('w-3 h-3 rounded-full shrink-0', dot)} />
      <span className="text-[10px] font-semibold text-slate-600">{label}</span>
    </div>
  );
}

// ── Conversor: OpsAirportLoad → SimAirport ─────────────────────────────────
function toSimAirport(a: {
  icao: string; city: string; continent: string; load: number; capacity: number;
}): SimAirport {
  const pct = a.capacity > 0 ? (a.load / a.capacity) * 100 : 0;
  const level = a.load === 0 ? 'EMPTY' : pct >= 90 ? 'RED' : pct >= 70 ? 'AMBER' : 'GREEN';
  return { icao: a.icao, city: a.city, continent: a.continent, load: a.load, capacity: a.capacity, occupancyPct: pct, occupancyLevel: level };
}

// ── Conversor: OpsPlane → SimFlight ────────────────────────────────────────
function toSimFlight(p: OpsPlane): SimFlight {
  const pct = p.capacity > 0 ? (p.occupied / p.capacity) * 100 : 0;
  const level = pct >= 90 ? 'RED' : pct >= 70 ? 'AMBER' : 'GREEN';
  return {
    flightId: p.flightId,
    fromIcao: p.fromIcao,
    toIcao: p.toIcao,
    depTime: new Date(p.startedAt).toISOString(),
    arrTime: new Date(p.startedAt + p.durationMs).toISOString(),
    status: 'DEPARTED',
    load: p.occupied,
    capacity: p.capacity,
    occupancyPct: pct,
    occupancyLevel: level,
  };
}

interface DailyOperationsViewProps {
  /** Pedido externo (p. ej. desde Tracking) de enfocar un envío por su shipmentId */
  focusRequest?: { shipmentId: string; nonce: number } | null;
}

export const DailyOperationsView: React.FC<DailyOperationsViewProps> = React.memo(({ focusRequest }) => {
  const { worldData, pathGenerator, projectedHubs, projectedFlights } = useMap();
  const { planes, airports, ops, lastSimUpdate } = useOperationsContext();

  // ── Envíos y vuelos completos de la sesión de operaciones ────────────────
  const [opsShipments, setOpsShipments] = useState<SimShipment[]>([]);
  const [opsAllFlights, setOpsAllFlights] = useState<SimFlight[]>([]);

  useEffect(() => {
    const sessionId = ops?.id;
    const opsStatus = ops?.status;
    // Skip dead sessions — their /flights endpoint returns 404
    if (!sessionId || opsStatus === 'stopped' || opsStatus === 'completed' || opsStatus === 'collapsed') return;

    let cancelled = false;
    let timerId: ReturnType<typeof setInterval> | null = null;

    const doFetch = async () => {
      if (cancelled) return;

      // Flights: if session no longer exists (404) stop polling entirely
      try {
        const flights = await simulationService.getSimFlights(sessionId);
        if (!cancelled) setOpsAllFlights(flights);
      } catch (err: any) {
        if (err?.response?.status === 404) {
          if (timerId !== null) { clearInterval(timerId); timerId = null; }
          return;
        }
      }

      // Shipments: best-effort
      try {
        const shipments = await simulationService.getSimShipments(sessionId);
        if (!cancelled) setOpsShipments(shipments);
      } catch {}
    };

    doFetch();
    timerId = setInterval(doFetch, 15_000);
    return () => { cancelled = true; if (timerId !== null) clearInterval(timerId); };
  }, [ops?.id, ops?.status]);

  // ── Panel lateral derecho ─────────────────────────────────────────────────
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const [infoPanelTab, setInfoPanelTab]   = useState<'airports' | 'flights' | 'packages'>('airports');

  // ── Estado de selección ──────────────────────────────────────────────────
  const [selectedAirportId, setSelectedAirportId] = useState<string | null>(null);
  const [selectedFlightId,  setSelectedFlightId]  = useState<string | null>(null);
  // Envío seleccionado (pestaña Paquetes) y su ruta dibujada en el mapa — mismo
  // comportamiento que en SimulationDashboardView, ver focusOnShipment más abajo.
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [routeOverlay, setRouteOverlay] =
    useState<{ shipmentId: string; legs: ShipmentRouteLeg[] } | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);

  // ── Rutas canceladas — parpadeo temporal en el mapa (D14/D15, LE-62) ──────
  // El avión ya lo quita OperationsProvider al recibir FLIGHT_CANCELLED; aquí
  // solo se dibuja el aviso visual sobre la ruta afectada.
  const [cancelledRoutes, setCancelledRoutes] =
    useState<{ key: string; flightId: string; fromIcao: string; toIcao: string }[]>([]);
  const cancelTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  // Reporte de la última planificación estable de la operación (G09)
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    const CANCEL_BLINK_MS = 60_000;
    const unsub = operationsSocket.on('FLIGHT_CANCELLED', ({ payload }: any) => {
      const fid = payload?.flightId ?? payload?.flightScheduleKey;
      if (!fid) return;
      const parts = String(fid).split('-');
      const fromIcao = payload?.fromIcao ?? parts[0];
      const toIcao   = payload?.toIcao   ?? parts[1];
      if (!fromIcao || !toIcao) return;
      const key = `${fid}-${Date.now()}`;
      setCancelledRoutes(prev => [...prev.filter(c => c.flightId !== fid), { key, flightId: fid, fromIcao, toIcao }]);
      const timer = setTimeout(() => {
        setCancelledRoutes(prev => prev.filter(c => c.key !== key));
        cancelTimersRef.current.delete(key);
      }, CANCEL_BLINK_MS);
      cancelTimersRef.current.set(key, timer);
    });
    return () => {
      unsub();
      cancelTimersRef.current.forEach(t => clearTimeout(t));
      cancelTimersRef.current.clear();
    };
  }, []);

  // ── Tooltips ─────────────────────────────────────────────────────────────
  const [hubTooltip, setHubTooltip] = useState<{
    hub: typeof projectedHubs[0]; screenX: number; screenY: number;
  } | null>(null);
  const [planeTooltip, setPlaneTooltip] = useState<{
    plane: OpsPlane; screenX: number; screenY: number;
  } | null>(null);

  // ── Zoom / Pan ─────────────────────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewTransform, setViewTransform] = useState({ x: 0, y: 0, k: 1 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  const clamp = useCallback((x: number, y: number, k: number) => {
    const W = MAP_VIEWBOX.width, H = MAP_VIEWBOX.height;
    const ck = Math.max(1, Math.min(12, k));
    return { x: Math.max(W * (1 - ck), Math.min(0, x)), y: Math.max(H * (1 - ck), Math.min(0, y)), k: ck };
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width * MAP_VIEWBOX.width;
    const my = (e.clientY - rect.top) / rect.height * MAP_VIEWBOX.height;
    const delta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setViewTransform(prev => {
      const rawK = prev.k * delta;
      const kRatio = rawK / prev.k;
      return clamp(mx - kRatio * (mx - prev.x), my - kRatio * (my - prev.y), rawK);
    });
  }, [clamp]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY, tx: viewTransform.x, ty: viewTransform.y };
  }, [viewTransform]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = (e.clientX - panStart.current.x) * (MAP_VIEWBOX.width / rect.width);
    const dy = (e.clientY - panStart.current.y) * (MAP_VIEWBOX.height / rect.height);
    setViewTransform(prev => clamp(panStart.current.tx + dx, panStart.current.ty + dy, prev.k));
  }, [clamp]);

  const handleMouseUp = useCallback(() => { isPanning.current = false; }, []);
  const resetZoom = useCallback(() => setViewTransform({ x: 0, y: 0, k: 1 }), []);
  const zoomIn  = useCallback(() => setViewTransform(prev => {
    const cx = MAP_VIEWBOX.width / 2, cy = MAP_VIEWBOX.height / 2;
    const rawK = prev.k * 1.5;
    return clamp(cx - (rawK / prev.k) * (cx - prev.x), cy - (rawK / prev.k) * (cy - prev.y), rawK);
  }), [clamp]);
  const zoomOut = useCallback(() => setViewTransform(prev => {
    const cx = MAP_VIEWBOX.width / 2, cy = MAP_VIEWBOX.height / 2;
    const rawK = prev.k / 1.5;
    return clamp(cx - (rawK / prev.k) * (cx - prev.x), cy - (rawK / prev.k) * (cy - prev.y), rawK);
  }), [clamp]);

  // ── Zoom hacia hub seleccionado ───────────────────────────────────────────
  const focusOnAirport = useCallback((icao: string) => {
    setSelectedAirportId(prev => prev === icao ? null : icao);
    // Selección directa de aeropuerto: deja de tener sentido cualquier envío fijado.
    setSelectedShipmentId(null);
    setRouteOverlay(null);
    const hub = projectedHubs.find(h => h.id === icao);
    if (!hub) return;
    const targetK = 5;
    const W = MAP_VIEWBOX.width, H = MAP_VIEWBOX.height;
    setViewTransform(clamp(W / 2 - hub.projectedX! * targetK, H / 2 - hub.projectedY! * targetK, targetK));
  }, [projectedHubs, clamp]);

  // Selecciona un vuelo sin togglear — usada por focusOnPlane y por la selección de
  // envíos "en vuelo" (que siempre debe seleccionar, nunca deseleccionar por rebote
  // si ese vuelo ya estaba elegido por otra vía).
  const selectPlaneFlight = useCallback((flightId: string, fromIcao: string, toIcao: string) => {
    setSelectedFlightId(flightId);
    const origin = projectedHubs.find(h => h.id === fromIcao);
    const dest   = projectedHubs.find(h => h.id === toIcao);
    if (!origin || !dest) return;
    const cx = (origin.projectedX! + dest.projectedX!) / 2;
    const cy = (origin.projectedY! + dest.projectedY!) / 2;
    const targetK = 4;
    const W = MAP_VIEWBOX.width, H = MAP_VIEWBOX.height;
    setViewTransform(clamp(W / 2 - cx * targetK, H / 2 - cy * targetK, targetK));
  }, [projectedHubs, clamp]);

  // ── Zoom hacia avión seleccionado (clic directo en el mapa/panel) ─────────
  const focusOnPlane = useCallback((plane: OpsPlane) => {
    if (plane.flightId === selectedFlightId) {
      setSelectedFlightId(null);
      setSelectedShipmentId(null);
      setRouteOverlay(null);
      return;
    }
    setSelectedShipmentId(null);
    setRouteOverlay(null);
    setInfoPanelTab('flights');
    selectPlaneFlight(plane.flightId, plane.fromIcao, plane.toIcao);
  }, [selectedFlightId, selectPlaneFlight]);

  // ── Rutas deduplicadas ─────────────────────────────────────────────────────
  const uniqueRoutes = useMemo(() => {
    const seen = new Set<string>();
    return projectedFlights.filter(f => {
      const key = [f.originId, f.destinationId].sort().join('-');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [projectedFlights]);

  // ── Pares de ruta activos ─────────────────────────────────────────────────
  const activeRoutePairs = useMemo(() => {
    const s = new Set<string>();
    planes.forEach(p => s.add(`${p.fromIcao}-${p.toIcao}`));
    return s;
  }, [planes]);

  const activeHubs = useMemo(() => {
    const s = new Set<string>();
    planes.forEach(p => { s.add(p.fromIcao); s.add(p.toIcao); });
    return s;
  }, [planes]);

  const hubIndex = useMemo(() => new Map(projectedHubs.map(h => [h.id, h])), [projectedHubs]);

  const INACTIVE_OPACITY = selectedFlightId || selectedAirportId ? 0.04 : 0.08;

  // ── Datos convertidos para SimulationInfoPanel ────────────────────────────
  const opsAirportList = useMemo((): SimAirport[] =>
    Array.from(airports.values()).map(toSimAirport),
  [airports]);

  const opsFlightList = useMemo((): SimFlight[] =>
    planes.map(toSimFlight),
  [planes]);

  // ── Ruta / hub del vuelo seleccionado ─────────────────────────────────────
  // Si el vuelo seleccionado está en el aire, sale de `planes` (fuente de verdad
  // en vivo). Si es un vuelo asignado pero aún no despega (seleccionado vía un
  // envío ASIGNADO), no hay avión activo — se resuelve contra la lista de vuelos
  // del API para que la ruta/hubs igual se resalten en el mapa.
  const selectedPlane = useMemo(() => planes.find(p => p.flightId === selectedFlightId) ?? null, [planes, selectedFlightId]);
  const selectedFlight = useMemo(() => {
    if (selectedPlane) return toSimFlight(selectedPlane);
    if (!selectedFlightId) return null;
    const candidates = opsAllFlights.length > 0 ? opsAllFlights : opsFlightList;
    return candidates.find(f => f.flightId === selectedFlightId) ?? null;
  }, [selectedPlane, selectedFlightId, opsAllFlights, opsFlightList]);

  // Todos los flightIds de planes son "activos" (están en el mapa)
  const activeFlightIds = useMemo(() => new Set(planes.map(p => p.flightId)), [planes]);

  // Color de hub por ocupación
  const hubColor = (pct: number, empty: boolean) =>
    empty ? '#94a3b8' : pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';

  // Encuadra la cámara para que entren todos los aeropuertos dados.
  const fitToHubs = useCallback((icaos: string[]) => {
    const hubs = icaos
      .map(ic => projectedHubs.find(h => h.id === ic))
      .filter((h): h is typeof projectedHubs[0] => !!h);
    if (hubs.length === 0) return;
    const xs = hubs.map(h => h.projectedX!);
    const ys = hubs.map(h => h.projectedY!);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 120;
    const kX = MAP_VIEWBOX.width  / (maxX - minX + pad * 2);
    const kY = MAP_VIEWBOX.height / (maxY - minY + pad * 2);
    const k  = Math.max(1, Math.min(8, Math.min(kX, kY)));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    setViewTransform(clamp(
      MAP_VIEWBOX.width  / 2 - cx * k,
      MAP_VIEWBOX.height / 2 - cy * k,
      k,
    ));
  }, [projectedHubs, clamp]);

  // Seleccionar un envío: trae su ruta completa y la dibuja, y además selecciona el
  // vuelo correspondiente — igual que en SimulationDashboardView:
  // - Tramo EN VUELO (DEPARTED): selecciona el avión real vía planes (fromIcao/toIcao).
  // - Tramo ASIGNADO (PLANNED, aún no despega): selecciona el vuelo programado
  //   correspondiente vía la lista de vuelos del API (fromIcao/toIcao/depTime, con
  //   1 min de tolerancia — el endpoint de ruta no expone el flightId del tramo).
  // No hay tarjeta flotante: el envío queda fijado en su propia pestaña, y si el
  // vuelo resuelto se revisa luego desde la pestaña Vuelos, aparece fijado también.
  const focusOnShipment = useCallback(async (s: SimShipment) => {
    if (!ops?.id) return;
    if (selectedShipmentId === s.shipmentId) {
      setSelectedShipmentId(null);
      setRouteOverlay(null);
      setSelectedFlightId(null);
      return;
    }
    try {
      const legs = await simulationService.getShipmentRoute(ops.id, s.shipmentId);
      if (legs.length === 0) return;
      setSelectedShipmentId(s.shipmentId);
      setRouteOverlay({ shipmentId: s.shipmentId, legs });
      setSelectedAirportId(null);

      const inFlightLeg = legs.find(l => l.state === 'DEPARTED');
      const plannedLeg  = !inFlightLeg ? legs.find(l => l.state === 'PLANNED') : undefined;

      if (inFlightLeg) {
        const plane = planes.find(p => p.fromIcao === inFlightLeg.fromIcao && p.toIcao === inFlightLeg.toIcao);
        if (plane) {
          selectPlaneFlight(plane.flightId, plane.fromIcao, plane.toIcao);
          return;
        }
      } else if (plannedLeg) {
        const plannedDepMs = new Date(plannedLeg.depTime).getTime();
        const candidateFlights = opsAllFlights.length > 0 ? opsAllFlights : opsFlightList;
        const matchedFlight = candidateFlights.find(f =>
          f.fromIcao === plannedLeg.fromIcao && f.toIcao === plannedLeg.toIcao &&
          Math.abs(new Date(f.depTime).getTime() - plannedDepMs) < 60_000
        );
        if (matchedFlight) {
          setSelectedFlightId(matchedFlight.flightId);
          return;
        }
      }

      // Sin vuelo resoluble: solo mostrar la ruta.
      setSelectedFlightId(null);
      fitToHubs([legs[0].fromIcao, ...legs.map(l => l.toIcao)]);
    } catch { /* silencioso */ }
  }, [ops?.id, selectedShipmentId, planes, opsAllFlights, opsFlightList, selectPlaneFlight, fitToHubs]);

  // Enfocar un envío pedido desde fuera (p. ej. el botón "Ver en el mapa" de
  // Tracking). Solo necesita el shipmentId: focusOnShipment no usa otros campos
  // del SimShipment antes de traer la ruta real por API.
  useEffect(() => {
    if (!focusRequest || !ops?.id) return;
    setInfoPanelOpen(true);
    setInfoPanelTab('packages');
    focusOnShipment({ shipmentId: focusRequest.shipmentId } as SimShipment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce, ops?.id]);

  return (
    <div className="absolute inset-0 w-full h-full bg-slate-100">

      {/* ── MAPA ──────────────────────────────────────────────────────────── */}
      <svg
        ref={svgRef}
        className="w-full h-full"
        style={{ cursor: isPanning.current ? 'grabbing' : 'grab' }}
        viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <defs>
          <filter id="ops-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="ops-plane-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <g transform={`translate(${viewTransform.x},${viewTransform.y}) scale(${viewTransform.k})`}>
          {/* Océano */}
          <rect x="0" y="0" width={MAP_VIEWBOX.width} height={MAP_VIEWBOX.height} fill="#a8cfe8" />

          {/* Países — todos sin filtrar */}
          {worldData && pathGenerator && (
            <g className="countries">
              {worldData.features.map((feature: any, i: number) => (
                <path
                  key={i}
                  d={pathGenerator(feature) || ''}
                  fill="#dde6ee"
                  stroke="#6b8299"
                  strokeWidth={Math.max(0.5, 1.2 / viewTransform.k)}
                  strokeLinejoin="round"
                />
              ))}
            </g>
          )}

          {/* Rutas */}
          <g className="routes">
            {uniqueRoutes.map(flight => {
              const isActive = activeRoutePairs.has(`${flight.originId}-${flight.destinationId}`) ||
                               activeRoutePairs.has(`${flight.destinationId}-${flight.originId}`);
              const isSelected = selectedFlight &&
                ((flight.originId === selectedFlight.fromIcao && flight.destinationId === selectedFlight.toIcao) ||
                 (flight.originId === selectedFlight.toIcao   && flight.destinationId === selectedFlight.fromIcao));

              if (isSelected) {
                return (
                  <path
                    key={flight.id}
                    d={flight.projectedPath}
                    stroke="#f59e0b"
                    strokeWidth={1.5 / viewTransform.k}
                    fill="none"
                    opacity={0.95}
                  />
                );
              }
              if (isActive) {
                const dimmed = !!(selectedFlightId || selectedAirportId) && !isSelected;
                return (
                  <path
                    key={flight.id}
                    d={flight.projectedPath}
                    stroke="#ef4444"
                    strokeWidth={0.8 / viewTransform.k}
                    fill="none"
                    opacity={dimmed ? 0.10 : 0.45}
                  />
                );
              }
              return (
                <path
                  key={flight.id}
                  d={flight.projectedPath}
                  stroke="#94a3b8"
                  strokeWidth={0.3 / viewTransform.k}
                  fill="none"
                  strokeDasharray={`${2 / viewTransform.k} ${6 / viewTransform.k}`}
                  opacity={INACTIVE_OPACITY * 0.6}
                />
              );
            })}
          </g>

          {/* Rutas canceladas — parpadeo temporal (D14/D15, LE-62) */}
          {cancelledRoutes.length > 0 && (
            <g className="cancelled-routes">
              {cancelledRoutes.map(c => {
                const o = hubIndex.get(c.fromIcao);
                const d = hubIndex.get(c.toIcao);
                if (!o || !d) return null;
                const dist = Math.sqrt((d.projectedX! - o.projectedX!) ** 2 + (d.projectedY! - o.projectedY!) ** 2);
                const ccx = (o.projectedX! + d.projectedX!) / 2;
                const ccy = (o.projectedY! + d.projectedY!) / 2 - dist * 0.2;
                const midX = 0.25 * o.projectedX! + 0.5 * ccx + 0.25 * d.projectedX!;
                const midY = 0.25 * o.projectedY! + 0.5 * ccy + 0.25 * d.projectedY!;
                return (
                  <g key={c.key}>
                    <path
                      d={`M ${o.projectedX} ${o.projectedY} Q ${ccx} ${ccy} ${d.projectedX} ${d.projectedY}`}
                      stroke="#dc2626"
                      strokeWidth={1.4 / viewTransform.k}
                      fill="none"
                      strokeLinecap="round"
                      strokeDasharray={`${6 / viewTransform.k} ${4 / viewTransform.k}`}
                    >
                      <animate attributeName="opacity" values="0.95;0.15;0.95" dur="1.1s" repeatCount="indefinite" />
                    </path>
                    <circle cx={midX} cy={midY} r={6 / viewTransform.k} fill="#dc2626">
                      <animate attributeName="opacity" values="1;0.3;1" dur="1.1s" repeatCount="indefinite" />
                    </circle>
                    <text
                      x={midX} y={midY + 2.4 / viewTransform.k}
                      textAnchor="middle" fill="white"
                      className="pointer-events-none"
                      style={{ fontSize: `${7 / viewTransform.k}px`, fontWeight: 900 }}
                    >
                      ✕
                    </text>
                  </g>
                );
              })}
            </g>
          )}

          {/* Ruta del envío seleccionado (escalas / directo) */}
          {routeOverlay && (
            <g className="shipment-route">
              {routeOverlay.legs.map((leg, i) => {
                const o = hubIndex.get(leg.fromIcao);
                const d = hubIndex.get(leg.toIcao);
                if (!o || !d) return null;
                const dist = Math.sqrt((d.projectedX! - o.projectedX!) ** 2 + (d.projectedY! - o.projectedY!) ** 2);
                const cx = (o.projectedX! + d.projectedX!) / 2;
                const cy = (o.projectedY! + d.projectedY!) / 2 - dist * 0.2;
                const path = `M ${o.projectedX} ${o.projectedY} Q ${cx} ${cy} ${d.projectedX} ${d.projectedY}`;
                const color = leg.state === 'ARRIVED' ? '#10b981'
                            : leg.state === 'DEPARTED' ? '#f59e0b'
                            : '#2563eb';
                const planned = leg.state === 'PLANNED';
                return (
                  <path
                    key={`${leg.fromIcao}-${leg.toIcao}-${i}`}
                    d={path}
                    stroke={color}
                    strokeWidth={(planned ? 1.6 : 2.0) / viewTransform.k}
                    fill="none"
                    opacity={0.95}
                    strokeLinecap="round"
                    strokeDasharray={planned ? `${5 / viewTransform.k} ${4 / viewTransform.k}` : undefined}
                  />
                );
              })}
              {/* Marcadores: origen, escalas y destino */}
              {[routeOverlay.legs[0]?.fromIcao, ...routeOverlay.legs.map(l => l.toIcao)]
                .filter((ic, idx, arr) => ic && ic !== arr[idx - 1])
                .map((ic, idx, arr) => {
                  const h = hubIndex.get(ic!);
                  if (!h) return null;
                  const isOrigin = idx === 0;
                  const isDest   = idx === arr.length - 1;
                  const fillDot = isOrigin ? '#10b981' : isDest ? '#2563eb' : '#f59e0b';
                  const r = (isOrigin || isDest ? 3.4 : 2.6) / viewTransform.k;
                  return (
                    <g key={`stop-${ic}-${idx}`}>
                      <circle cx={h.projectedX!} cy={h.projectedY!} r={r + 1.5 / viewTransform.k} fill="white" opacity={0.9} />
                      <circle cx={h.projectedX!} cy={h.projectedY!} r={r} fill={fillDot} />
                      <text
                        x={h.projectedX!}
                        y={h.projectedY! - (r + 3 / viewTransform.k)}
                        textAnchor="middle"
                        fontSize={5 / viewTransform.k}
                        fontWeight={700}
                        fill="#0f172a"
                        style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 1.5 / viewTransform.k }}
                      >
                        {ic}
                      </text>
                    </g>
                  );
                })}
            </g>
          )}

          {/* Aviones en vivo */}
          <g className="planes" filter="url(#ops-plane-glow)">
            {planes.map(plane => {
              const origin = hubIndex.get(plane.fromIcao);
              const dest   = hubIndex.get(plane.toIcao);
              if (!origin || !dest) return null;
              const isHighlighted = plane.flightId === selectedFlightId;
              const isDimmed = selectedFlightId && !isHighlighted;
              return (
                <g
                  key={plane.key}
                  opacity={isDimmed ? 0.2 : 1}
                  style={{ cursor: 'pointer' }}
                  onClick={() => focusOnPlane(plane)}
                  onMouseEnter={(e) => {
                    const r = svgRef.current?.parentElement?.getBoundingClientRect();
                    setPlaneTooltip({ plane, screenX: e.clientX - (r?.left ?? 0), screenY: e.clientY - (r?.top ?? 0) });
                  }}
                  onMouseMove={(e) => {
                    if (!planeTooltip) return;
                    const r = svgRef.current?.parentElement?.getBoundingClientRect();
                    setPlaneTooltip(prev => prev ? { ...prev, screenX: e.clientX - (r?.left ?? 0), screenY: e.clientY - (r?.top ?? 0) } : null);
                  }}
                  onMouseLeave={() => setPlaneTooltip(null)}
                >
                  <AnimatedPlane
                    x1={origin.projectedX!} y1={origin.projectedY!}
                    x2={dest.projectedX!}   y2={dest.projectedY!}
                    startedAt={plane.startedAt}
                    durationMs={plane.durationMs}
                    iconScale={1 / viewTransform.k}
                    highlighted={isHighlighted}
                    capacity={plane.capacity}
                    occupied={plane.occupied}
                  />
                </g>
              );
            })}
          </g>

          {/* Hubs */}
          <g className="hubs">
            {projectedHubs.map(hub => {
              const x = hub.projectedX!, y = hub.projectedY!;
              const opsAirport = airports.get(hub.id);
              const load     = opsAirport?.load ?? hub.currentStorage;
              const capacity = opsAirport?.capacity ?? hub.storageCapacity;
              const pct = capacity > 0 ? (load / capacity) * 100 : 0;
              const r = 5 / viewTransform.k;
              const hasActive = activeHubs.has(hub.id);
              const isSelected = selectedAirportId === hub.id ||
                (selectedFlight ? hub.id === selectedFlight.fromIcao || hub.id === selectedFlight.toIcao : false);
              const isDimmed = !!(selectedFlightId || selectedAirportId) && !isSelected;
              const isAirportSelected = selectedAirportId === hub.id;
              const fill = isAirportSelected
                ? '#6366f1'
                : (selectedFlight && (hub.id === selectedFlight.fromIcao || hub.id === selectedFlight.toIcao))
                  ? '#f59e0b'
                  : hubColor(pct, load === 0);

              return (
                <g
                  key={hub.id}
                  opacity={isDimmed ? 0.25 : 1}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => {
                    const r2 = svgRef.current?.parentElement?.getBoundingClientRect();
                    setHubTooltip({ hub, screenX: e.clientX - (r2?.left ?? 0), screenY: e.clientY - (r2?.top ?? 0) });
                  }}
                  onMouseMove={(e) => {
                    if (!hubTooltip) return;
                    const r2 = svgRef.current?.parentElement?.getBoundingClientRect();
                    setHubTooltip(prev => prev ? { ...prev, screenX: e.clientX - (r2?.left ?? 0), screenY: e.clientY - (r2?.top ?? 0) } : null);
                  }}
                  onMouseLeave={() => setHubTooltip(null)}
                  onClick={() => {
                    focusOnAirport(hub.id);
                    setSelectedFlightId(null);
                    setInfoPanelOpen(true);
                    setInfoPanelTab('airports');
                  }}
                >
                  {/* Zona hover ampliada */}
                  <circle cx={x} cy={y} r={r * 3} fill="transparent" />
                  {/* Halo azul activo */}
                  {hasActive && (
                    <>
                      <circle cx={x} cy={y} r={r * 2.4} fill="rgba(59,130,246,0.12)" />
                      <circle cx={x} cy={y} r={r * 2.8}
                        fill="none" stroke="#94a3b8"
                        strokeWidth={1.2 / viewTransform.k}
                        strokeDasharray={`${3.5 / viewTransform.k} ${2.5 / viewTransform.k}`} />
                    </>
                  )}
                  {/* Halo de selección */}
                  {isSelected && (
                    <circle cx={x} cy={y} r={r * 2.8}
                      fill="none" stroke={isAirportSelected ? '#6366f1' : '#f59e0b'}
                      strokeWidth={1.2 / viewTransform.k}
                      strokeDasharray={`${3.5 / viewTransform.k} ${2.5 / viewTransform.k}`} />
                  )}
                  {/* Diamante — marcador de aeropuerto */}
                  <rect
                    x={x - r * 0.82} y={y - r * 0.82}
                    width={r * 1.64} height={r * 1.64}
                    rx={r * 0.28}
                    fill={fill}
                    stroke="white"
                    strokeWidth={1.4 / viewTransform.k}
                    transform={`rotate(45,${x},${y})`}
                  />
                  {/* Cruz de pistas */}
                  <line x1={x - r * 0.42} y1={y} x2={x + r * 0.42} y2={y}
                    stroke="white" strokeWidth={0.9 / viewTransform.k} strokeLinecap="round" />
                  <line x1={x} y1={y - r * 0.42} x2={x} y2={y + r * 0.42}
                    stroke="white" strokeWidth={0.9 / viewTransform.k} strokeLinecap="round" />
                  {/* Etiqueta */}
                  <rect
                    x={x - 28 / viewTransform.k} y={y - 20 / viewTransform.k}
                    width={56 / viewTransform.k} height={12 / viewTransform.k}
                    rx={3 / viewTransform.k} fill="rgba(255,255,255,0.88)"
                    className="pointer-events-none"
                  />
                  <text
                    x={x} y={y - 11 / viewTransform.k}
                    textAnchor="middle" fill="#1e293b"
                    className="pointer-events-none"
                    style={{ fontSize: `${9 / viewTransform.k}px`, fontWeight: 700 }}
                  >
                    {hub.city.length > 10 ? hub.city.substring(0, 10) + '…' : hub.city}
                  </text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {/* ── TOOLTIP HUB ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {hubTooltip && (() => {
          const hub = hubTooltip.hub;
          const opsAp = airports.get(hub.id);
          const tooltipLoad = opsAp?.load ?? hub.currentStorage;
          const tooltipCap  = opsAp?.capacity ?? hub.storageCapacity;
          const pct = tooltipCap > 0 ? Math.round((tooltipLoad / tooltipCap) * 100) : 0;
          const statusColor = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : tooltipLoad === 0 ? '#94a3b8' : '#10b981';
          const statusLabel = pct >= 90 ? 'Crítico' : pct >= 70 ? 'En alerta' : tooltipLoad === 0 ? 'Vacío' : 'Óptimo';
          const activeCount = planes.filter(p => p.fromIcao === hub.id || p.toIcao === hub.id).length;
          const containerRect = svgRef.current?.parentElement?.getBoundingClientRect();
          if (!containerRect) return null;
          const relX = hubTooltip.screenX - containerRect.left;
          const relY = hubTooltip.screenY - containerRect.top;
          const flipX = relX > containerRect.width  * 0.7;
          const flipY = relY > containerRect.height * 0.7;
          return (
            <motion.div key="hub-tip"
              initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.12 }}
              className="absolute z-50 pointer-events-none"
              style={{
                left: flipX ? relX - 4 : relX + 12,
                top:  flipY ? relY - 4 : relY + 12,
                transform: `${flipX ? 'translateX(-100%)' : ''} ${flipY ? 'translateY(-100%)' : ''}`,
              }}
            >
              <div className="bg-white/97 backdrop-blur-md rounded-2xl border border-slate-200 shadow-2xl px-4 py-3 min-w-[190px]">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: statusColor }} />
                  <div>
                    <p className="text-[12px] font-black text-slate-900 leading-tight">{hub.city}</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest font-mono">{hub.id}</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-500 font-semibold">Almacenamiento</span>
                    <span className="text-[10px] font-black text-slate-800 font-mono">{tooltipLoad.toLocaleString()} / {tooltipCap.toLocaleString()}</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: statusColor }} />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: statusColor }}>{statusLabel}</span>
                    <span className="text-[9px] text-slate-400 font-mono">{pct}%</span>
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between items-center">
                  <span className="text-[10px] text-slate-500 font-semibold">Vuelos activos</span>
                  <span className="text-[10px] font-black text-slate-800 font-mono">{activeCount}</span>
                </div>
                {hub.continent && (
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-[10px] text-slate-500 font-semibold">Continente</span>
                    <span className="text-[10px] font-bold text-slate-600">{hub.continent}</span>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ── TOOLTIP AVIÓN ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {planeTooltip && (() => {
          const p = planeTooltip.plane;
          const pct = p.capacity > 0 ? Math.round((p.occupied / p.capacity) * 100) : 0;
          const loadColor = p.capacity === 0 ? '#2563eb' : pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';
          const loadLabel = p.capacity === 0 ? 'Sin datos' : pct >= 90 ? 'Capacidad crítica' : pct >= 70 ? 'Casi lleno' : 'Normal';
          const flipX = planeTooltip.screenX > 700;
          const flipY = planeTooltip.screenY > 400;
          return (
            <motion.div key="plane-tip"
              initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.12 }}
              className="absolute z-50 pointer-events-none"
              style={{
                left: flipX ? planeTooltip.screenX - 4 : planeTooltip.screenX + 14,
                top:  flipY ? planeTooltip.screenY - 4 : planeTooltip.screenY + 14,
                transform: `${flipX ? 'translateX(-100%)' : ''} ${flipY ? 'translateY(-100%)' : ''}`,
              }}
            >
              <div className="bg-white/97 backdrop-blur-md rounded-2xl border border-slate-200 shadow-2xl px-4 py-3 min-w-[200px]">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-4 h-4 shrink-0" style={{ color: loadColor }}>✈</div>
                  <div>
                    <p className="text-[12px] font-black text-slate-900 leading-tight">{p.flightId}</p>
                    <p className="text-[9px] font-bold text-slate-400 font-mono uppercase tracking-widest">En vuelo</p>
                  </div>
                </div>
                <div className="space-y-1 text-[10px]">
                  <div className="flex justify-between"><span className="text-slate-500 font-semibold">Origen</span><span className="font-black text-slate-800 font-mono">{p.fromIcao}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500 font-semibold">Destino</span><span className="font-black text-slate-800 font-mono">{p.toIcao}</span></div>
                </div>
                {p.capacity > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-slate-100 space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-slate-500 font-semibold">Carga</span>
                      <span className="text-[10px] font-black text-slate-800 font-mono">{p.occupied.toLocaleString()} / {p.capacity.toLocaleString()}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: loadColor }} />
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: loadColor }}>{loadLabel}</span>
                      <span className="text-[9px] text-slate-400 font-mono">{pct}%</span>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ── CONTROLES DE ZOOM (debajo de la barra superior del header) ──────── */}
      <div className="absolute top-[72px] left-4 z-20 flex flex-col gap-1.5">
        <button onClick={zoomIn} title="Acercar"
          className="w-9 h-9 bg-white/90 backdrop-blur-md rounded-xl border border-slate-200 shadow-lg flex items-center justify-center hover:bg-slate-50 transition-colors text-slate-700">
          <ZoomIn className="w-4 h-4" />
        </button>
        <button onClick={zoomOut} title="Alejar"
          className="w-9 h-9 bg-white/90 backdrop-blur-md rounded-xl border border-slate-200 shadow-lg flex items-center justify-center hover:bg-slate-50 transition-colors text-slate-700">
          <ZoomOut className="w-4 h-4" />
        </button>
        <button onClick={resetZoom} title="Restablecer zoom"
          className="w-9 h-9 bg-white/90 backdrop-blur-md rounded-xl border border-slate-200 shadow-lg flex items-center justify-center hover:bg-slate-50 transition-colors text-slate-700 text-xs font-bold">
          ⌂
        </button>
      </div>

      {/* ── BOTÓN LEYENDA (inferior izquierda) ──────────────────────────────── */}
      <div className="absolute bottom-4 left-4 z-30 flex flex-col gap-2 items-start">
        <AnimatePresence>
          {legendOpen && (
            <motion.div key="pop-legend"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.15 }}
              className="w-[240px] bg-white/97 backdrop-blur-md rounded-2xl border border-slate-200 shadow-2xl p-4"
            >
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-700 mb-3">Leyenda</p>
              <div className="space-y-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Aeropuertos ◆</p>
                <LegendRow dot="bg-slate-400"   label="Almacén vacío" />
                <LegendRow dot="bg-emerald-500" label="Almacén óptimo" />
                <LegendRow dot="bg-amber-500"   label="En alerta (>70%)" />
                <LegendRow dot="bg-red-500"     label="Punto crítico (>90%)" />
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 pt-1">Aviones</p>
                <LegendRow dot="bg-emerald-500" label="Carga normal" />
                <LegendRow dot="bg-amber-500"   label="Casi lleno (>70%)" />
                <LegendRow dot="bg-red-500"     label="Capacidad crítica" />
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 pt-1">Rutas</p>
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-px bg-red-400 rounded" />
                  <span className="text-[10px] font-semibold text-slate-600">Ruta activa</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="flex gap-0.5">{[0,1,2].map(i => <div key={i} className="w-1.5 h-px bg-slate-400" />)}</div>
                  <span className="text-[10px] font-semibold text-slate-600">Ruta disponible</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-px bg-red-600 rounded animate-pulse" />
                  <span className="text-[10px] font-semibold text-slate-600">Ruta cancelada (parpadea)</span>
                </div>
                <div className="pt-1.5 border-t border-slate-100 text-[9px] text-slate-400">
                  Rueda del ratón para zoom · Arrastrar para desplazar
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <button
          onClick={() => setLegendOpen(v => !v)}
          className={cn(
            'px-3 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-lg',
            legendOpen ? 'bg-slate-800 text-white' : 'bg-white/90 backdrop-blur-md text-slate-600 border border-slate-200 hover:bg-slate-50'
          )}
        >
          <MapIcon className="w-4 h-4" /> Leyenda
        </button>
        {ops?.id && (
          <SlaAlertsButton
            shipments={opsShipments}
            simNowMs={lastSimUpdate?.simMs ?? null}
            onSelectShipment={(s) => {
              setInfoPanelOpen(true);
              setInfoPanelTab('packages');
              focusOnShipment(s);
            }}
          />
        )}
        {ops?.id && (
          <button
            onClick={() => setCancelModalOpen(true)}
            className="px-3 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-lg bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20"
            title="Inyectar cancelaciones de vuelos (manual o aleatoria)"
          >
            <XCircle className="w-4 h-4" /> Cancelar vuelos
          </button>
        )}
        {ops?.id && (
          <button
            onClick={() => setReportOpen(true)}
            className="px-3 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-lg bg-white/90 backdrop-blur-md text-slate-700 border border-slate-200 hover:bg-slate-50"
            title="Reporte de la última planificación estable de la operación"
          >
            <FileText className="w-4 h-4" /> Reporte
          </button>
        )}
      </div>

      {/* ── PANEL DE INFORMACIÓN (derecha): Aeropuertos · Vuelos ─────────────── */}
      <AnimatePresence>
        {infoPanelOpen && (
          <motion.div
            key="ops-info-panel"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className="absolute top-4 right-4 bottom-4 z-30 w-[46%] min-w-[400px] max-w-[640px] flex flex-col"
          >
            <button
              onClick={() => setInfoPanelOpen(false)}
              className="absolute -left-3 top-1/2 -translate-y-1/2 z-10 w-7 h-12 bg-white rounded-l-xl border border-slate-200 shadow-lg flex items-center justify-center text-slate-500 hover:text-indigo-600 hover:bg-slate-50 transition-colors"
              title="Ocultar paneles"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <SimulationInfoPanel
              sessionId={ops?.id ?? null}
              hasSession={true}
              airports={opsAirportList}
              flights={opsAllFlights.length > 0 ? opsAllFlights : opsFlightList}
              shipments={opsShipments}
              selectedAirportId={selectedAirportId}
              selectedFlightId={selectedFlightId}
              selectedShipmentId={selectedShipmentId}
              onSelectAirport={(icao) => {
                focusOnAirport(icao);
                setSelectedFlightId(null);
              }}
              onSelectFlight={(sf) => {
                const plane = planes.find(p => p.flightId === sf.flightId);
                if (plane) {
                  focusOnPlane(plane);
                } else {
                  setSelectedShipmentId(null);
                  setRouteOverlay(null);
                  setSelectedFlightId(prev => prev === sf.flightId ? null : sf.flightId);
                  setInfoPanelTab('flights');
                }
              }}
              onSelectShipment={focusOnShipment}
              activeTab={infoPanelTab}
              onTabChange={setInfoPanelTab}
              activeFlightIds={activeFlightIds}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Botón para reabrir el panel */}
      {!infoPanelOpen && (
        <button
          onClick={() => setInfoPanelOpen(true)}
          className="absolute top-1/2 right-0 -translate-y-1/2 z-30 px-2 py-3 bg-white rounded-l-xl border border-slate-200 shadow-lg flex flex-col items-center gap-1.5 text-slate-600 hover:text-indigo-600 hover:bg-slate-50 transition-colors"
          title="Mostrar paneles"
        >
          <ChevronLeft className="w-4 h-4" />
          <LayoutGrid className="w-4 h-4" />
        </button>
      )}

      {/* ── MODAL: Cancelar vuelos (LE-70/LE-71) ─────────────────────────────── */}
      <AnimatePresence>
        {cancelModalOpen && ops?.id && (
          <FlightCancelModal sessionId={ops.id} onClose={() => setCancelModalOpen(false)} />
        )}
      </AnimatePresence>

      {/* ── MODAL: Reporte de la última planificación estable (G09) ──────────── */}
      {reportOpen && ops?.id && (
        <SummaryReportModal
          title="Reporte de operación"
          subtitle="Última planificación estable — Operación Día a Día"
          sessionId={ops.id}
          onClose={() => setReportOpen(false)}
        />
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
      `}</style>
    </div>
  );
});
