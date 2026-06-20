import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import {
  Package, CheckCircle2, AlertTriangle, Globe, BarChart3, Map as MapIcon,
  Plane, ChevronDown, ChevronUp, ZoomIn, ZoomOut, Radio, Clock, Activity,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useMap, MAP_VIEWBOX } from '../providers/MapProvider';
import { useOperationsContext, OpsPlane } from '../providers/OperationsProvider';
import { AnimatedPlane } from '../components/map/AnimatedPlane';
import { cn } from '../lib/utils';

// Países sin operación que podrían caer dentro del recuadro de la región y se ocultan
// para que el mapa solo muestre la zona de vuelos (ISO 3166-1 numérico, como en
// world-atlas): EE.UU. 840, Canadá 124, Rusia 643, Australia 36, Antártida 10,
// Groenlandia 304, Nueva Zelanda 554.
const HIDDEN_COUNTRY_IDS = new Set([840, 124, 643, 36, 10, 304, 554]);

// ── Reloj ──────────────────────────────────────────────────────────────────
const MONTHS_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function fmtDate(d: Date) {
  return `${String(d.getUTCDate()).padStart(2,'0')} ${MONTHS_ES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function fmtTime(d: Date) {
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}

// ── Panel colapsable flotante ──────────────────────────────────────────────
function CollapsiblePanel({
  title, icon, defaultOpen = false, children, className,
}: {
  title: string; icon: React.ReactNode; defaultOpen?: boolean;
  children: React.ReactNode; className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn(
      'bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 shadow-xl overflow-hidden min-w-[220px] max-w-[300px]',
      className,
    )}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-blue-600">{icon}</span>
          <span className="text-[11px] font-black uppercase tracking-widest text-slate-700">{title}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
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
            <div className="px-4 pb-4 border-t border-slate-100">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const DailyOperationsView: React.FC = React.memo(() => {
  const { worldData, pathGenerator, projectedHubs, projectedFlights } = useMap();
  const { ops, connected, planes, airports, metrics, events, lastSimUpdate, activeFlightCount } = useOperationsContext();

  // ── Reloj simulado en vivo (≈ tiempo real con speedFactor=1) ───────────────
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  const displayDate = useMemo(() => {
    const sf = ops?.speedFactor ?? 1;
    if (lastSimUpdate) return new Date(lastSimUpdate.simMs + (now - lastSimUpdate.realMs) * sf);
    if (ops?.simTime) return new Date(ops.simTime);
    return new Date(now);
  }, [now, lastSimUpdate, ops?.speedFactor, ops?.simTime]);

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
  // La proyección ya viene encuadrada en la región (MapProvider.fitExtent), así que
  // restablecer = vista completa del lienzo (= región), sin zonas sin vuelos.
  const resetZoom = useCallback(() => setViewTransform({ x: 0, y: 0, k: 1 }), []);
  const zoomBy = useCallback((factor: number) => {
    setViewTransform(prev => {
      const cx = MAP_VIEWBOX.width / 2, cy = MAP_VIEWBOX.height / 2;
      const rawK = prev.k * factor;
      return clamp(cx - (rawK / prev.k) * (cx - prev.x), cy - (rawK / prev.k) * (cy - prev.y), rawK);
    });
  }, [clamp]);

  // ── Rutas deduplicadas ──────────────────────────────────────────────────────
  const uniqueRoutes = useMemo(() => {
    const seen = new Set<string>();
    return projectedFlights.filter(f => {
      const key = [f.originId, f.destinationId].sort().join('-');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [projectedFlights]);

  // ── Pares de ruta con vuelo activo ──────────────────────────────────────────
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

  // ── Tooltip de avión ────────────────────────────────────────────────────────
  const [planeTip, setPlaneTip] = useState<{ plane: OpsPlane; x: number; y: number } | null>(null);

  // ── Carga viva por hub (desde el snapshot del backend) ──────────────────────
  const hubLoad = useCallback((icao: string, fallbackCap: number) => {
    const a = airports.get(icao);
    const capacity = a?.capacity || fallbackCap || 0;
    const load = a?.load ?? 0;
    const pct = capacity > 0 ? (load / capacity) * 100 : 0;
    return { load, capacity, pct };
  }, [airports]);

  const statusColor = (pct: number) => pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';

  // Resumen de carga total
  const totalLoad = useMemo(() => {
    let load = 0, pending = 0;
    airports.forEach(a => { load += a.load; pending += a.pending; });
    return { load, pending };
  }, [airports]);

  const statusLabel = ops?.status ?? '—';

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
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="ops-plane-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <g transform={`translate(${viewTransform.x},${viewTransform.y}) scale(${viewTransform.k})`}>
          <rect x="0" y="0" width={MAP_VIEWBOX.width} height={MAP_VIEWBOX.height} fill="#a8cfe8" />

          {worldData && pathGenerator && (
            <g className="countries">
              {worldData.features
                .filter((feature: any) => !HIDDEN_COUNTRY_IDS.has(Number(feature.id)))
                .map((feature: any, i: number) => (
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
              return (
                <path
                  key={flight.id}
                  d={flight.projectedPath}
                  stroke={isActive ? '#ef4444' : '#94a3b8'}
                  strokeWidth={isActive ? 1.6 / viewTransform.k : 0.5 / viewTransform.k}
                  fill="none"
                  strokeDasharray={isActive ? undefined : `${3 / viewTransform.k} ${5 / viewTransform.k}`}
                  opacity={isActive ? 0.9 : 0.28}
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
              return (
                <g
                  key={plane.key}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => {
                    const r = svgRef.current?.parentElement?.getBoundingClientRect();
                    setPlaneTip({ plane, x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) });
                  }}
                  onMouseLeave={() => setPlaneTip(null)}
                >
                  <AnimatedPlane
                    x1={origin.projectedX!} y1={origin.projectedY!}
                    x2={dest.projectedX!}   y2={dest.projectedY!}
                    startedAt={plane.startedAt}
                    durationMs={plane.durationMs}
                    iconScale={1 / viewTransform.k}
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
              const { pct } = hubLoad(hub.id, hub.storageCapacity);
              const r = 5 / viewTransform.k, rInner = 2 / viewTransform.k;
              const hasActive = activeHubs.has(hub.id);
              const fill = statusColor(pct);
              return (
                <g key={hub.id}>
                  {hasActive && (
                    <circle cx={x} cy={y} r={r * 2.1} fill="rgba(16,185,129,0.16)" />
                  )}
                  <circle cx={x} cy={y} r={r} fill={fill} filter="url(#ops-glow)"
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

      {/* ── Tooltip de avión ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {planeTip && (() => {
          const p = planeTip.plane;
          const pct = p.capacity > 0 ? Math.round((p.occupied / p.capacity) * 100) : 0;
          const color = p.capacity === 0 ? '#2563eb' : pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';
          const flipX = planeTip.x > 700, flipY = planeTip.y > 400;
          return (
            <motion.div
              key="ops-plane-tip"
              initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.12 }}
              className="absolute z-50 pointer-events-none"
              style={{
                left: flipX ? planeTip.x - 4 : planeTip.x + 14,
                top:  flipY ? planeTip.y - 4 : planeTip.y + 14,
                transform: `${flipX ? 'translateX(-100%)' : ''} ${flipY ? 'translateY(-100%)' : ''}`,
              }}
            >
              <div className="bg-white/97 backdrop-blur-md rounded-2xl border border-slate-200 shadow-2xl px-4 py-3 min-w-[200px]">
                <div className="flex items-center gap-2 mb-2.5">
                  <Plane className="w-4 h-4 shrink-0" style={{ color }} />
                  <div>
                    <p className="text-[12px] font-black text-slate-900 leading-tight">{p.flightId}</p>
                    <p className="text-[9px] font-bold text-slate-400 font-mono uppercase tracking-widest">En vuelo</p>
                  </div>
                </div>
                <div className="space-y-1 text-[10px]">
                  <Row label="Origen"  value={p.fromIcao} mono />
                  <Row label="Destino" value={p.toIcao} mono />
                  <Row label="Carga"   value={p.capacity > 0 ? `${p.occupied}/${p.capacity} (${pct}%)` : '—'} mono />
                </div>
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ── Controles de zoom ──────────────────────────────────────────────── */}
      <div className="absolute bottom-5 left-5 z-20 flex flex-col gap-1.5">
        <ZoomBtn onClick={() => zoomBy(1.5)} title="Acercar"><ZoomIn className="w-4 h-4" /></ZoomBtn>
        <ZoomBtn onClick={() => zoomBy(1 / 1.5)} title="Alejar"><ZoomOut className="w-4 h-4" /></ZoomBtn>
        <ZoomBtn onClick={resetZoom} title="Restablecer">⌂</ZoomBtn>
      </div>

      {/* ── Badge LIVE + reloj ─────────────────────────────────────────────── */}
      <div className="absolute top-5 left-5 z-20 flex flex-col gap-2 items-start">
        <div className="flex items-center gap-2 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-200 shadow-xl">
          <Radio className={cn('w-4 h-4', connected ? 'text-emerald-600' : 'text-slate-400')} />
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-900">
            Operación Día a Día
          </span>
          <div className={cn('w-1.5 h-1.5 rounded-full ml-1', connected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300')} />
        </div>
        <div className="flex items-center gap-2 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-200 shadow">
          <Clock className="w-3.5 h-3.5 text-blue-600" />
          <div className="flex flex-col leading-none">
            <span className="tabular-nums font-black text-slate-900 text-xs tracking-wide">{fmtDate(displayDate)}</span>
            <span className="tabular-nums font-mono text-slate-500 text-[10px] mt-0.5">
              {fmtTime(displayDate)} UTC
              <span className="ml-1.5 text-indigo-400 font-bold">
                {ops?.speedFactor && ops.speedFactor !== 1 ? `(x${ops.speedFactor})` : '(tiempo real)'}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* ── Paneles superior-derecha ───────────────────────────────────────── */}
      <div className="absolute top-5 right-5 z-20 flex flex-col gap-3 items-end">
        <CollapsiblePanel title="Operación en vivo" icon={<Activity className="w-4 h-4" />} defaultOpen>
          <div className="pt-3 space-y-3">
            <MetricRow icon={<Plane className="w-4 h-4 text-blue-500" />} label="Vuelos en aire" value={`${activeFlightCount}`} />
            <MetricRow icon={<Package className="w-4 h-4 text-indigo-500" />} label="En almacén" value={`${totalLoad.load}`} />
            <MetricRow icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />} label="Entregadas" value={`${metrics?.delivered ?? 0}`} />
            <MetricRow icon={<Activity className="w-4 h-4 text-amber-500" />} label="Pendientes" value={`${metrics?.pending ?? totalLoad.pending}`} />
            <MetricRow
              icon={<AlertTriangle className="w-4 h-4 text-rose-500" />}
              label="SLA vencidas" value={`${metrics?.slaBreaches ?? 0}`}
              valueClass={(metrics?.slaBreaches ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-600'}
            />
          </div>
        </CollapsiblePanel>

        <CollapsiblePanel title="Leyenda" icon={<MapIcon className="w-4 h-4" />}>
          <div className="pt-3 space-y-2.5">
            <LegendRow dot="bg-emerald-500" label="Hub óptimo" />
            <LegendRow dot="bg-amber-500" label="Hub en alerta (>70%)" />
            <LegendRow dot="bg-red-500" label="Hub crítico (>90%)" />
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-0.5 bg-red-500" />
              <span className="text-[10px] font-semibold text-slate-600">Ruta con vuelo activo</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Plane className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-[10px] font-semibold text-slate-600">Vuelo en curso (hoy)</span>
            </div>
          </div>
        </CollapsiblePanel>

        {events.length > 0 && (
          <CollapsiblePanel title={`Eventos (${events.length})`} icon={<Activity className="w-4 h-4" />}>
            <div className="pt-3 space-y-1.5 max-h-48 overflow-y-auto ops-scroll pr-1">
              {events.slice(0, 20).map(ev => (
                <div key={ev.id} className="text-[10px] text-slate-600 bg-slate-50 rounded-lg px-2 py-1.5 border border-slate-100">
                  {ev.message}
                </div>
              ))}
            </div>
          </CollapsiblePanel>
        )}
      </div>

      {/* ── Estado de hubs (inferior-izquierda) ────────────────────────────── */}
      <div className="absolute bottom-5 left-20 z-20">
        <CollapsiblePanel title="Estado de Hubs" icon={<BarChart3 className="w-4 h-4" />} className="max-w-[280px]">
          <div className="pt-3 space-y-3 max-h-52 overflow-y-auto ops-scroll pr-1">
            {projectedHubs.map(hub => {
              const { load, capacity, pct } = hubLoad(hub.id, hub.storageCapacity);
              const c = statusColor(pct);
              return (
                <div key={hub.id} className="space-y-1">
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider">
                    <span className="text-slate-600">{hub.city}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400 font-mono">{load}/{capacity}</span>
                      <span style={{ color: c }}>{Math.round(pct)}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div animate={{ width: `${Math.min(100, pct)}%` }} className="h-full rounded-full" style={{ background: c }} />
                  </div>
                </div>
              );
            })}
          </div>
        </CollapsiblePanel>
      </div>

      {/* ── Resumen de red (inferior-derecha) ──────────────────────────────── */}
      <div className="absolute bottom-5 right-5 z-20">
        <CollapsiblePanel title="Resumen de Red" icon={<Globe className="w-4 h-4" />}>
          <div className="pt-3 space-y-2.5">
            <SummaryRow label="Estado sesión" value={statusLabel} />
            <SummaryRow label="Total hubs" value={`${projectedHubs.length}`} />
            <SummaryRow label="Rutas activas" value={`${activeRoutePairs.size}`} valueClass="text-blue-600" />
            <SummaryRow label="Vuelos en aire" value={`${activeFlightCount}`} />
            <SummaryRow label="Bultos en almacén" value={`${totalLoad.load}`} />
          </div>
        </CollapsiblePanel>
      </div>

      <style>{`
        .ops-scroll::-webkit-scrollbar { width: 3px; }
        .ops-scroll::-webkit-scrollbar-track { background: transparent; }
        .ops-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
      `}</style>
    </div>
  );
});

// ── helpers ──────────────────────────────────────────────────────────────────
function ZoomBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title}
      className="w-9 h-9 bg-white/90 backdrop-blur-md rounded-xl border border-slate-200 shadow-lg flex items-center justify-center hover:bg-slate-50 transition-colors text-slate-700 text-xs font-bold">
      {children}
    </button>
  );
}

function MetricRow({ icon, label, value, valueClass }: { icon: React.ReactNode; label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[10px] font-semibold text-slate-600">{label}</span>
      </div>
      <span className={cn('text-[11px] font-black tabular-nums', valueClass || 'text-slate-900')}>{value}</span>
    </div>
  );
}

function LegendRow({ dot, label }: { dot: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={cn('w-3 h-3 rounded-full shrink-0', dot)} />
      <span className="text-[10px] font-semibold text-slate-600">{label}</span>
    </div>
  );
}

function SummaryRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="text-[10px] text-slate-500 font-semibold capitalize">{label}</span>
      <span className={cn('text-[11px] font-black', valueClass || 'text-slate-900')}>{value}</span>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500 font-semibold">{label}</span>
      <span className={cn('font-black text-slate-800', mono && 'font-mono')}>{value}</span>
    </div>
  );
}
