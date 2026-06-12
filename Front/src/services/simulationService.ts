import api from './api';
import { SimulationSession } from '../models/operational';
import { SimulationScenario } from '../constants/domain';

function mapSession(data: any, config: { scenario: SimulationScenario; speed: number }): SimulationSession {
  const simTimeMs = data.simTime ? new Date(data.simTime).getTime() : 0;
  const simStartMs = data.simStart ? new Date(data.simStart).getTime() : 0;
  const currentTimeAt = simStartMs > 0 ? Math.max(0, Math.round((simTimeMs - simStartMs) / 3_600_000)) : 0;
  return {
    id: String(data.id),
    status: (data.status as string)?.toLowerCase() as SimulationSession['status'],
    startTimeAt: data.simStart || new Date().toISOString(),
    currentTimeAt,
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

const SPEED_FACTOR = 480.0;

export const simulationService = {
  createSession: async (
    simStart: string,
    simEnd: string,
    config: { scenario: SimulationScenario; speed: number },
    signal?: AbortSignal
  ): Promise<SimulationSession> => {
    const body = {
      dataSource:       'DB',
      solverTimingMode: 'REAL_TIME',
      optimizerMode:    'ALNS_ONLY',
      simStart,
      simEnd,
      speedFactor:      SPEED_FACTOR,
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

  mapSessionPublic: (data: any, config: { scenario: SimulationScenario; speed: number }): SimulationSession =>
    mapSession(data, config),
};
