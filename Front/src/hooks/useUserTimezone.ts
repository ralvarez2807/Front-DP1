import { useMemo } from 'react';
import { useAuthContext } from '../providers/AuthProvider';
import { useMap } from '../providers/MapProvider';
import { resolveGmtOffset, resolveUserCity } from '../lib/timezone';

/** Offset GMT (horas) del aeropuerto de la ciudad del usuario logueado, o 0 si no coincide con ninguna (admin). */
export function useUserTimezone(): number {
  const { user } = useAuthContext();
  const { projectedHubs } = useMap();
  return useMemo(() => resolveGmtOffset(user?.name, projectedHubs), [user?.name, projectedHubs]);
}

/** Ciudad del usuario logueado, para etiquetar la hora mostrada (p.ej. "Lima").
 *  null si el usuario no corresponde a ninguna ciudad (admin) — ahí se usa el GMT. */
export function useUserCity(): string | null {
  const { user } = useAuthContext();
  const { projectedHubs } = useMap();
  return useMemo(() => resolveUserCity(user?.name, projectedHubs), [user?.name, projectedHubs]);
}
