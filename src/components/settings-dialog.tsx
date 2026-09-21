"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  Brain,
  ChevronDown,
  FileText,
  Gauge,
  KeyRound,
  Loader2,
  LogOut,
  SlidersHorizontal,
  Trash2,
  User as UserIcon,
  X,
} from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import {
  AuthError,
  changeName,
  changePassword,
  deleteAccount,
  fetchMemorySettings,
  fetchMyMemory,
  fetchUsage,
  logoutEverywhere,
  setMemoryEnabled,
  type MemoryOwner,
  type UsageInfo,
} from "@/lib/api";
import { MemoryGroups } from "@/components/memory-list";
import { useAuth } from "@/components/auth/auth-provider";
import { useLocale, useT } from "@/i18n/i18n-context";
import type { Locale } from "@/lib/locale";

type Section = "general" | "memory" | "usage" | "account" | "legal";

const FIELD_CLS =
  "w-full rounded-xl border border-border bg-foreground/5 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary/60 focus:bg-primary/5 focus:outline-none";

function fmtCredits(n: number | null | undefined, locale: string): string {
  if (n === null || n === undefined) return "∞";
  return Math.round(n).toLocaleString(locale === "ru" ? "ru-RU" : "en-US");
}

function fmtReset(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Сегментированный переключатель темы / языка (две опции).
 *
 *  layoutId ОБЯЗАТЕЛЕН и должен быть уникальным на каждый экземпляр: framer-motion
 *  считает все motion.span с одинаковым layoutId одним общим элементом, поэтому при
 *  общем id оранжевая заливка-«шарик» рисуется лишь у ОДНОГО из контролов (баг: у
 *  Language не было подсветки активного сегмента). */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  layoutId,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  layoutId: string;
}) {
  return (
    <span className="relative inline-flex shrink-0 items-center rounded-full bg-muted p-0.5 text-xs font-medium">
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={cn(
              "relative z-10 rounded-full px-3 py-1 transition-colors",
              active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
                className="absolute inset-0 -z-10 rounded-full bg-primary"
              />
            )}
            {o.label}
          </button>
        );
      })}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function GeneralSection() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const theme = mounted && resolvedTheme === "dark" ? "dark" : "light";

  return (
    <div className="flex flex-col divide-y divide-border">
      <Row label={t.sidebar.theme}>
        <Segmented
          layoutId="settings-seg-theme"
          value={theme}
          options={[
            { id: "light", label: t.settings.themeLight },
            { id: "dark", label: t.settings.themeDark },
          ]}
          onChange={(v) => setTheme(v)}
        />
      </Row>
      <Row label={t.sidebar.language}>
        <Segmented
          layoutId="settings-seg-lang"
          value={locale}
          options={[
            { id: "ru" as Locale, label: "RU" },
            { id: "en" as Locale, label: "EN" },
          ]}
          onChange={(v) => setLocale(v)}
        />
      </Row>
    </div>
  );
}

const PLAN_KEY: Record<string, keyof ReturnType<typeof useT>["settings"]> = {
  free: "planFree",
  promo: "planPromo",
  pro: "planPro",
  enterprise: "planEnterprise",
};

function UsageSection() {
  const t = useT();
  const { locale } = useLocale();
  const [usage, setUsage] = React.useState<UsageInfo | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setLoading(true);
    fetchUsage()
      .then(setUsage)
      .finally(() => setLoading(false));
  }, []);

  if (loading && !usage) {
    return <div className="text-sm text-muted-foreground">{t.settings.loading}</div>;
  }

  const limited = usage?.limited ?? false;
  const limit = usage?.limit_credits ?? null;
  const spent = usage?.spent_credits ?? 0;
  const remaining = usage?.remaining_credits ?? null;
  const ratio = limited && limit && limit > 0 ? Math.min(1, spent / limit) : 0;
  const planKey = PLAN_KEY[usage?.plan ?? ""];
  const planLabel = planKey ? (t.settings[planKey] as string) : (usage?.plan ?? "—");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col divide-y divide-border">
        <Row label={t.settings.plan}>
          <span className="text-sm font-medium">{planLabel}</span>
        </Row>
        <Row label={t.settings.creditsAvailable}>
          <span className="text-sm font-medium tabular-nums">
            {limited
              ? t.settings.creditsOf(
                  fmtCredits(remaining, locale),
                  fmtCredits(limit, locale),
                )
              : t.settings.unlimited}
          </span>
        </Row>
      </div>

      {limited && (
        <div className="flex flex-col gap-2">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                ratio >= 1 ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${Math.round(ratio * 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t.settings.spent(fmtCredits(spent, locale))}</span>
            <span>{t.settings.resetOn(fmtReset(usage?.reset_at ?? null, locale))}</span>
          </div>
        </div>
      )}

      {usage?.exhausted && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t.settings.exhausted(fmtReset(usage?.reset_at ?? null, locale))}
        </div>
      )}

      {!limited && (
        <p className="text-xs text-muted-foreground">{t.settings.noLimitHint}</p>
      )}
    </div>
  );
}

/**
 * Раскрывающаяся строка настроек: слева иконка в тонированном квадрате +
 * заголовок и приглушённое описание, справа — шеврон. По клику разворачивает
 * содержимое (форму) под собой. Опасные действия — с danger-окраской.
 */
function SettingRow({
  icon: Icon,
  title,
  description,
  danger = false,
  open,
  onToggle,
  children,
}: {
  icon: typeof Gauge;
  title: string;
  description: string;
  danger?: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="group flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors hover:bg-accent/40"
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            danger
              ? "bg-destructive/10 text-destructive"
              : "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-[1.05rem]" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-sm font-medium",
              danger ? "text-destructive" : "text-foreground",
            )}
          >
            {title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {description}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="px-2 pb-3 pt-1">{children}</div>}
    </div>
  );
}

/** Управление аккаунтом: имя, пароль, выход со всех устройств, удаление. */
function AccountSection({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { user, setUser, logout } = useAuth();
  const a = t.settings;

  // --- имя ---
  const [name, setName] = React.useState(user?.name ?? "");
  const [nameBusy, setNameBusy] = React.useState(false);
  const [nameDone, setNameDone] = React.useState(false);

  const saveName = async () => {
    const next = name.trim();
    if (!next || next === user?.name || nameBusy) return;
    setNameBusy(true);
    setNameDone(false);
    try {
      const updated = await changeName(next);
      setUser(updated);
      setNameDone(true);
    } catch {
      /* имя не критично — молча */
    } finally {
      setNameBusy(false);
    }
  };

  // Какая из раскрывающихся секций открыта (одна за раз).
  const [openPanel, setOpenPanel] = React.useState<
    "password" | "sessions" | "delete" | null
  >(null);
  const toggle = (p: "password" | "sessions" | "delete") =>
    setOpenPanel((cur) => (cur === p ? null : p));

  // --- пароль ---
  const [cur, setCur] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [pwdBusy, setPwdBusy] = React.useState(false);
  const [pwdMsg, setPwdMsg] = React.useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const savePassword = async () => {
    if (pwdBusy) return;
    setPwdMsg(null);
    if (next.length < 8) {
      setPwdMsg({ ok: false, text: a.passwordTooShort });
      return;
    }
    if (next !== confirm) {
      setPwdMsg({ ok: false, text: a.passwordMismatch });
      return;
    }
    setPwdBusy(true);
    try {
      await changePassword(cur, next);
      setPwdMsg({ ok: true, text: a.passwordSaved });
      setCur("");
      setNext("");
      setConfirm("");
    } catch (err) {
      const wrong = err instanceof AuthError && err.code === "wrong_password";
      setPwdMsg({ ok: false, text: wrong ? a.passwordWrong : a.genericError });
    } finally {
      setPwdBusy(false);
    }
  };

  // --- выход со всех устройств ---
  const [sessionsBusy, setSessionsBusy] = React.useState(false);
  const doLogoutEverywhere = async () => {
    if (sessionsBusy) return;
    setSessionsBusy(true);
    try {
      await logoutEverywhere();
      await logout();
    } finally {
      setSessionsBusy(false);
    }
  };

  // --- удаление аккаунта ---
  const [delPwd, setDelPwd] = React.useState("");
  const [delBusy, setDelBusy] = React.useState(false);
  const [delErr, setDelErr] = React.useState<string | null>(null);
  const doDelete = async () => {
    if (delBusy) return;
    setDelErr(null);
    setDelBusy(true);
    try {
      await deleteAccount(delPwd);
      await logout();
      onClose();
    } catch (err) {
      const wrong = err instanceof AuthError && err.code === "wrong_password";
      setDelErr(wrong ? a.passwordWrong : a.genericError);
    } finally {
      setDelBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Профиль: аватар-инициал + имя. Имя — частое безопасное действие, инлайн. */}
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold uppercase text-primary">
          {(user?.name?.[0] ?? user?.email?.[0] ?? "?").toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {user?.name || "—"}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {user?.email}
          </div>
        </div>
      </div>

      {/* Имя */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {a.accountName}
        </label>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameDone(false);
            }}
            className={FIELD_CLS}
            maxLength={120}
          />
          <button
            type="button"
            onClick={saveName}
            disabled={nameBusy || !name.trim() || name.trim() === user?.name}
            className="shrink-0 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {nameBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : nameDone ? (
              a.saved
            ) : (
              a.save
            )}
          </button>
        </div>
      </div>

      {/* Действия-строки с иконками. Пароль/удаление раскрываются формой;
          выход со всех устройств — простое действие, отдельной строкой-кнопкой. */}
      <div className="-mx-2 flex flex-col rounded-2xl border border-border/60 bg-muted/20 p-1.5">
        {/* Смена пароля */}
        <SettingRow
          icon={KeyRound}
          title={a.password}
          description={a.passwordDesc}
          open={openPanel === "password"}
          onToggle={() => toggle("password")}
        >
          <div className="flex flex-col gap-2">
            <input
              type="password"
              value={cur}
              onChange={(e) => setCur(e.target.value)}
              placeholder={a.passwordCurrent}
              autoComplete="current-password"
              className={FIELD_CLS}
            />
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder={a.passwordNew}
              autoComplete="new-password"
              className={FIELD_CLS}
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={a.passwordConfirm}
              autoComplete="new-password"
              className={FIELD_CLS}
            />
            {pwdMsg && (
              <p
                className={cn(
                  "text-sm",
                  pwdMsg.ok ? "text-primary" : "text-destructive",
                )}
              >
                {pwdMsg.text}
              </p>
            )}
            <button
              type="button"
              onClick={savePassword}
              disabled={pwdBusy || !cur || !next || !confirm}
              className="self-start rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {pwdBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                a.passwordSave
              )}
            </button>
          </div>
        </SettingRow>

        {/* Выход со всех устройств — простое действие, без раскрытия. */}
        <button
          type="button"
          onClick={doLogoutEverywhere}
          disabled={sessionsBusy}
          className="group flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors hover:bg-accent/40 disabled:opacity-60"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {sessionsBusy ? (
              <Loader2 className="size-[1.05rem] animate-spin" />
            ) : (
              <LogOut className="size-[1.05rem]" strokeWidth={2} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">
              {a.logoutEverywhere}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {a.sessionsDesc}
            </span>
          </span>
        </button>

        {/* Удаление аккаунта */}
        <SettingRow
          icon={Trash2}
          title={a.deleteAccount}
          description={a.deleteAccountDesc}
          danger
          open={openPanel === "delete"}
          onToggle={() => toggle("delete")}
        >
          <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm text-muted-foreground">
              {a.deleteAccountWarn(60)}
            </p>
            <input
              type="password"
              value={delPwd}
              onChange={(e) => setDelPwd(e.target.value)}
              placeholder={a.deleteAccountPasswordPrompt}
              autoComplete="current-password"
              className={FIELD_CLS}
            />
            {delErr && <p className="text-sm text-destructive">{delErr}</p>}
            <button
              type="button"
              onClick={doDelete}
              disabled={delBusy || !delPwd}
              className="self-start rounded-xl bg-destructive px-4 py-2.5 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {delBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                a.deleteAccountButton
              )}
            </button>
          </div>
        </SettingRow>
      </div>
    </div>
  );
}

/** Что запомнилось + выключатель.
 *
 *  Память попадает в промпт каждый ход и влияет на все ответы, поэтому человек
 *  должен видеть её целиком, уметь стереть строку и уметь ВЫКЛЮЧИТЬ запись
 *  вовсе — разговор, о котором не надо помнить, бывает у любого.
 *
 *  Список плоский: личная память принадлежит ЧЕЛОВЕКУ, а не агенту — она одна
 *  на всех. Группировка по владельцам вернётся вместе с пространствами, у
 *  которых будет свой слой; до тех пор владелец ровно один и заголовок над
 *  единственной группой только мешал бы. */
function MemorySection() {
  const t = useT();
  // Владельцы целиком, а не плоский список: личный слой и слои пространств
  // показываем раздельно (см. MemoryGroups).
  const [owners, setOwners] = React.useState<MemoryOwner[]>([]);
  const [enabled, setEnabled] = React.useState(true);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let alive = true;
    Promise.all([fetchMyMemory(), fetchMemorySettings()])
      .then(([owners, settings]) => {
        if (!alive) return;
        setOwners(owners);
        setEnabled(settings.enabled);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (next: boolean) => {
    // Переключаем сразу, не дожидаясь ответа: тумблер, который «думает»,
    // ощущается сломанным. При отказе возвращаем на место.
    setEnabled(next);
    void setMemoryEnabled(next).then((ok) => !ok && setEnabled(!next));
  };

  const forget = (factId: string) =>
    setOwners((cur) =>
      cur.map((o) => ({ ...o, facts: o.facts.filter((f) => f.id !== factId) })),
    );

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t.settings.loading}</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col divide-y divide-border">
        <Row label={t.settings.memoryEnabled}>
          <Segmented
            layoutId="settings-seg-memory"
            value={enabled ? "on" : "off"}
            options={[
              { id: "on", label: t.settings.memoryOn },
              { id: "off", label: t.settings.memoryOff },
            ]}
            onChange={(v) => toggle(v === "on")}
          />
        </Row>
      </div>

      <p className="text-xs text-muted-foreground">
        {enabled ? t.settings.memoryIntro : t.settings.memoryOffHint}
      </p>

      <MemoryGroups owners={owners} onForget={forget} dimmed={!enabled} />
    </div>
  );
}

/** Юридические документы: ссылки на политику и условия. */
function LegalSection() {
  const t = useT();
  const a = t.settings;
  return (
    <div className="flex flex-col divide-y divide-border">
      <Row label={a.legalPrivacy}>
        <Link
          href="/privacy"
          target="_blank"
          className="text-sm font-medium text-primary hover:underline"
        >
          {a.legalOpen}
        </Link>
      </Row>
      <Row label={a.legalTerms}>
        <Link
          href="/terms"
          target="_blank"
          className="text-sm font-medium text-primary hover:underline"
        >
          {a.legalOpen}
        </Link>
      </Row>
    </div>
  );
}

/** Полноэкранное окно настроек: бэкдроп блюрит ВСЁ (портал в body), слева
 *  разделы, справа контент. */
export function SettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [section, setSection] = React.useState<Section>("general");
  const [mounted, setMounted] = React.useState(false);

  const sections: { id: Section; label: string; icon: typeof Gauge }[] = [
    { id: "general", label: t.settings.general, icon: SlidersHorizontal },
    { id: "memory", label: t.settings.memory, icon: Brain },
    { id: "account", label: t.settings.account, icon: UserIcon },
    { id: "usage", label: t.settings.usage, icon: Gauge },
    { id: "legal", label: t.settings.legal, icon: FileText },
  ];

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-4">
          {/* Бэкдроп — блюрит весь экран, включая инпут чата (портал в body) */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-md"
            onClick={onClose}
            aria-hidden
          />
          {/* Окно */}
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            // Уменьшаем весь текст диалога на ступень — тот же приём, что в
            // сайдбаре: переопределяем токен --text-sm (Tailwind v4 берёт из него
            // размер text-sm) в скоупе окна. Так настройки совпадают по кеглю с
            // сайдбаром, а не с чатом, без правки text-sm в каждом элементе.
            style={{ "--text-sm": "0.8125rem" } as React.CSSProperties}
            className="relative z-10 flex h-[100dvh] w-full flex-col overflow-hidden border-border bg-card text-card-foreground shadow-2xl sm:h-[70vh] sm:w-[70vw] sm:max-w-5xl sm:flex-row sm:rounded-2xl sm:border"
          >
            {/* Разделы: на десктопе — левый вертикальный сайдбар; на мобиле —
                горизонтальный ряд табов сверху (скролл по X, если не влезают).
                Верхний safe-area inset — чтобы шапка не лезла под «чёлку». */}
            <aside
              className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/30 p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-48 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r"
              style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
            >
              <h2 className="hidden px-2 py-2 text-sm font-semibold sm:block">
                {t.settings.title}
              </h2>
              {sections.map((s) => {
                const Icon = s.icon;
                const active = section === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSection(s.id)}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors sm:shrink",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                    {s.label}
                  </button>
                );
              })}
            </aside>

            {/* Контент. Нижний safe-area inset — чтобы контент/кнопки не упирались
                в home-индикатор на мобиле (полноэкран). */}
            <div
              className="relative min-h-0 flex-1 overflow-y-auto p-6"
              style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
            >
              <button
                type="button"
                onClick={onClose}
                aria-label={t.settings.close}
                className="absolute right-4 top-4 z-10 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
              <h3 className="mb-4 text-sm font-semibold">
                {sections.find((s) => s.id === section)?.label}
              </h3>
              {section === "general" && <GeneralSection />}
              {section === "memory" && <MemorySection />}
              {section === "account" && <AccountSection onClose={onClose} />}
              {section === "usage" && <UsageSection />}
              {section === "legal" && <LegalSection />}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
