"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  Brain,
  Download,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import {
  changeName,
  fetchMemorySettings,
  fetchMyMemory,
  setMemoryEnabled,
  type MemoryOwner,
} from "@/lib/api";
import { MemoryGroups } from "@/components/memory-list";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/components/auth/auth-provider";
import { desktopBridge, type UpdateCheck } from "@/hooks/use-is-desktop";
import { useLocale, useT } from "@/i18n/i18n-context";
import type { Locale } from "@/lib/locale";

// Два раздела. Аккаунт, пароли, потребление и документы убраны: установка
// на одного человека на его машине — сменить пароль или удалить аккаунт
// негде и незачем, кредитов нет, а юридические документы относятся к
// облачному сервису.
type Section = "general" | "memory";

const FIELD_CLS =
  "rounded-xl border border-border bg-foreground/5 px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary/60 focus:bg-primary/5 focus:outline-none";

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

/** Имя — единственное, что осталось от «аккаунта»: оно показывается в
 *  сайдбаре и уходит агенту как обращение. Меняется по месту, без формы. */
function NameRow() {
  const t = useT();
  const { user, setUser } = useAuth();
  const [name, setName] = React.useState(user?.name ?? "");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const dirty = name.trim() !== "" && name.trim() !== (user?.name ?? "");

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    setDone(false);
    try {
      const updated = await changeName(name.trim());
      setUser(updated);
      setDone(true);
    } catch {
      /* имя не критично — поле остаётся с введённым, можно повторить */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row label={t.settings.nameLabel}>
      <span className="flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDone(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className={cn(FIELD_CLS, "w-44 sm:w-56")}
          maxLength={120}
        />
        <button
          type="button"
          onClick={save}
          disabled={!dirty || busy}
          className="shrink-0 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : done ? (
            t.settings.saved
          ) : (
            t.settings.save
          )}
        </button>
      </span>
    </Row>
  );
}

/** Обновления. Работают ТОЛЬКО внутри приложения: заменить контейнеры может
 *  лишь процесс окна (desktop/src/main.js) — бэкенд живёт в них сам.
 *  Сервер не опрашивается сам по себе: проверка по кнопке, установка по
 *  кнопке. Во время установки окно уходит в свои экраны хода, а эта страница
 *  выгружается вместе со старым стеком — поэтому здесь нет прогресса. */
function UpdatesBlock() {
  const t = useT();
  const a = t.settings;
  const bridge = desktopBridge();
  const [current, setCurrent] = React.useState<string>("");
  const [check, setCheck] = React.useState<UpdateCheck | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [installing, setInstalling] = React.useState(false);

  React.useEffect(() => {
    if (!bridge) return;
    let alive = true;
    bridge.updates.current().then((v) => alive && setCurrent(v || ""));
    return () => {
      alive = false;
    };
  }, [bridge]);

  const doCheck = async () => {
    if (!bridge || checking) return;
    setChecking(true);
    try {
      const res = await bridge.updates.check();
      setCheck(res);
      if (res.current) setCurrent(res.current);
    } catch (e) {
      setCheck({ current, error: (e as Error)?.message || "error" });
    } finally {
      setChecking(false);
    }
  };

  const doInstall = () => {
    if (!bridge || !check?.latest || installing) return;
    setInstalling(true);
    // Дальше окно само: скачает, погасит стек, поставит и вернёт чат.
    void bridge.updates.install(check.latest).catch(() => setInstalling(false));
  };

  if (!bridge) {
    return (
      <div className="flex flex-col divide-y divide-border">
        <Row label={a.updates}>
          <span className="text-sm text-muted-foreground">{a.updatesBrowserHint}</span>
        </Row>
      </div>
    );
  }

  const available = Boolean(check && !check.error && check.available && check.latest);
  let status: React.ReactNode = null;
  if (check?.error) {
    const text =
      check.code === "no_token"
        ? a.updatesNoToken
        : check.code === "unauthorized"
          ? a.updatesUnauthorized
          : a.updatesError;
    status = <span className="text-sm text-destructive">{text}</span>;
  } else if (available) {
    status = (
      <span className="text-sm font-medium text-foreground">
        {a.updatesAvailable(check!.latest!)}
      </span>
    );
  } else if (check) {
    status = <span className="text-sm text-muted-foreground">{a.updatesLatest}</span>;
  }

  return (
    <div className="flex flex-col divide-y divide-border">
      <Row label={a.updatesVersion}>
        <span className="text-sm font-medium tabular-nums">{current || "—"}</span>
      </Row>
      <div className="flex flex-col gap-3 py-3">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">{a.updatesRow}</span>
          {available ? (
            <button
              type="button"
              onClick={doInstall}
              disabled={installing}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {installing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
              {a.updatesInstall}
            </button>
          ) : (
            <button
              type="button"
              onClick={doCheck}
              disabled={checking}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
            >
              {checking ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {checking ? a.updatesChecking : a.updatesCheck}
            </button>
          )}
        </div>
        {status && <div className="flex items-center justify-between gap-4">{status}</div>}
        {available && (
          <p className="text-xs text-muted-foreground">{a.updatesInstallHint}</p>
        )}
        {check?.error && check.code === "network" && (
          <p className="break-all text-xs text-muted-foreground">{check.error}</p>
        )}
      </div>
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
    <div className="flex flex-col gap-6">
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
        <NameRow />
      </div>

      <div>
        <h4 className="mb-1 text-sm font-semibold">{t.settings.updates}</h4>
        <UpdatesBlock />
      </div>
    </div>
  );
}

/** Что запомнилось + выключатель.
 *
 *  Память попадает в промпт каждый ход и влияет на все ответы, поэтому человек
 *  должен видеть её целиком, уметь стереть строку и уметь ВЫКЛЮЧИТЬ запись
 *  вовсе — разговор, о котором не надо помнить, бывает у любого. */
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
          <Switch checked={enabled} onCheckedChange={toggle} aria-label={t.settings.memoryEnabled} />
        </Row>
      </div>

      <p className="text-xs text-muted-foreground">
        {enabled ? t.settings.memoryIntro : t.settings.memoryOffHint}
      </p>

      <MemoryGroups owners={owners} onForget={forget} dimmed={!enabled} />
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
  // Портал в document.body есть только на клиенте: серверный снимок — «не
  // смонтировано», клиентский — «смонтировано», без setState в эффекте.
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const sections: { id: Section; label: string; icon: typeof Brain }[] = [
    { id: "general", label: t.settings.general, icon: SlidersHorizontal },
    { id: "memory", label: t.settings.memory, icon: Brain },
  ];

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
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
