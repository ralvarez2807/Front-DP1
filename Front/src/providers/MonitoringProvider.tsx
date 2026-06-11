import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { monitoringService } from '../services/monitoringService';
import { MonitoringMetrics, SLAAlert } from '../models/monitoring';
import { useSimulationContext } from './SimulationProvider';

interface MonitoringContextType {
  metrics: MonitoringMetrics | null;
  alerts: SLAAlert[];
  isLoading: boolean;
  error: string | null;
  resolveAlert: (id: string, resolution: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const MonitoringContext = createContext<MonitoringContextType | null>(null);

export const MonitoringProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session } = useSimulationContext();
  const [metrics, setMetrics] = useState<MonitoringMetrics | null>(null);
  const [alerts, setAlerts] = useState<SLAAlert[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (sessionId: string, signal?: AbortSignal) => {
    setIsLoading(true);
    try {
      const metricsData = await monitoringService.getDashboard(sessionId, signal);
      setMetrics(metricsData);
      setError(null);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err.message || 'Error fetching monitoring data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) {
      setMetrics(null);
      setAlerts([]);
      return;
    }
    const controller = new AbortController();
    fetchData(session.id, controller.signal);
    const interval = setInterval(() => fetchData(session.id), 10_000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [session?.id, fetchData]);

  const resolveAlert = useCallback(async (id: string, _resolution: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    if (session) await fetchData(session.id);
  }, [session, fetchData]);

  const value = useMemo(() => ({
    metrics, alerts, isLoading, error, resolveAlert, refresh
  }), [metrics, alerts, isLoading, error, resolveAlert, refresh]);

  return (
    <MonitoringContext.Provider value={value}>
      {children}
    </MonitoringContext.Provider>
  );
};

export const useMonitoringContext = () => {
  const context = useContext(MonitoringContext);
  if (!context) throw new Error('useMonitoringContext must be used within a MonitoringProvider');
  return context;
};
