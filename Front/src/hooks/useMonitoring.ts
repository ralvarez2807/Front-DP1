import { useMonitoringContext } from '../providers/MonitoringProvider';

/**
 * Enterprise Monitoring Hook
 * Bridges components to the MonitoringProvider (Socket-driven state)
 */
export function useMonitoring() {
  return useMonitoringContext();
}
