import api from './api';

/** Aeropuerto de la red (GET /data/airports). La red es fija: solo se edita la capacidad. */
export interface AirportInfo {
  icao: string;
  city: string;
  country: string;
  continent: string;
  shortName: string;
  gmtOffset: number;
  capacity: number;
  lat: number;
  lon: number;
}

export const airportService = {
  list: async (signal?: AbortSignal): Promise<AirportInfo[]> => {
    const response = await api.get('/data/airports', { signal });
    return response.data as AirportInfo[];
  },

  /** Modifica la capacidad de almacén de un aeropuerto existente (PUT). */
  updateCapacity: async (icao: string, capacity: number): Promise<AirportInfo> => {
    const response = await api.put(`/data/airports/${icao}/capacity`, { capacity });
    return response.data as AirportInfo;
  },
};
