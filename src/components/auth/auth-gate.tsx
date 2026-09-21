"use client";

import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";

/**
 * Гейт защищённых страниц: пока идёт проверка — сплэш, дальше рендерим чат.
 *
 * ЛОКАЛЬНАЯ СБОРКА: экрана входа НЕТ. Приложение стоит на машине одного человека
 * и слушает только localhost, поэтому бэкенд подставляет единственного
 * пользователя установки сам (server/domain/users/auth.py: автовход). Редирект
 * на /login убран вместе со страницей — вести туда стало некуда.
 *
 * Если пользователя всё же нет (init-контейнер не отработал и база пуста),
 * показываем не бесконечный спиннер, а причину: иначе это выглядело бы как
 * зависшая загрузка.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-svh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-svh flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium">Учётная запись не создана</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Приложение не нашло ни одного пользователя. Проверьте, что при
          развёртывании отработал шаг создания учётной записи:
        </p>
        <code className="rounded bg-muted px-2 py-1 text-xs">
          docker compose logs init-user
        </code>
      </div>
    );
  }

  return <>{children}</>;
}
