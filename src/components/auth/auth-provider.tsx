"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  type AuthUser,
} from "@/lib/api";

type AuthState = {
  user: AuthUser | null;
  /** true, пока идёт первичная проверка сессии (fetchMe на маунте). */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    name: string;
    password: string;
    inviteCode: string;
    consent: boolean;
  }) => Promise<void>;
  logout: () => Promise<void>;
  /** Обновить кэш текущего пользователя в UI (после смены имени, восстановления
   *  через /recover и т.п.). */
  setUser: (user: AuthUser | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

/**
 * Состояние аутентификации на клиенте. Источник правды — сессионная cookie на
 * сервере; здесь лишь зеркалим текущего пользователя (через /api/auth/me) и даём
 * методы login/register/logout. Реальная защита — на бэкенде (cookie+session);
 * этот контекст управляет только UI (гейт, отображение юзера).
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Первичная проверка сессии. setState только ПОСЛЕ await (синхронизация с
  // внешним источником — сервером), с guard'ом против размонтирования.
  useEffect(() => {
    let alive = true;
    (async () => {
      const me = await fetchMe();
      if (alive) {
        setUser(me);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const u = await apiLogin({ email, password });
    setUser(u);
  }, []);

  const register = useCallback(
    async (input: {
      email: string;
      name: string;
      password: string;
      inviteCode: string;
      consent: boolean;
    }) => {
      const u = await apiRegister(input);
      setUser(u);
    },
    [],
  );

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, logout, setUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
