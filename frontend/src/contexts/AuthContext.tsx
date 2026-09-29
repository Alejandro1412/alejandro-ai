import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, tokenStore } from '@/lib/api';
import type { Me } from '@/types';

interface AuthCtx {
  me: Me | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  login: (email: string, password: string) => Promise<Me>;
  register: (input: { name: string; email: string; password: string; clinicName: string; locale: 'es' | 'en' }) => Promise<Me>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
  reload: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<AuthCtx['status']>('loading');
  const qc = useQueryClient();

  const loadMe = useCallback(async () => {
    const data = await api.get<Me>('/auth/me');
    setMe(data);
    setStatus('authenticated');
    return data;
  }, []);

  useEffect(() => {
    let alive = true;
    refreshSession().then(async (token) => {
      if (!alive) return;
      if (!token) return setStatus('anonymous');
      try {
        await loadMe();
      } catch {
        setStatus('anonymous');
      }
    });
    // If a later refresh fails (session revoked), drop to anonymous.
    const unsub = tokenStore.subscribe((tok) => {
      if (!tok && alive) {
        setMe(null);
        setStatus('anonymous');
      }
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [loadMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<{ accessToken: string }>('/auth/login', { email, password }, { anonymous: true });
      tokenStore.set(res.accessToken);
      return loadMe();
    },
    [loadMe],
  );

  const register = useCallback<AuthCtx['register']>(
    async (input) => {
      const res = await api.post<{ accessToken: string }>('/auth/register', input, { anonymous: true });
      tokenStore.set(res.accessToken);
      return loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      tokenStore.set(null);
      setMe(null);
      setStatus('anonymous');
      qc.clear();
    }
  }, [qc]);

  const can = useCallback((p: string) => Boolean(me?.permissions.includes(p)), [me]);

  const value = useMemo(() => ({ me, status, login, register, logout, can, reload: async () => void (await loadMe()) }), [me, status, login, register, logout, can, loadMe]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
