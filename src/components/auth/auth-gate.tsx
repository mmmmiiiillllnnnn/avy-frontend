"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";

/**
 * Клиентский гейт защищённых страниц: пока идёт проверка сессии — сплэш; нет
 * пользователя — редирект на /login; есть — рендерим детей (чат). Реальная
 * защита данных — на бэке (cookie+session); этот гейт управляет только UX, чтобы
 * неавторизованный не видел пустой интерфейс приложения.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex h-svh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}
