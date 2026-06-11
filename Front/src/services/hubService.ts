import api from './api';
import { Hub } from '../models/infrastructure';

export const hubService = {
  getAll: async (signal?: AbortSignal): Promise<Hub[]> => {
    const response = await api.get('/data/airports', { signal });
    return response.data.map((a: any): Hub => ({
      id: a.icao,
      name: `Hub ${a.city}`,
      city: a.city,
      continent: a.continent as Hub['continent'],
      lat: a.lat,
      lng: a.lon,
      storageCapacity: a.capacity,
      currentStorage: 0,
    }));
  }
};
