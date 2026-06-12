import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useSocket } from './SocketProvider';
import { useToast } from './ToastProvider';
import { socketService } from '../services/socket';
import { simulationService } from '../services/simulationService';
import { SimulationSession, OperationalEvent, CriticalPoint } from '../models/operational';
import { SCENARIOS, SimulationScenario } from '../constants/domain';

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

function toOperationalEvent(type: BackendEventType, payload: any, simTime?: string): OperationalEvent {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: type.startsWith('FLIGHT') ? 'flight_delay' : 'shipment_update',
    severity: type === 'FLIGHT_CANCELLED' ? 'warning' : 'info',
    timestamp: simTime || new Date().toISOString(),
    message: EVENT_MESSAGES[type]?.(payload) ?? type,
  };
}

function computeDateRange(scenario: SimulationScenario, startDate: string): { simStart: string; simEnd: string } {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(start);
  if (scenario === SCENARIOS.PERIOD_5D) {
    end.setDate(end.getDate() + 5);
  } else if (scenario === SCENARIOS.COLLAPSE) {
    end.setDate(end.getDate() + 30);
  } else {
    end.setDate(end.getDate() + 1);
  }
  return { simStart: start.toISOString(), simEnd: end.toISOString() };
}

interface SimulationContextType {
  session: SimulationSession | null;
  events: OperationalEvent[];
  criticalPoints: CriticalPoint[];
  isLoading: boolean;
  error: string | null;
  restoredFlights: any[];
  clearRestoredFlights: () => void;
  createSession: (scenario: SimulationScenario, startDate: string) => Promise<void>;
  startSimulation: () => Promise<void>;
  pauseSimulation: () => Promise<void>;
  resetSimulation: () => Promise<void>;
  injectFault: (type: string, locationId: string) => Promise<void>;
}

const SimulationContext = createContext<SimulationContextType | null>(null);

export const SimulationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const socket = useSocket();
  const { addToast } = useToast();
  const [session, setSession] = useState<SimulationSession | null>(null);
  const [events, setEvents] = useState<OperationalEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoredFlights, setRestoredFlights] = useState<any[]>([]);
  const clearRestoredFlights = useCallback(() => setRestoredFlights([]), []);

  // ── Rehidratación via GET /simulations/mine ───────────────────────────────
  useEffect(() => {
    simulationService.getMine()
      .then(mine => {
        if (!mine) return;
        const status = mine.status?.toLowerCase() as SimulationSession['status'];
        if (status === 'stopped' || status === 'completed') return;

        const savedConfig = localStorage.getItem('simulation_config');
        const config: { scenario: SimulationScenario; speed: number } = savedConfig
          ? JSON.parse(savedConfig)
          : { scenario: 'period_5d' as SimulationScenario, speed: 1 };

        simulationService.getSnapshotRaw(mine.id)
          .then(snapshot => {
            setSession(simulationService.mapSessionPublic({ ...snapshot, id: mine.id }, config));
            const inFlight = (snapshot.flights ?? [])
              .filter((f: any) => f.status === 'IN_FLIGHT')
              .map((f: any) => ({ ...f, simTime: snapshot.simTime }));
            if (inFlight.length > 0) setRestoredFlights(inFlight);
            socketService.connect(mine.id);
          })
          .catch(() => {});
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsubs = BACKEND_EVENTS.map(eventType =>
      socket.on(eventType, ({ simTime, payload }: { simTime?: string; payload: any }) => {
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

  // ── SIM_STATUS: transiciones de estado enviadas por el backend ───────────
  useEffect(() => {
    const unsub = socket.on('SIM_STATUS', ({ payload }: { payload: { status: string } }) => {
      const status = payload?.status?.toLowerCase() as SimulationSession['status'];
      if (!status) return;
      if (status === 'stopped' || status === 'completed') {
        socketService.disconnect();
        localStorage.removeItem('simulation_config');
        setSession(null);
        setEvents([]);
        addToast(status === 'completed' ? 'Simulación completada' : 'Simulación detenida externamente', 'info');
        return;
      }
      setSession(prev => prev ? { ...prev, status } : null);
    });
    return unsub;
  }, [socket, addToast]);

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
          .filter((f: any) => f.status === 'IN_FLIGHT')
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
    const TERMINAL = new Set(['stopped', 'completed']);
    const ACTIVE   = new Set(['starting', 'running', 'paused']);
    if (!session?.id || !ACTIVE.has(session.status)) return;

    const sessionId = session.id;
    const config    = session.config;

    const poll = async () => {
      try {
        const updated = await simulationService.getSession(sessionId, config);

        if (TERMINAL.has(updated.status)) {
          socketService.disconnect();
          localStorage.removeItem('simulation_config');
          setSession(null);
          setEvents([]);
          addToast(
            updated.status === 'completed' ? 'Simulación completada' : 'Simulación detenida externamente',
            'info'
          );
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
        if (e?.statusCode === 404) {
          socketService.disconnect();
          localStorage.removeItem('simulation_config');
          setSession(null);
          setEvents([]);
          addToast('La sesión ya no existe en el servidor', 'warning');
        }
      }
    };

    const id = setInterval(poll, 4_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.status]);

  const createSession = useCallback(async (scenario: SimulationScenario, startDate: string) => {
    setIsLoading(true);
    const controller = new AbortController();
    try {
      const { simStart, simEnd } = computeDateRange(scenario, startDate);
      const config = { scenario, speed: 1 };
      localStorage.setItem('simulation_config', JSON.stringify(config));
      let newSession: SimulationSession;
      try {
        newSession = await simulationService.createSession(simStart, simEnd, config, controller.signal);
      } catch (err: any) {
        if (err?.statusCode === 409) {
          // Ya existe una sesión activa — la recuperamos
          const mine = await simulationService.getMine(controller.signal);
          if (!mine) throw err;
          const snapshot = await simulationService.getSnapshotRaw(mine.id, controller.signal);
          newSession = simulationService.mapSessionPublic({ ...snapshot, id: mine.id }, config);
          const inFlight = (snapshot.flights ?? [])
            .filter((f: any) => f.status === 'IN_FLIGHT')
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
      socketService.connect(newSession.id);
      addToast(`Escenario ${scenario} inicializado correctamente`, 'success');
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err.message || 'Failed to initialize simulation');
      addToast('Error al inicializar la sesión', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  const startSimulation = useCallback(async () => {
    if (!session) return;
    try {
      await simulationService.resume(session.id);
      setSession(prev => prev ? { ...prev, status: 'running' } : null);
      addToast('Simulación iniciada', 'info');
    } catch {
      addToast('Fallo al iniciar simulación', 'error');
    }
  }, [session, addToast]);

  const pauseSimulation = useCallback(async () => {
    if (!session) return;
    try {
      await simulationService.pause(session.id);
      setSession(prev => prev ? { ...prev, status: 'paused' } : null);
      addToast('Simulación pausada', 'warning');
    } catch {
      addToast('Error al pausar', 'error');
    }
  }, [session, addToast]);

  const resetSimulation = useCallback(async () => {
    if (!session) return;
    try {
      await simulationService.stop(session.id);
      socketService.disconnect();
      localStorage.removeItem('simulation_config');
      setSession(null);
      setEvents([]);
      addToast('Simulación detenida', 'info');
    } catch {
      addToast('Error al detener', 'error');
    }
  }, [session, addToast]);

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
    createSession,
    startSimulation,
    pauseSimulation,
    resetSimulation,
    injectFault,
  }), [session, events, isLoading, error, restoredFlights, clearRestoredFlights, createSession, startSimulation, pauseSimulation, resetSimulation, injectFault]);

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
