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

/** Orden de maletas que carga un operario en la Operación Día a Día. */
export interface CreateOrderRequest {
  originIcao: string;
  destIcao: string;
  quantity: number;
  clientId?: string;
}

/** Respuesta tras registrar una orden manual (POST /operations/orders). */
export interface CreateOrderResponse {
  shipmentId: string;
  baggageIds: string[];
  originIcao: string;
  destIcao: string;
  quantity: number;
  entryTime: string;
}

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

  /**
   * Registra una orden de maletas en la Operación Día a Día. La hora de la orden es
   * el momento de envío y el backend la enruta de inmediato a vuelos con capacidad.
   */
  createOrder: async (order: CreateOrderRequest): Promise<CreateOrderResponse> => {
    const response = await api.post('/operations/orders', order);
    return response.data as CreateOrderResponse;
  },
};
