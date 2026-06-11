import { useAuthContext } from '../providers/AuthProvider';

/**
 * Enterprise Auth Hook
 */
export function useAuth() {
  return useAuthContext();
}
