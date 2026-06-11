export interface MonitoringMetrics {
  activeBaggageCount: number;
  deliveredBaggageToday: number;
  averageLeadTime: number;
  systemThroughput: number;
  networkHealthScore: number;
  pendingSLAAlerts: number;
}

export interface SLAAlert {
  id: string;
  type: 'delay' | 'missed_connection' | 'lost';
  shipmentId: string;
  deadline: number;
  currentDelay: number;
  status: 'new' | 'investigating' | 'resolved' | 'ignored';
  timestamp?: string; // For sequencing
}
