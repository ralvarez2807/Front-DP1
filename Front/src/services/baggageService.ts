import api from './api';
import { BaggageRequest, FullTrackingData, RouteResult } from '../models/operational';

export const baggageService = {
  getAll: async (signal?: AbortSignal): Promise<BaggageRequest[]> => {
    const response = await api.get('/v1/baggage', { signal });
    return response.data;
  },

  getById: async (id: string, signal?: AbortSignal): Promise<BaggageRequest> => {
    const response = await api.get(`/v1/baggage/${id}`, { signal });
    return response.data;
  },

  create: async (data: Partial<BaggageRequest>, signal?: AbortSignal): Promise<BaggageRequest> => {
    const response = await api.post('/v1/baggage', data, { signal });
    return response.data;
  },

  getTracking: async (id: string, signal?: AbortSignal): Promise<FullTrackingData> => {
    const response = await api.get(`/v1/baggage/${id}/track`, { signal });
    return response.data;
  }
};

export const routingService = {
  calculateRoute: async (originId: string, destinationId: string, constraints?: any, signal?: AbortSignal): Promise<RouteResult> => {
    const response = await api.post('/v1/routing/calculate', { originId, destinationId, constraints }, { signal });
    return response.data;
  },

  getNetworkCongestion: async (signal?: AbortSignal): Promise<Record<string, number>> => {
    const response = await api.get('/v1/routing/congestion', { signal });
    return response.data;
  }
};
