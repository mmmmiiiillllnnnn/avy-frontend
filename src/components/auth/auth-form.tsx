"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthError } from "@/lib/api";
import { useAuth } from "@/components/auth/auth-provider";
import { MeshHero } from "@/components/auth/mesh-hero";
import { useT } from "@/i18n/i18n-context";
import type { Dictionary } from "@/i18n/dictionary";

// Адаптировано из дизайна 21st.dev (easemize/sign-in): убраны Google-вход и
// сброс пароля (бэкенд их не поддерживает), акценты переведены на бренд-токены
// (--primary оранжевый вместо violet). Правый блок — наш mesh-градиент.

type Mode = "login" | "signup";

/** Стеклянная обёртка инпута (фокус подсвечивает кольцом бренд-цвета). */
function Field({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-foreground/5 transition-colors focus-within:border-primary/60 focus-within:bg-primary/5">
      {children}
    </div>
  );
}

const INPUT_CLS =
  "w-full bg-transparent p-4 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none";

/** Человекочитаемая ошибка по коду из AuthError (detail бэкенда). */
function errorMessage(err: unknown, mode: Mode, t: Dictionary): string {
  const a = t.auth;
  if (err instanceof AuthError) {
    switch (err.code) {
      case "invalid_credentials":
        return a.errInvalidCredentials;
      case "invalid_invite_code":
        return a.errInvalidInvite;
      case "email_taken":
        return a.errEmailTaken;
      case "invalid_email":
        return a.errInvalidEmail;
      case "consent_required":
        return a.errConsentRequired;
      default:
        return mode === "login" ? a.errLoginFailed : a.errSignupFailed;
    }
  }
  return a.errServiceDown;
}

/**
 * Экран входа/регистрации: слева форма, справа mesh-блок с логотипом. `mode`
 * выбирает набор полей (регистрация добавляет имя + код приглашения) и действие.
 * После успеха редиректит на «/» (там AuthGate пустит в чат).
 */
export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const t = useT();
  const { login, register } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === "signup";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();
    const inviteCode = String(form.get("invite_code") ?? "").trim();
    const consent = form.get("consent") === "on";

    setSubmitting(true);
    try {
      if (isSignup) {
        await register({ email, name, password, inviteCode, consent });
      } else {
        await login(email, password);
      }
      router.replace("/");
    } catch (err) {
      // Аккаунт в grace-периоде удаления: ведём на восстановление, а не ошибку.
      if (err instanceof AuthError && err.code === "account_deleted") {
        const days =
          typeof err.detail?.days_left === "number" ? err.detail.days_left : 0;
        const qs = new URLSearchParams({ email, days: String(days) });
        router.replace(`/recover?${qs.toString()}`);
        return;
      }
      setError(errorMessage(err, mode, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-[100dvh] w-[100dvw] flex-col md:flex-row">
      {/* Левая колонка: форма */}
      <section className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="flex flex-col gap-6">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
                {isSignup ? t.auth.signupTitle : t.auth.loginTitle}
              </h1>
              <p className="mt-2 text-muted-foreground">
                {isSignup ? t.auth.signupSubtitle : t.auth.loginSubtitle}
              </p>
            </div>

            <form className="space-y-4" onSubmit={onSubmit}>
              {isSignup && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {t.auth.name}
                  </label>
                  <Field>
                    <input
                      name="name"
                      type="text"
                      required
                      autoComplete="name"
                      placeholder={t.auth.namePlaceholder}
                      className={INPUT_CLS}
                    />
                  </Field>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t.auth.email}
                </label>
                <Field>
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    className={INPUT_CLS}
                  />
                </Field>
              </div>

              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  {t.auth.password}
                </label>
                <Field>
                  <div className="relative">
                    <input
                      name="password"
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete={isSignup ? "new-password" : "current-password"}
                      placeholder={
                        isSignup
                          ? t.auth.passwordPlaceholderSignup
                          : t.auth.passwordPlaceholderLogin
                      }
                      className={`${INPUT_CLS} pr-12`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={
                        showPassword ? t.auth.hidePassword : t.auth.showPassword
                      }
                      className="absolute inset-y-0 right-3 flex items-center text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {showPassword ? (
                        <EyeOff className="size-5" />
                      ) : (
                        <Eye className="size-5" />
                      )}
                    </button>
                  </div>
                </Field>
              </div>

              {isSignup && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    {t.auth.inviteCode}
                  </label>
                  <Field>
                    <input
                      name="invite_code"
                      type="text"
                      required
                      placeholder={t.auth.inviteCodePlaceholder}
                      className={INPUT_CLS}
                    />
                  </Field>
                </div>
              )}

              {isSignup && (
                <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <input
                    name="consent"
                    type="checkbox"
                    required
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span>
                    {t.auth.consentPrefix}{" "}
                    <Link
                      href="/terms"
                      target="_blank"
                      className="text-primary hover:underline"
                    >
                      {t.auth.consentTerms}
                    </Link>{" "}
                    {t.auth.consentAnd}{" "}
                    <Link
                      href="/privacy"
                      target="_blank"
                      className="text-primary hover:underline"
                    >
                      {t.auth.consentPrivacy}
                    </Link>
                  </span>
                </label>
              )}

              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {isSignup ? t.auth.submitSignup : t.auth.submitLogin}
              </button>
            </form>

            <p className="text-center text-sm text-muted-foreground">
              {isSignup ? (
                <>
                  {t.auth.haveAccount}{" "}
                  <Link
                    href="/login"
                    className="font-medium text-primary hover:underline"
                  >
                    {t.auth.goLogin}
                  </Link>
                </>
              ) : (
                <>
                  {t.auth.noAccount}{" "}
                  <Link
                    href="/signup"
                    className="font-medium text-primary hover:underline"
                  >
                    {t.auth.goSignup}
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* Правая колонка: mesh-градиент + логотип (скрыта на мобильных). */}
      <section className="hidden flex-1 p-3 md:block">
        <div className="h-full w-full overflow-hidden rounded-3xl">
          <MeshHero />
        </div>
      </section>
    </div>
  );
}
