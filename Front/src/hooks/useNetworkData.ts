import { useState, useEffect, useCallback } from 'react';
import { Hub, Flight } from '../models/infrastructure';
import { Shipment } from '../models/operational';
import { hubService } from '../services/hubService';
import { flightService } from '../services/flightService';

export function useNetworkData() {
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [shipments] = useState<Shipment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInfrastructure = useCallback(async (signal?: AbortSignal) => {
    try {
      const [hubsData, flightsData] = await Promise.all([
        hubService.getAll(signal),
        flightService.getAll(signal),
      ]);
      setHubs(Array.isArray(hubsData) ? hubsData : []);
      setFlights(Array.isArray(flightsData) ? flightsData : []);
      setError(null);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('[NetworkData] Sync Failed', err);
      setError('Error de sincronización con la infraestructura.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchInfrastructure(controller.signal);
    const interval = setInterval(() => fetchInfrastructure(), 60000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchInfrastructure]);

  return { hubs, flights, shipments, isLoading, error, refresh: fetchInfrastructure };
}
