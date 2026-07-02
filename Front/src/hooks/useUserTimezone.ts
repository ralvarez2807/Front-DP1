import { useMemo } from 'react';
import { useAuthContext } from '../providers/AuthProvider';
import { useMap } from '../providers/MapProvider';
import { resolveGmtOffset } from '../lib/timezone';

/** Offset GMT (horas) del aeropuerto de la ciudad del usuario logueado, o 0 si no coincide con ninguna (admin). */
export function useUserTimezone(): number {
  const { user } = useAuthContext();
  const { projectedHubs } = useMap();
  return useMemo(() => resolveGmtOffset(user?.name, projectedHubs), [user?.name, projectedHubs]);
}
