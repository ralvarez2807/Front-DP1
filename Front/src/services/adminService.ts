import api from './api';
import { AirportInfo } from './airportService';

/** Horario recurrente de vuelo (GET /data/routes, shape crudo del backend). */
export interface RouteInfo {
  id: string;            // "ORIG-DEST-HH:mm"
  originIcao: string;
  destIcao: string;
  capacity: number;
  depTimeLocal: string;  // "HH:mm" hora local del origen
  arrTimeLocal: string;  // "HH:mm" hora local del destino
}

/** Alta unitaria de aeropuerto (POST /admin/airports/single, exigencias v2.0). */
export interface CreateAirportRequest {
  icao: string;
  city: string;
  country: string;
  continent: string;   // string libre, sin catálogo (decisión LE-14/LE-15)
  shortName: string;
  gmtOffset: number;
  capacity: number;
  lat: number;
  lon: number;
}

/** Alta unitaria de vuelo (POST /admin/flights/single). */
export interface CreateFlightRequest {
  originIcao: string;
  destIcao: string;
  depTimeLocal: string;
  arrTimeLocal: string;
  capacity: number;
}

/** Edición de un horario existente (PUT /admin/flights/:scheduleId, LE-12/LE-27).
 *  Al menos un campo; el backend dispara la replanificación de maletas afectadas. */
export interface UpdateFlightRequest {
  depTimeLocal?: string;
  arrTimeLocal?: string;
  capacity?: number;
}

export const adminService = {
  createAirport: async (payload: CreateAirportRequest): Promise<AirportInfo> => {
    const response = await api.post('/admin/airports/single', payload);
    return response.data as AirportInfo;
  },

  listRoutes: async (signal?: AbortSignal): Promise<RouteInfo[]> => {
    const response = await api.get('/data/routes', { signal });
    return response.data as RouteInfo[];
  },

  createFlight: async (payload: CreateFlightRequest): Promise<RouteInfo> => {
    const response = await api.post('/admin/flights/single', payload);
    return response.data as RouteInfo;
  },

  updateFlight: async (scheduleId: string, changes: UpdateFlightRequest): Promise<RouteInfo> => {
    const response = await api.put(`/admin/flights/${encodeURIComponent(scheduleId)}`, changes);
    return response.data as RouteInfo;
  },
};
