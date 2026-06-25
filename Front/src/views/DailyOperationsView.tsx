import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import {
  Map as MapIcon, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, LayoutGrid,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useMap, MAP_VIEWBOX } from '../providers/MapProvider';
import { useOperationsContext, OpsPlane } from '../providers/OperationsProvider';
import { AnimatedPlane } from '../components/map/AnimatedPlane';
import { SimulationInfoPanel } from './SimulationInfoPanel';
import type { SimAirport, SimFlight } from '../services/simulationService';
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

export const DailyOperationsView: React.FC = React.memo(() => {
  const { worldData, pathGenerator, projectedHubs, projectedFlights } = useMap();
  const { planes, airports } = useOperationsContext();

  // ── Panel lateral derecho ─────────────────────────────────────────────────
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const [infoPanelTab, setInfoPanelTab]   = useState<'airports' | 'flights' | 'packages'>('airports');

  // ── Estado de selección ──────────────────────────────────────────────────
  const [selectedAirportId, setSelectedAirportId] = useState<string | null>(null);
  const [selectedFlightId,  setSelectedFlightId]  = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);

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
    const hub = projectedHubs.find(h => h.id === icao);
    if (!hub) return;
    const targetK = 5;
    const W = MAP_VIEWBOX.width, H = MAP_VIEWBOX.height;
    setViewTransform(clamp(W / 2 - hub.projectedX! * targetK, H / 2 - hub.projectedY! * targetK, targetK));
  }, [projectedHubs, clamp]);

  // ── Zoom hacia avión seleccionado ─────────────────────────────────────────
  const focusOnPlane = useCallback((plane: OpsPlane) => {
    setSelectedFlightId(prev => prev === plane.flightId ? null : plane.flightId);
    setInfoPanelTab('flights');
    const origin = projectedHubs.find(h => h.id === plane.fromIcao);
    const dest   = projectedHubs.find(h => h.id === plane.toIcao);
    if (!origin || !dest) return;
    const cx = (origin.projectedX! + dest.projectedX!) / 2;
    const cy = (origin.projectedY! + dest.projectedY!) / 2;
    const targetK = 4;
    const W = MAP_VIEWBOX.width, H = MAP_VIEWBOX.height;
    setViewTransform(clamp(W / 2 - cx * targetK, H / 2 - cy * targetK, targetK));
  }, [projectedHubs, clamp]);

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

  // ── Ruta / hub del vuelo seleccionado ─────────────────────────────────────
  const selectedPlane  = useMemo(() => planes.find(p => p.flightId === selectedFlightId) ?? null, [planes, selectedFlightId]);
  const selectedFlight = useMemo(() => selectedPlane ? toSimFlight(selectedPlane) : null, [selectedPlane]);

  const INACTIVE_OPACITY = selectedFlightId || selectedAirportId ? 0.04 : 0.08;

  // ── Datos convertidos para SimulationInfoPanel ────────────────────────────
  const opsAirportList = useMemo((): SimAirport[] =>
    Array.from(airports.values()).map(toSimAirport),
  [airports]);

  const opsFlightList = useMemo((): SimFlight[] =>
    planes.map(toSimFlight),
  [planes]);

  // Todos los flightIds de planes son "activos" (están en el mapa)
  const activeFlightIds = useMemo(() => new Set(planes.map(p => p.flightId)), [planes]);

  // Color de hub por ocupación
  const hubColor = (pct: number, empty: boolean) =>
    empty ? '#94a3b8' : pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';

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

          {/* Aviones en vivo */}
          <g className="planes" filter="url(#ops-plane-glow)">
            {planes.map(plane => {
              const origin = hubIndex.get(plane.fromIcao);
              const dest   = hubIndex.get(plane.toIcao);
              if (!origin || !dest) return null;
              const isHighlighted = plane.flightId === selectedFlightId;
              return (
                <g
                  key={plane.key}
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
              sessionId={null}
              hasSession={true}
              airports={opsAirportList}
              flights={opsFlightList}
              shipments={[]}
              selectedAirportId={selectedAirportId}
              selectedFlightId={selectedFlightId}
              onSelectAirport={(icao) => {
                focusOnAirport(icao);
                setSelectedFlightId(null);
              }}
              onSelectFlight={(sf) => {
                const plane = planes.find(p => p.flightId === sf.flightId);
                if (plane) focusOnPlane(plane);
              }}
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

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
      `}</style>
    </div>
  );
});
