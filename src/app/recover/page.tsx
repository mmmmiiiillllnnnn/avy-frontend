"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { AuthError, recoverAccount } from "@/lib/api";
import { useAuth } from "@/components/auth/auth-provider";
import { useT } from "@/i18n/i18n-context";

// Страница самостоятельного восстановления soft-удалённого аккаунта. Сюда ведёт
// форма входа, когда логин в grace-аккаунт вернул account_deleted (+days_left).
// Вне AuthGate — пользователь разлогинен.

function RecoverInner() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { setUser } = useAuth();

  const email = params.get("email") ?? "";
  const days = Number(params.get("days") ?? "0") || 0;

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      const user = await recoverAccount({ email, password });
      setUser(user);
      router.replace("/");
    } catch (err) {
      if (err instanceof AuthError && err.code === "wrong_password") {
        setError(t.recover.errWrongPassword);
      } else if (err instanceof AuthError && err.code === "not_deleted") {
        setError(t.recover.errNotDeleted);
      } else {
        setError(t.recover.genericError);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t.recover.title}
        </h1>
        <p className="mt-2 text-muted-foreground">{t.recover.body(days)}</p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          {email && (
            <input
              type="email"
              value={email}
              readOnly
              className="w-full rounded-2xl border border-border bg-foreground/5 px-4 py-3.5 text-sm text-muted-foreground"
            />
          )}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t.recover.passwordPrompt}
            autoComplete="current-password"
            autoFocus
            className="w-full rounded-2xl border border-border bg-foreground/5 px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary/60 focus:bg-primary/5 focus:outline-none"
          />
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !password}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t.recover.button}
          </button>
        </form>

        <p className="mt-6 text-center text-sm">
          <Link
            href="/"
            className="font-medium text-primary hover:underline"
          >
            {t.recover.backToLogin}
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function RecoverPage() {
  // useSearchParams требует Suspense-границы в app router.
  return (
    <Suspense fallback={null}>
      <RecoverInner />
    </Suspense>
  );
}
