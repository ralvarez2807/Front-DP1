import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  Play, Pause, RotateCcw, Settings2, Database,
  Activity, Map as MapIcon, Globe, Clock, AlertTriangle, CheckCircle, Building2,
  ChevronDown, ChevronUp, ZoomIn, ZoomOut,
} from 'lucide-react';
import { Plane } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useSimulationContext } from '../providers/SimulationProvider';
import { useSocket } from '../providers/SocketProvider';
import { useMap, MAP_VIEWBOX } from '../providers/MapProvider';
import { AvailableDayPicker } from '../components/AvailableDayPicker';
import { hubService } from '../services/hubService';
import { simulationService } from '../services/simulationService';
import { cn } from '../lib/utils';
import { SCENARIOS, SCENARIO_LABELS, SimulationScenario } from '../constants/domain';

// speedFactor del backend: 80 sim-horas por hora real (5 días en ~90 min reales).
// La animación visual usa el mismo factor para que el avión aterrice exactamente
// cuando el backend envía FLIGHT_ARRIVED.
const SIM_SPEED = 80;

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
  scheduleId: string;   // ID sin sufijo de fecha, p.ej. "SKBO-SEQM-19:00"
  fromIcao: string;
  toIcao: string;
  seenAt: number;
  isActive: boolean;
  lastOccupied?: number;
  lastCapacity?: number;
}

// Extrae el ID de horario sin fecha: "SKBO-SEQM-19:00-20260103" → "SKBO-SEQM-19:00"
function scheduleIdOf(flightId: string): string {
  return flightId.replace(/-\d{8}$/, '');
}

// Inserta una entrada en seenFlights manteniendo:
// - todos los activos (sin límite)
// - el vuelo seleccionado (sin límite)
// - completados limitados a MAX_COMPLETED, sin perder el seleccionado
function mergeSeenFlights(
  prev: SeenFlight[],
  entry: SeenFlight,
  selectedId: string | null,
  maxCompleted = 80,
): SeenFlight[] {
  const withoutDup = prev.filter(f => f.flightId !== entry.flightId);
  const next = [entry, ...withoutDup];
  const active    = next.filter(f => f.isActive || f.flightId === selectedId);
  const completed = next.filter(f => !f.isActive && f.flightId !== selectedId).slice(0, maxCompleted);
  return [...active, ...completed];
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

  // Escala base reducida a 0.6 para aviones más pequeños
  return (
    <g transform={`translate(${pos.x},${pos.y}) rotate(${pos.angle}) scale(${iconScale * size * 0.6})`}>
      {highlighted && <circle cx="0" cy="0" r="14" fill="rgba(245,158,11,0.15)" />}
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
  const { session, events, createSession, startSimulation, pauseSimulation, resetSimulation, isLoading, restoredFlights, clearRestoredFlights, sessionStartedAt, completionReport, clearCompletionReport } = useSimulationContext();
  const socket = useSocket();
  const { worldData, pathGenerator, projectedHubs, projectedFlights } = useMap();

  // ── Carga real de aeropuertos durante la simulación ───────────────────────
  type SimAirport = { icao: string; city: string; load: number; capacity: number; occupancyPct: number; occupancyLevel: string };
  const [simAirportList, setSimAirportList] = useState<SimAirport[]>([]);
  const simHubLoads = useMemo(() => {
    const m = new Map<string, { load: number; capacity: number }>();
    simAirportList.forEach(a => m.set(a.icao, { load: a.load, capacity: a.capacity }));
    return m;
  }, [simAirportList]);

  useEffect(() => {
    if (!session?.id) { setSimAirportList([]); return; }
    const sessionId = session.id;
    let cancelled = false;

    const fetchLoads = async () => {
      try {
        const airports = await simulationService.getSimAirports(sessionId);
        if (cancelled) return;
        setSimAirportList(airports);
      } catch { /* silencioso */ }
    };

    fetchLoads();
    const id = setInterval(fetchLoads, 8_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [session?.id]);

  // ── Cache de duraciones reales de vuelo (flightId → durationMs real) ──────
  // Poblado desde el API para que cada vuelo tenga su propia velocidad visual.
  const flightDurationsRef = useRef<Map<string, number>>(new Map());

  // ── Carga real de vuelos (polling) ──────────────────────────────────────
  const fetchFlightLoadsRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (!session?.id) { fetchFlightLoadsRef.current = null; return; }
    const sessionId = session.id;
    let cancelled = false;

    const fetchFlightLoads = async () => {
      try {
        const flights = await simulationService.getSimFlights(sessionId);
        if (cancelled) return;
        console.debug('[SimMap] /flights sample:', flights.slice(0, 3).map(f => ({
          id: f.flightId, status: f.status, load: f.load, cap: f.capacity, dep: f.depTime, arr: f.arrTime,
        })));
        // Actualizar cache de duraciones reales
        flights.forEach(f => {
          if (f.depTime && f.arrTime) {
            const simMs = new Date(f.arrTime).getTime() - new Date(f.depTime).getTime();
            const realMs = Math.max(15_000, Math.round(simMs / SIM_SPEED));
            flightDurationsRef.current.set(f.flightId, realMs);
          }
        });
        // Actualizar carga en aviones activos
        setActivePlanes(prev => prev.map(p => {
          const live = flights.find(f => f.flightId === p.flightId)
                    ?? flights.find(f => f.fromIcao === p.fromIcao && f.toIcao === p.toIcao && f.status === 'DEPARTED');
          if (!live || live.capacity === 0) return p;
          // También actualizar durationMs si ahora tenemos el dato real
          const cachedDuration = flightDurationsRef.current.get(p.flightId);
          return { ...p, capacity: live.capacity, occupied: live.load, ...(cachedDuration ? { durationMs: cachedDuration } : {}) };
        }));
      } catch { /* silencioso */ }
    };

    fetchFlightLoadsRef.current = fetchFlightLoads;
    fetchFlightLoads();
    const id = setInterval(fetchFlightLoads, 8_000);
    return () => { cancelled = true; clearInterval(id); fetchFlightLoadsRef.current = null; };
  }, [session?.id]);

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
    const delta = e.deltaY < 0 ? 1.05 : 1 / 1.05;
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
      const rawK = prev.k * 1.05;
      const kRatio = rawK / prev.k;
      return clamp(cx - kRatio * (cx - prev.x), cy - kRatio * (cy - prev.y), rawK);
    });
  }, [clamp]);

  const zoomOut = useCallback(() => {
    setViewTransform(prev => {
      const cx = MAP_VIEWBOX.width / 2;
      const cy = MAP_VIEWBOX.height / 2;
      const rawK = prev.k / 1.05;
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

      // Duración real: usar cache de depTime/arrTime del API si está disponible.
      // Fallback: 2 sim-horas (90 s reales a speedFactor=80) — se corrige en el
      // primer polling o cuando llega FLIGHT_ARRIVED.
      const cachedDuration = flightDurationsRef.current.get(fid);
      const fallbackSimHours = payload.durationHours ?? payload.duration ?? 2;
      const durationMs = cachedDuration
        ?? Math.max(15_000, Math.round(fallbackSimHours * 3_600_000 / SIM_SPEED));

      console.debug(`[SimMap] FLIGHT_DEPARTED: ${fromIcao}→${toIcao} | cached=${!!cachedDuration} durationMs=${durationMs}`);

      const capacity = payload.capacity ?? payload.maxCapacity ?? 0;
      const occupied = payload.load ?? payload.occupiedCapacity ?? payload.currentLoad ?? payload.loadedPackages ?? 0;
      console.debug(`[SimMap] FLIGHT_DEPARTED carga WS: load=${payload.load} capacity=${payload.capacity} → occupied=${occupied}`);
      if (occupied === 0 || capacity === 0) {
        setTimeout(() => fetchFlightLoadsRef.current?.(), 2_000);
      }

      // Limpiar timer anterior si existe
      const existingTimer = planeTimersRef.current.get(key);
      if (existingTimer) clearTimeout(existingTimer);

      // Timer de seguridad: elimina el avión si FLIGHT_ARRIVED no llega a tiempo
      // (se cancela y reemplaza cuando llega el evento de aterrizaje)
      const timer = setTimeout(() => {
        setActivePlanes(prev => prev.filter(p => p.key !== key));
        planeTimersRef.current.delete(key);
      }, durationMs + 30_000); // margen de 30 s para latencia del WS
      planeTimersRef.current.set(key, timer);

      const schedId = scheduleIdOf(fid);

      setActivePlanes(prev => [
        ...prev.filter(p => p.key !== key),
        { key, flightId: fid, fromIcao, toIcao, startedAt: Date.now(), durationMs, capacity, occupied },
      ]);
      setSeenFlights(prev => {
        const entry: SeenFlight = { flightId: fid, scheduleId: schedId, fromIcao, toIcao, seenAt: Date.now(), isActive: true };
        return mergeSeenFlights(prev, entry, selectedFlightId);
      });
      // Auto-seguimiento: si el usuario rastreaba una instancia anterior del mismo horario,
      // actualizar la selección al nuevo vuelo del día
      setSelectedFlightId(prev => {
        if (!prev) return prev;
        const prevSchedule = scheduleIdOf(prev);
        if (prevSchedule === schedId && prev !== fid) return fid;
        return prev;
      });
    });

    // FLIGHT_ARRIVED: termina la animación visual y guarda carga final.
    // Este evento es la fuente de verdad del aterrizaje — reemplaza el timer.
    const unsubArr = socket.on('FLIGHT_ARRIVED', ({ payload }: { payload: any }) => {
      const fid = payload?.flightId ?? payload?.id;
      if (!fid) return;
      const arrivedLoad = payload?.load ?? payload?.occupiedCapacity ?? undefined;

      // Buscar la key del avión para cancelar su timer de seguridad
      setActivePlanes(prev => {
        const plane = prev.find(p => p.flightId === fid);
        if (plane) {
          const existingTimer = planeTimersRef.current.get(plane.key);
          if (existingTimer) clearTimeout(existingTimer);
          // Dar 1.5 s para que la animación termine visualmente en la posición de destino
          const landingTimer = setTimeout(() => {
            setActivePlanes(a => a.filter(p => p.key !== plane.key));
            planeTimersRef.current.delete(plane.key);
          }, 1_500);
          planeTimersRef.current.set(plane.key, landingTimer);

          // Actualizar la carga final en el avión activo también
          if (arrivedLoad !== undefined) {
            return prev.map(p => p.flightId === fid ? { ...p, occupied: arrivedLoad } : p);
          }
        }
        return prev;
      });

      setSeenFlights(prev =>
        prev.map(f => {
          if (f.flightId !== fid) return f;
          const plane = activePlanes.find(p => p.flightId === fid);
          return {
            ...f,
            isActive: false,
            lastOccupied: arrivedLoad ?? plane?.occupied,
            lastCapacity: plane?.capacity ?? f.lastCapacity,
          };
        })
      );
    });

    return () => { unsubDep(); unsubArr(); };
  }, [socket]);

  // ── Restaurar aviones IN_FLIGHT desde snapshot (nueva pestaña / resync) ──
  useEffect(() => {
    if (restoredFlights.length === 0) return;

    const planes: ActivePlane[] = [];
    const seen: SeenFlight[] = [];

    restoredFlights.forEach((f: any) => {
      const depMs  = new Date(f.depTime).getTime();
      const arrMs  = new Date(f.arrTime).getTime();
      const simNow = new Date(f.simTime).getTime();

      const simFlightMs  = arrMs - depMs;
      const durationMs   = Math.max(30_000, Math.round(simFlightMs / SIM_SPEED));
      const simElapsedMs = Math.max(0, simNow - depMs);
      const startedAt    = Date.now() - Math.round(simElapsedMs / SIM_SPEED);

      const key = `${f.flightId}-${f.fromIcao}-${f.toIcao}`;

      // Timer de limpieza cuando termine la animación visual
      const remaining = durationMs - (Date.now() - startedAt);
      if (remaining > 0) {
        const timer = setTimeout(() => {
          setActivePlanes(prev => prev.filter(p => p.key !== key));
          planeTimersRef.current.delete(key);
        }, remaining + 500);
        planeTimersRef.current.set(key, timer);
      }

      planes.push({
        key,
        flightId: f.flightId,
        fromIcao: f.fromIcao,
        toIcao:   f.toIcao,
        startedAt,
        durationMs,
        capacity: f.capacity ?? 0,
        occupied: f.load ?? 0,
      });

      seen.push({ flightId: f.flightId, scheduleId: scheduleIdOf(f.flightId), fromIcao: f.fromIcao, toIcao: f.toIcao, seenAt: Date.now(), isActive: true });
    });

    setActivePlanes(prev => {
      const existingKeys = new Set(prev.map(p => p.key));
      return [...prev, ...planes.filter(p => !existingKeys.has(p.key))];
    });
    setSeenFlights(prev => {
      let result = prev;
      for (const entry of seen) {
        if (!result.find(f => f.flightId === entry.flightId)) {
          result = mergeSeenFlights(result, entry, selectedFlightId);
        }
      }
      return result;
    });

    clearRestoredFlights();
  }, [restoredFlights, clearRestoredFlights]);

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
  const [startTime, setStartTime] = useState('00:00');
  const [availableDays, setAvailableDays] = useState<string[]>([]);
  const [showCollapseWarning, setShowCollapseWarning] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    hubService.getAvailableDays(controller.signal)
      .then(days => {
        const sorted = [...days].sort();
        setAvailableDays(sorted);
        if (sorted.length > 0) {
          const today = new Date().toISOString().slice(0, 10);
          const best = sorted.includes(today)
            ? today
            : sorted.filter(d => d <= today).at(-1) ?? sorted[0];
          setStartDate(best);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const handleCreate = useCallback(async () => {
    if (selectedScenario === SCENARIOS.COLLAPSE) {
      setShowCollapseWarning(true);
      return;
    }
    await createSession(selectedScenario, startDate, startTime);
  }, [selectedScenario, startDate, startTime, createSession]);

  const confirmCollapse = useCallback(async () => {
    setShowCollapseWarning(false);
    await createSession(SCENARIOS.COLLAPSE, startDate, startTime);
  }, [createSession, startDate, startTime]);

  // ── Tiempo real transcurrido (cronómetro fluido) ─────────────────────────
  const [elapsedRealMs, setElapsedRealMs] = useState(0);
  useEffect(() => {
    if (!sessionStartedAt || !session?.id) { setElapsedRealMs(0); return; }
    // Dependency en session.id solamente para evitar que cada evento WS reinicie el intervalo
    const startedAt = sessionStartedAt;
    const id = setInterval(() => setElapsedRealMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [sessionStartedAt, session?.id]);

  const formatRealElapsed = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m.toString().padStart(2,'0')}m ${s.toString().padStart(2,'0')}s`;
    return `${m}m ${s.toString().padStart(2,'0')}s`;
  };

  // ── Formato tiempo simulado legible ──────────────────────────────────────
  const formatSimElapsed = (totalHours: number) => {
    const d = Math.floor(totalHours / 24);
    const h = totalHours % 24;
    if (d > 0) return `${d}d ${h}h`;
    return `${h}h`;
  };

  // ── Auto-fit: centra el mapa en los aeropuertos cargados ─────────────────
  const autoFitDoneRef = useRef(false);
  useEffect(() => {
    if (projectedHubs.length === 0 || autoFitDoneRef.current) return;
    autoFitDoneRef.current = true;
    const xs = projectedHubs.map(h => h.projectedX!);
    const ys = projectedHubs.map(h => h.projectedY!);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    const pad = 80;
    const kX = MAP_VIEWBOX.width  / (maxX - minX + pad * 2);
    const kY = MAP_VIEWBOX.height / (maxY - minY + pad * 2);
    const k  = Math.max(1, Math.min(12, Math.min(kX, kY)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setViewTransform(clamp(
      MAP_VIEWBOX.width  / 2 - cx * k,
      MAP_VIEWBOX.height / 2 - cy * k,
      k,
    ));
  }, [projectedHubs, clamp]);

  // ── Aeropuerto seleccionado ──────────────────────────────────────────────
  const [selectedAirportId, setSelectedAirportId] = useState<string | null>(null);

  const focusOnAirport = useCallback((icao: string) => {
    setSelectedAirportId(prev => prev === icao ? null : icao);
    const hub = projectedHubs.find(h => h.id === icao);
    if (!hub) return;
    const targetK = 5;
    const W = MAP_VIEWBOX.width;
    const H = MAP_VIEWBOX.height;
    setViewTransform(clamp(W / 2 - hub.projectedX! * targetK, H / 2 - hub.projectedY! * targetK, targetK));
  }, [projectedHubs, clamp]);

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
    setSelectedAirportId(null);
    const origin = projectedHubs.find(h => h.id === sf.fromIcao);
    const dest   = projectedHubs.find(h => h.id === sf.toIcao);
    if (!origin || !dest) return;
    const cx = (origin.projectedX! + dest.projectedX!) / 2;
    const cy = (origin.projectedY! + dest.projectedY!) / 2;
    const dist = Math.sqrt((dest.projectedX! - origin.projectedX!) ** 2 + (dest.projectedY! - origin.projectedY!) ** 2);
    const targetK = Math.max(2, Math.min(8, MAP_VIEWBOX.width / (dist * 1.6)));
    const W = MAP_VIEWBOX.width;
    const H = MAP_VIEWBOX.height;
    setViewTransform(clamp(W / 2 - cx * targetK, H / 2 - cy * targetK, targetK));
  }, [projectedHubs, clamp, setSelectedAirportId]);

  // ── Cámara sigue al avión seleccionado ──────────────────────────────────
  const followIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (followIntervalRef.current) clearInterval(followIntervalRef.current);
    if (!selectedFlightId) return;

    const follow = () => {
      setActivePlanes(planes => {
        const plane = planes.find(p => p.flightId === selectedFlightId);
        if (!plane) return planes;
        const origin = projectedHubs.find(h => h.id === plane.fromIcao);
        const dest   = projectedHubs.find(h => h.id === plane.toIcao);
        if (!origin || !dest) return planes;
        const t = Math.min(1, (Date.now() - plane.startedAt) / plane.durationMs);
        const px = origin.projectedX! + (dest.projectedX! - origin.projectedX!) * t;
        const py = origin.projectedY! + (dest.projectedY! - origin.projectedY!) * t;
        const dist = Math.sqrt((dest.projectedX! - origin.projectedX!) ** 2 + (dest.projectedY! - origin.projectedY!) ** 2);
        const targetK = Math.max(3, Math.min(8, MAP_VIEWBOX.width / (dist * 1.2)));
        const W = MAP_VIEWBOX.width;
        const H = MAP_VIEWBOX.height;
        setViewTransform(prev => {
          const newX = W / 2 - px * targetK;
          const newY = H / 2 - py * targetK;
          // suavizado: interpola 15% hacia la posición objetivo
          const smoothX = prev.x + (newX - prev.x) * 0.15;
          const smoothY = prev.y + (newY - prev.y) * 0.15;
          return { x: Math.max(W * (1 - targetK), Math.min(0, smoothX)), y: Math.max(H * (1 - targetK), Math.min(0, smoothY)), k: targetK };
        });
        return planes;
      });
    };

    followIntervalRef.current = setInterval(follow, 500);
    return () => { if (followIntervalRef.current) clearInterval(followIntervalRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFlightId, projectedHubs]);

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
                    strokeWidth={1.5 / viewTransform.k}
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
                    strokeWidth={1 / viewTransform.k}
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
                  strokeWidth={0.4 / viewTransform.k}
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
                  onClick={() => {
                    const sf = seenFlights.find(f => f.flightId === plane.flightId);
                    if (sf) focusOnFlight(sf);
                    else { setSelectedFlightId(prev => prev === plane.flightId ? null : plane.flightId); setSelectedAirportId(null); }
                  }}
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
              const isSelectedHub = selectedAirportId === hub.id ||
                (selectedFlight ? hub.id === selectedFlight.fromIcao || hub.id === selectedFlight.toIcao : false);
              const isDimmedHub = (selectedFlightId || selectedAirportId) && !isSelectedHub;
              const r = 5 / viewTransform.k;
              const rInner = 2 / viewTransform.k;

              // Color según estado de almacenamiento — usa datos en tiempo real si disponibles
              const simLoad = simHubLoads.get(hub.id);
              const currentStorage = simLoad ? simLoad.load : hub.currentStorage;
              const storageCapacity = simLoad ? simLoad.capacity : hub.storageCapacity;
              const pct = storageCapacity > 0 ? (currentStorage / storageCapacity) * 100 : 0;
              const isAirportSelected = selectedAirportId === hub.id;
              const storageColor = isAirportSelected
                ? '#6366f1'
                : (selectedFlight && (hub.id === selectedFlight.fromIcao || hub.id === selectedFlight.toIcao))
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
                  onClick={() => { focusOnAirport(hub.id); setSelectedFlightId(null); }}
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
                      fill="none" stroke={isAirportSelected ? '#6366f1' : '#f59e0b'}
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
          const simLoadTooltip = simHubLoads.get(hub.id);
          const tooltipStorage = simLoadTooltip ? simLoadTooltip.load : hub.currentStorage;
          const tooltipCapacity = simLoadTooltip ? simLoadTooltip.capacity : hub.storageCapacity;
          const pct = tooltipCapacity > 0
            ? Math.round((tooltipStorage / tooltipCapacity) * 100)
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
                      {tooltipStorage.toLocaleString()} / {tooltipCapacity.toLocaleString()}
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
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 block">
                    Fecha de inicio
                  </label>
                  {availableDays.length === 0 ? (
                    <div className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-400">
                      Cargando fechas disponibles…
                    </div>
                  ) : (
                    <AvailableDayPicker
                      availableDays={availableDays}
                      selected={startDate}
                      onChange={setStartDate}
                      disabled={isLoading}
                    />
                  )}
                  {/* Hora de inicio */}
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <label className="text-[10px] font-bold uppercase tracking-widest text-indigo-600">
                      Hora de inicio (UTC)
                    </label>
                  </div>
                  <input
                    type="time"
                    value={startTime}
                    onChange={e => setStartTime(e.target.value)}
                    disabled={isLoading}
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
            defaultOpen={false}
          >
            <div className="pt-3 space-y-3">
              {/* Cartillas de tiempo */}
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-indigo-50 rounded-xl p-2 border border-indigo-100">
                  <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-widest mb-0.5">Tiempo simulado</p>
                  <p className="text-sm font-black font-mono text-indigo-700">{formatSimElapsed(session.currentTimeAt || 0)}</p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-2 border border-emerald-100">
                  <p className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest mb-0.5">Tiempo real</p>
                  <p className="text-sm font-black font-mono text-emerald-700">{formatRealElapsed(elapsedRealMs)}</p>
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-2 border border-slate-100 text-center">
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Vuelos activos</p>
                <p className="text-sm font-black font-mono text-indigo-700">{activePlanes.length}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={simRunning ? pauseSimulation : startSimulation}
                  disabled={session.status === 'starting'}
                  className={cn(
                    'flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition-all',
                    session.status === 'starting'
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      : simRunning
                        ? 'bg-amber-500 hover:bg-amber-400 text-white'
                        : 'bg-emerald-500 hover:bg-emerald-400 text-white'
                  )}
                >
                  {session.status === 'starting'
                    ? <><span className="w-3 h-3 rounded-full border-2 border-slate-400 border-t-transparent animate-spin" />Iniciando…</>
                    : simRunning
                      ? <><Pause className="w-4 h-4" />Pausar</>
                      : <><Play className="w-4 h-4" />Reanudar</>
                  }
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

              {/* Vuelo seleccionado — fijo encima del scroll */}
              {selectedFlightId && selectedFlight && (() => {
                const ap = activePlanes.find(p => p.flightId === selectedFlight.flightId);
                // Carga: en vuelo → datos en vivo; aterrizó → last known desde SeenFlight
                const occ = ap?.occupied ?? selectedFlight.lastOccupied;
                const cap = ap?.capacity ?? selectedFlight.lastCapacity;
                const pct = cap && cap > 0 && occ !== undefined ? Math.round((occ / cap) * 100) : null;
                const lc = pct === null ? '#94a3b8' : pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';
                const borderClass = selectedFlight.isActive ? 'border-amber-300' : 'border-slate-200';
                const bgClass = selectedFlight.isActive ? 'bg-amber-50' : 'bg-slate-50';
                return (
                  <div className={cn('rounded-xl border p-2.5', bgClass, borderClass)}>
                    <div className="flex items-center gap-2">
                      <div className={cn('w-2 h-2 rounded-full shrink-0', selectedFlight.isActive ? 'bg-amber-500 animate-pulse' : 'bg-slate-400')} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-black text-slate-800 truncate">{selectedFlight.flightId}</p>
                        <p className="text-[9px] text-slate-500 font-mono">
                          {selectedFlight.fromIcao} → {selectedFlight.toIcao}
                          {selectedFlight.scheduleId !== selectedFlight.flightId && (
                            <span className="ml-1 text-slate-400">· {selectedFlight.scheduleId}</span>
                          )}
                        </p>
                      </div>
                      <button onClick={() => setSelectedFlightId(null)} className="text-[10px] text-slate-400 hover:text-slate-600 shrink-0 px-1">✕</button>
                    </div>
                    {pct !== null && cap! > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-100">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[9px] text-slate-500 font-semibold">
                            {selectedFlight.isActive ? 'Carga' : 'Carga final'}
                          </span>
                          <span className="text-[9px] font-black font-mono" style={{ color: lc }}>{occ}/{cap} ({pct}%)</span>
                        </div>
                        <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: lc }} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

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
                    // Carga a mostrar: en vuelo → datos en vivo; aterrizó → last known
                    const showOccupied = activePlane?.occupied ?? sf.lastOccupied;
                    const showCapacity = activePlane?.capacity ?? sf.lastCapacity;
                    const hasLoad = showCapacity && showCapacity > 0;
                    const loadColor = hasLoad ? getPlaneColor(showOccupied!, showCapacity!, false) : '#94a3b8';
                    // Horario sin fecha para mostrar el patrón de ruta
                    const schedLabel = sf.scheduleId !== sf.flightId ? sf.scheduleId : null;
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
                          <p className={cn('text-[10px] font-bold truncate', isSelected ? 'text-amber-700' : 'text-slate-700')}>
                            {sf.flightId}
                          </p>
                          <p className="text-[9px] text-slate-400 font-mono">{sf.fromIcao} → {sf.toIcao}
                            {schedLabel && <span className="ml-1 opacity-50">({schedLabel})</span>}
                          </p>
                          {hasLoad && (
                            <p className="text-[9px] font-mono mt-0.5" style={{ color: loadColor }}>
                              {sf.isActive ? 'Carga' : 'Carga final'}: {formatCapacity(showOccupied!, showCapacity!)}
                            </p>
                          )}
                        </div>
                        <span className={cn(
                          'text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full shrink-0',
                          sf.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
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
                  {seenFlights.filter(f => f.isActive).length} en vuelo · {seenFlights.filter(f => !f.isActive).length} aterrizados · {seenFlights.length} total
                </p>
              )}
            </div>
          </CollapsiblePanel>
        )}

        {/* Estado de Aeropuertos */}
        {session && (
          <CollapsiblePanel
            title={`Aeropuertos${simAirportList.length > 0 ? ` (${simAirportList.length})` : ''}`}
            icon={<Building2 className="w-4 h-4" />}
            defaultOpen={false}
          >
            {/* Aeropuerto seleccionado — fijo encima del scroll */}
            {(() => {
              const sel = selectedAirportId ? simAirportList.find(a => a.icao === selectedAirportId) : null;
              if (!sel) return null;
              const lc = sel.occupancyLevel === 'RED' ? '#ef4444' : sel.occupancyLevel === 'AMBER' ? '#f59e0b' : '#10b981';
              return (
                <div className="mt-3 mb-1 rounded-xl border border-indigo-300 bg-indigo-50 px-2.5 py-2 flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: lc }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-black font-mono text-indigo-700">{sel.icao}</span>
                      <span className="text-[9px] font-bold font-mono" style={{ color: lc }}>{sel.load}/{sel.capacity}</span>
                    </div>
                    <div className="w-full h-1 bg-indigo-100 rounded-full overflow-hidden mt-1">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, sel.occupancyPct)}%`, background: lc }} />
                    </div>
                    <p className="text-[9px] text-indigo-400 mt-0.5 truncate">{sel.city} · {Math.round(sel.occupancyPct)}%</p>
                  </div>
                  <button onClick={() => setSelectedAirportId(null)} className="text-indigo-300 hover:text-indigo-600 shrink-0 px-1 text-xs">✕</button>
                </div>
              );
            })()}
            <div className="pt-1 space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar pr-1">
              {simAirportList.length === 0 ? (
                <p className="text-[10px] text-slate-400 text-center py-4">
                  {session ? 'Cargando datos de aeropuertos…' : 'Sin sesión activa'}
                </p>
              ) : (
                [...simAirportList]
                  .sort((a, b) => b.occupancyPct - a.occupancyPct)
                  .map(airport => {
                    const isSelected = selectedAirportId === airport.icao;
                    const levelColor = airport.occupancyLevel === 'RED' ? '#ef4444'
                      : airport.occupancyLevel === 'AMBER' ? '#f59e0b'
                      : airport.occupancyLevel === 'GREEN' ? '#10b981'
                      : '#94a3b8';
                    return (
                      <button
                        key={airport.icao}
                        onClick={() => { focusOnAirport(airport.icao); setSelectedFlightId(null); }}
                        className={cn(
                          'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors',
                          isSelected
                            ? 'bg-indigo-50 border border-indigo-300'
                            : 'hover:bg-slate-50 border border-transparent'
                        )}
                      >
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: levelColor }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <span className={cn('text-[10px] font-black font-mono', isSelected ? 'text-indigo-700' : 'text-slate-800')}>
                              {airport.icao}
                            </span>
                            <span className="text-[9px] font-bold font-mono" style={{ color: levelColor }}>
                              {airport.load}/{airport.capacity}
                            </span>
                          </div>
                          <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden mt-1">
                            <div className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${Math.min(100, airport.occupancyPct)}%`, background: levelColor }} />
                          </div>
                          <p className="text-[9px] text-slate-400 mt-0.5 truncate">{airport.city}</p>
                        </div>
                        <span className="text-[8px] font-bold font-mono shrink-0" style={{ color: levelColor }}>
                          {Math.round(airport.occupancyPct)}%
                        </span>
                      </button>
                    );
                  })
              )}
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

      {/* ── MODAL: Simulación completada ─────────────────────────────────────── */}
      <AnimatePresence>
        {completionReport && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className="bg-white rounded-3xl border border-emerald-200 shadow-2xl max-w-md w-full overflow-hidden"
            >
              <div className="bg-emerald-600 px-8 py-6 flex items-center gap-4">
                <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center shrink-0">
                  <CheckCircle className="w-7 h-7 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white">Simulación Completada</h3>
                  <p className="text-emerald-200 text-xs font-semibold">Resumen de operaciones</p>
                </div>
              </div>
              <div className="px-8 py-6 space-y-4">
                {completionReport.error ? (
                  <p className="text-sm text-slate-500 text-center py-4">No se pudo obtener el reporte.</p>
                ) : (
                  <div className="space-y-3">
                    {[
                      { label: 'Bultos entregados', value: completionReport.deliveredBaggage ?? completionReport.deliveredCount ?? completionReport.baggage?.delivered ?? '—' },
                      { label: 'Total de bultos', value: completionReport.totalBaggage ?? completionReport.totalCount ?? completionReport.baggage?.total ?? '—' },
                      { label: 'Vuelos completados', value: completionReport.completedFlights ?? completionReport.flights?.completed ?? '—' },
                      { label: 'Infracciones SLA', value: completionReport.slaBreaches ?? completionReport.slaBreach ?? completionReport.sla?.breaches ?? '—' },
                    ].map(row => (
                      <div key={row.label} className="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
                        <span className="text-sm text-slate-600 font-semibold">{row.label}</span>
                        <span className="text-sm font-black text-slate-900 font-mono">{String(row.value)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={clearCompletionReport}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition-colors shadow-lg shadow-emerald-600/20 mt-2"
                >
                  Cerrar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
