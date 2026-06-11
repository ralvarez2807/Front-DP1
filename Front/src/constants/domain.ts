/**
 * TASF.B2B - Immutable Domain Constants
 */

export const SCENARIOS = {
  DAILY: 'daily',
  PERIOD_5D: 'period_5d',
  COLLAPSE: 'collapse',
} as const;

export type SimulationScenario = typeof SCENARIOS[keyof typeof SCENARIOS];

export const SCENARIO_LABELS: Record<SimulationScenario, string> = {
  [SCENARIOS.DAILY]: 'Operación Diaria (24h)',
  [SCENARIOS.PERIOD_5D]: 'Operación Periodo 5 Días',
  [SCENARIOS.COLLAPSE]: 'Operación hasta el Colapso',
};

export const OPERATIONAL_EVENTS = {
  SIMULATION_UPDATE: 'simulation:update',
  SIMULATION_EVENT: 'simulation:event',
  MONITORING_ALERT: 'monitoring:alert',
  TRACKING_UPDATE: 'tracking:update',
  FLIGHT_CAPACITY_CHANGED: 'flight:capacity_changed',
  ROUTING_CRITICAL_POINT: 'routing:critical_point',
  BAGGAGE_UPDATED: 'baggage:updated',
  SIMULATION_STATUS_CHANGED: 'simulation:status_changed',
} as const;
