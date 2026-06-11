import { HUBS, FLIGHTS } from '../models/infrastructure';

/**
 * Simple BFS to find the shortest path (number of flights) between two hubs.
 */
export function findPath(originId: string, destinationId: string): string[] | null {
  if (originId === destinationId) return [originId];

  const queue: [string, string[]][] = [[originId, [originId]]];
  const visited = new Set<string>([originId]);

  while (queue.length > 0) {
    const [currentId, path] = queue.shift()!;

    const outgoingFlights = FLIGHTS.filter(f => f.originId === currentId);
    for (const flight of outgoingFlights) {
      if (flight.destinationId === destinationId) {
        return [...path, destinationId];
      }
      if (!visited.has(flight.destinationId)) {
        visited.add(flight.destinationId);
        queue.push([flight.destinationId, [...path, flight.destinationId]]);
      }
    }
  }

  return null;
}

export function getStorageStatus(current: number, capacity: number) {
  const ratio = current / capacity;
  if (ratio > 0.8) return 'red';
  if (ratio > 0.5) return 'amber';
  return 'green';
}

export function getContinentColor(continent: string) {
  switch (continent) {
    case 'America': return '#3b82f6'; // blue
    case 'Europe': return '#10b981'; // green
    case 'Asia': return '#f59e0b'; // amber
    default: return '#6b7280';
  }
}
