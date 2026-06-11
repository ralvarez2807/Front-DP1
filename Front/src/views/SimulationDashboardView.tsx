import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  Play, Pause, RotateCcw, Settings2, Database,
  Activity, Map as MapIcon, Globe,
  ChevronDown, ChevronUp, AlertTriangle, ZoomIn, ZoomOut,
} from 'lucide-react';
import { Plane } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useSimulationContext } from '../providers/SimulationProvider';
import { useSocket } from '../providers/SocketProvider';
import { useMap, MAP_VIEWBOX } from '../providers/MapProvider';
import { cn } from '../lib/utils';
import { SCENARIOS, SCENARIO_LABELS, SimulationScenario } from '../constants/domain';

// ── Velocidad visual fija: 1 día simulado = 15 min reales (96 sim-h / real-h)
// El backend corre más rápido; aquí controlamos solo la animación visual.
const VISUAL_SPEED = 96; // sim-horas por hora real

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
      'bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 shadow-xl overflow-hidden min-w-[220px] max-w-[310px]',
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
        {open ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
               : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-slate-100">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
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

// ── Helpers ────────────────────────────────────────────────────────────────
function formatCapacity(occupied: number, capacity: number): string {
  if (capacity === 0) return '—';
  const pct = Math.round((occupied / capacity) * 100);
  return `${occupied}/${capacity} (${pct}%)`;
}

// ── Tipos para aviones en vuelo ────────────────────────────────────────────
interface ActivePlane {
  key: string;
  flightId: string;
  fromIcao: string;
  toIcao: string;
  startedAt: number;
  durationMs: number;
  capacity: number;
  occupied: number;
}

interface SeenFlight {
  flightId: string;
  fromIcao: string;
  toIcao: string;
  seenAt: number;
  isActive: boolean;
}

function getPlaneColor(occupied: number, capacity: number, highlighted: boolean): string {
  if (highlighted) return '#f59e0b';
  if (capacity === 0) return '#2563eb';
  const pct = (occupied / capacity) * 100;
  if (pct >= 90) return '#ef4444';
  if (pct >= 70) return '#f59e0b';
  return '#10b981';
}

// ── Componente de avión animado a lo largo de un arco ─────────────────────
function AnimatedPlane({
  x1, y1, x2, y2,
  startedAt,
  durationMs,
  iconScale = 1,
  highlighted = false,
  capacity = 0,
  occupied = 0,
}: {
  x1: number; y1: number; x2: number; y2: number;
  startedAt: number;
  durationMs: number;
  iconScale?: number;
  highlighted?: boolean;
  capacity?: number;
  occupied?: number;
}) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number>();

  useEffect(() => {
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const p = Math.min(elapsed / durationMs, 1);
      setProgress(p);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [startedAt, durationMs]);

  const pos = useMemo(() => {
    // Mismo control point que arcPath en MapProvider: punto medio - 20% de la distancia
    const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2 - dist * 0.2;
    const t = progress;
    const mt = 1 - t;
    const x = mt * mt * x1 + 2 * mt * t * cx + t * t * x2;
    const y = mt * mt * y1 + 2 * mt * t * cy + t * t * y2;
    const dx = 2 * mt * (cx - x1) + 2 * t * (x2 - cx);
    const dy = 2 * mt * (cy - y1) + 2 * t * (y2 - cy);
    // +90 porque la nariz del avión apunta a (0,-8) = arriba en SVG
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    return { x, y, angle };
  }, [x1, y1, x2, y2, progress]);

  if (progress >= 1) return null;

  const color = getPlaneColor(occupied, capacity, highlighted);
  const size = highlighted ? 1.4 : 1;

  return (
    <g transform={`translate(${pos.x},${pos.y}) rotate(${pos.angle}) scale(${iconScale * size})`}>
      {highlighted && <circle cx="0" cy="0" r="14" fill="rgba(245,158,11,0.15)" />}
      {/* Silueta top-down de avión, igual que el ícono de la leyenda */}
      {/* Fuselaje */}
      <ellipse cx="0" cy="0" rx="1.8" ry="7" fill={color} />
      {/* Nariz */}
      <ellipse cx="0" cy="-6.5" rx="1.8" ry="2.5" fill={color} />
      {/* Alas principales */}
      <path d="M-1.5,-1 L-10,3 L-9,5 L-1.5,2 L1.5,2 L9,5 L10,3 L1.5,-1 Z" fill={color} />
      {/* Cola */}
      <path d="M-1.5,5 L-5,8 L-4,9 L-1.5,7 L1.5,7 L4,9 L5,8 L1.5,5 Z" fill={color} />
      {/* Borde blanco para contraste */}
      <ellipse cx="0" cy="0" rx="1.8" ry="7" fill="none" stroke="white" strokeWidth="0.6" />
      <path d="M-1.5,-1 L-10,3 L-9,5 L-1.5,2 L1.5,2 L9,5 L10,3 L1.5,-1 Z" fill="none" stroke="white" strokeWidth="0.5" />
    </g>
  );
}

// ── Vista principal ────────────────────────────────────────────────────────
export const SimulationDashboardView: React.FC = () => {
  const { session, events, createSession, startSimulation, pauseSimulation, resetSimulation, isLoading } = useSimulationContext();
  const socket = useSocket();
  const { worldData, pathGenerator, projectedHubs, projectedFlights } = useMap();

  // ── Rutas deduplicadas — clave canónica para que A→B y B→A usen la misma línea
  const uniqueRoutes = useMemo(() => {
    const seen = new Set<string>();
    return projectedFlights.filter(f => {
      const key = [f.originId, f.destinationId].sort().join('-');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [projectedFlights]);

  // ── Tooltip de hub ────────────────────────────────────────────────────────
  const [hubTooltip, setHubTooltip] = useState<{
    hub: typeof projectedHubs[0];
    screenX: number;
    screenY: number;
  } | null>(null);

  // ── Tooltip de avión ──────────────────────────────────────────────────────
  const [planeTooltip, setPlaneTooltip] = useState<{
    plane: ActivePlane;
    screenX: number;
    screenY: number;
  } | null>(null);

  // ── Timers de limpieza de aviones (cuando termina la animación visual) ────
  const planeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ── Zoom / Pan ────────────────────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewTransform, setViewTransform] = useState({ x: 0, y: 0, k: 1 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  // Clamp para que el mapa siempre cubra el viewport y no se salga por ningún lado
  const clamp = useCallback((x: number, y: number, k: number) => {
    const W = MAP_VIEWBOX.width;
    const H = MAP_VIEWBOX.height;
    const clampedK = Math.max(1, Math.min(12, k)); // mínimo 1 para que siempre cubra
    const clampedX = Math.max(W * (1 - clampedK), Math.min(0, x));
    const clampedY = Math.max(H * (1 - clampedK), Math.min(0, y));
    return { x: clampedX, y: clampedY, k: clampedK };
  }, []);

  const getHubScreenPos = useCallback((hub: typeof projectedHubs[0]) => {
    const svg = svgRef.current;
    if (!svg) return { screenX: 0, screenY: 0 };
    const rect = svg.getBoundingClientRect();
    const svgX = (viewTransform.x + hub.projectedX! * viewTransform.k) / MAP_VIEWBOX.width * rect.width;
    const svgY = (viewTransform.y + hub.projectedY! * viewTransform.k) / MAP_VIEWBOX.height * rect.height;
    return { screenX: rect.left + svgX, screenY: rect.top + svgY };
  }, [viewTransform, projectedHubs]);

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
      const rawX = mx - kRatio * (mx - prev.x);
      const rawY = my - kRatio * (my - prev.y);
      return clamp(rawX, rawY, rawK);
    });
  }, [clamp]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isPanning.current = true;
    panStart.current = {
      x: e.clientX,
      y: e.clientY,
      tx: viewTransform.x,
      ty: viewTransform.y,
    };
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
    setViewTransform(prev =>
      clamp(panStart.current.tx + dx, panStart.current.ty + dy, prev.k)
    );
  }, [clamp]);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const resetZoom = useCallback(() => {
    setViewTransform({ x: 0, y: 0, k: 1 });
  }, []);

  const zoomIn = useCallback(() => {
    setViewTransform(prev => {
      const cx = MAP_VIEWBOX.width / 2;
      const cy = MAP_VIEWBOX.height / 2;
      const rawK = prev.k * 1.5;
      const kRatio = rawK / prev.k;
      return clamp(cx - kRatio * (cx - prev.x), cy - kRatio * (cy - prev.y), rawK);
    });
  }, [clamp]);

  const zoomOut = useCallback(() => {
    setViewTransform(prev => {
      const cx = MAP_VIEWBOX.width / 2;
      const cy = MAP_VIEWBOX.height / 2;
      const rawK = prev.k / 1.5;
      const kRatio = rawK / prev.k;
      return clamp(cx - kRatio * (cx - prev.x), cy - kRatio * (cy - prev.y), rawK);
    });
  }, [clamp]);

  // ── Aviones en vuelo ─────────────────────────────────────────────────────
  const [activePlanes, setActivePlanes] = useState<ActivePlane[]>([]);
  const [seenFlights, setSeenFlights] = useState<SeenFlight[]>([]);

  useEffect(() => {
    const unsubDep = socket.on('FLIGHT_DEPARTED', ({ payload }: { payload: any }) => {
      // Intentar múltiples nombres de campo que el backend podría usar
      const fromIcao = payload?.fromIcao ?? payload?.originIcao ?? payload?.origin ?? payload?.from;
      const toIcao   = payload?.toIcao   ?? payload?.destIcao   ?? payload?.destination ?? payload?.dest ?? payload?.to;

      if (!fromIcao || !toIcao) {
        console.warn('[SimMap] FLIGHT_DEPARTED: campos de ubicación no encontrados. Payload:', JSON.stringify(payload));
        return;
      }

      const fid = payload.flightId ?? payload.id ?? `${fromIcao}-${toIcao}`;
      const key = `${fid}-${fromIcao}-${toIcao}`;

      // Duración visual fija: VISUAL_SPEED = 96 → 1 día sim = 15 min reales.
      // Independiente de la velocidad real del backend.
      const flightHours = payload.durationHours ?? payload.flightDurationHours ?? payload.duration ?? 8;
      const durationMs  = Math.max(30_000, Math.round(flightHours * 3_600_000 / VISUAL_SPEED));

      console.log(`[SimMap] FLIGHT_DEPARTED: ${fromIcao}→${toIcao} | ${flightHours}h sim → ${(durationMs/60000).toFixed(1)} min reales`);

      const capacity = payload.capacity ?? payload.maxCapacity ?? 0;
      const occupied = payload.occupiedCapacity ?? payload.currentLoad ?? payload.loadedPackages ?? 0;

      // Limpiar timer anterior si existe
      const existingTimer = planeTimersRef.current.get(key);
      if (existingTimer) clearTimeout(existingTimer);

      // Registrar timer de limpieza cuando la animación visual termine
      const timer = setTimeout(() => {
        setActivePlanes(prev => prev.filter(p => p.key !== key));
        planeTimersRef.current.delete(key);
      }, durationMs + 500); // +500ms de margen
      planeTimersRef.current.set(key, timer);

      setActivePlanes(prev => [
        ...prev.filter(p => p.key !== key),
        { key, flightId: fid, fromIcao, toIcao, startedAt: Date.now(), durationMs, capacity, occupied },
      ]);
      setSeenFlights(prev => {
        const exists = prev.find(f => f.flightId === fid);
        const entry: SeenFlight = { flightId: fid, fromIcao, toIcao, seenAt: Date.now(), isActive: true };
        return exists
          ? prev.map(f => f.flightId === fid ? entry : f)
          : [entry, ...prev].slice(0, 100);
      });
    });

    // FLIGHT_ARRIVED: solo actualiza el estado en seenFlights.
    // La animación visual termina con su propio timer (VISUAL_SPEED).
    const unsubArr = socket.on('FLIGHT_ARRIVED', ({ payload }: { payload: any }) => {
      const fid = payload?.flightId ?? payload?.id;
      if (!fid) return;
      setSeenFlights(prev =>
        prev.map(f => f.flightId === fid ? { ...f, isActive: false } : f)
      );
    });

    return () => { unsubDep(); unsubArr(); };
  }, [socket]);

  // Al resetear la simulación, limpiar historial y timers pendientes
  useEffect(() => {
    if (!session) {
      setActivePlanes([]);
      setSeenFlights([]);
      setSelectedFlightId(null);
      setFlightQuery('');
      planeTimersRef.current.forEach(t => clearTimeout(t));
      planeTimersRef.current.clear();
    }
  }, [session]);

  // ── Escenario ────────────────────────────────────────────────────────────
  const [selectedScenario, setSelectedScenario] = useState<SimulationScenario>(SCENARIOS.PERIOD_5D);
  const [startDate, setStartDate] = useState('');
  const [showCollapseWarning, setShowCollapseWarning] = useState(false);

  const handleCreate = useCallback(async () => {
    if (selectedScenario === SCENARIOS.COLLAPSE) {
      setShowCollapseWarning(true);
      return;
    }
    await createSession(selectedScenario, selectedScenario === SCENARIOS.PERIOD_5D ? startDate : undefined);
  }, [selectedScenario, startDate, createSession]);

  const confirmCollapse = useCallback(async () => {
    setShowCollapseWarning(false);
    await createSession(SCENARIOS.COLLAPSE);
  }, [createSession]);

  // ── Filtro de vuelos ─────────────────────────────────────────────────────
  const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null);
  const [flightQuery, setFlightQuery] = useState('');

  const filteredFlights = useMemo(() => {
    const q = flightQuery.trim().toUpperCase();
    if (!q) return seenFlights;
    return seenFlights.filter(f =>
      f.flightId.toUpperCase().includes(q) ||
      f.fromIcao.includes(q) ||
      f.toIcao.includes(q)
    );
  }, [seenFlights, flightQuery]);

  // Al seleccionar un vuelo, hacer auto-pan/zoom para centrarlo en el mapa
  const focusOnFlight = useCallback((sf: SeenFlight) => {
    setSelectedFlightId(prev => prev === sf.flightId ? null : sf.flightId);
    const origin = projectedHubs.find(h => h.id === sf.fromIcao);
    const dest   = projectedHubs.find(h => h.id === sf.toIcao);
    if (!origin || !dest) return;
    const cx = (origin.projectedX! + dest.projectedX!) / 2;
    const cy = (origin.projectedY! + dest.projectedY!) / 2;
    const dist = Math.sqrt((dest.projectedX! - origin.projectedX!) ** 2 + (dest.projectedY! - origin.projectedY!) ** 2);
    // zoom proporcional a la distancia: ruta corta = más zoom, ruta larga = menos
    const targetK = Math.max(2, Math.min(8, MAP_VIEWBOX.width / (dist * 1.6)));
    const W = MAP_VIEWBOX.width;
    const H = MAP_VIEWBOX.height;
    setViewTransform(clamp(W / 2 - cx * targetK, H / 2 - cy * targetK, targetK));
  }, [projectedHubs, clamp]);

  // ── Rutas e hubs con vuelo activo ────────────────────────────────────────
  const hubIndex = useMemo(() => new Map(projectedHubs.map(h => [h.id, h])), [projectedHubs]);

  // Vuelo seleccionado en el mapa
  const selectedPlane = useMemo(() =>
    selectedFlightId ? activePlanes.find(p => p.flightId === selectedFlightId) ?? null : null
  , [selectedFlightId, activePlanes]);

  const selectedFlight = useMemo(() =>
    selectedFlightId ? seenFlights.find(f => f.flightId === selectedFlightId) ?? null : null
  , [selectedFlightId, seenFlights]);

  // Clave por par origen-destino para evitar desfases por ID de vuelo
  const activeRoutePairSet = useMemo(() => {
    const s = new Set<string>();
    activePlanes.forEach(p => s.add(`${p.fromIcao}-${p.toIcao}`));
    return s;
  }, [activePlanes]);

  const activeHubSet = useMemo(() => {
    const s = new Set<string>();
    activePlanes.forEach(p => { s.add(p.fromIcao); s.add(p.toIcao); });
    return s;
  }, [activePlanes]);

  const simRunning = session?.status === 'running';
  const hasSession = !!session;

  // Si hay un vuelo seleccionado, atenuar más todo lo demás
  const INACTIVE_OPACITY = selectedFlightId ? 0.02 : (hasSession ? 0.04 : 0.08);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="absolute inset-0 w-full h-full bg-slate-100">

      {/* ── MAPA BASE ──────────────────────────────────────────────────────── */}
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
          <filter id="sim-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="plane-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <g transform={`translate(${viewTransform.x},${viewTransform.y}) scale(${viewTransform.k})`}>
          {/* Océano */}
          <rect x="0" y="0" width={MAP_VIEWBOX.width} height={MAP_VIEWBOX.height} fill="#a8cfe8" />

          {/* Países */}
          {worldData && pathGenerator && (
            <g className="countries">
              {worldData.features.map((feat: any, i: number) => (
                <path
                  key={i}
                  d={pathGenerator(feat) || ''}
                  fill="#dde6ee"
                  stroke="#6b8299"
                  strokeWidth={Math.max(0.5, 1.2 / viewTransform.k)}
                  strokeLinejoin="round"
                />
              ))}
            </g>
          )}

          {/* Rutas de vuelo — una sola línea por par origen-destino */}
          <g className="routes">
            {uniqueRoutes.map(flight => {
              // Verificar ambas direcciones (A→B y B→A)
              const isActive = activeRoutePairSet.has(`${flight.originId}-${flight.destinationId}`) ||
                               activeRoutePairSet.has(`${flight.destinationId}-${flight.originId}`);
              const isSelected = selectedFlight
                ? (flight.originId === selectedFlight.fromIcao && flight.destinationId === selectedFlight.toIcao) ||
                  (flight.originId === selectedFlight.toIcao && flight.destinationId === selectedFlight.fromIcao)
                : false;
              const dimmed = selectedFlightId && !isSelected;

              if (isSelected) {
                return (
                  <path
                    key={flight.id}
                    d={flight.projectedPath}
                    stroke="#f59e0b"
                    strokeWidth={3 / viewTransform.k}
                    fill="none"
                    opacity={0.95}
                    strokeDasharray={!selectedFlight?.isActive ? `${4 / viewTransform.k} ${4 / viewTransform.k}` : undefined}
                  />
                );
              }
              if (isActive) {
                return (
                  <path
                    key={flight.id}
                    d={flight.projectedPath}
                    stroke="#ef4444"
                    strokeWidth={2 / viewTransform.k}
                    fill="none"
                    opacity={dimmed ? 0.15 : 0.9}
                  />
                );
              }
              return (
                <path
                  key={flight.id}
                  d={flight.projectedPath}
                  stroke="#94a3b8"
                  strokeWidth={0.6 / viewTransform.k}
                  fill="none"
                  strokeDasharray={`${3 / viewTransform.k} ${5 / viewTransform.k}`}
                  opacity={INACTIVE_OPACITY}
                />
              );
            })}
          </g>

          {/* Aviones animados */}
          <g className="planes" filter="url(#plane-glow)">
            {activePlanes.map(plane => {
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
                  onMouseEnter={(e) => {
                    const containerRect = svgRef.current?.parentElement?.getBoundingClientRect();
                    setPlaneTooltip({
                      plane,
                      screenX: e.clientX - (containerRect?.left ?? 0),
                      screenY: e.clientY - (containerRect?.top ?? 0),
                    });
                  }}
                  onMouseLeave={() => setPlaneTooltip(null)}
                >
                  <AnimatedPlane
                    x1={origin.projectedX!}
                    y1={origin.projectedY!}
                    x2={dest.projectedX!}
                    y2={dest.projectedY!}
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

          {/* Hubs / aeropuertos */}
          <g className="hubs">
            {projectedHubs.map(hub => {
              const x = hub.projectedX!;
              const y = hub.projectedY!;
              const hasActiveFlights = activeHubSet.has(hub.id);
              const isSelectedHub = selectedFlight
                ? hub.id === selectedFlight.fromIcao || hub.id === selectedFlight.toIcao
                : false;
              const isDimmedHub = selectedFlightId && !isSelectedHub;
              const r = 5 / viewTransform.k;
              const rInner = 2 / viewTransform.k;

              // Color según estado de almacenamiento (como Dashboard)
              const pct = hub.storageCapacity > 0
                ? (hub.currentStorage / hub.storageCapacity) * 100 : 0;
              const storageColor = isSelectedHub
                ? '#f59e0b'
                : pct >= 90 ? '#ef4444'
                : pct >= 70 ? '#f59e0b'
                : '#10b981';

              return (
                <g
                  key={hub.id}
                  opacity={isDimmedHub ? 0.25 : 1}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => {
                    const { screenX, screenY } = getHubScreenPos(hub);
                    setHubTooltip({ hub, screenX, screenY });
                  }}
                  onMouseLeave={() => setHubTooltip(null)}
                >
                  {/* Zona de hover ampliada (invisible) */}
                  <circle cx={x} cy={y} r={r * 3} fill="transparent" />
                  {/* Anillo de pulso cuando hay vuelos activos */}
                  {hasActiveFlights && (
                    <circle cx={x} cy={y} r={r * 2.2}
                      fill={isSelectedHub ? 'rgba(245,158,11,0.18)' : 'rgba(16,185,129,0.18)'} />
                  )}
                  {isSelectedHub && (
                    <circle cx={x} cy={y} r={r * 3}
                      fill="none" stroke="#f59e0b"
                      strokeWidth={1.5 / viewTransform.k}
                      strokeDasharray={`${4 / viewTransform.k} ${3 / viewTransform.k}`} />
                  )}
                  <circle
                    cx={x} cy={y} r={r}
                    fill={storageColor}
                    stroke="white"
                    strokeWidth={1.5 / viewTransform.k}
                  />
                  <circle cx={x} cy={y} r={rInner} fill="white" />
                  {/* Etiqueta */}
                  <rect
                    x={x - 28 / viewTransform.k} y={y - 20 / viewTransform.k}
                    width={56 / viewTransform.k} height={12 / viewTransform.k}
                    rx={3 / viewTransform.k}
                    fill="rgba(255,255,255,0.88)"
                    className="pointer-events-none"
                  />
                  <text
                    x={x} y={y - 11 / viewTransform.k}
                    textAnchor="middle"
                    fill="#1e293b"
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
          const activeFlights = activePlanes.filter(p => p.fromIcao === hub.id || p.toIcao === hub.id).length;
          const pct = hub.storageCapacity > 0
            ? Math.round((hub.currentStorage / hub.storageCapacity) * 100)
            : 0;
          const statusColor = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';
          const statusLabel = pct >= 90 ? 'Crítico' : pct >= 70 ? 'En alerta' : 'Óptimo';

          const svg = svgRef.current;
          const rect = svg?.getBoundingClientRect();
          const containerRect = svg?.parentElement?.getBoundingClientRect();
          if (!rect || !containerRect) return null;
          // posición relativa al contenedor (que tiene position:absolute)
          const relX = hubTooltip.screenX - containerRect.left;
          const relY = hubTooltip.screenY - containerRect.top;
          const flipX = relX > containerRect.width * 0.7;
          const flipY = relY > containerRect.height * 0.7;

          return (
            <motion.div
              key="hub-tooltip"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.12 }}
              className="absolute z-50 pointer-events-none"
              style={{
                left: flipX ? relX - 4 : relX + 12,
                top:  flipY ? relY - 4 : relY + 12,
                transform: `${flipX ? 'translateX(-100%)' : ''} ${flipY ? 'translateY(-100%)' : ''}`,
              }}
            >
              <div className="bg-white/97 backdrop-blur-md rounded-2xl border border-slate-200 shadow-2xl px-4 py-3 min-w-[190px]">
                {/* Cabecera */}
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: statusColor }} />
                  <div>
                    <p className="text-[12px] font-black text-slate-900 leading-tight">{hub.city}</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest font-mono">{hub.id}</p>
                  </div>
                </div>
                {/* Capacidad */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-500 font-semibold">Almacenamiento</span>
                    <span className="text-[10px] font-black text-slate-800 font-mono">
                      {hub.currentStorage.toLocaleString()} / {hub.storageCapacity.toLocaleString()}
                    </span>
                  </div>
                  {/* Barra de progreso */}
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, pct)}%`, background: statusColor }}
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: statusColor }}>
                      {statusLabel}
                    </span>
                    <span className="text-[9px] text-slate-400 font-mono">{pct}%</span>
                  </div>
                </div>
                {/* Vuelos activos */}
                <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between items-center">
                  <span className="text-[10px] text-slate-500 font-semibold">Vuelos activos</span>
                  <span className="text-[10px] font-black text-slate-800 font-mono">{activeFlights}</span>
                </div>
                {/* Continente */}
                <div className="flex justify-between items-center mt-1">
                  <span className="text-[10px] text-slate-500 font-semibold">Continente</span>
                  <span className="text-[10px] font-bold text-slate-600">{hub.continent}</span>
                </div>
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
          const loadColor = p.capacity === 0 ? '#2563eb'
            : pct >= 90 ? '#ef4444'
            : pct >= 70 ? '#f59e0b'
            : '#10b981';
          const loadLabel = p.capacity === 0 ? 'Sin datos'
            : pct >= 90 ? 'Capacidad crítica'
            : pct >= 70 ? 'Casi lleno'
            : 'Normal';
          const flipX = planeTooltip.screenX > 700;
          const flipY = planeTooltip.screenY > 400;
          return (
            <motion.div
              key="plane-tooltip"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
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
                  <Plane className="w-4 h-4 shrink-0" style={{ color: loadColor }} />
                  <div>
                    <p className="text-[12px] font-black text-slate-900 leading-tight">{p.flightId}</p>
                    <p className="text-[9px] font-bold text-slate-400 font-mono uppercase tracking-widest">En vuelo</p>
                  </div>
                </div>
                <div className="space-y-1 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">Origen</span>
                    <span className="font-black text-slate-800 font-mono">{p.fromIcao}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-semibold">Destino</span>
                    <span className="font-black text-slate-800 font-mono">{p.toIcao}</span>
                  </div>
                </div>
                {p.capacity > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-slate-100 space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-slate-500 font-semibold">Carga</span>
                      <span className="text-[10px] font-black text-slate-800 font-mono">
                        {p.occupied.toLocaleString()} / {p.capacity.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min(100, pct)}%`, background: loadColor }} />
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: loadColor }}>
                        {loadLabel}
                      </span>
                      <span className="text-[9px] text-slate-400 font-mono">{pct}%</span>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ── BADGE LIVE ──────────────────────────────────────────────────────── */}
      <div className="absolute top-5 left-5 z-20 flex items-center gap-2 bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-200 shadow-xl">
        <MapIcon className="w-4 h-4 text-indigo-600" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-900">
          Simulación Operacional
        </span>
        {simRunning && (
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse ml-1" />
        )}
      </div>

      {/* ── CONTROLES DE ZOOM (abajo izquierda sobre el mapa) ───────────────── */}
      <div className="absolute bottom-5 left-5 z-20 flex flex-col gap-1.5">
        <button
          onClick={zoomIn}
          className="w-9 h-9 bg-white/90 backdrop-blur-md rounded-xl border border-slate-200 shadow-lg flex items-center justify-center hover:bg-slate-50 transition-colors text-slate-700"
          title="Acercar"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={zoomOut}
          className="w-9 h-9 bg-white/90 backdrop-blur-md rounded-xl border border-slate-200 shadow-lg flex items-center justify-center hover:bg-slate-50 transition-colors text-slate-700"
          title="Alejar"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={resetZoom}
          className="w-9 h-9 bg-white/90 backdrop-blur-md rounded-xl border border-slate-200 shadow-lg flex items-center justify-center hover:bg-slate-50 transition-colors text-slate-700 text-xs font-bold"
          title="Restablecer zoom"
        >
          ⌂
        </button>
        {/* Sesión activa (movida aquí) */}
        {session && (
          <div className="mt-2 bg-white/90 backdrop-blur-md rounded-xl border border-slate-200 shadow-lg px-3 py-2 flex items-center gap-2">
            <Globe className="w-4 h-4 text-indigo-600 shrink-0" />
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Sesión</p>
              <p className="text-[10px] font-black text-slate-700 font-mono">
                {session.id.substring(0, 12)}…
              </p>
            </div>
            <div className={cn(
              'w-2 h-2 rounded-full shrink-0',
              simRunning ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
            )} />
          </div>
        )}
      </div>

      {/* ── PANELES DERECHA ─────────────────────────────────────────────────── */}
      <div className="absolute top-5 right-5 z-20 flex flex-col gap-3">

        {/* Configuración / Escenario */}
        {!session && (
          <CollapsiblePanel
            title="Configurar Simulación"
            icon={<Settings2 className="w-4 h-4" />}
            defaultOpen={false}
            className="max-w-[320px]"
          >
            <div className="pt-3 space-y-4">
              <div className="space-y-2">
                {([SCENARIOS.PERIOD_5D, SCENARIOS.COLLAPSE] as SimulationScenario[]).map(s => (
                  <label
                    key={s}
                    className={cn(
                      'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
                      selectedScenario === s
                        ? s === SCENARIOS.COLLAPSE
                          ? 'border-rose-300 bg-rose-50'
                          : 'border-indigo-300 bg-indigo-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    )}
                  >
                    <input
                      type="radio"
                      name="scenario"
                      value={s}
                      checked={selectedScenario === s}
                      onChange={() => setSelectedScenario(s)}
                      className="mt-0.5 accent-indigo-600"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'text-[11px] font-black',
                          selectedScenario === s
                            ? s === SCENARIOS.COLLAPSE ? 'text-rose-700' : 'text-indigo-700'
                            : 'text-slate-700'
                        )}>
                          {SCENARIO_LABELS[s]}
                        </span>
                        {s === SCENARIOS.COLLAPSE && (
                          <span className="text-[8px] font-bold uppercase tracking-widest bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded-full">
                            Stress test
                          </span>
                        )}
                      </div>
                      <p className="text-[9px] text-slate-500 mt-0.5 leading-snug">
                        {s === SCENARIOS.PERIOD_5D && 'Simula 5 días desde la fecha elegida (~15 min/día)'}
                        {s === SCENARIOS.COLLAPSE  && 'Prueba de estrés hasta el colapso'}
                      </p>
                    </div>
                  </label>
                ))}
              </div>

              {selectedScenario === SCENARIOS.PERIOD_5D && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 block">
                    Fecha de inicio
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="w-full bg-white border border-indigo-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-indigo-400"
                  />
                </div>
              )}

              <button
                onClick={handleCreate}
                disabled={isLoading || (selectedScenario === SCENARIOS.PERIOD_5D && !startDate)}
                className={cn(
                  'w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg',
                  selectedScenario === SCENARIOS.COLLAPSE
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/20'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20',
                  'disabled:opacity-40 disabled:cursor-not-allowed'
                )}
              >
                <Database className="w-4 h-4" />
                {isLoading ? 'Inicializando…' : 'Iniciar Simulación'}
              </button>
            </div>
          </CollapsiblePanel>
        )}

        {/* Control de sesión activa */}
        {session && (
          <CollapsiblePanel
            title={`Simulación — ${session.status.toUpperCase()}`}
            icon={<Activity className="w-4 h-4" />}
            defaultOpen
          >
            <div className="pt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-slate-50 rounded-xl p-2 border border-slate-100">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Tiempo sim.</p>
                  <p className="text-sm font-black font-mono text-indigo-700">T+{session.currentTimeAt || 0}h</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-2 border border-slate-100">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Vuelos activos</p>
                  <p className="text-sm font-black font-mono text-indigo-700">{activePlanes.length}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={simRunning ? pauseSimulation : startSimulation}
                  className={cn(
                    'flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all',
                    simRunning
                      ? 'bg-amber-500 hover:bg-amber-400 text-white'
                      : 'bg-emerald-500 hover:bg-emerald-400 text-white'
                  )}
                >
                  {simRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {simRunning ? 'Pausar' : 'Reanudar'}
                </button>
                <button
                  onClick={resetSimulation}
                  className="px-3 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-600 transition-all"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>
          </CollapsiblePanel>
        )}

        {/* Rastrear vuelo */}
        {session && (
          <CollapsiblePanel
            title="Rastrear Vuelo"
            icon={<Plane className="w-4 h-4" />}
            defaultOpen={false}
            className="max-w-[320px]"
          >
            <div className="pt-3 space-y-3">
              {/* Buscador */}
              <div className="relative">
                <input
                  type="text"
                  value={flightQuery}
                  onChange={e => setFlightQuery(e.target.value)}
                  placeholder="ID vuelo, origen o destino…"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none focus:border-indigo-400 focus:bg-white transition-colors pr-7"
                />
                {flightQuery && (
                  <button
                    onClick={() => setFlightQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Vuelo seleccionado actualmente */}
              {selectedFlightId && selectedFlight && (
                <div className={cn(
                  'rounded-xl border p-2.5 flex items-center gap-2',
                  selectedFlight.isActive
                    ? 'bg-amber-50 border-amber-200'
                    : 'bg-slate-50 border-slate-200'
                )}>
                  <div className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    selectedFlight.isActive ? 'bg-amber-500 animate-pulse' : 'bg-slate-400'
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black text-slate-800 truncate">{selectedFlight.flightId}</p>
                    <p className="text-[9px] text-slate-500 font-mono">{selectedFlight.fromIcao} → {selectedFlight.toIcao}</p>
                  </div>
                  <button
                    onClick={() => { setSelectedFlightId(null); }}
                    className="text-[10px] text-slate-400 hover:text-slate-600 shrink-0 px-1"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Lista de vuelos */}
              <div className="max-h-44 overflow-y-auto custom-scrollbar space-y-1 pr-0.5">
                {filteredFlights.length === 0 ? (
                  <p className="text-[10px] text-slate-400 text-center py-3">
                    {seenFlights.length === 0 ? 'Sin vuelos registrados aún' : 'Sin resultados'}
                  </p>
                ) : (
                  filteredFlights.map(sf => {
                    const isSelected = sf.flightId === selectedFlightId;
                    const activePlane = activePlanes.find(p => p.flightId === sf.flightId);
                    return (
                      <button
                        key={sf.flightId}
                        onClick={() => focusOnFlight(sf)}
                        className={cn(
                          'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors',
                          isSelected
                            ? 'bg-amber-50 border border-amber-300'
                            : 'hover:bg-slate-50 border border-transparent'
                        )}
                      >
                        <div className={cn(
                          'w-1.5 h-1.5 rounded-full shrink-0',
                          sf.isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'
                        )} />
                        <div className="flex-1 min-w-0">
                          <p className={cn(
                            'text-[10px] font-bold truncate',
                            isSelected ? 'text-amber-700' : 'text-slate-700'
                          )}>
                            {sf.flightId}
                          </p>
                          <p className="text-[9px] text-slate-400 font-mono">{sf.fromIcao} → {sf.toIcao}</p>
                          {activePlane && activePlane.capacity > 0 && (
                            <p className="text-[9px] font-mono mt-0.5" style={{
                              color: getPlaneColor(activePlane.occupied, activePlane.capacity, false)
                            }}>
                              Carga: {formatCapacity(activePlane.occupied, activePlane.capacity)}
                            </p>
                          )}
                        </div>
                        <span className={cn(
                          'text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0',
                          sf.isActive
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        )}>
                          {sf.isActive ? 'En vuelo' : 'Aterrizó'}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              {seenFlights.length > 0 && (
                <p className="text-[9px] text-slate-400 text-center">
                  {seenFlights.filter(f => f.isActive).length} en vuelo · {seenFlights.length} total
                </p>
              )}
            </div>
          </CollapsiblePanel>
        )}

        {/* Log de eventos */}
        {session && events.length > 0 && (
          <CollapsiblePanel
            title={`Eventos (${events.length})`}
            icon={<Activity className="w-4 h-4" />}
          >
            <div className="pt-3 space-y-2 max-h-52 overflow-y-auto custom-scrollbar pr-1">
              {events.slice(0, 15).map((evt, i) => (
                <div key={evt.id || i} className="relative pl-3 border-l-2 border-slate-100">
                  <div className={cn(
                    'absolute -left-[5px] top-1.5 w-2 h-2 rounded-full',
                    evt.severity === 'critical' ? 'bg-red-500'
                    : evt.severity === 'warning' ? 'bg-amber-500'
                    : 'bg-indigo-500'
                  )} />
                  <p className="text-[10px] text-slate-700 leading-snug">{evt.message}</p>
                  <p className="text-[9px] text-slate-400 font-mono">T+{evt.timestamp}</p>
                </div>
              ))}
            </div>
          </CollapsiblePanel>
        )}

        {/* Leyenda — mismos colores que Dashboard */}
        <CollapsiblePanel title="Leyenda" icon={<MapIcon className="w-4 h-4" />}>
          <div className="pt-3 space-y-2.5">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Hubs</p>
            <LegendRow dot="bg-emerald-500" label="Hub en estado óptimo" />
            <LegendRow dot="bg-amber-500" label="Hub en alerta (>70% cap.)" />
            <LegendRow dot="bg-red-500" label="Hub en punto crítico" />
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 pt-1">Aviones</p>
            <LegendRow dot="bg-emerald-500" label="Avión con carga normal" />
            <LegendRow dot="bg-amber-500" label="Avión casi lleno (>70%)" />
            <LegendRow dot="bg-red-500" label="Avión en capacidad crítica" />
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 pt-1">Rutas</p>
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-0.5 bg-red-500 rounded" />
              <span className="text-[10px] font-semibold text-slate-600">Ruta activa (con vuelo)</span>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="flex gap-0.5">
                {[0,1,2].map(i => <div key={i} className="w-1.5 h-0.5 bg-slate-400" />)}
              </div>
              <span className="text-[10px] font-semibold text-slate-600">Ruta disponible</span>
            </div>
            <div className="pt-1.5 border-t border-slate-100 text-[9px] text-slate-400 leading-snug">
              Rueda del ratón para zoom · Arrastrar para desplazar
            </div>
          </div>
        </CollapsiblePanel>
      </div>

      {/* ── MODAL: Advertencia Colapso ───────────────────────────────────────── */}
      <AnimatePresence>
        {showCollapseWarning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6"
            onClick={() => setShowCollapseWarning(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-3xl border border-rose-200 shadow-2xl max-w-md w-full overflow-hidden"
            >
              <div className="bg-rose-600 px-8 py-6 flex items-center gap-4">
                <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-7 h-7 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white">Prueba de Estrés</h3>
                  <p className="text-rose-200 text-xs font-semibold">Operación hasta el Colapso</p>
                </div>
              </div>
              <div className="px-8 py-6 space-y-4">
                <p className="text-sm text-slate-700 leading-relaxed">
                  Este escenario somete al sistema a una{' '}
                  <span className="font-bold text-rose-600">carga extrema</span>{' '}
                  hasta detectar el punto de colapso operativo.
                </p>
                <ul className="text-xs text-slate-500 space-y-1.5 list-disc list-inside">
                  <li>Volumen de envíos superior a la capacidad diseñada</li>
                  <li>Posibles cancelaciones masivas de vuelos</li>
                  <li>Activación de todos los protocolos de contingencia</li>
                </ul>
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setShowCollapseWarning(false)}
                    className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmCollapse}
                    className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm transition-colors shadow-lg shadow-rose-600/20"
                  >
                    Iniciar prueba de estrés
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
      `}</style>
    </div>
  );
};
