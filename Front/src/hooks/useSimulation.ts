import { useSimulationContext } from '../providers/SimulationProvider';

/**
 * Enterprise Simulation Hook
 * Bridges components to the SimulationProvider (Socket-driven state)
 */
export function useSimulation() {
  return useSimulationContext();
}
