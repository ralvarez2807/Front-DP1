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

function computeDateRange(scenario: SimulationScenario, startDate?: string): { simStart: string; simEnd: string } {
  const now = new Date();
  if (scenario === SCENARIOS.PERIOD_5D && startDate) {
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(start);
    end.setDate(end.getDate() + 5);
    return { simStart: start.toISOString(), simEnd: end.toISOString() };
  }
  if (scenario === SCENARIOS.COLLAPSE) {
    const end = new Date(now);
    end.setDate(end.getDate() + 30);
    return { simStart: now.toISOString(), simEnd: end.toISOString() };
  }
  const end = new Date(now);
  end.setDate(end.getDate() + 1);
  return { simStart: now.toISOString(), simEnd: end.toISOString() };
}

interface SimulationContextType {
  session: SimulationSession | null;
  events: OperationalEvent[];
  criticalPoints: CriticalPoint[];
  isLoading: boolean;
  error: string | null;
  createSession: (scenario: SimulationScenario, startDate?: string) => Promise<void>;
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

  // ── Polling de respaldo: actualiza tiempo aunque el WS tarde en llegar ────
  // GET /api/v1/simulations/{id} cada 4 s cuando la sesión está running.
  // Los eventos WebSocket siguen siendo la fuente principal; este polling es
  // simplemente el safety-net para que el reloj no se quede en T+0h.
  useEffect(() => {
    if (!session?.id || session.status !== 'running') return;
    const sessionId = session.id;
    const config    = session.config;

    const poll = async () => {
      try {
        const updated = await simulationService.getSession(sessionId, config);
        setSession(prev => {
          if (!prev) return null;
          // Solo actualizar si el backend reporta más tiempo del que tenemos
          if (updated.currentTimeAt > prev.currentTimeAt) {
            return { ...prev, currentTimeAt: updated.currentTimeAt, status: updated.status };
          }
          return prev;
        });
      } catch {
        // ignora errores de red temporales
      }
    };

    const id = setInterval(poll, 4_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.status]);

  const createSession = useCallback(async (scenario: SimulationScenario, startDate?: string) => {
    setIsLoading(true);
    const controller = new AbortController();
    try {
      const { simStart, simEnd } = computeDateRange(scenario, startDate);
      const config = { scenario, speed: 1 };
      const newSession = await simulationService.createSession(simStart, simEnd, config, controller.signal);
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
    createSession,
    startSimulation,
    pauseSimulation,
    resetSimulation,
    injectFault,
  }), [session, events, isLoading, error, createSession, startSimulation, pauseSimulation, resetSimulation, injectFault]);

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
