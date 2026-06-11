export interface Hub {
  id: string;
  name: string;
  city: string;
  continent: 'America' | 'Europe' | 'Asia';
  lat: number;
  lng: number;
  storageCapacity: number;
  currentStorage: number;
  // Performance stabilization properties
  projectedX?: number;
  projectedY?: number;
}

export interface Flight {
  id: string;
  originId: string;
  destinationId: string;
  capacity: number;
  duration: number; // in hours
  departureTime: number; // hour of the day (0-23)
  occupiedCapacity: number;
  // Performance stabilization properties
  projectedPath?: string; // SVG path string
}

export const HUBS: Hub[] = [
  { id: 'LIM', name: 'Hub Lima', city: 'Lima', continent: 'America', lat: -12.0219, lng: -77.1143, storageCapacity: 600, currentStorage: 0 },
  { id: 'NYC', name: 'Hub New York', city: 'New York', continent: 'America', lat: 40.6413, lng: -73.7781, storageCapacity: 800, currentStorage: 0 },
  { id: 'SAO', name: 'Hub Sao Paulo', city: 'Sao Paulo', continent: 'America', lat: -23.4356, lng: -46.4731, storageCapacity: 700, currentStorage: 0 },
  { id: 'MEX', name: 'Hub Mexico City', city: 'Mexico City', continent: 'America', lat: 19.4361, lng: -99.0719, storageCapacity: 650, currentStorage: 0 },
  { id: 'MAD', name: 'Hub Madrid', city: 'Madrid', continent: 'Europe', lat: 40.4839, lng: -3.5680, storageCapacity: 750, currentStorage: 0 },
  { id: 'PAR', name: 'Hub Paris', city: 'Paris', continent: 'Europe', lat: 49.0097, lng: 2.5479, storageCapacity: 800, currentStorage: 0 },
  { id: 'LON', name: 'Hub London', city: 'London', continent: 'Europe', lat: 51.4700, lng: -0.4543, storageCapacity: 800, currentStorage: 0 },
  { id: 'BER', name: 'Hub Berlin', city: 'Berlin', continent: 'Europe', lat: 52.3667, lng: 13.5033, storageCapacity: 700, currentStorage: 0 },
  { id: 'HND', name: 'Hub Tokyo', city: 'Tokyo', continent: 'Asia', lat: 35.5494, lng: 139.7798, storageCapacity: 800, currentStorage: 0 },
  { id: 'PEK', name: 'Hub Beijing', city: 'Beijing', continent: 'Asia', lat: 40.0799, lng: 116.6031, storageCapacity: 750, currentStorage: 0 },
  { id: 'ICN', name: 'Hub Seoul', city: 'Seoul', continent: 'Asia', lat: 37.4602, lng: 126.4407, storageCapacity: 700, currentStorage: 0 },
  { id: 'BKK', name: 'Hub Bangkok', city: 'Bangkok', continent: 'Asia', lat: 13.6900, lng: 100.7501, storageCapacity: 650, currentStorage: 0 },
];

export const FLIGHTS: Flight[] = [
  { id: 'F1', originId: 'LIM', destinationId: 'NYC', capacity: 200, duration: 12, departureTime: 8, occupiedCapacity: 0 },
  { id: 'F2', originId: 'NYC', destinationId: 'LIM', capacity: 200, duration: 12, departureTime: 20, occupiedCapacity: 0 },
  { id: 'F3', originId: 'LIM', destinationId: 'SAO', capacity: 180, duration: 12, departureTime: 10, occupiedCapacity: 0 },
  { id: 'F4', originId: 'SAO', destinationId: 'LIM', capacity: 180, duration: 12, departureTime: 22, occupiedCapacity: 0 },
  { id: 'F5', originId: 'MEX', destinationId: 'NYC', capacity: 220, duration: 12, departureTime: 6, occupiedCapacity: 0 },
  { id: 'F6', originId: 'MAD', destinationId: 'PAR', capacity: 200, duration: 12, departureTime: 9, occupiedCapacity: 0 },
  { id: 'F7', originId: 'PAR', destinationId: 'LON', capacity: 250, duration: 12, departureTime: 11, occupiedCapacity: 0 },
  { id: 'F8', originId: 'LON', destinationId: 'BER', capacity: 200, duration: 12, departureTime: 14, occupiedCapacity: 0 },
  { id: 'F9', originId: 'HND', destinationId: 'PEK', capacity: 200, duration: 12, departureTime: 7, occupiedCapacity: 0 },
  { id: 'F10', originId: 'PEK', destinationId: 'ICN', capacity: 180, duration: 12, departureTime: 10, occupiedCapacity: 0 },
  { id: 'F11', originId: 'ICN', destinationId: 'BKK', capacity: 200, duration: 12, departureTime: 13, occupiedCapacity: 0 },
  { id: 'F12', originId: 'NYC', destinationId: 'LON', capacity: 300, duration: 24, departureTime: 21, occupiedCapacity: 0 },
  { id: 'F13', originId: 'LON', destinationId: 'NYC', capacity: 300, duration: 24, departureTime: 10, occupiedCapacity: 0 },
  { id: 'F14', originId: 'MAD', destinationId: 'MEX', capacity: 280, duration: 24, departureTime: 23, occupiedCapacity: 0 },
  { id: 'F15', originId: 'PAR', destinationId: 'HND', capacity: 350, duration: 24, departureTime: 18, occupiedCapacity: 0 },
  { id: 'F16', originId: 'HND', destinationId: 'PAR', capacity: 350, duration: 24, departureTime: 6, occupiedCapacity: 0 },
  { id: 'F17', originId: 'SAO', destinationId: 'MAD', capacity: 250, duration: 24, departureTime: 19, occupiedCapacity: 0 },
];
