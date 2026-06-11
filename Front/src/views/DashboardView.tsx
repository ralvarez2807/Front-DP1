import React, { useMemo, useState, useRef, useCallback } from 'react';
import {
  Package, Truck, CheckCircle2, AlertTriangle,
  Globe, BarChart3, Map as MapIcon, Plane,
  ChevronDown, ChevronUp, ZoomIn, ZoomOut,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useMonitoringContext } from '../providers/MonitoringProvider';
import { useSimulationContext } from '../providers/SimulationProvider';
import { useMap, MAP_VIEWBOX } from '../providers/MapProvider';
import { cn } from '../lib/utils';
import { Hub, Flight } from '../models/infrastructure';
import { Shipment } from '../models/operational';

interface DashboardViewProps {
  hubs: Hub[];
  flights: Flight[];
  shipments: Shipment[];
  activeRoutes: Set<string>;
  day: number;
  hour: number;
  getStorageStatus: (current: number, capacity: number) => 'green' | 'amber' | 'red';
  setHoveredHub: (hub: any) => void;
  setHoveredRoute: (route: any) => void;
  setMousePos: (pos: { x: number; y: number }) => void;
}

// Panel colapsable flotante
function CollapsiblePanel({
  title,
  icon,
  defaultOpen = false,
  children,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn(
      "bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 shadow-xl overflow-hidden min-w-[220px] max-w-[300px]",
      className
    )}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-blue-600">{icon}</span>
          <span className="text-[11px] font-black uppercase tracking-widest text-slate-700">{title}</span>
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-slate-100">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const DashboardView: React.FC<DashboardViewProps> = React.memo(({
  hubs,
  flights,
  shipments,
  activeRoutes,
  getStorageStatus,
  setHoveredHub,
  setHoveredRoute,
  setMousePos,
}) => {
  const { metrics, alerts } = useMonitoringContext();
  const { session } = useSimulationContext();
  const { worldData, pathGenerator, projectedHubs, projectedFlights } = useMap();

  const time = session?.currentTimeAt || 0;
  const day = Math.floor(time / 24) + 1;
  const hour = time % 24;

  // ── Zoom / Pan (mismos límites que SimulationDashboardView) ──────────────
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewTransform, setViewTransform] = useState({ x: 0, y: 0, k: 1 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  const clamp = useCallback((x: number, y: number, k: number) => {
    const W = MAP_VIEWBOX.width;
    const H = MAP_VIEWBOX.height;
    const clampedK = Math.max(1, Math.min(12, k));
    const clampedX = Math.max(W * (1 - clampedK), Math.min(0, x));
    const clampedY = Math.max(H * (1 - clampedK), Math.min(0, y));
    return { x: clampedX, y: clampedY, k: clampedK };
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
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
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = MAP_VIEWBOX.width / rect.width;
    const scaleY = MAP_VIEWBOX.height / rect.height;
    const dx = (e.clientX - panStart.current.x) * scaleX;
    const dy = (e.clientY - panStart.current.y) * scaleY;
    setViewTransform(prev => clamp(panStart.current.tx + dx, panStart.current.ty + dy, prev.k));
  }, [clamp]);

  const handleMouseUp = useCallback(() => { isPanning.current = false; }, []);

  const resetZoom = useCallback(() => setViewTransform({ x: 0, y: 0, k: 1 }), []);
  const zoomIn = useCallback(() => {
    setViewTransform(prev => {
      const cx = MAP_VIEWBOX.width / 2, cy = MAP_VIEWBOX.height / 2;
      const rawK = prev.k * 1.5;
      return clamp(cx - (rawK / prev.k) * (cx - prev.x), cy - (rawK / prev.k) * (cy - prev.y), rawK);
    });
  }, [clamp]);
  const zoomOut = useCallback(() => {
    setViewTransform(prev => {
      const cx = MAP_VIEWBOX.width / 2, cy = MAP_VIEWBOX.height / 2;
      const rawK = prev.k / 1.5;
      return clamp(cx - (rawK / prev.k) * (cx - prev.x), cy - (rawK / prev.k) * (cy - prev.y), rawK);
    });
  }, [clamp]);

  // ── Rutas deduplicadas (misma lógica que Simulación) ────────────────────
  const uniqueRoutes = useMemo(() => {
    const seen = new Set<string>();
    return projectedFlights.filter(f => {
      const key = [f.originId, f.destinationId].sort().join('-');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [projectedFlights]);

  return (
    <div className="absolute inset-0 w-full h-full">

      {/* ── MAPA (base, ocupa todo) — mismos colores que Simulación ──────── */}
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
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <g transform={`translate(${viewTransform.x},${viewTransform.y}) scale(${viewTransform.k})`}>
          {/* Océano — mismo color que Simulación */}
          <rect x="0" y="0" width={MAP_VIEWBOX.width} height={MAP_VIEWBOX.height} fill="#a8cfe8" />

          {/* Países — mismos colores que Simulación */}
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

          <g className="routes">
            {uniqueRoutes.map(flight => {
              const isActive = activeRoutes.has(flight.id) ||
                activeRoutes.has(projectedFlights.find(
                  f => f.originId === flight.destinationId && f.destinationId === flight.originId
                )?.id ?? '');
              return (
                <path
                  key={flight.id}
                  d={flight.projectedPath}
                  stroke={isActive ? '#ef4444' : '#94a3b8'}
                  strokeWidth={isActive ? 2 / viewTransform.k : 0.6 / viewTransform.k}
                  fill="none"
                  strokeDasharray={isActive ? undefined : `${3 / viewTransform.k} ${5 / viewTransform.k}`}
                  opacity={isActive ? 0.9 : 0.4}
                  className="cursor-help transition-all duration-300 hover:opacity-80"
                  onMouseEnter={(e) => { setHoveredRoute(flight); setMousePos({ x: e.clientX, y: e.clientY }); }}
                  onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHoveredRoute(null)}
                />
              );
            })}
          </g>

          <g className="hubs">
            {projectedHubs.map(hub => {
              const x = hub.projectedX!;
              const y = hub.projectedY!;
              const status = getStorageStatus(hub.currentStorage, hub.storageCapacity);
              const r = 5 / viewTransform.k;
              const rInner = 2 / viewTransform.k;
              const fillColor = status === 'red' ? '#ef4444' : status === 'amber' ? '#f59e0b' : '#10b981';
              return (
                <g
                  key={hub.id}
                  className="cursor-pointer"
                  onMouseEnter={(e) => { setHoveredHub(hub); setMousePos({ x: e.clientX, y: e.clientY }); }}
                  onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHoveredHub(null)}
                >
                  <circle cx={x} cy={y} r={r} fill={fillColor} filter="url(#glow)"
                    stroke="white" strokeWidth={1.5 / viewTransform.k} />
                  <circle cx={x} cy={y} r={rInner} fill="white" />
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

      {/* ── CONTROLES DE ZOOM ───────────────────────────────────────────────── */}
      <div className="absolute bottom-5 left-5 z-20 flex flex-col gap-1.5">
        <button onClick={zoomIn}
          className="w-9 h-9 bg-white/90 backdrop-blur-md rounded-xl border border-slate-200 shadow-lg flex items-center justify-center hover:bg-slate-50 transition-colors text-slate-700"
          title="Acercar">
          <ZoomIn className="w-4 h-4" />
        </button>
        <button onClick={zoomOut}
          className="w-9 h-9 bg-white/90 backdrop-blur-md rounded-xl border border-slate-200 shadow-lg flex items-center justify-center hover:bg-slate-50 transition-colors text-slate-700"
          title="Alejar">
          <ZoomOut className="w-4 h-4" />
        </button>
        <button onClick={resetZoom}
          className="w-9 h-9 bg-white/90 backdrop-blur-md rounded-xl border border-slate-200 shadow-lg flex items-center justify-center hover:bg-slate-50 transition-colors text-slate-700 text-xs font-bold"
          title="Restablecer zoom">
          ⌂
        </button>
      </div>

      {/* ── BADGE LIVE (top-left) ───────────────────────────────── */}
      <div className="absolute top-5 left-5 z-20 flex items-center gap-2 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-200 shadow-xl">
        <MapIcon className="w-4 h-4 text-blue-600" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-900">
          Live Backend Operations
        </span>
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse ml-1" />
      </div>

      {/* ── SESIÓN / TIEMPO (top-left, bajo el badge) ─────────── */}
      <div className="absolute top-14 left-5 z-20 flex items-center gap-2 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-200 shadow">
        <Globe className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
          Sesión: {session?.id || 'PROD_LIVE'} · Día {day} · {String(hour).padStart(2, '0')}:00
        </span>
      </div>

      {/* ── PANELES FLOTANTES (esquina superior derecha, apilados) ── */}
      <div className="absolute top-5 right-5 z-20 flex flex-col gap-3 items-end">

        {/* MÉTRICAS */}
        <CollapsiblePanel title="Métricas" icon={<BarChart3 className="w-4 h-4" />} defaultOpen>
          <div className="pt-3 space-y-3">
            <MetricRow
              icon={<Package className="w-4 h-4 text-blue-500" />}
              label="Volumen Total"
              value={`${metrics?.deliveredBaggageToday || 0} und`}
            />
            <MetricRow
              icon={<Truck className="w-4 h-4 text-amber-500" />}
              label="Flujo Activo"
              value={`${metrics?.activeBaggageCount || shipments.length} env`}
            />
            <MetricRow
              icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
              label="SLA Health"
              value={`${metrics?.networkHealthScore || 98}%`}
            />
            <MetricRow
              icon={<AlertTriangle className="w-4 h-4 text-rose-500" />}
              label="Alertas Críticas"
              value={`${alerts.length} err`}
              valueClass={alerts.length > 0 ? 'text-rose-600' : 'text-emerald-600'}
            />
          </div>
        </CollapsiblePanel>

        {/* LEYENDA */}
        <CollapsiblePanel title="Leyenda" icon={<MapIcon className="w-4 h-4" />}>
          <div className="pt-3 space-y-2.5">
            <LegendRow dot="bg-emerald-500" label="Hub en estado óptimo" />
            <LegendRow dot="bg-amber-500" label="Hub en alerta (>70% cap.)" />
            <LegendRow dot="bg-red-500" label="Hub en punto crítico" />
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-0.5">
                <div className="w-6 h-0.5 bg-red-500" />
              </div>
              <span className="text-[10px] font-semibold text-slate-600">Ruta activa (con carga)</span>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-0.5">
                {[0,1,2].map(i => <div key={i} className="w-1.5 h-0.5 bg-slate-400" />)}
              </div>
              <span className="text-[10px] font-semibold text-slate-600">Ruta disponible (sin carga)</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Plane className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-[10px] font-semibold text-slate-600">Tránsito internacional</span>
            </div>
          </div>
        </CollapsiblePanel>

        {/* ALERTAS */}
        {alerts.length > 0 && (
          <CollapsiblePanel title={`Alertas (${alerts.length})`} icon={<AlertTriangle className="w-4 h-4 text-rose-500" />}>
            <div className="pt-3 space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-1">
              {alerts.slice(0, 10).map((alert: any, i: number) => (
                <div key={i} className="text-[10px] text-rose-700 bg-rose-50 rounded-lg px-2 py-1.5 border border-rose-100">
                  {alert.message || alert.description || JSON.stringify(alert)}
                </div>
              ))}
            </div>
          </CollapsiblePanel>
        )}
      </div>

      {/* ── ESTADO DE HUBS (esquina inferior izquierda) ─────────── */}
      <div className="absolute bottom-5 left-5 z-20">
        <CollapsiblePanel title="Estado de Hubs" icon={<BarChart3 className="w-4 h-4" />} className="max-w-[280px]">
          <div className="pt-3 space-y-3 max-h-52 overflow-y-auto custom-scrollbar pr-1">
            {hubs.map(hub => {
              const status = getStorageStatus(hub.currentStorage, hub.storageCapacity);
              const pct = Math.min(100, (hub.currentStorage / (hub.storageCapacity || 1)) * 100);
              return (
                <div key={hub.id} className="space-y-1">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider">
                    <span className="text-slate-600">{hub.city}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400 font-mono">{hub.currentStorage}/{hub.storageCapacity}</span>
                      <span className={cn(
                        status === 'red' ? 'text-red-500' : status === 'amber' ? 'text-amber-600' : 'text-emerald-600'
                      )}>{Math.round(pct)}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div
                      animate={{ width: `${pct}%` }}
                      className={cn(
                        'h-full rounded-full',
                        status === 'red' ? 'bg-red-500' : status === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'
                      )}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CollapsiblePanel>
      </div>

      {/* ── RESUMEN RED (esquina inferior derecha) ───────────────── */}
      <div className="absolute bottom-5 right-5 z-20">
        <CollapsiblePanel title="Resumen de Red" icon={<Globe className="w-4 h-4" />}>
          <div className="pt-3 space-y-2.5">
            <div className="flex items-center justify-between gap-6">
              <span className="text-[10px] text-slate-500 font-semibold">Total hubs</span>
              <span className="text-[11px] font-black text-slate-900">{hubs.length}</span>
            </div>
            <div className="flex items-center justify-between gap-6">
              <span className="text-[10px] text-slate-500 font-semibold">Rutas activas</span>
              <span className="text-[11px] font-black text-blue-600">{activeRoutes.size}</span>
            </div>
            <div className="flex items-center justify-between gap-6">
              <span className="text-[10px] text-slate-500 font-semibold">Total vuelos</span>
              <span className="text-[11px] font-black text-slate-900">{flights.length}</span>
            </div>
            <div className="flex items-center justify-between gap-6">
              <span className="text-[10px] text-slate-500 font-semibold">Envíos en tránsito</span>
              <span className="text-[11px] font-black text-slate-900">{shipments.length}</span>
            </div>
          </div>
        </CollapsiblePanel>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
      `}</style>
    </div>
  );
});

// ── helpers ────────────────────────────────────────────────────────────────

function MetricRow({ icon, label, value, valueClass }: { icon: React.ReactNode; label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[10px] font-semibold text-slate-600">{label}</span>
      </div>
      <span className={cn("text-[11px] font-black tabular-nums", valueClass || 'text-slate-900')}>{value}</span>
    </div>
  );
}

function LegendRow({ dot, label }: { dot: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={cn("w-3 h-3 rounded-full shrink-0", dot)} />
      <span className="text-[10px] font-semibold text-slate-600">{label}</span>
    </div>
  );
}
