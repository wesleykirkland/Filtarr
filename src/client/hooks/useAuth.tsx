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

const SESSION_QUERY_KEY = ['auth', 'session'] as const;

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Mark only the session as signed out so the route guard redirects to /login,
    // instead of clearing every query (which flashed all pages to Loading).
    // Acting only on an authenticated cached session also prevents a refetch loop.
    const handleAuthError = () => {
      const current = queryClient.getQueryData<AuthSession>(SESSION_QUERY_KEY);
      if (!current?.authenticated || current.mode === 'none') return;
      queryClient.setQueryData<AuthSession>(SESSION_QUERY_KEY, { authenticated: false, mode: current.mode });
      void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    };

    globalThis.addEventListener('auth:401', handleAuthError);
    return () => globalThis.removeEventListener('auth:401', handleAuthError);
  }, [queryClient]);

  const { data: session, isLoading, error, refetch } = useQuery({
    queryKey: SESSION_QUERY_KEY,
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
      await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
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
