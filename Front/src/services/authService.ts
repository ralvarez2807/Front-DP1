import api from './api';
import { User } from '../models/auth';

export const authService = {
  login: async (email: string, password?: string, signal?: AbortSignal): Promise<{ user: User; token: string }> => {
    const response = await api.post('/auth/login', { username: email, password }, { signal });
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
