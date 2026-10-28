import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { MeResponse, Role } from '@alert/shared';
import { api, ApiError, isUnreachable } from './api';
import { cacheGet, cacheSet } from './outbox';

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
// Ostatnio zalogowany użytkownik w pamięci telefonu: otwarta bez zasięgu aplikacja pokazuje listę obecności,
// a nie ekran logowania (bez sieci i tak nie da się zalogować). Każde zapytanie do serwera nadal sprawdza sesję.
const ME_CACHE = 'me';

function rememberMe(me: MeResponse | null) {
  cacheSet(ME_CACHE, me?.mfa === 'ok' ? me : null);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        const me = await api.get<MeResponse>('/auth/me');
        rememberMe(me);
        return me;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          rememberMe(null);
          return null;
        }
        const cached = isUnreachable(err) ? cacheGet<MeResponse>(ME_CACHE) : null;
        if (cached) return cached;
        throw err;
      }
    },
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    const onExpired = () => {
      rememberMe(null);
      queryClient.setQueryData(ME_KEY, null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [queryClient]);

  const value: AuthContextValue = {
    me: data ?? null,
    loading: isLoading,
    setMe: (me) => {
      rememberMe(me);
      queryClient.setQueryData(ME_KEY, me);
    },
    refresh: () => queryClient.invalidateQueries({ queryKey: ME_KEY }),
    logout: async () => {
      await api.post('/auth/logout').catch(() => undefined);
      rememberMe(null);
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
