import { Hub } from './infrastructure';
import { SimulationScenario } from '../constants/domain';
import { MonitoringMetrics } from './monitoring';

export interface Order {
  id: string;
  customerId: string;
  customerName: string;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  createdAt: number;
  items: string[];
  totalValue: number;
}

export interface Shipment {
  id: string;
  orderId: string;
  originId: string;
  destinationId: string;
  currentLocationId: string;
  status: 'waiting' | 'in-transit' | 'delivered' | 'delayed' | 'cancelled';
  createdAt: number; // operational time
  deadline: number; // operational time
  path: string[]; // sequence of hub IDs
  currentPathIndex: number;
  transportType: 'air' | 'land' | 'sea';
}

export interface BaggageRequest extends Order {
  priority: 'low' | 'medium' | 'high' | 'critical';
  weight: number;
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
  fragile: boolean;
  insuranceValue: number;
}

export interface RouteResult {
  shipmentId: string;
  suggestedPath: string[]; // hub IDs
  estimatedDelivery: number;
  alternatives: {
    path: string[];
    cost: number;
    eta: number;
  }[];
  congestionScore: number; // 0-100
}

export interface OperationalEvent {
  id: string;
  type: 'shipment_update' | 'flight_delay' | 'hub_congestion' | 'system_alert' | 'simulation_step';
  severity: 'info' | 'warning' | 'error' | 'critical';
  timestamp: string;
  sequenceNumber?: number; // For event ordering/deduplication
  message: string;
  metadata?: Record<string, any>;
}

export interface SimulationSession {
  id: string;
  status: 'starting' | 'running' | 'paused' | 'completed' | 'stopped';
  startTimeAt: string;
  currentTimeAt: number; // operational time
  lastProcessedSequence?: number; // For synchronization
  speedFactor: number; // sim-hours per real-hour, leído del backend
  config: {
    speed: number;
    scenario: SimulationScenario;
    targetDays?: number;
  };
  metrics: MonitoringMetrics;
}

export interface CriticalPoint {
  id: string;
  locationId: string; // Hub or Flight ID
  type: 'hub_overflow' | 'route_bottleneck' | 'sla_risk';
  description: string;
  impactScore: number; // 0-1
  remediationAction?: string;
}

export interface TrackingStep {
  hubId: string;
  arrivalTime?: number;
  departureTime?: number;
  status: 'pending' | 'completed' | 'current' | 'skipped';
  events: OperationalEvent[];
}

export interface FullTrackingData {
  shipmentId: string;
  originHub: Hub;
  destinationHub: Hub;
  currentHub: Hub;
  status: string;
  timeline: TrackingStep[];
  estimatedArrival: number;
}
