import { createContext, useContext, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

interface AuthSession {
  authenticated: boolean;
  mode: string;
  user?: { id: number; username: string; displayName: string };
  apiKey?: { id: number; name: string };
}

interface AuthContextValue {
  session: AuthSession | undefined;
  isLoading: boolean;
  error: Error | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  retrySession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleAuthError = () => {
      queryClient.clear();
      // Optional: force a reload or redirect, but clearing cache will make the protected route component do the redirect eventually when the session query fails.
    };

    globalThis.addEventListener('auth:401', handleAuthError);
    return () => globalThis.removeEventListener('auth:401', handleAuthError);
  }, [queryClient]);

  const { data: session, isLoading, error, refetch } = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: () => api.get<AuthSession>('/auth/session'),
    retry: false,
    staleTime: 60_000,
  });

  const retrySession = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const login = useCallback(
    async (username: string, password: string) => {
      await api.post('/auth/login', { username, password });
      await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
  }, [queryClient]);

  const value = useMemo(
    () => ({ session, isLoading, error, login, logout, retrySession }),
    [session, isLoading, error, login, logout, retrySession],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
