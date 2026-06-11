import api from './api';
import { SimulationSession } from '../models/operational';
import { SimulationScenario } from '../constants/domain';

function mapSession(data: any, config: { scenario: SimulationScenario; speed: number }): SimulationSession {
  const simTimeMs = data.simTime ? new Date(data.simTime).getTime() : 0;
  const simStartMs = data.simStart ? new Date(data.simStart).getTime() : 0;
  const currentTimeAt = simStartMs > 0 ? Math.max(0, Math.round((simTimeMs - simStartMs) / 3_600_000)) : 0;
  return {
    id: String(data.id),
    status: data.status,
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

export const simulationService = {
  createSession: async (
    simStart: string,
    simEnd: string,
    config: { scenario: SimulationScenario; speed: number },
    signal?: AbortSignal
  ): Promise<SimulationSession> => {
    const response = await api.post('/simulations', { simStart, simEnd }, { signal });
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

  pause: async (id: string, signal?: AbortSignal): Promise<void> => {
    await api.post(`/simulations/${id}/pause`, {}, { signal });
  },

  resume: async (id: string, signal?: AbortSignal): Promise<void> => {
    await api.post(`/simulations/${id}/resume`, {}, { signal });
  },

  stop: async (id: string, signal?: AbortSignal): Promise<void> => {
    await api.post(`/simulations/${id}/stop`, {}, { signal });
  },
};
