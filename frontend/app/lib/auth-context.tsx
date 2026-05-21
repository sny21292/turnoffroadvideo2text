"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ApiUser,
  getStoredUser,
  login as apiLogin,
  logout as apiLogout,
} from "./api";

type AuthState = {
  user: ApiUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<ApiUser>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUser(getStoredUser());
    setReady(true);
    function onChange() {
      setUser(getStoredUser());
    }
    window.addEventListener("v2t:auth-change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("v2t:auth-change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const u = await apiLogin(email, password);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    apiLogout();
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, ready, login, logout }),
    [user, ready, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
