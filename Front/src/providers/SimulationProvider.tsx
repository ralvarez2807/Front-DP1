import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSocket } from './SocketProvider';
import { useAuthContext } from './AuthProvider';
import { useToast } from './ToastProvider';
import { socketService } from '../services/socket';
import { simulationService, SimulationResult } from '../services/simulationService';
import { SimulationSession, OperationalEvent, CriticalPoint } from '../models/operational';
import { SCENARIOS, SimulationScenario } from '../constants/domain';
import { localInputToUtcIso } from '../lib/timezone';
import { saveRun } from '../lib/runHistory';
import { useUserTimezone } from '../hooks/useUserTimezone';

const BACKEND_EVENTS = [
  'FLIGHT_SCHEDULED', 'FLIGHT_DEPARTED', 'FLIGHT_ARRIVED', 'FLIGHT_CANCELLED',
  'BAGGAGE_DEPARTED', 'BAGGAGE_ARRIVED', 'BAGGAGE_DELIVERED', 'BAGGAGE_PENDING',
  'BAGGAGE_ASSIGNED', 'SHIPMENT_CREATED',
] as const;

type BackendEventType = typeof BACKEND_EVENTS[number];

const EVENT_MESSAGES: Record<BackendEventType, (p: any) => string> = {
  FLIGHT_SCHEDULED: (p) => `Vuelo ${p?.flightId} programado: ${p?.fromIcao} → ${p?.toIcao}`,
  FLIGHT_DEPARTED:  (p) => `Vuelo ${p?.flightId} despegó desde ${p?.fromIcao}`,
  FLIGHT_ARRIVED:   (p) => `Vuelo ${p?.flightId} aterrizó en ${p?.toIcao}`,
  FLIGHT_CANCELLED: (p) => `Vuelo ${p?.flightId} cancelado`,
  BAGGAGE_DEPARTED: (p) => `Bulto ${p?.baggageId} embarcado en vuelo ${p?.flightId}`,
  BAGGAGE_ARRIVED:  (p) => `Bulto ${p?.baggageId} llegó a ${p?.currentIcao}`,
  BAGGAGE_DELIVERED:(p) => `Bulto ${p?.baggageId} entregado en ${p?.currentIcao}`,
  BAGGAGE_PENDING:  (p) => `Bulto ${p?.baggageId} en espera en ${p?.currentIcao}`,
  BAGGAGE_ASSIGNED: (p) => `Bulto ${p?.baggageId} asignado a ruta`,
  SHIPMENT_CREATED: (p) => `Envío ${p?.shipmentId}: ${p?.originIcao} → ${p?.destIcao}`,
};

// ── Ancla real de "cuándo arrancó la sesión" (para T. Real) ──────────────────
// El backend no manda tiempo real transcurrido (ver docs), así que se ancla al
// reloj del navegador que crea/recupera la sesión. Se persiste en localStorage
// para que sobreviva recargas de página y se comparta entre pestañas del mismo
// navegador — sin esto, cada pestaña/recarga perdía el ancla y "T. Real" se
// veía reiniciado en 0 en vez de continuar donde iba la sesión real.
const SESSION_STARTED_KEY = 'session_started_at';

function readStoredStartedAt(sessionId: string): number | null {
  try {
    const raw = localStorage.getItem(SESSION_STARTED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.id === sessionId ? parsed.startedAt : null;
  } catch {
    return null;
  }
}
function storeStartedAt(sessionId: string, startedAt: number) {
  localStorage.setItem(SESSION_STARTED_KEY, JSON.stringify({ id: sessionId, startedAt }));
}
function clearStoredStartedAt() {
  localStorage.removeItem(SESSION_STARTED_KEY);
}

// Cuando se recupera una sesión que este navegador nunca vio antes (sin ancla
// guardada), no hay forma de saber el instante real exacto en que arrancó —
// pero SÍ se puede estimar: simElapsedMs = realElapsedMs * speedFactor (así
// funciona el acelerador), así que t.real ≈ t.simulado / speedFactor. Es mucho
// mejor aproximación que asumir "recién arrancó ahora" (lo que hacía que T.Real
// mostrara 0 y avanzara desde cero pese a que la sesión llevaba horas corriendo).
function estimateStartedAt(simStartIso: string, simTimeIso: string, speedFactor: number): number {
  const simElapsedMs = new Date(simTimeIso).getTime() - new Date(simStartIso).getTime();
  const estimatedRealElapsedMs = speedFactor > 0 ? simElapsedMs / speedFactor : 0;
  return Date.now() - Math.max(0, estimatedRealElapsedMs);
}

// El backend mantiene la sesión terminada en su registry solo ~15s de margen
// (REGISTRY_GRACE_SECONDS) antes de liberarla — pasado eso, /reports/summary
// devuelve 404. Un solo intento fallido (red lenta, o el WS mismo llegó tarde
// por lag) dejaba el reporte final en blanco para siempre, sin ningún aviso —
// se veía como una pantalla rota en vez de un error explícito. Reintenta unas
// pocas veces dentro de esa ventana antes de rendirse.
async function fetchReportWithRetry(sessionId: string, attempts = 3, delayMs = 1500): Promise<any | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await simulationService.getSummaryReport(sessionId);
    } catch {
      if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return null;
}

function toOperationalEvent(type: BackendEventType, payload: any, simTime?: string): OperationalEvent {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: type.startsWith('FLIGHT') ? 'flight_delay' : 'shipment_update',
    severity: type === 'FLIGHT_CANCELLED' ? 'warning' : 'info',
    timestamp: simTime || new Date().toISOString(),
    message: EVENT_MESSAGES[type]?.(payload) ?? type,
  };
}

// startDate/startTime son hora LOCAL del usuario (según su ciudad) — se convierten
// a UTC con localInputToUtcIso antes de construir el rango.
function computeDateRange(
  scenario: SimulationScenario,
  startDate: string,
  startTime: string = '00:00',
  gmtOffset: number = 0,
  durationDays: number = 5,
): { simStart: string; simEnd: string } {
  const start = new Date(localInputToUtcIso(startDate, startTime, gmtOffset));
  const end   = new Date(start);
  if (scenario === SCENARIOS.PERIOD_5D) {
    end.setUTCDate(end.getUTCDate() + durationDays); // LE-69: duración elegible (3/5/7)
  } else if (scenario === SCENARIOS.COLLAPSE) {
    end.setUTCDate(end.getUTCDate() + 30);
  } else {
    end.setUTCDate(end.getUTCDate() + 1);
  }
  return { simStart: start.toISOString(), simEnd: end.toISOString() };
}

export interface DashboardMetrics {
  simTime: string; delivered: number; pending: number; assigned: number;
  inFlight: number; slaBreaches: number; throughputPerHour: number;
  // Indicadores globales LE-101/LE-102 — el backend manda el % crudo, el semáforo lo pinta el front
  fleetOccupancyPct?: number;
  airportOccupancyPct?: number;
}

export interface CollapseResult {
  sessionId: string;
  simTime: string;
  reason: string;
  baggageId: string;
  deadline: string;
  consecutiveCycles: number;
  simElapsedMs: number;
  realElapsedMs: number;
  // Reporte de la última planificación estable (G10) — llega asíncrono, best effort
  report?: any | null;
}

interface SimulationContextType {
  session: SimulationSession | null;
  events: OperationalEvent[];
  criticalPoints: CriticalPoint[];
  isLoading: boolean;
  error: string | null;
  restoredFlights: any[];
  clearRestoredFlights: () => void;
  sessionStartedAt: number | null;
  lastSimUpdate: { simMs: number; realMs: number } | null;
  completionReport: any | null;
  clearCompletionReport: () => void;
  collapseResult: CollapseResult | null;
  clearCollapseResult: () => void;
  dashboardMetrics: DashboardMetrics | null;
  /** Acción de ciclo de vida en curso (pausa/reanudar/detener) — mientras no sea
   *  null, la UI debe deshabilitar esos controles: sin esto, un click en "pausar"
   *  con latencia de red no bloqueaba el botón "reiniciar" ni "iniciar", y un
   *  segundo click disparaba una petición en paralelo que carreaba con la primera
   *  (síntoma reportado: pausa lenta + reinicio inmediato → estado inconsistente). */
  actionPending: 'start' | 'pause' | 'reset' | null;
  /** Vuelve a chequear GET /simulations/mine — usado al entrar a la pestaña
   *  Simulación por si una sesión se creó en otra pestaña después del montaje. */
  checkForExistingSession: () => Promise<void>;
  createSession: (scenario: SimulationScenario, startDate: string, startTime?: string, durationDays?: number) => Promise<void>;
  startSimulation: () => Promise<void>;
  pauseSimulation: () => Promise<void>;
  resetSimulation: () => Promise<void>;
  injectFault: (type: string, locationId: string) => Promise<void>;
}

const SimulationContext = createContext<SimulationContextType | null>(null);

export const SimulationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const socket = useSocket();
  const { addToast } = useToast();
  const { isAuthenticated, user } = useAuthContext();
  const gmtOffset = useUserTimezone();
  const [session, setSession] = useState<SimulationSession | null>(null);
  const [events, setEvents] = useState<OperationalEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoredFlights, setRestoredFlights] = useState<any[]>([]);
  const clearRestoredFlights = useCallback(() => setRestoredFlights([]), []);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [lastSimUpdate, setLastSimUpdate] = useState<{ simMs: number; realMs: number } | null>(null);
  // Espejo del último tiempo simulado conocido, para leerlo desde el polling de
  // respaldo (cuyo closure no se recrea en cada evento WS) al reconstruir el
  // colapso vía GET /result.
  const lastSimUpdateRef = useRef<{ simMs: number; realMs: number } | null>(null);
  useEffect(() => { lastSimUpdateRef.current = lastSimUpdate; }, [lastSimUpdate]);
  // Espejo de la sesión activa para leer startTimeAt/scenario desde el listener de
  // COLLAPSE_DETECTED sin que ese efecto tenga que re-suscribirse en cada evento
  // (ver por qué en el comentario de ese efecto, más abajo).
  const sessionRef = useRef<SimulationSession | null>(null);
  useEffect(() => { sessionRef.current = session; }, [session]);
  const [completionReport, setCompletionReport] = useState<any | null>(null);
  const clearCompletionReport = useCallback(() => setCompletionReport(null), []);
  const [collapseResult, setCollapseResult] = useState<CollapseResult | null>(null);
  const clearCollapseResult = useCallback(() => setCollapseResult(null), []);
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(null);
  const [actionPending, setActionPending] = useState<'start' | 'pause' | 'reset' | null>(null);

  // ── Polling de métricas del dashboard ────────────────────────────────────
  useEffect(() => {
    const ACTIVE = new Set(['starting', 'running', 'paused']);
    if (!session?.id || !ACTIVE.has(session.status)) { setDashboardMetrics(null); return; }
    const sessionId = session.id;
    let cancelled = false;
    const fetch = async () => {
      try {
        const data = await simulationService.getDashboard(sessionId);
        if (!cancelled) setDashboardMetrics(data);
      } catch { /* silencioso */ }
    };
    fetch();
    const id = setInterval(fetch, 5_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [session?.id, session?.status]);

  // ── Rehidratación via GET /simulations/mine ───────────────────────────────
  // Solo con el usuario autenticado: este endpoint requiere JWT. Si se dispara
  // antes del login (p. ej. un dispositivo nuevo que aún no tiene sesión iniciada
  // en el navegador) daba 401 y, como el efecto solo corría una vez al montar,
  // nunca se reintentaba tras el login — la sesión activa del usuario en otro
  // dispositivo quedaba sin restaurar para siempre. Mismo bug que ya se arregló
  // en MapProvider; aquí se reintenta en cada login (isAuthenticated/user).
  //
  // Extraída como función reutilizable (no solo efecto al montar) para que la
  // vista de Simulación pueda volver a llamarla al entrar a esa pestaña — cubre
  // el caso de una sesión creada en otra pestaña del navegador DESPUÉS de que
  // esta ya había montado y corrido su chequeo inicial una sola vez.
  const checkForExistingSession = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const mine = await simulationService.getMine();
      if (!mine) return;
      const status = mine.status?.toLowerCase() as SimulationSession['status'];
      if (status === 'stopped' || status === 'completed' || status === 'collapsed') return;

      const savedConfig = localStorage.getItem('simulation_config');
      const config: { scenario: SimulationScenario; speed: number } = savedConfig
        ? JSON.parse(savedConfig)
        : { scenario: 'period_5d' as SimulationScenario, speed: 1 };

      const snapshot = await simulationService.getSnapshotRaw(mine.id);
      const mapped = simulationService.mapSessionPublic({ ...snapshot, id: mine.id }, config);
      setSession(mapped);
      const inFlight = (snapshot.flights ?? [])
        .filter((f: any) => f.status === 'DEPARTED' || f.status === 'IN_FLIGHT')
        .map((f: any) => ({ ...f, simTime: snapshot.simTime }));
      if (inFlight.length > 0) setRestoredFlights(inFlight);
      // Restaura el ancla real de "T. Real": si esta sesión ya se había visto en
      // este navegador (otra pestaña, o esta misma antes de recargar), reusa su
      // startedAt. Si no, se estima a partir de t.simulado/speedFactor en vez de
      // asumir "recién arrancó ahora" (ver `estimateStartedAt`).
      const startedAt = readStoredStartedAt(mine.id)
        ?? estimateStartedAt(snapshot.simStart, snapshot.simTime, mapped.speedFactor);
      storeStartedAt(mine.id, startedAt);
      setSessionStartedAt(startedAt);
      socketService.connect(mine.id);
    } catch {
      // silencioso: 401 antes del login, red caída, etc. — no hay sesión que restaurar
    }
  }, [isAuthenticated]);

  useEffect(() => { checkForExistingSession(); }, [checkForExistingSession]);

  useEffect(() => {
    const unsubs = BACKEND_EVENTS.map(eventType =>
      socket.on(eventType, ({ simTime, payload }: { simTime?: string; payload: any }) => {
        if (simTime) {
          setLastSimUpdate({ simMs: new Date(simTime).getTime(), realMs: Date.now() });
        }
        setSession(prev => {
          if (!prev || !simTime) return prev;
          const startMs = new Date(prev.startTimeAt).getTime();
          const simMs = new Date(simTime).getTime();
          const hoursElapsed = Math.max(0, Math.round((simMs - startMs) / 3_600_000));
          return { ...prev, currentTimeAt: hoursElapsed };
        });
        setEvents(prev => [
          toOperationalEvent(eventType, payload, simTime),
          ...prev.slice(0, 49),
        ]);
      })
    );
    return () => unsubs.forEach(u => u());
  }, [socket]);

  // ── SIMULATION_ENDED: cierre autoritativo de la sesión por WS ────────────
  // Reemplaza al viejo listener 'SIM_STATUS': el backend nunca llegó a emitir
  // ese tipo de evento (no existe en el switch de InMemoryStatePublicher —
  // era código muerto acá). Antes de esto, "completed"/"stopped" solo se
  // detectaban vía el polling de respaldo (drift de hasta 4s, o nunca si el
  // 404 de sesión liberada no llegaba a tiempo). Ahora el backend publica
  // SIMULATION_ENDED { status, collapseReason } para los tres finales
  // (COMPLETED/COLLAPSED/STOPPED) justo antes de cerrar el socket limpio.
  useEffect(() => {
    const unsub = socket.on('SIMULATION_ENDED', ({ payload }: {
      payload: { simTime: string; status: string; collapseReason: string | null };
    }) => {
      const status = payload?.status?.toLowerCase() as 'stopped' | 'completed' | 'collapsed';
      if (!status) return;
      // Captura si YA se había limpiado la sesión por otra vía (típicamente
      // COLLAPSE_DETECTED, que llega antes y trae más detalle para su propio
      // modal) — si es así, este evento es puramente informativo y no debe
      // repetir el fetch del reporte ni el toast.
      let alreadyHandled = true;
      setSession(prev => {
        if (!prev?.id) return null;
        alreadyHandled = false;
        const runId = prev.id;
        const scenario = prev.config?.scenario ?? 'period_5d';
        // Fetch asíncrono del reporte — no bloquea el render. Además se guarda
        // en el historial local para la comparativa de ejecuciones (LE-76).
        fetchReportWithRetry(runId).then(report => {
          if (report) {
            setCompletionReport({ ...report, __outcome: status, __sessionId: runId });
          } else {
            setCompletionReport({ error: true, __outcome: status, __sessionId: runId });
          }
          saveRun({ id: runId, endedAt: Date.now(), scenario, outcome: status, report });
        });
        return null;
      });
      if (alreadyHandled) return;
      socketService.disconnect();
      localStorage.removeItem('simulation_config');
      clearStoredStartedAt();
      setEvents([]);
      setSessionStartedAt(null);
      setLastSimUpdate(null);
      // "collapsed" no muestra este toast: el modal de colapso ya informa el desenlace.
      // "completed"/"stopped" desde ESTA pestaña ya se manejan en resetSimulation()
      // (que se desconecta antes de que este evento pueda llegar); este toast es
      // para cuando la sesión se cierra vista desde OTRA pestaña/dispositivo.
      if (status !== 'completed' && status !== 'collapsed') {
        addToast('Simulación detenida externamente', 'info');
      }
    });
    return unsub;
  }, [socket, addToast]);

  // ── COLLAPSE_DETECTED: el backend detectó colapso operativo ──────────────
  // Aplica a cualquier escenario (todos corren con collapseOnFailure: true).
  // Finaliza la sesión localmente como si hubiera terminado normalmente — el
  // backend la detiene y termina en status "completed", pero no esperamos a
  // ese SIM_STATUS para cerrar: el modal de colapso ya informa el desenlace.
  //
  // Depende SOLO de `session?.id` (igual que el resto de efectos de este
  // archivo) y no del objeto `session` completo — startTimeAt/scenario se leen
  // de `sessionRef` dentro del handler. Antes dependía de `session`, que
  // recibe un objeto NUEVO en cada evento de backend (ver el listener de
  // BACKEND_EVENTS más arriba, `currentTimeAt` cambia en cada uno), así que
  // este efecto se des/re-suscribía del socket en CADA evento. En el escenario
  // "Simulación hasta el Colapso" (speedFactor 1000, muchísimos más eventos
  // por segundo real que los demás escenarios) ese churn de-suscribir/re-
  // suscribir podía llegar a miles de veces por corrida — el candidato más
  // probable tanto para el lag reportado al pausar como para que, alguna vez,
  // el propio COLLAPSE_DETECTED llegara justo en medio de un ciclo de
  // resuscripción y no se procesara (sin re-suscribirse en cada evento, el
  // listener queda fijo una sola vez por sesión, sin ese hueco).
  useEffect(() => {
    if (!session?.id) return;
    const sessionId = session.id;

    const unsub = socket.on('COLLAPSE_DETECTED', ({ payload }: { payload: {
      simTime: string; reason: string; baggageId: string; deadline: string; consecutiveCycles: number;
    } }) => {
      if (!payload?.simTime) return;
      const current    = sessionRef.current;
      const startTimeAt = current?.startTimeAt ?? payload.simTime;
      const scenario    = current?.config?.scenario ?? 'collapse';
      const simElapsedMs  = new Date(payload.simTime).getTime() - new Date(startTimeAt).getTime();
      const realElapsedMs = Date.now() - (sessionStartedAt ?? Date.now());
      setCollapseResult({
        sessionId,
        simTime:           payload.simTime,
        reason:            payload.reason,
        baggageId:         payload.baggageId,
        deadline:          payload.deadline,
        consecutiveCycles: payload.consecutiveCycles,
        simElapsedMs,
        realElapsedMs,
      });
      // Reporte de la última planificación estable al colapsar (G10) — best effort,
      // el backend detiene la sesión justo después de emitir el evento. Se
      // resuelve SIEMPRE (con reintentos, ver fetchReportWithRetry) a un valor
      // explícito — null si falla — para que el modal pueda distinguir "todavía
      // cargando" (report === undefined) de "no se pudo traer" (report === null)
      // en vez de quedarse en blanco para siempre sin ningún aviso.
      fetchReportWithRetry(sessionId).then(report => {
        setCollapseResult(prev => prev ? { ...prev, report } : prev);
        saveRun({ id: sessionId, endedAt: Date.now(), scenario, outcome: 'collapsed', report });
      });
      socketService.disconnect();
      localStorage.removeItem('simulation_config');
      clearStoredStartedAt();
      setSession(null);
      setEvents([]);
      setSessionStartedAt(null);
      setLastSimUpdate(null);
    });
    return unsub;
  }, [socket, session?.id, sessionStartedAt]);

  // ── Resync por gap en seq del WebSocket ───────────────────────────────────
  useEffect(() => {
    if (!session?.id) return;
    const sessionId = session.id;
    const config    = session.config;

    const unsub = socket.on('RESYNC_NEEDED', async () => {
      try {
        const raw = await simulationService.getSnapshotRaw(sessionId);
        const restored = simulationService.mapSessionPublic({ ...raw, id: sessionId }, config);
        setSession(prev => prev ? { ...restored, config: prev.config } : null);
        const inFlight = (raw.flights ?? [])
          .filter((f: any) => f.status === 'DEPARTED' || f.status === 'IN_FLIGHT')
          .map((f: any) => ({ ...f, simTime: raw.simTime }));
        if (inFlight.length > 0) setRestoredFlights(inFlight);
      } catch (e) {
        console.error('[Sim] Snapshot resync failed', e);
      }
    });

    return unsub;
  }, [session?.id, socket]);

  // ── Polling de respaldo: sincroniza estado aunque el WS no llegue ─────────
  useEffect(() => {
    const TERMINAL = new Set(['stopped', 'completed', 'collapsed']);
    const ACTIVE   = new Set(['starting', 'running', 'paused']);
    if (!session?.id || !ACTIVE.has(session.status)) return;

    const sessionId     = session.id;
    const config        = session.config;
    const startTimeAtIso = session.startTimeAt;
    const speedFactor    = session.speedFactor;

    // Limpieza local de la sesión (idéntica al cierre por WS).
    const teardown = () => {
      socketService.disconnect();
      localStorage.removeItem('simulation_config');
      clearStoredStartedAt();
      setEvents([]);
      setSessionStartedAt(null);
      setLastSimUpdate(null);
      setSession(null);
    };

    // Muestra el modal de colapso a partir del estado final. El WS COLLAPSE_DETECTED
    // es el camino primario (trae simTime/baggageId exactos); esto lo reconstruye por
    // si aquel evento no llegó a procesarse: el simTime se aproxima con el último
    // tiempo simulado conocido y el motivo viene de GET /result.
    const showCollapse = (collapseReason: string | null) => {
      const scenario = config?.scenario ?? 'period_5d';
      const startMs = startTimeAtIso ? new Date(startTimeAtIso).getTime() : Date.now();
      const realElapsedMs = Date.now() - (sessionStartedAt ?? Date.now());
      // Si nunca llegó un evento por WS con t.simulado antes del colapso
      // (lastSimUpdateRef vacío — típico de este camino de respaldo, que se
      // dispara cuando COLLAPSE_DETECTED no se procesó), no hay que clavar
      // t.simulado = inicio (eso mostraba "0" de tiempo simulado transcurrido
      // pese a que la sesión sí llevaba corriendo). Se estima con el mismo
      // ratio que usa el acelerador: simElapsed ≈ realElapsed × speedFactor.
      const simMs = lastSimUpdateRef.current?.simMs
        ?? (speedFactor > 0 ? startMs + realElapsedMs * speedFactor : startMs);
      setCollapseResult({
        sessionId,
        simTime:           new Date(simMs).toISOString(),
        reason:            collapseReason ?? 'Colapso operativo',
        baggageId:         '',
        deadline:          '',
        consecutiveCycles: 0,
        simElapsedMs:      Math.max(0, simMs - startMs),
        realElapsedMs,
      });
      fetchReportWithRetry(sessionId).then(report => {
        setCollapseResult(prev => prev ? { ...prev, report } : prev);
        saveRun({ id: sessionId, endedAt: Date.now(), scenario, outcome: 'collapsed', report });
      });
    };

    const poll = async () => {
      try {
        const updated = await simulationService.getSession(sessionId, config);

        if (TERMINAL.has(updated.status)) {
          // Este polling de respaldo es el que de verdad detecta el fin de una
          // simulación (el evento SIM_STATUS por WS que se maneja más abajo no
          // está confirmado en el backend — no aparece en la tabla de eventos de
          // APIS.md). Cubre también el colapso: si la sesión aún reporta "collapsed"
          // (ventana breve antes de que el backend la elimine) mostramos el modal.
          if (updated.status === 'completed' || updated.status === 'stopped') {
            const outcome: 'completed' | 'stopped' = updated.status;
            const scenario = config?.scenario ?? 'period_5d';
            fetchReportWithRetry(sessionId).then(report => {
              if (report) {
                setCompletionReport({ ...report, __outcome: outcome, __sessionId: sessionId });
              } else {
                setCompletionReport({ error: true, __outcome: outcome, __sessionId: sessionId });
              }
              saveRun({ id: sessionId, endedAt: Date.now(), scenario, outcome, report });
            });
          }
          teardown();
          if (updated.status === 'collapsed') {
            simulationService.getResult(sessionId)
              .then(r => showCollapse(r.collapseReason))
              .catch(() => showCollapse(null));
          } else {
            addToast(
              updated.status === 'completed' ? 'Simulación completada' : 'Simulación detenida externamente',
              'info'
            );
          }
          return;
        }

        setSession(prev => {
          if (!prev) return null;
          return {
            ...prev,
            currentTimeAt: Math.max(prev.currentTimeAt, updated.currentTimeAt),
            status: updated.status,
          };
        });
      } catch (e: any) {
        if (e?.statusCode !== 404) return;

        // 404 = la sesión ya no está en el registry porque TERMINÓ (el backend la
        // elimina al finalizar/colapsar). Su estado final (incl. el flag de colapso)
        // sigue disponible en GET /result durante ~5 min: lo consultamos para mostrar
        // el reporte de colapso en vez del aviso genérico. Es la red de seguridad por
        // si el evento WS COLLAPSE_DETECTED no llegó a procesarse antes del cierre.
        let finalResult: SimulationResult | null = null;
        try {
          finalResult = await simulationService.getResult(sessionId);
        } catch { /* /result también expiró o el id nunca existió */ }

        teardown();

        if (finalResult?.status === 'COLLAPSED') {
          showCollapse(finalResult.collapseReason);
        } else if (finalResult?.status === 'COMPLETED' || finalResult?.status === 'STOPPED') {
          const outcome = finalResult.status.toLowerCase() as 'completed' | 'stopped';
          const scenario = config?.scenario ?? 'period_5d';
          simulationService.getSummaryReport(sessionId)
            .then(report => {
              setCompletionReport({ ...report, __outcome: outcome, __sessionId: sessionId });
              saveRun({ id: sessionId, endedAt: Date.now(), scenario, outcome, report });
            })
            .catch(() => setCompletionReport({ error: true, __outcome: outcome, __sessionId: sessionId }));
        } else {
          addToast('La sesión ya no existe en el servidor', 'warning');
        }
      }
    };

    // Recuperación al volver de segundo plano: los navegadores throttlean
    // agresivamente setInterval/setTimeout en pestañas no visibles (o los
    // pausan del todo si el equipo se suspende) — tanto este poll de 4s como
    // el backoff de reconexión del WS (ver socketService.forceReconnect)
    // pueden quedar sin correr mientras la pestaña está de fondo. Sin esto,
    // al volver había que esperar al próximo tick throttleado (podía tardar
    // minutos) para enterarse de que la sesión había terminado — y si para
    // entonces ya pasó la ventana de gracia del backend (15s en el registry,
    // ~5 min en /result), no quedaba nada que mostrar: ni reporte ni sesión.
    // Se escucha tanto `visibilitychange` (cambio de pestaña) como `focus`
    // (volver desde otra ventana/app — no siempre dispara visibilitychange).
    const onRegainFocus = () => {
      if (document.visibilityState === 'hidden') return;
      socketService.forceReconnect(sessionId);
      poll();
    };
    document.addEventListener('visibilitychange', onRegainFocus);
    window.addEventListener('focus', onRegainFocus);

    // Llamada inmediata: sin esto, setInterval espera 4s para el primer chequeo,
    // y si algo recrea este efecto antes de ese primer tick (p. ej. session?.status
    // cambia por otra vía) el poll de respaldo podía no llegar a ejecutarse NUNCA.
    poll();
    const id = setInterval(poll, 4_000);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onRegainFocus);
      window.removeEventListener('focus', onRegainFocus);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.status]);

  const createSession = useCallback(async (scenario: SimulationScenario, startDate: string, startTime: string = '00:00', durationDays: number = 5) => {
    setIsLoading(true);
    const controller = new AbortController();
    try {
      const { simStart, simEnd } = computeDateRange(scenario, startDate, startTime, gmtOffset, durationDays);
      const config = { scenario, speed: 1 };
      localStorage.setItem('simulation_config', JSON.stringify(config));
      let newSession: SimulationSession;
      let recoveredSnapshot: any = null;
      try {
        newSession = await simulationService.createSession(simStart, simEnd, config, controller.signal);
      } catch (err: any) {
        if (err?.statusCode === 409) {
          // Ya existe una sesión activa — la recuperamos
          const mine = await simulationService.getMine(controller.signal);
          if (!mine) throw err;
          const snapshot = await simulationService.getSnapshotRaw(mine.id, controller.signal);
          recoveredSnapshot = snapshot;
          newSession = simulationService.mapSessionPublic({ ...snapshot, id: mine.id }, config);
          const inFlight = (snapshot.flights ?? [])
            .filter((f: any) => f.status === 'DEPARTED' || f.status === 'IN_FLIGHT')
            .map((f: any) => ({ ...f, simTime: snapshot.simTime }));
          if (inFlight.length > 0) setRestoredFlights(inFlight);
          addToast('Sesión existente recuperada', 'info');
        } else {
          throw err;
        }
      }
      setSession(newSession);
      setEvents([]);
      setError(null);
      setCollapseResult(null);
      // Si se recuperó una sesión ya existente (409), reusa su ancla real si este
      // navegador ya la había visto antes; si no, la estima a partir de
      // t.simulado/speedFactor en vez de asumir "recién arrancó ahora" (ver
      // `estimateStartedAt`) — una sesión recuperada casi siempre lleva rato corriendo.
      const startedAt = recoveredSnapshot
        ? (readStoredStartedAt(newSession.id)
            ?? estimateStartedAt(recoveredSnapshot.simStart, recoveredSnapshot.simTime, newSession.speedFactor))
        : Date.now();
      storeStartedAt(newSession.id, startedAt);
      setSessionStartedAt(startedAt);
      socketService.connect(newSession.id);
      addToast(`Escenario ${scenario} inicializado correctamente`, 'success');
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err.message || 'Failed to initialize simulation');
      addToast('Error al inicializar la sesión', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [addToast, gmtOffset]);

  const startSimulation = useCallback(async () => {
    if (!session || actionPending) return;
    setActionPending('start');
    try {
      await simulationService.resume(session.id);
      setSession(prev => prev ? { ...prev, status: 'running' } : null);
      addToast('Simulación iniciada', 'info');
    } catch {
      addToast('Fallo al iniciar simulación', 'error');
    } finally {
      setActionPending(null);
    }
  }, [session, addToast, actionPending]);

  const pauseSimulation = useCallback(async () => {
    if (!session || actionPending) return;
    setActionPending('pause');
    try {
      await simulationService.pause(session.id);
      setSession(prev => prev ? { ...prev, status: 'paused' } : null);
      addToast('Simulación pausada', 'warning');
    } catch {
      addToast('Error al pausar', 'error');
    } finally {
      setActionPending(null);
    }
  }, [session, addToast, actionPending]);

  const resetSimulation = useCallback(async () => {
    if (!session || actionPending) return;
    setActionPending('reset');
    const runId = session.id;
    const scenario = session.config?.scenario ?? 'period_5d';
    try {
      // El reporte se pide ANTES de detener: una vez que el backend libera la
      // sesión, /reports/summary deja de responder (mismo motivo por el que
      // COLLAPSE_DETECTED lo pide apenas detecta el colapso, no después).
      const report = await fetchReportWithRetry(runId);

      try {
        await simulationService.stop(runId);
      } catch {
        // Seguimos igual: si stop() falla probablemente la sesión ya había
        // terminado sola justo antes de este click — no debe impedir mostrar
        // el reporte que sí logramos traer.
      }

      socketService.disconnect();
      localStorage.removeItem('simulation_config');
      clearStoredStartedAt();
      setSession(null);
      setEvents([]);
      setSessionStartedAt(null);
      setLastSimUpdate(null);
      if (report) {
        setCompletionReport({ ...report, __outcome: 'stopped', __sessionId: runId });
        saveRun({ id: runId, endedAt: Date.now(), scenario, outcome: 'stopped', report });
      } else {
        setCompletionReport({ error: true, __outcome: 'stopped', __sessionId: runId });
        saveRun({ id: runId, endedAt: Date.now(), scenario, outcome: 'stopped', report: null });
      }
      addToast('Simulación detenida', 'info');
    } finally {
      setActionPending(null);
    }
  }, [session, addToast, actionPending]);

  const injectFault = useCallback(async (_type: string, _locationId: string) => {
    addToast('Inyección de fallos no disponible en esta versión del backend', 'warning');
  }, [addToast]);

  const value = useMemo(() => ({
    session,
    events,
    criticalPoints: [] as CriticalPoint[],
    isLoading,
    error,
    restoredFlights,
    clearRestoredFlights,
    sessionStartedAt,
    lastSimUpdate,
    completionReport,
    clearCompletionReport,
    collapseResult,
    clearCollapseResult,
    dashboardMetrics,
    actionPending,
    checkForExistingSession,
    createSession,
    startSimulation,
    pauseSimulation,
    resetSimulation,
    injectFault,
  }), [session, events, isLoading, error, restoredFlights, clearRestoredFlights, sessionStartedAt, lastSimUpdate, completionReport, clearCompletionReport, collapseResult, clearCollapseResult, dashboardMetrics, actionPending, checkForExistingSession, createSession, startSimulation, pauseSimulation, resetSimulation, injectFault]);

  return (
    <SimulationContext.Provider value={value}>
      {children}
    </SimulationContext.Provider>
  );
};

export const useSimulationContext = () => {
  const context = useContext(SimulationContext);
  if (!context) throw new Error('useSimulationContext must be used within a SimulationProvider');
  return context;
};
