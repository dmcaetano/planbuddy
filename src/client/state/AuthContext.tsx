import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import type { PublicUser } from "../api/types";

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  signup: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (user: PublicUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: PublicUser }>("/auth/me");
      setUser(data.user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
      } else {
        throw err;
      }
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const signup = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ user: PublicUser }>("/auth/signup", { email, password });
    setUser(data.user);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ user: PublicUser }>("/auth/login", { email, password });
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout");
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signup, login, logout, refresh, setUser }),
    [user, loading, signup, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
