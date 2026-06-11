import api from './api';
import { Flight } from '../models/infrastructure';

export const flightService = {
  getAll: async (signal?: AbortSignal): Promise<Flight[]> => {
    const response = await api.get('/data/routes', { signal });
    return response.data.map((r: any): Flight => ({
      id: String(r.id),
      originId: r.originIcao,
      destinationId: r.destIcao,
      capacity: r.capacity,
      duration: 0,
      departureTime: r.depTimeLocal ? parseInt(r.depTimeLocal.split(':')[0], 10) : 0,
      occupiedCapacity: 0,
    }));
  }
};
