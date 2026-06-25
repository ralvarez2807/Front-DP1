import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  Play, Pause, RotateCcw, Settings2, Database,
  Map as MapIcon, Clock, AlertTriangle, CheckCircle,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, LayoutGrid,
} from 'lucide-react';
import { Plane } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useSimulationContext } from '../providers/SimulationProvider';
import { useSocket } from '../providers/SocketProvider';
import { useMap, MAP_VIEWBOX } from '../providers/MapProvider';
import { AvailableDayPicker } from '../components/AvailableDayPicker';
import { hubService } from '../services/hubService';
import { simulationService, SimAirport, SimFlight, SimShipment } from '../services/simulationService';
import { SimulationInfoPanel } from './SimulationInfoPanel';
import { cn } from '../lib/utils';
import { SCENARIOS, SCENARIO_LABELS, SimulationScenario } from '../constants/domain';

// Fallback de velocidad si el backend aún no respondió con su speedFactor real.
const SIM_SPEED_FALLBACK = 80;

function LegendRow({ dot, label }: { dot: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={cn('w-3 h-3 rounded-full shrink-0', dot)} />
      <span className="text-[10px] font-semibold text-slate-600">{label}</span>
    </div>
  );
}

// ── Métrica compacta para la barra inferior ─────────────────────────────────
function BottomStat({ label, value, className }: {
  label: string; value: React.ReactNode; className?: string;
}) {
  return (
    <div className="flex flex-col leading-tight px-1.5">
      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 whitespace-nowrap">{label}</span>
      <span className={cn('text-base font-black font-mono', className)}>{value}</span>
    </div>
  );
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
interface SimulationDashboardViewProps {
  showConfig: boolean;
  onConfigClose: () => void;
}

export const SimulationDashboardView: React.FC<SimulationDashboardViewProps> = ({ showConfig, onConfigClose }) => {
  const { session, lastSimUpdate, events, createSession, startSimulation, pauseSimulation, resetSimulation, isLoading, restoredFlights, clearRestoredFlights, sessionStartedAt, completionReport, clearCompletionReport, dashboardMetrics } = useSimulationContext();
  const socket = useSocket();
  const { worldData, pathGenerator, projectedHubs, projectedFlights } = useMap();

  // ── Carga real de aeropuertos durante la simulación ───────────────────────
  const [simAirportList, setSimAirportList] = useState<SimAirport[]>([]);
  // Listas en vivo para el panel de información (vuelos y paquetes/envíos)
  const [simFlightList, setSimFlightList] = useState<SimFlight[]>([]);
  const [simShipmentList, setSimShipmentList] = useState<SimShipment[]>([]);
  // Panel lateral derecho — cerrado por defecto
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  // Popover de leyenda flotante en el mapa
  const [legendOpen, setLegendOpen] = useState(false);
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

  // ── Carga real de envíos/paquetes durante la simulación ───────────────────
  useEffect(() => {
    if (!session?.id) { setSimShipmentList([]); return; }
    const sessionId = session.id;
    let cancelled = false;

    const fetchShipments = async () => {
      try {
        const shipments = await simulationService.getSimShipments(sessionId);
        if (cancelled) return;
        setSimShipmentList(shipments);
      } catch { /* silencioso */ }
    };

    fetchShipments();
    const id = setInterval(fetchShipments, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [session?.id]);

  // ── Cache de duraciones y depTimes reales de vuelo ──────────────────────────
  // Poblado desde el API para que cada vuelo tenga su propia velocidad visual y
  // para validar eventos WS que lleguen antes de la hora de salida programada.
  const flightDurationsRef = useRef<Map<string, number>>(new Map());
  const flightDepMsRef     = useRef<Map<string, number>>(new Map());

  // speedFactor real leído del backend (sim-horas por hora real).
  // Se mantiene en ref para que los callbacks del WS siempre lean el valor actual
  // sin necesidad de estar en sus listas de dependencias.
  const simSpeedRef = useRef<number>(SIM_SPEED_FALLBACK);
  useEffect(() => {
    if (session?.speedFactor) simSpeedRef.current = session.speedFactor;
  }, [session?.speedFactor]);

  // ── Carga real de vuelos (polling) ──────────────────────────────────────
  const fetchFlightLoadsRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (!session?.id) { fetchFlightLoadsRef.current = null; setSimFlightList([]); return; }
    const sessionId = session.id;
    let cancelled = false;

    const fetchFlightLoads = async () => {
      try {
        const flights = await simulationService.getSimFlights(sessionId);
        if (cancelled) return;
        setSimFlightList(flights);
        console.debug('[SimMap] /flights sample:', flights.slice(0, 3).map(f => ({
          id: f.flightId, status: f.status, load: f.load, cap: f.capacity, dep: f.depTime, arr: f.arrTime,
        })));
        // Actualizar cache de duraciones y depTimes reales
        flights.forEach(f => {
          if (f.depTime && f.arrTime) {
            const depMs = new Date(f.depTime).getTime();
            const simMs = new Date(f.arrTime).getTime() - depMs;
            const realMs = Math.max(15_000, Math.round(simMs / simSpeedRef.current));
            flightDurationsRef.current.set(f.flightId, realMs);
            if (depMs) flightDepMsRef.current.set(f.flightId, depMs);
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
    setLegendOpen(false);
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
  // shipmentIds con al menos una maleta actualmente en el aire (por eventos BAGGAGE_DEPARTED/DELIVERED)
  const [shipmentsInFlight, setShipmentsInFlight] = useState<Set<string>>(new Set());
  // Ref sincronizada para leer en RAF sin closures obsoletos
  const activePlanesRef = useRef<ActivePlane[]>([]);
  useEffect(() => { activePlanesRef.current = activePlanes; }, [activePlanes]);
  const [seenFlights, setSeenFlights] = useState<SeenFlight[]>([]);

  useEffect(() => {
    const unsubDep = socket.on('FLIGHT_DEPARTED', ({ simTime, payload }: { simTime?: string; payload: any }) => {
      // Intentar múltiples nombres de campo que el backend podría usar
      const fromIcao = payload?.fromIcao ?? payload?.originIcao ?? payload?.origin ?? payload?.from;
      const toIcao   = payload?.toIcao   ?? payload?.destIcao   ?? payload?.destination ?? payload?.dest ?? payload?.to;

      if (!fromIcao || !toIcao) {
        console.warn('[SimMap] FLIGHT_DEPARTED: campos de ubicación no encontrados. Payload:', JSON.stringify(payload));
        return;
      }

      const fid = payload.flightId ?? payload.id ?? `${fromIcao}-${toIcao}`;

      // Validar que el evento no llega antes que la hora de salida programada.
      // El backend puede emitir FLIGHT_DEPARTED con un simTime anterior al depTime real
      // (bug de inicialización). Ignorar el evento en ese caso; el WS lo reenviará
      // cuando el tiempo simulado llegue realmente al depTime.
      const wsSimMs    = simTime ? new Date(simTime).getTime() : null;
      const cachedDepMs = flightDepMsRef.current.get(fid);
      if (wsSimMs && cachedDepMs && wsSimMs < cachedDepMs - 60_000) {
        console.warn(`[SimMap] FLIGHT_DEPARTED ignorado: simTime (${simTime}) es anterior al depTime programado del vuelo ${fid}`);
        return;
      }

      const key = `${fid}-${fromIcao}-${toIcao}`;

      // Duración real: usar cache de depTime/arrTime del API si está disponible.
      // Fallback: 2 sim-horas (90 s reales a speedFactor=80) — se corrige en el
      // primer polling o cuando llega FLIGHT_ARRIVED.
      const cachedDuration = flightDurationsRef.current.get(fid);
      const fallbackSimHours = payload.durationHours ?? payload.duration ?? 2;
      const durationMs = cachedDuration
        ?? Math.max(15_000, Math.round(fallbackSimHours * 3_600_000 / simSpeedRef.current));

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

    // BAGGAGE_DEPARTED / BAGGAGE_ARRIVED: rastrear qué envíos tienen maletas en el aire.
    // El baggageId sigue el formato "{shipmentId}-B{n}" → derivamos shipmentId quitando el sufijo.
    const shipmentIdOf = (baggageId: string) => baggageId.replace(/-B\d+$/, '');

    const unsubBagDep = socket.on('BAGGAGE_DEPARTED', ({ payload }: { payload: any }) => {
      const bid = payload?.baggageId;
      if (!bid) return;
      setShipmentsInFlight(prev => {
        const next = new Set(prev);
        next.add(shipmentIdOf(bid));
        return next;
      });
    });

    const unsubBagArr = socket.on('BAGGAGE_ARRIVED', ({ payload }: { payload: any }) => {
      const bid = payload?.baggageId;
      if (!bid) return;
      // No quitamos el shipmentId aquí: puede haber otras maletas del mismo envío aún en vuelo.
      // Se limpiará al recibir BAGGAGE_DELIVERED o en el siguiente polling.
    });

    const unsubBagDel = socket.on('BAGGAGE_DELIVERED', ({ payload }: { payload: any }) => {
      const bid = payload?.baggageId;
      if (!bid) return;
      const sid = shipmentIdOf(bid);
      // Solo eliminar si no queda ninguna otra maleta del envío en vuelo
      // (la lógica exacta la maneja el polling; aquí solo marcamos que al menos una llegó)
      setShipmentsInFlight(prev => {
        const next = new Set(prev);
        next.delete(sid);
        return next;
      });
    });

    return () => { unsubDep(); unsubArr(); unsubBagDep(); unsubBagArr(); unsubBagDel(); };
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

      // El backend puede incluir en el snapshot vuelos con status DEPARTED cuya depTime
      // aún no ha llegado en tiempo simulado (bug de inicialización). Ignorarlos: si el
      // vuelo no ha salido en sim-time no debe aparecer en el mapa.
      if (!depMs || !simNow || depMs > simNow) return;

      const simFlightMs  = arrMs - depMs;
      const durationMs   = Math.max(30_000, Math.round(simFlightMs / simSpeedRef.current));
      const simElapsedMs = Math.max(0, simNow - depMs);
      const startedAt    = Date.now() - Math.round(simElapsedMs / simSpeedRef.current);

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
    onConfigClose();
  }, [selectedScenario, startDate, startTime, createSession, onConfigClose]);

  const confirmCollapse = useCallback(async () => {
    setShowCollapseWarning(false);
    onConfigClose();
    await createSession(SCENARIOS.COLLAPSE, startDate, startTime);
  }, [createSession, startDate, startTime, onConfigClose]);


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

  // ── Pestaña activa del panel lateral ────────────────────────────────────
  const [infoPanelTab, setInfoPanelTab] = useState<'airports' | 'flights' | 'packages'>('airports');

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

  // ── Vuelo seleccionado en el mapa ────────────────────────────────────────
  const [selectedFlightId, setSelectedFlightId] = useState<string | null>(null);

  // Calcula la posición Bézier actual del avión (misma curva que AnimatedPlane)
  const getPlanePosition = useCallback((plane: ActivePlane, origin: typeof projectedHubs[0], dest: typeof projectedHubs[0]) => {
    const t = Math.min(1, (Date.now() - plane.startedAt) / plane.durationMs);
    const dist = Math.sqrt((dest.projectedX! - origin.projectedX!) ** 2 + (dest.projectedY! - origin.projectedY!) ** 2);
    const bcx = (origin.projectedX! + dest.projectedX!) / 2;
    const bcy = (origin.projectedY! + dest.projectedY!) / 2 - dist * 0.2;
    const mt = 1 - t;
    return {
      x: mt*mt*origin.projectedX! + 2*mt*t*bcx + t*t*dest.projectedX!,
      y: mt*mt*origin.projectedY! + 2*mt*t*bcy + t*t*dest.projectedY!,
      dist,
    };
  }, [projectedHubs]);

  // Al seleccionar un vuelo, hacer zoom instantáneo al avión (o al midpoint si aterrizó)
  const focusOnFlight = useCallback((sf: SeenFlight) => {
    const newId = sf.flightId === selectedFlightId ? null : sf.flightId;
    setSelectedFlightId(newId);
    setSelectedAirportId(null);
    if (!newId) return;
    const origin = projectedHubs.find(h => h.id === sf.fromIcao);
    const dest   = projectedHubs.find(h => h.id === sf.toIcao);
    if (!origin || !dest) return;
    const dist = Math.sqrt((dest.projectedX! - origin.projectedX!) ** 2 + (dest.projectedY! - origin.projectedY!) ** 2);
    const targetK = Math.max(3, Math.min(8, MAP_VIEWBOX.width / (dist * 1.2)));
    const W = MAP_VIEWBOX.width;
    const H = MAP_VIEWBOX.height;
    // Saltar al avión si está en vuelo, sino al midpoint
    const plane = activePlanes.find(p => p.flightId === sf.flightId);
    let fx: number, fy: number;
    if (plane && sf.isActive) {
      const pos = getPlanePosition(plane, origin, dest);
      fx = pos.x; fy = pos.y;
    } else {
      fx = (origin.projectedX! + dest.projectedX!) / 2;
      fy = (origin.projectedY! + dest.projectedY!) / 2;
    }
    setViewTransform(clamp(W / 2 - fx * targetK, H / 2 - fy * targetK, targetK));
  }, [projectedHubs, clamp, selectedFlightId, activePlanes, getPlanePosition]);

  // Enfocar un vuelo desde el panel de información (datos del API).
  // Para vuelos DEPARTED: resuelve primero contra activePlanes (fuente de verdad del WS actual)
  // para obtener el flightId exacto y las ICAO correctas, evitando mezclar instancias del mismo
  // horario de días distintos.
  // Para vuelos SCHEDULED/ARRIVED: crea un SeenFlight sintético con datos del API.
  const focusOnSimFlight = useCallback((f: SimFlight) => {
    // 1. Buscar el avión activo en el mapa: solo por flightId exacto o scheduleId.
    // NO usar la ruta (fromIcao/toIcao) como fallback: si hay dos vuelos en la misma
    // ruta, cogería el primero que encuentre en activePlanes en lugar del vuelo correcto.
    const matchingPlane = activePlanes.find(p =>
      p.flightId === f.flightId ||
      scheduleIdOf(p.flightId) === scheduleIdOf(f.flightId)
    );

    // ID real del WS si hay avión en vuelo, sino el del API
    const resolvedId = matchingPlane?.flightId ?? f.flightId;

    // 2. Buscar SeenFlight con el ID resuelto (no por scheduleId, para no coger instancias antiguas)
    const existing = seenFlights.find(sf => sf.flightId === resolvedId);

    if (existing) {
      focusOnFlight(existing);
      return;
    }

    // 3. Sin SeenFlight: construir uno con el ID y las ICAO correctas.
    // isActive solo es true si el WS tiene un avión activo para este vuelo.
    // Si no hay avión en el mapa, el vuelo no puede seguirse aunque el API diga DEPARTED.
    const synthetic: SeenFlight = {
      flightId: resolvedId,
      scheduleId: scheduleIdOf(resolvedId),
      fromIcao: matchingPlane?.fromIcao ?? f.fromIcao,
      toIcao:   matchingPlane?.toIcao   ?? f.toIcao,
      seenAt: Date.now(),
      isActive: !!matchingPlane,
    };
    setSeenFlights(prev => mergeSeenFlights(prev, synthetic, resolvedId));
    focusOnFlight(synthetic);
  }, [seenFlights, focusOnFlight, activePlanes]);

  // Enfocar un aeropuerto desde el panel y deseleccionar vuelo
  const handleSelectAirportFromPanel = useCallback((icao: string) => {
    focusOnAirport(icao);
    setSelectedFlightId(null);
  }, [focusOnAirport]);

  // Enfocar un envío "En ruta": consulta el tramo activo del envío y navega al avión
  const focusOnShipment = useCallback(async (s: SimShipment) => {
    if (!session?.id) return;
    try {
      const { fromIcao, toIcao } = await simulationService.getShipmentDetail(session.id, s.shipmentId);
      if (!fromIcao || !toIcao) return;

      // Buscar el avión en activePlanes que esté en ese tramo
      const plane = activePlanes.find(p => p.fromIcao === fromIcao && p.toIcao === toIcao);
      if (!plane) return;

      const sf = seenFlights.find(f => f.flightId === plane.flightId);
      if (sf) {
        setInfoPanelTab('flights');
        focusOnFlight(sf);
      }
    } catch { /* silencioso */ }
  }, [session?.id, activePlanes, seenFlights, focusOnFlight]);

  // ── Cámara sigue al avión seleccionado con RAF (fluido, sin escalonado) ──
  const selectedFlightIdRef = useRef<string | null>(null);
  useEffect(() => { selectedFlightIdRef.current = selectedFlightId; }, [selectedFlightId]);
  const projectedHubsRef = useRef(projectedHubs);
  useEffect(() => { projectedHubsRef.current = projectedHubs; }, [projectedHubs]);

  useEffect(() => {
    if (!selectedFlightId) return;
    let rafId: number;

    const follow = () => {
      const fid = selectedFlightIdRef.current;
      if (!fid) return;
      const plane = activePlanesRef.current.find(p => p.flightId === fid);
      if (!plane) { rafId = requestAnimationFrame(follow); return; }
      const origin = projectedHubsRef.current.find(h => h.id === plane.fromIcao);
      const dest   = projectedHubsRef.current.find(h => h.id === plane.toIcao);
      if (!origin || !dest) { rafId = requestAnimationFrame(follow); return; }

      // Misma curva de Bézier que AnimatedPlane
      const t = Math.min(1, (Date.now() - plane.startedAt) / plane.durationMs);
      const dist = Math.sqrt((dest.projectedX! - origin.projectedX!) ** 2 + (dest.projectedY! - origin.projectedY!) ** 2);
      const cx = (origin.projectedX! + dest.projectedX!) / 2;
      const cy = (origin.projectedY! + dest.projectedY!) / 2 - dist * 0.2;
      const mt = 1 - t;
      const px = mt*mt*origin.projectedX! + 2*mt*t*cx + t*t*dest.projectedX!;
      const py = mt*mt*origin.projectedY! + 2*mt*t*cy + t*t*dest.projectedY!;

      // targetX/Y se calculan dentro del callback con prev.k para que sean correctos
      // independientemente del zoom actual. Si se usara un targetK fijo calculado afuera,
      // la cámara no centraría bien cuando prev.k difiere de ese targetK.
      setViewTransform(prev => {
        const W = MAP_VIEWBOX.width;
        const H = MAP_VIEWBOX.height;
        const txAtK = W / 2 - px * prev.k;
        const tyAtK = H / 2 - py * prev.k;
        const sf = 0.06;
        const nx = prev.x + (txAtK - prev.x) * sf;
        const ny = prev.y + (tyAtK - prev.y) * sf;
        return clamp(nx, ny, prev.k);
      });

      rafId = requestAnimationFrame(follow);
    };

    rafId = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(rafId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFlightId, clamp]);

  // ── Rutas e hubs con vuelo activo ────────────────────────────────────────
  const hubIndex = useMemo(() => new Map(projectedHubs.map(h => [h.id, h])), [projectedHubs]);

  // Vuelo seleccionado en el mapa
  const selectedPlane = useMemo(() =>
    selectedFlightId ? activePlanes.find(p => p.flightId === selectedFlightId) ?? null : null
  , [selectedFlightId, activePlanes]);

  const selectedFlight = useMemo(() =>
    selectedFlightId ? seenFlights.find(f => f.flightId === selectedFlightId) ?? null : null
  , [selectedFlightId, seenFlights]);

  // La ruta seleccionada es sólida únicamente si hay un avión real en el mapa.
  // El API puede decir "En vuelo" pero sin avión en activePlanes (WS no lo confirmó)
  // la ruta debe pintarse punteada — no hay nada que seguir.
  const selectedFlightIsActive = !!selectedPlane;

  // Clave por par origen-destino para evitar desfases por ID de vuelo
  const activeRoutePairSet = useMemo(() => {
    const s = new Set<string>();
    activePlanes.forEach(p => s.add(`${p.fromIcao}-${p.toIcao}`));
    return s;
  }, [activePlanes]);

  // Fuente de verdad para "En vuelo": solo los aviones que están físicamente
  // en el mapa (activePlanes). Si no hay avión visible, el vuelo no está en vuelo.
  const mapActiveFlightIds = useMemo(() =>
    new Set(activePlanes.map(p => p.flightId)),
  [activePlanes]);

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
                    strokeDasharray={!selectedFlightIsActive ? `${4 / viewTransform.k} ${4 / viewTransform.k}` : undefined}
                  />
                );
              }
              if (isActive) {
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
                    setPlaneTooltip({ plane, screenX: e.clientX - (containerRect?.left ?? 0), screenY: e.clientY - (containerRect?.top ?? 0) });
                  }}
                  onMouseMove={(e) => {
                    if (!planeTooltip) return;
                    const containerRect = svgRef.current?.parentElement?.getBoundingClientRect();
                    setPlaneTooltip(prev => prev ? { ...prev, screenX: e.clientX - (containerRect?.left ?? 0), screenY: e.clientY - (containerRect?.top ?? 0) } : null);
                  }}
                  onMouseLeave={() => setPlaneTooltip(null)}
                  onClick={() => {
                    const sf = seenFlights.find(f => f.flightId === plane.flightId);
                    if (sf) focusOnFlight(sf);
                    else { setSelectedFlightId(prev => prev === plane.flightId ? null : plane.flightId); setSelectedAirportId(null); }
                    setInfoPanelOpen(true);
                    setInfoPanelTab('flights');
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
                  : currentStorage === 0 ? '#94a3b8'   // vacío — gris neutro
                  : '#10b981';                          // óptimo — verde

              return (
                <g
                  key={hub.id}
                  opacity={isDimmedHub ? 0.25 : 1}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => {
                    const containerRect = svgRef.current?.parentElement?.getBoundingClientRect();
                    setHubTooltip({
                      hub,
                      screenX: e.clientX - (containerRect?.left ?? 0),
                      screenY: e.clientY - (containerRect?.top ?? 0),
                    });
                  }}
                  onMouseMove={(e) => {
                    if (!hubTooltip) return;
                    const containerRect = svgRef.current?.parentElement?.getBoundingClientRect();
                    setHubTooltip(prev => prev ? {
                      ...prev,
                      screenX: e.clientX - (containerRect?.left ?? 0),
                      screenY: e.clientY - (containerRect?.top ?? 0),
                    } : null);
                  }}
                  onMouseLeave={() => setHubTooltip(null)}
                  onClick={() => {
                    focusOnAirport(hub.id);
                    setSelectedFlightId(null);
                    setInfoPanelOpen(true);
                    setInfoPanelTab('airports');
                  }}
                >
                  {/* Zona de hover ampliada (invisible) */}
                  <circle cx={x} cy={y} r={r * 3} fill="transparent" />
                  {/* Halo de selección / vuelos activos */}
                  {hasActiveFlights && (
                    <circle cx={x} cy={y} r={r * 2.4}
                      fill={isSelectedHub ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.12)'} />
                  )}
                  {isSelectedHub && (
                    <circle cx={x} cy={y} r={r * 2.8}
                      fill="none" stroke={isAirportSelected ? '#6366f1' : '#f59e0b'}
                      strokeWidth={1.2 / viewTransform.k}
                      strokeDasharray={`${3.5 / viewTransform.k} ${2.5 / viewTransform.k}`} />
                  )}
                  {/* Diamante (cuadrado rotado 45°) — marcador de aeropuerto */}
                  <rect
                    x={x - r * 0.82} y={y - r * 0.82}
                    width={r * 1.64} height={r * 1.64}
                    rx={r * 0.28}
                    fill={storageColor}
                    stroke="white"
                    strokeWidth={1.4 / viewTransform.k}
                    transform={`rotate(45,${x},${y})`}
                  />
                  {/* Cruz de pistas interior */}
                  <line x1={x - r * 0.42} y1={y} x2={x + r * 0.42} y2={y}
                    stroke="white" strokeWidth={0.9 / viewTransform.k} strokeLinecap="round" />
                  <line x1={x} y1={y - r * 0.42} x2={x} y2={y + r * 0.42}
                    stroke="white" strokeWidth={0.9 / viewTransform.k} strokeLinecap="round" />
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

      {/* ── CONTROLES DE ZOOM (debajo de la barra superior) ────────────────── */}
      <div className="absolute top-[72px] left-4 z-20 flex flex-col gap-1.5">
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
      </div>

      {/* ── PANEL DE CONFIGURACIÓN (flotante en el mapa, disparado desde header) ── */}
      <AnimatePresence>
        {showConfig && !session && (
          <motion.div
            key="pop-config"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="absolute top-4 left-4 z-40 w-[320px] bg-white/97 backdrop-blur-md rounded-2xl border border-slate-200 shadow-2xl p-4 max-h-[80vh] overflow-y-auto custom-scrollbar"
          >
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-700 mb-3">Configurar simulación</p>
              <div className="space-y-4">
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
            </motion.div>
          )}
        </AnimatePresence>

      {/* ── BOTÓN LEYENDA (flotante en mapa, esquina inferior izquierda) ───── */}
      <div className="absolute bottom-4 left-4 z-30 flex flex-col gap-2 items-start">
        <AnimatePresence>
          {legendOpen && (
            <motion.div
              key="pop-legend"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
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
                  <div className="w-6 h-px bg-red-400 rounded" style={{ opacity: 0.6 }} />
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

      {/* ── PANEL DE INFORMACIÓN (derecha): Aeropuertos · Vuelos · Paquetes ──── */}
      <AnimatePresence>
        {infoPanelOpen && (
          <motion.div
            key="info-panel"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className="absolute top-4 right-4 bottom-4 z-30 w-[46%] min-w-[400px] max-w-[640px] flex flex-col"
          >
            {/* Botón para colapsar el panel */}
            <button
              onClick={() => setInfoPanelOpen(false)}
              className="absolute -left-3 top-1/2 -translate-y-1/2 z-10 w-7 h-12 bg-white rounded-l-xl border border-slate-200 shadow-lg flex items-center justify-center text-slate-500 hover:text-indigo-600 hover:bg-slate-50 transition-colors"
              title="Ocultar paneles"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <SimulationInfoPanel
              sessionId={session?.id ?? null}
              hasSession={hasSession}
              airports={simAirportList}
              flights={simFlightList}
              shipments={simShipmentList}
              selectedAirportId={selectedAirportId}
              selectedFlightId={selectedFlightId}
              onSelectAirport={handleSelectAirportFromPanel}
              onSelectFlight={focusOnSimFlight}
              onSelectShipment={focusOnShipment}
              shipmentsInFlight={shipmentsInFlight}
              activeTab={infoPanelTab}
              onTabChange={setInfoPanelTab}
              activeFlightIds={mapActiveFlightIds}
              currentSimMs={(() => {
                if (!session?.startTimeAt) return undefined;
                const base = new Date(session.startTimeAt).getTime();
                if (lastSimUpdate) return lastSimUpdate.simMs;
                return base + (session.currentTimeAt || 0) * 3_600_000;
              })()}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Botón para reabrir el panel cuando está colapsado */}
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
