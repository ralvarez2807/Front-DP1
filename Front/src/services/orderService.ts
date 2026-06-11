import api from './api';
import { Order } from '../models/operational';

/**
 * Service for managing logistic orders
 */
export const orderService = {
  getAll: async (signal?: AbortSignal): Promise<Order[]> => {
    const response = await api.get('/orders', { signal });
    return response.data;
  },

  create: async (orderData: Partial<Order>, signal?: AbortSignal): Promise<Order> => {
    const response = await api.post('/orders', orderData, { signal });
    return response.data;
  },

  cancel: async (orderId: string, signal?: AbortSignal): Promise<void> => {
    await api.delete(`/orders/${orderId}`, { signal });
  }
};
