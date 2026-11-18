import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '@/client/lib/api';
import type { LoginRequestDTO, UserDTO } from '@/shared/types';

interface AuthContextValue {
  user: UserDTO | null;
  nextSheetNumber: string;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (credentials: LoginRequestDTO) => Promise<UserDTO>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [nextSheetNumber, setNextSheetNumber] = useState('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.auth.me(true);
      setUser(res.user);
      setNextSheetNumber(res.nextSheetNumber);
    } catch {
      setUser(null);
      setNextSheetNumber('');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (credentials: LoginRequestDTO): Promise<UserDTO> => {
    const res = await api.auth.login(credentials);
    setUser(res.user);
    setNextSheetNumber(res.nextSheetNumber);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    await api.auth.logout();
    setUser(null);
    setNextSheetNumber('');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      nextSheetNumber,
      isLoading,
      isAuthenticated: Boolean(user),
      isAdmin: user?.role === 'admin',
      login,
      logout,
      refreshUser,
    }),
    [user, nextSheetNumber, isLoading, login, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
