import axios, { AxiosError } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

export interface ApiError {
  message: string;
  code: string;
  statusCode?: number;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('jwt_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Content-Type solo en requests que llevan body; los GETs no deben incluirlo
  // porque Spring intenta parsear el body y explota si está vacío.
  const method = config.method?.toLowerCase() ?? '';
  if (['post', 'put', 'patch'].includes(method) && config.headers) {
    config.headers['Content-Type'] ??= 'application/json';
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && originalRequest && !(originalRequest as any)._retry) {
      (originalRequest as any)._retry = true;
      try {
        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, null, {
          headers: { Authorization: `Bearer ${localStorage.getItem('jwt_token')}` },
        });
        localStorage.setItem('jwt_token', data.accessToken);
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        }
        return api(originalRequest);
      } catch {
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('user_data');
      }
    }

    const normalizedError: ApiError = {
      message: (error.response?.data as any)?.message || error.message || 'Unknown network error',
      code: (error.response?.data as any)?.code || 'NETWORK_ERROR',
      statusCode: error.response?.status,
    };

    return Promise.reject(normalizedError);
  }
);

export const createAbortController = () => new AbortController();

export default api;
