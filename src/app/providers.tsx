"use client";

import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/components/auth/auth-provider";
import { LocaleProvider } from "@/i18n/i18n-context";
import { ThemeColorMeta } from "@/components/theme-color-meta";

/**
 * Клиентские провайдеры приложения.
 *
 * ThemeProvider (next-themes) управляет схемой: ставит класс `light`/`dark` на
 * <html>, хранит выбор в localStorage и по умолчанию следует системной
 * настройке (defaultTheme="system" + enableSystem). attribute="class" — наши
 * схемы в globals.css завязаны на классы .light/.dark.
 *
 * AuthProvider зеркалит сессию пользователя (cookie) и даёт login/register/
 * logout; гейт на основе его состояния — в AuthGate (см. app/page.tsx).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <ThemeColorMeta />
      <LocaleProvider>
        <AuthProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </AuthProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
