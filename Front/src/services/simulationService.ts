import api from './api';
import { SimulationSession } from '../models/operational';
import { SimulationScenario, SCENARIOS } from '../constants/domain';

// ── Tipos de vistas en vivo de la simulación (compartidos con la UI) ─────────
export interface SimAirport {
  icao: string;
  city: string;
  continent: string;
  load: number;
  capacity: number;
  occupancyPct: number;
  occupancyLevel: string; // GREEN | AMBER | RED | EMPTY
}

export interface SimFlight {
  flightId: string;
  fromIcao: string;
  toIcao: string;
  depTime: string;
  arrTime: string;
  status: string; // SCHEDULED | DEPARTED | ARRIVED
  load: number;
  capacity: number;
  occupancyPct: number;
  occupancyLevel: string;
}

export interface SimShipment {
  shipmentId: string;
  originIcao: string;
  destIcao: string;
  deadlineUtc: string;
  totalBaggages: number;
  delivered: number;
  noRoute: number;
  onTime: number;
  late: number;
  breached: number; // maletas sin entregar cuyo deadline ya venció
}

// ── Diagnóstico forense de un envío incumplido / sin ruta ────────────────────
export interface DiagDirectFlight {
  flightId: string;
  depUtc: string;
  arrUtc: string;
  remainingCapacity: number;
  usable: boolean;
  reason: string;
}
export interface BaggageDiagnostic {
  baggageId: string;
  status: string;
  currentIcao: string;
  availableFromUtc: string;
  minutesToDeadline: number;
  hasCompleteRoute: boolean;
  reachableInTime: boolean;
  bestEffortArrivalUtc: string | null;
  bestEffortLateMinutes: number;
  bestEffortHops: number;
  verdict: string;     // DELIVERED_LATE | NO_CONNECTIVITY | DEADLINE_INFEASIBLE | PLANNER_MISS | ON_TRACK
  explanation: string;
  directFlights: DiagDirectFlight[];
}
export interface ShipmentDiagnostics {
  shipmentId: string;
  originIcao: string;
  destIcao: string;
  deadlineUtc: string;
  simNowUtc: string;
  baggages: BaggageDiagnostic[];
}

// ── Foto forense de un incumplimiento de SLA (instante exacto) ───────────────
export interface SlaBreachLeg {
  fromIcao: string;
  toIcao: string;
  depUtc: string;
  arrUtc: string;
  state: 'ARRIVED' | 'DEPARTED' | 'PLANNED';
}
export interface SlaBreach {
  breachTimeUtc: string;
  baggageId: string;
  shipmentId: string;
  originIcao: string;
  destIcao: string;
  deadlineUtc: string;
  statusAtBreach: string;       // PENDING | WAITING | IN_FLIGHT
  locationIcao: string;
  hadCompleteRoute: boolean;
  plannedEtaUtc: string | null;
  plannedEtaLateMinutes: number;
  cause: string;
  plannedRoute: SlaBreachLeg[];
}

// ── Disrupciones (LE-70/LE-71) ───────────────────────────────────────────────
// El backend resuelve la fecha de la ocurrencia a cancelar a partir del scheduleId
// sin fecha: la de hoy si faltan más de 1 h simulada para la salida, la de mañana
// si no (regla documentada en APIS.md §15).
export interface DisruptionResult {
  resolvedFlightId?: string;
  affectedFlights: number;
  flightIds: string[];
}

// Tramo de la ruta de un envío (para dibujar en el mapa)
export interface ShipmentRouteLeg {
  fromIcao: string;
  toIcao: string;
  depTime: string;
  arrTime: string;
  state: 'ARRIVED' | 'DEPARTED' | 'PLANNED';
}

// ── Tracking de una maleta individual ────────────────────────────────────────
export interface BaggageState {
  baggageId: string;
  status: 'PENDING' | 'WAITING' | 'IN_FLIGHT' | 'DELIVERED';
  currentIcao: string;
  flightId: string | null;   // solo cuando IN_FLIGHT
  destIcao: string;
  deadlineUtc: string;
}

export interface BaggageRouteLeg {
  fromIcao: string;
  toIcao: string;
  depTime: string;
  arrTime: string;
  flightId: string;
  state: 'ARRIVED' | 'DEPARTED' | 'PLANNED';
}

// Log de transiciones de estado de una maleta (LE-45, endpoint nuevo /history)
export interface BaggageHistoryEntry {
  timestamp: string;
  status: string;
  icao?: string;
  flightId?: string;
}

// Maleta esperando físicamente en un aeropuerto (endpoint /airports/{icao}/transit)
export interface AirportBaggage {
  baggageId: string;
  shipmentId: string;
  destIcao: string;
  deadlineUtc: string;
  nextFlightId: string | null;
  nextDepTime: string | null;
}

// Maleta a bordo / asignada a un vuelo (aplanada desde /flights/{flightId})
export interface FlightBaggage {
  baggageId: string;
  shipmentId: string;
  originIcao: string;
  destIcao: string;
  deadlineUtc: string;
}

function mapSession(data: any, config: { scenario: SimulationScenario; speed: number }): SimulationSession {
  const simTimeMs = data.simTime ? new Date(data.simTime).getTime() : 0;
  const simStartMs = data.simStart ? new Date(data.simStart).getTime() : 0;
  const currentTimeAt = simStartMs > 0 ? Math.max(0, Math.round((simTimeMs - simStartMs) / 3_600_000)) : 0;
  return {
    id: String(data.id),
    status: (data.status as string)?.toLowerCase() as SimulationSession['status'],
    startTimeAt: data.simStart || new Date().toISOString(),
    currentTimeAt,
    speedFactor: data.speedFactor ?? SPEED_FACTOR,
    config,
    metrics: {
      activeBaggageCount: 0,
      deliveredBaggageToday: 0,
      averageLeadTime: 0,
      systemThroughput: 0,
      networkHealthScore: 100,
      pendingSLAAlerts: 0,
    },
  };
}

const SPEED_FACTOR = 80.0; // 5 días × 24h / 1.5h real = 80
const COLLAPSE_SPEED_FACTOR = 1000.0; // colapso: rango de fechas muy amplio, hay que acelerar más

export const simulationService = {
  createSession: async (
    simStart: string,
    simEnd: string,
    config: { scenario: SimulationScenario; speed: number },
    signal?: AbortSignal
  ): Promise<SimulationSession> => {
    // LE-69/LE-73: la duración es elegible (3/5/7 días) pero la corrida completa
    // toma siempre ~90 min reales — speedFactor proporcional a los días simulados
    // (3→48, 5→80 [valor histórico], 7→112).
    const rangeDays = Math.max(1, Math.round(
      (new Date(simEnd).getTime() - new Date(simStart).getTime()) / 86_400_000
    ));
    const body = {
      dataSource:       'DB',
      solverTimingMode: 'REAL_TIME',
      optimizerMode:    'ALNS_ONLY',
      simStart,
      simEnd,
      speedFactor:      config.scenario === SCENARIOS.COLLAPSE ? COLLAPSE_SPEED_FACTOR : rangeDays * 16,
      // Todos los escenarios detectan colapso; la diferencia del escenario COLLAPSE
      // es únicamente el rango de fechas (ver computeDateRange), tan amplio que
      // permite observar el colapso real en vez de cortar la simulación antes.
      collapseOnFailure: true,
    };
    const response = await api.post('/simulations', body, { signal });
    return mapSession(response.data, config);
  },

  getSession: async (
    id: string,
    config: { scenario: SimulationScenario; speed: number },
    signal?: AbortSignal
  ): Promise<SimulationSession> => {
    const response = await api.get(`/simulations/${id}`, { signal });
    return mapSession(response.data, config);
  },

  getMine: async (signal?: AbortSignal): Promise<{ id: string; status: string; simTime: string; simStart: string; simEnd: string } | null> => {
    try {
      const response = await api.get('/simulations/mine', { signal });
      return response.data;
    } catch (e: any) {
      if (e?.statusCode === 404) return null;
      throw e;
    }
  },

  pause: async (id: string, signal?: AbortSignal): Promise<void> => {
    await api.post(`/simulations/${id}/pause`, {}, { signal });
  },

  resume: async (id: string, signal?: AbortSignal): Promise<void> => {
    await api.post(`/simulations/${id}/resume`, {}, { signal });
  },

  stop: async (id: string, signal?: AbortSignal): Promise<void> => {
    await api.post(`/simulations/${id}/stop`, {}, { signal });
  },

  getSnapshot: async (
    id: string,
    config: { scenario: SimulationScenario; speed: number },
    signal?: AbortSignal
  ): Promise<SimulationSession> => {
    const response = await api.get(`/simulations/${id}/snapshot`, { signal });
    return mapSession(response.data, config);
  },

  getSnapshotRaw: async (id: string, signal?: AbortSignal): Promise<any> => {
    const response = await api.get(`/simulations/${id}/snapshot`, { signal });
    return response.data;
  },

  getDashboard: async (id: string, signal?: AbortSignal): Promise<{
    simTime: string; delivered: number; pending: number; assigned: number;
    inFlight: number; slaBreaches: number; throughputPerHour: number;
    fleetOccupancyPct?: number; airportOccupancyPct?: number;
  }> => {
    const response = await api.get(`/simulations/${id}/dashboard`, { signal });
    return response.data;
  },

  getSummaryReport: async (id: string, signal?: AbortSignal): Promise<any> => {
    const response = await api.get(`/simulations/${id}/reports/summary`, { signal });
    return response.data;
  },

  getSimAirports: async (id: string, signal?: AbortSignal): Promise<SimAirport[]> => {
    const response = await api.get(`/simulations/${id}/airports`, { signal });
    return response.data;
  },

  getSimFlights: async (id: string, signal?: AbortSignal): Promise<SimFlight[]> => {
    const response = await api.get(`/simulations/${id}/flights`, { signal });
    return response.data;
  },

  getSimShipments: async (id: string, signal?: AbortSignal): Promise<SimShipment[]> => {
    const response = await api.get(`/simulations/${id}/shipments`, { signal });
    return response.data;
  },

  // Detalle de un envío: maletas individuales con estado, posición y tramos.
  // Usado para localizar el vuelo que transporta un envío "En ruta".
  getShipmentDetail: async (id: string, shipmentId: string, signal?: AbortSignal): Promise<{
    fromIcao: string | null;
    toIcao: string | null;
  }> => {
    const response = await api.get(`/simulations/${id}/shipments/${shipmentId}`, { signal });
    const baggages: any[] = response.data?.baggages ?? [];
    // Buscar una maleta IN_FLIGHT con un tramo en estado DEPARTED
    for (const b of baggages) {
      if (b.status !== 'IN_FLIGHT') continue;
      const activeLeg = (b.route ?? []).find((leg: any) => leg.state === 'DEPARTED');
      if (activeLeg) return { fromIcao: activeLeg.fromIcao, toIcao: activeLeg.toIcao };
    }
    return { fromIcao: null, toIcao: null };
  },

  // Foto forense de cada incumplimiento de SLA en el instante en que ocurrió.
  getSlaBreaches: async (id: string, signal?: AbortSignal): Promise<SlaBreach[]> => {
    const response = await api.get(`/simulations/${id}/sla-breaches`, { signal });
    return response.data ?? [];
  },

  // Forense de por qué un envío incumplió SLA / quedó sin ruta.
  getShipmentDiagnostics: async (id: string, shipmentId: string, signal?: AbortSignal): Promise<ShipmentDiagnostics> => {
    const response = await api.get(`/simulations/${id}/shipments/${shipmentId}/diagnostics`, { signal });
    return response.data;
  },

  // Ruta completa (representativa) de un envío para dibujarla en el mapa.
  // Toma la maleta con más tramos (peor caso de escalas) y devuelve la secuencia
  // ordenada origen→…→destino. state: ARRIVED (ya volado) | DEPARTED (en vuelo) | PLANNED.
  getShipmentRoute: async (id: string, shipmentId: string, signal?: AbortSignal): Promise<ShipmentRouteLeg[]> => {
    const response = await api.get(`/simulations/${id}/shipments/${shipmentId}`, { signal });
    const baggages: any[] = response.data?.baggages ?? [];
    let best: any[] = [];
    for (const b of baggages) {
      const route: any[] = b.route ?? [];
      if (route.length > best.length) best = route;
    }
    return best.map((l: any) => ({
      fromIcao: l.fromIcao,
      toIcao:   l.toIcao,
      depTime:  l.depTime,
      arrTime:  l.arrTime,
      state:    l.state,
    }));
  },

  // ── Tracking puntual de una maleta ─────────────────────────────────────────
  getBaggage: async (id: string, baggageId: string, signal?: AbortSignal): Promise<BaggageState> => {
    const response = await api.get(`/simulations/${id}/baggage/${encodeURIComponent(baggageId)}`, { signal });
    return response.data;
  },

  getBaggageRoute: async (id: string, baggageId: string, signal?: AbortSignal): Promise<{
    baggageId: string; status: string; currentIcao: string; destIcao: string;
    deadlineUtc: string; legs: BaggageRouteLeg[];
  }> => {
    const response = await api.get(`/simulations/${id}/baggage/${encodeURIComponent(baggageId)}/route`, { signal });
    return response.data;
  },

  // Historial de cambios de estado de la maleta (LE-45).
  getBaggageHistory: async (id: string, baggageId: string, signal?: AbortSignal): Promise<BaggageHistoryEntry[]> => {
    const response = await api.get(`/simulations/${id}/baggage/${encodeURIComponent(baggageId)}/history`, { signal });
    return response.data ?? [];
  },

  // Cancela la próxima ocurrencia de un horario recurrente (scheduleId sin fecha).
  injectCancellation: async (id: string, scheduleId: string, severity = 5): Promise<DisruptionResult> => {
    const response = await api.post(`/simulations/${id}/disruptions`, { kind: 'CANCELLATION', scheduleId, severity });
    return response.data;
  },

  // Cancelación masiva: una lista de horarios en un solo request.
  injectCancellationsBulk: async (id: string, scheduleIds: string[], severity = 5): Promise<DisruptionResult[]> => {
    const response = await api.post(`/simulations/${id}/disruptions/bulk`, {
      disruptions: scheduleIds.map(scheduleId => ({ kind: 'CANCELLATION', scheduleId, severity })),
    });
    return response.data?.results ?? [];
  },

  // Maletas físicamente en un aeropuerto ahora (en espera de conexión).
  getAirportBaggages: async (id: string, icao: string, signal?: AbortSignal): Promise<AirportBaggage[]> => {
    const response = await api.get(`/simulations/${id}/airports/${icao}/transit`, { signal });
    return response.data?.transit ?? [];
  },

  // Maletas a bordo / asignadas a un vuelo (aplanadas desde sus envíos).
  getFlightBaggages: async (id: string, flightId: string, signal?: AbortSignal): Promise<FlightBaggage[]> => {
    const response = await api.get(`/simulations/${id}/flights/${flightId}`, { signal });
    const shipments: any[] = response.data?.shipments ?? [];
    return shipments.flatMap(s =>
      (s.baggages ?? []).map((b: any) => ({
        baggageId: b.baggageId,
        shipmentId: s.shipmentId,
        originIcao: s.originIcao,
        destIcao: b.destIcao,
        deadlineUtc: b.deadlineUtc,
      }))
    );
  },

  mapSessionPublic: (data: any, config: { scenario: SimulationScenario; speed: number }): SimulationSession =>
    mapSession(data, config),
};
