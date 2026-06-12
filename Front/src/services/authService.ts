import api from './api';
import { User } from '../models/auth';

export const authService = {
  login: async (email: string, password?: string, signal?: AbortSignal): Promise<{ user: User; token: string }> => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password ?? ''));
    const passwordHash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    const response = await api.post('/auth/login', { username: email, passwordHash }, { signal });
    const { accessToken } = response.data;
    return {
      user: { id: 'user', email, name: email, role: 'admin' },
      token: accessToken,
    };
  },

  logout: () => {
    localStorage.removeItem('jwt_token');
  }
};
