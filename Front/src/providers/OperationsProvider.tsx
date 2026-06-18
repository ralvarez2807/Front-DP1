import React, {
  createContext, useContext, useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import { useAuthContext } from './AuthProvider';
import { operationsService, operationsSocket, OperationsStatus } from '../services/operationsService';
import { scheduleIdOf } from '../components/map/AnimatedPlane';

// ── Tipos ────────────────────────────────────────────────────────────────────
export interface OpsPlane {
  key: string;
  flightId: string;
  fromIcao: string;
  toIcao: string;
  startedAt: number;   // epoch ms real en que arrancó (o debió arrancar) la animación
  durationMs: number;  // duración real de la animación
  capacity: number;
  occupied: number;
}

export interface OpsAirportLoad {
  icao: string;
  city: string;
  continent: string;
  load: number;
  pending: number;
  capacity: number;
}

export interface OpsMetrics {
  simTime: string; delivered: number; pending: number; assigned: number;
  inFlight: number; slaBreaches: number; throughputPerHour: number;
}

export interface OpsEvent { id: string; type: string; message: string; time: string; }

interface OperationsContextType {
  ops: OperationsStatus | null;
  connected: boolean;
  planes: OpsPlane[];
  airports: Map<string, OpsAirportLoad>;
  metrics: OpsMetrics | null;
  events: OpsEvent[];
  /** Para interpolar el reloj simulado entre eventos. */
  lastSimUpdate: { simMs: number; realMs: number } | null;
  activeFlightCount: number;
}

const OperationsContext = createContext<OperationsContextType | null>(null);

// Solo eventos del backend que queremos reflejar en el feed
const FEED_EVENTS = [
  'FLIGHT_DEPARTED', 'FLIGHT_ARRIVED', 'FLIGHT_CANCELLED',
  'BAGGAGE_DELIVERED', 'SHIPMENT_CREATED',
] as const;

const EVENT_MESSAGES: Record<string, (p: any) => string> = {
  FLIGHT_DEPARTED:   (p) => `Vuelo ${p?.flightId} despegó de ${p?.fromIcao}`,
  FLIGHT_ARRIVED:    (p) => `Vuelo ${p?.flightId} aterrizó en ${p?.toIcao}`,
  FLIGHT_CANCELLED:  (p) => `Vuelo ${p?.flightId ?? p?.flightScheduleKey} cancelado`,
  BAGGAGE_DELIVERED: (p) => `Bulto ${p?.baggageId} entregado en ${p?.currentIcao}`,
  SHIPMENT_CREATED:  (p) => `Envío ${p?.shipmentId}: ${p?.originIcao} → ${p?.destIcao}`,
};

const planeKey = (flightId: string, fromIcao: string, toIcao: string) =>
  `${flightId}-${fromIcao}-${toIcao}`;

export const OperationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuthContext();

  const [ops, setOps]             = useState<OperationsStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [planes, setPlanes]       = useState<OpsPlane[]>([]);
  const [airports, setAirports]   = useState<Map<string, OpsAirportLoad>>(new Map());
  const [metrics, setMetrics]     = useState<OpsMetrics | null>(null);
  const [events, setEvents]       = useState<OpsEvent[]>([]);
  const [lastSimUpdate, setLastSimUpdate] = useState<{ simMs: number; realMs: number } | null>(null);

  // ── Refs que sobreviven a los renders ──────────────────────────────────────
  const speedFactorRef    = useRef(1);
  const flightDurationsRef = useRef<Map<string, number>>(new Map());
  const planeTimersRef    = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const opsIdRef          = useRef<string | null>(null);

  const computeDuration = useCallback((depMs: number, arrMs: number) => {
    const sf = speedFactorRef.current || 1;
    return Math.max(15_000, Math.round((arrMs - depMs) / sf));
  }, []);

  const clearAllTimers = useCallback(() => {
    planeTimersRef.current.forEach(t => clearTimeout(t));
    planeTimersRef.current.clear();
  }, []);

  // ── Cargar/refrescar snapshot: aeropuertos, duraciones, aviones en vuelo ────
  const applySnapshot = useCallback((snapshot: any) => {
    const simNowMs = snapshot?.simTime ? new Date(snapshot.simTime).getTime() : Date.now();

    // Aeropuertos (carga en vivo)
    const airMap = new Map<string, OpsAirportLoad>();
    (snapshot?.airports ?? []).forEach((a: any) => {
      airMap.set(a.icao, {
        icao: a.icao, city: a.city, continent: a.continent,
        load: a.load ?? 0, pending: a.pending ?? 0, capacity: a.capacity ?? 0,
      });
    });
    setAirports(airMap);

    // Duraciones por vuelo (para animar despegues posteriores recibidos por WS)
    (snapshot?.flights ?? []).forEach((f: any) => {
      if (f.depTime && f.arrTime) {
        const depMs = new Date(f.depTime).getTime();
        const arrMs = new Date(f.arrTime).getTime();
        if (arrMs > depMs) flightDurationsRef.current.set(f.flightId, computeDuration(depMs, arrMs));
      }
    });

    // Aviones actualmente en el aire (estado DEPARTED en el snapshot)
    const inAir = (snapshot?.flights ?? []).filter(
      (f: any) => f.status === 'DEPARTED' || f.status === 'IN_FLIGHT'
    );

    setPlanes(prev => {
      const existing = new Set(prev.map(p => p.key));
      const restored: OpsPlane[] = [];
      inAir.forEach((f: any) => {
        const key = planeKey(f.flightId, f.fromIcao, f.toIcao);
        if (existing.has(key)) return;
        const depMs = new Date(f.depTime).getTime();
        const arrMs = new Date(f.arrTime).getTime();
        const durationMs   = computeDuration(depMs, arrMs);
        const simElapsedMs = Math.max(0, simNowMs - depMs);
        const startedAt    = Date.now() - Math.round(simElapsedMs / (speedFactorRef.current || 1));

        const remaining = durationMs - (Date.now() - startedAt);
        if (remaining > 0) {
          const timer = setTimeout(() => {
            setPlanes(p => p.filter(x => x.key !== key));
            planeTimersRef.current.delete(key);
          }, remaining + 1_000);
          planeTimersRef.current.set(key, timer);
        }
        restored.push({
          key, flightId: f.flightId, fromIcao: f.fromIcao, toIcao: f.toIcao,
          startedAt, durationMs, capacity: f.capacity ?? 0, occupied: f.load ?? 0,
        });
      });
      return restored.length ? [...prev, ...restored] : prev;
    });
  }, [computeDuration]);

  // ── Inicialización / re-inicialización completa ─────────────────────────────
  const initRef = useRef<(() => Promise<void>) | null>(null);
  initRef.current = async () => {
    try {
      const status = await operationsService.getStatus();
      speedFactorRef.current = status.speedFactor || 1;

      // ¿Cambió la sesión en el servidor? Reconectar desde cero.
      if (opsIdRef.current && opsIdRef.current !== status.id) {
        operationsSocket.disconnect();
        clearAllTimers();
        setPlanes([]);
        flightDurationsRef.current.clear();
      }

      const isNew = opsIdRef.current !== status.id;
      opsIdRef.current = status.id;
      setOps(status);
      setLastSimUpdate({ simMs: new Date(status.simTime).getTime(), realMs: Date.now() });

      const snapshot = await operationsService.getSnapshot(status.id);
      applySnapshot(snapshot);

      if (isNew) {
        operationsSocket.connect(status.id);
      }
    } catch {
      /* el polling reintentará */
    }
  };

  // ── Arranque cuando el usuario está autenticado ─────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) {
      operationsSocket.disconnect();
      clearAllTimers();
      opsIdRef.current = null;
      setOps(null); setPlanes([]); setAirports(new Map());
      setMetrics(null); setEvents([]); setConnected(false);
      return;
    }
    initRef.current?.();
    // Re-sincroniza estado y aeropuertos periódicamente (también re-arranca si la
    // sesión del servidor cambió de id).
    const id = setInterval(() => {
      const opsId = opsIdRef.current;
      if (!opsId) { initRef.current?.(); return; }
      operationsService.getSnapshot(opsId)
        .then(applySnapshot)
        .catch(() => initRef.current?.());
      operationsService.getStatus()
        .then(s => {
          speedFactorRef.current = s.speedFactor || 1;
          if (s.id !== opsIdRef.current || s.status === 'completed' || s.status === 'stopped') {
            initRef.current?.();
          } else {
            setOps(s);
          }
        })
        .catch(() => {});
    }, 10_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // ── Métricas (dashboard) ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated || !ops?.id) { setMetrics(null); return; }
    const opsId = ops.id;
    let cancelled = false;
    const fetch = () => operationsService.getDashboard(opsId)
      .then(d => { if (!cancelled) setMetrics(d); })
      .catch(() => {});
    fetch();
    const id = setInterval(fetch, 5_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isAuthenticated, ops?.id]);

  // ── Conexión WebSocket: estado ──────────────────────────────────────────────
  useEffect(() => {
    const onOpen  = operationsSocket.on('__OPEN__', () => setConnected(true));
    const onClose = operationsSocket.on('__CLOSE__', () => setConnected(false));
    return () => { onOpen(); onClose(); };
  }, []);

  // ── WebSocket: vuelos ───────────────────────────────────────────────────────
  useEffect(() => {
    const subs: Array<() => void> = [];

    subs.push(operationsSocket.on('FLIGHT_DEPARTED', ({ payload, simTime }: any) => {
      const fromIcao = payload?.fromIcao ?? payload?.originIcao ?? payload?.from;
      const toIcao   = payload?.toIcao   ?? payload?.destIcao   ?? payload?.to;
      const fid      = payload?.flightId ?? payload?.id;
      if (!fromIcao || !toIcao || !fid) return;

      const key = planeKey(fid, fromIcao, toIcao);
      const sf  = speedFactorRef.current || 1;
      const durationMs = flightDurationsRef.current.get(fid)
        ?? Math.max(15_000, Math.round((2 * 3_600_000) / sf)); // fallback 2h sim
      const capacity = payload?.capacity ?? 0;
      const occupied = payload?.load ?? payload?.occupiedCapacity ?? 0;

      const existing = planeTimersRef.current.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        setPlanes(p => p.filter(x => x.key !== key));
        planeTimersRef.current.delete(key);
      }, durationMs + 30_000);
      planeTimersRef.current.set(key, timer);

      setPlanes(prev => [
        ...prev.filter(p => p.key !== key),
        { key, flightId: fid, fromIcao, toIcao, startedAt: Date.now(), durationMs, capacity, occupied },
      ]);
      if (simTime) setLastSimUpdate({ simMs: new Date(simTime).getTime(), realMs: Date.now() });
    }));

    subs.push(operationsSocket.on('FLIGHT_ARRIVED', ({ payload }: any) => {
      const fid = payload?.flightId ?? payload?.id;
      if (!fid) return;
      setPlanes(prev => {
        const plane = prev.find(p => p.flightId === fid);
        if (plane) {
          const t = planeTimersRef.current.get(plane.key);
          if (t) clearTimeout(t);
          const landing = setTimeout(() => {
            setPlanes(p => p.filter(x => x.key !== plane.key));
            planeTimersRef.current.delete(plane.key);
          }, 1_500);
          planeTimersRef.current.set(plane.key, landing);
        }
        return prev;
      });
    }));

    subs.push(operationsSocket.on('FLIGHT_CANCELLED', ({ payload }: any) => {
      const fid = payload?.flightId ?? payload?.flightScheduleKey;
      if (!fid) return;
      setPlanes(prev => prev.filter(p => scheduleIdOf(p.flightId) !== scheduleIdOf(fid) && p.flightId !== fid));
    }));

    // Feed de eventos
    FEED_EVENTS.forEach(type => {
      subs.push(operationsSocket.on(type, ({ payload, simTime }: any) => {
        setEvents(prev => [
          {
            id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type,
            message: EVENT_MESSAGES[type]?.(payload) ?? type,
            time: simTime || new Date().toISOString(),
          },
          ...prev.slice(0, 49),
        ]);
      }));
    });

    // Resync por hueco de seq
    subs.push(operationsSocket.on('RESYNC_NEEDED', () => {
      const opsId = opsIdRef.current;
      if (opsId) operationsService.getSnapshot(opsId).then(applySnapshot).catch(() => {});
    }));

    return () => subs.forEach(u => u());
  }, [applySnapshot]);

  const activeFlightCount = planes.length;

  const value = useMemo<OperationsContextType>(() => ({
    ops, connected, planes, airports, metrics, events, lastSimUpdate, activeFlightCount,
  }), [ops, connected, planes, airports, metrics, events, lastSimUpdate, activeFlightCount]);

  return (
    <OperationsContext.Provider value={value}>
      {children}
    </OperationsContext.Provider>
  );
};

export const useOperationsContext = () => {
  const ctx = useContext(OperationsContext);
  if (!ctx) throw new Error('useOperationsContext must be used within an OperationsProvider');
  return ctx;
};
