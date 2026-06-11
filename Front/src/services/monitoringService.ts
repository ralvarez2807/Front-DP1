import api from './api';
import { MonitoringMetrics } from '../models/monitoring';

export const monitoringService = {
  getDashboard: async (sessionId: string, signal?: AbortSignal): Promise<MonitoringMetrics> => {
    const response = await api.get(`/simulations/${sessionId}/dashboard`, { signal });
    const d = response.data;
    const slaBreaches = d.slaBreaches || 0;
    return {
      activeBaggageCount: (d.inFlight || 0) + (d.assigned || 0),
      deliveredBaggageToday: d.delivered || 0,
      averageLeadTime: 0,
      systemThroughput: d.throughputPerHour || 0,
      networkHealthScore: slaBreaches === 0 ? 100 : Math.max(0, 100 - slaBreaches),
      pendingSLAAlerts: slaBreaches,
    };
  }
};
