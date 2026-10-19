import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { MeResponse, Role } from '@alert/shared';
import { api, ApiError } from './api';

interface AuthContextValue {
  me: MeResponse | null;
  loading: boolean;
  setMe: (me: MeResponse | null) => void;
  /** Ponowne pobranie stanu sesji z serwera (np. po wygaśnięciu sesji logowania). */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const ME_KEY = ['me'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api.get<MeResponse>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    const onExpired = () => {
      queryClient.setQueryData(ME_KEY, null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [queryClient]);

  const value: AuthContextValue = {
    me: data ?? null,
    loading: isLoading,
    setMe: (me) => queryClient.setQueryData(ME_KEY, me),
    refresh: () => queryClient.invalidateQueries({ queryKey: ME_KEY }),
    logout: async () => {
      await api.post('/auth/logout').catch(() => undefined);
      queryClient.clear();
      queryClient.setQueryData(ME_KEY, null);
    },
    hasRole: (...roles) => Boolean(data && data.mfa === 'ok' && roles.includes(data.user.role)),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth poza AuthProvider');
  return ctx;
}
