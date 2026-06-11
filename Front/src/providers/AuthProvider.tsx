import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { User } from '../models/auth';
import { authService } from '../services/authService';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password?: string) => Promise<User>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// TEMP_AUTH_BYPASS: Set to false to bypass authentication for development
export const ENABLE_AUTH = true;

const MOCK_USER: User = {
  id: 'dev-user',
  email: 'admin@tasf.b2b',
  name: 'Admin Developer',
  role: 'admin'
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const login = useCallback(async (email: string, password?: string) => {
    if (!ENABLE_AUTH) {
      setUser(MOCK_USER);
      return MOCK_USER;
    }
    setIsLoading(true);
    const controller = new AbortController();
    try {
      const { user: userData, token } = await authService.login(email, password, controller.signal);
      localStorage.setItem('jwt_token', token);
      localStorage.setItem('user_data', JSON.stringify(userData));
      setUser(userData);
      return userData;
    } catch (err) {
      console.error('[Auth] Login failed', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    authService.logout();
    localStorage.removeItem('user_data');
    setUser(null);
  }, []);

  useEffect(() => {
    // TEMP_AUTH_BYPASS
    if (!ENABLE_AUTH) {
      setUser(MOCK_USER);
      setIsLoading(false);
      return;
    }

    const savedUser = localStorage.getItem('user_data');
    const token = localStorage.getItem('jwt_token');
    if (savedUser && token) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        localStorage.removeItem('user_data');
        localStorage.removeItem('jwt_token');
      }
    }
    setIsLoading(false);
  }, []);

  const value = useMemo(() => ({
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    logout
  }), [user, isLoading, login, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuthContext = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuthContext must be used within an AuthProvider');
  return context;
};
