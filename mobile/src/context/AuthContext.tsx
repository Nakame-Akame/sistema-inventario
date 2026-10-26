import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest, clearSessionCookie, getSavedBaseUrl, normalizeBaseUrl, saveBaseUrl } from '../lib/api';

export type User = {
  id: number;
  nombre: string;
  email: string;
  rol: string;
  permisos?: string[];
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  authError: string;
  baseUrl: string;
  setServerUrl: (url: string) => Promise<void>;
  signIn: (url: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const savedUrl = await getSavedBaseUrl();
        if (active) setBaseUrl(savedUrl);
        if (savedUrl) {
          const result = await apiRequest<{ usuario: User }>('/auth/me');
          if (active) setUser(result.usuario);
        }
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 401) {
          try {
            await clearSessionCookie();
          } catch (clearError) {
            if (active) setAuthError(clearError instanceof Error ? clearError.message : 'No se pudo limpiar la sesión anterior.');
          }
        } else if (active) {
          setAuthError(cause instanceof Error ? cause.message : 'No se pudo restaurar la sesión.');
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const setServerUrl = useCallback(async (url: string) => {
    const normalizedUrl = normalizeBaseUrl(url);
    if (normalizedUrl !== baseUrl) {
      await clearSessionCookie();
      setUser(null);
    }
    const savedUrl = await saveBaseUrl(url);
    setBaseUrl(savedUrl);
    setAuthError('');
  }, [baseUrl]);

  const signIn = useCallback(async (url: string, email: string, password: string) => {
    await setServerUrl(url);
    await apiRequest('/auth/login', { method: 'POST', json: { email, password } });
    const result = await apiRequest<{ usuario: User }>('/auth/me');
    setUser(result.usuario);
    setAuthError('');
  }, [setServerUrl]);

  const signOut = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } finally {
      await clearSessionCookie();
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    authError,
    baseUrl,
    setServerUrl,
    signIn,
    signOut,
    can: permission => user?.rol === 'admin' || Boolean(user?.permisos?.includes('*') || user?.permisos?.includes(permission)),
  }), [user, loading, authError, baseUrl, setServerUrl, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return context;
}
