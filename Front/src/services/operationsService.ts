import api from './api';
import { SocketService } from './socket';

/** Estado de la sesión de "Operación Día a Día" (GET /api/v1/operations). */
export interface OperationsStatus {
  id: string;
  status: 'starting' | 'running' | 'paused' | 'completed' | 'stopped';
  simTime: string;
  simStart: string;
  simEnd: string;
  speedFactor: number;
}

/**
 * Socket dedicado para la operación día a día. Es una instancia separada del
 * `socketService` global (que usa la simulación manual del usuario), de modo que
 * ambos streams en vivo pueden coexistir sin pisarse.
 */
export const operationsSocket = new SocketService();

export const operationsService = {
  /** Devuelve (creando si hace falta) la sesión día-a-día permanente del servidor. */
  getStatus: async (signal?: AbortSignal): Promise<OperationsStatus> => {
    const response = await api.get('/operations', { signal });
    return response.data as OperationsStatus;
  },

  /** Snapshot completo de la sesión día-a-día (reutiliza el endpoint de simulaciones). */
  getSnapshot: async (id: string, signal?: AbortSignal): Promise<any> => {
    const response = await api.get(`/simulations/${id}/snapshot`, { signal });
    return response.data;
  },

  /** Métricas agregadas de la sesión día-a-día. */
  getDashboard: async (id: string, signal?: AbortSignal): Promise<{
    simTime: string; delivered: number; pending: number; assigned: number;
    inFlight: number; slaBreaches: number; throughputPerHour: number;
  }> => {
    const response = await api.get(`/simulations/${id}/dashboard`, { signal });
    return response.data;
  },
};
