"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
  Unplug,
  X,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/i18n/i18n-context";
import { connectorTitle, generalConfirm, toolLabel, toolShortName } from "@/lib/connector-labels";

// Кнопки — те же, что в формах агентов и пространств (px-4 py-2 text-sm), а не
// <Button size="sm">: его h-7 и 0.8rem рядом с полями ввода выглядят игрушечно.
/** Остаток времени кода устройства: «4:05». */
function formatLeft(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50";
const BTN_OUTLINE =
  "inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50";
const BTN_GHOST =
  "rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50";
const BTN_DANGER =
  "inline-flex items-center gap-1.5 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50";
import {
  addConnectorResource,
  addCustomConnector,
  connectConnector,
  connectorSummary,
  deleteConnector,
  fetchConnectorResources,
  fetchConnectorTools,
  fetchConnectors,
  removeConnectorResource,
  saveConnectorSettings,
  startConnectorOAuth,
  type ConnectorCardInfo,
  type ConnectorInfo,
  type ConnectorResource,
  type ConnectorSettings,
  type ConnectorTool,
  fetchDeviceState,
  type DeviceCode,
} from "@/lib/api";

/** Раздел «Коннекторы»: каталог сервисов + свои серверы, состояние каждого.
 *
 *  Ни одного имени сервиса здесь нет: каталог приходит с бэкенда
 *  (connectors/*.yaml), панель только рисует карточки и ведёт подключение.
 *  Окно подключения (ConnectDialog) общее с карточкой в ленте чата: агент
 *  просит подключить сервис — открывается то же окно.
 *
 *  КАРТОЧКИ КАК У НАВЫКОВ: название, описание, чипы состояния, без
 *  декоративной иконки. У сервиса из каталога — его логотип (монохромный,
 *  под тему), у своего сервера — ничего: одинаковая картинка на всех
 *  карточках ничего не сообщает.
 */

// ── Логотип ──────────────────────────────────────────────────────────────────

/** Логотип через CSS-маску: цвет берётся из темы, а не из бренда — как и всё
 *  остальное в интерфейсе, где цвет остался только у состояний. */
export function ConnectorLogo({ src, className }: { src: string | null | undefined; className?: string }) {
  if (!src) return null;
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 bg-foreground", className)}
      style={{
        maskImage: `url(${src})`,
        WebkitMaskImage: `url(${src})`,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}

// ── Панель ───────────────────────────────────────────────────────────────────

export function ConnectorsPanel({
  items,
  sections,
  onChanged,
  customOpen,
  onCustomOpenChange,
}: {
  /** Весь список — окно держит по нему свежую запись выбранного. */
  items: ConnectorInfo[];
  /** Что показать: разделы после поиска и фильтров экрана. Заголовок только у
   *  своих серверов, у каталога его нет — как у встроенных навыков. */
  sections: Array<{ title: string | null; items: ConnectorInfo[] }>;
  onChanged: () => void;
  /** Окно «Свой сервер» открывает кнопка в шапке раздела — там же, где
   *  «Создать» у агентов и навыков, поэтому состояние живёт у экрана. */
  customOpen: boolean;
  onCustomOpenChange: (open: boolean) => void;
}) {
  const [selected, setSelected] = React.useState<ConnectorInfo | null>(null);

  // Окно держит СВЕЖУЮ запись: после подключения список перечитан, и
  // выбранный коннектор должен показать «подключено», а не старое состояние.
  const current = selected ? items.find((i) => i.id === selected.id) ?? selected : null;

  return (
    <>
      <div className="flex flex-col gap-6">
        {sections.map((sec) =>
          sec.items.length === 0 ? null : (
            <div key={sec.title ?? "catalog"} className="flex flex-col gap-2">
              {sec.title && (
                <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {sec.title}
                </h2>
              )}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {sec.items.map((it) => (
                  <ConnectorTile key={it.id} item={it} onOpen={() => setSelected(it)} />
                ))}
              </div>
            </div>
          ),
        )}
      </div>

      {current && (
        <ConnectDialog open connector={current} onClose={() => setSelected(null)} onChanged={onChanged} />
      )}
      <CustomDialog open={customOpen} onClose={() => onCustomOpenChange(false)} onChanged={onChanged} />
    </>
  );
}

function ConnectorTile({ item, onOpen }: { item: ConnectorInfo; onOpen: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const c = t.connectors;
  const unavailable = item.missing_env.length > 0 && !item.auth.includes("token");
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full cursor-pointer flex-col gap-2 rounded-xl border border-border/60 bg-muted/20 p-3 text-left transition-colors hover:bg-accent/40"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <ConnectorLogo src={item.logo} className="size-4" />
          <span className="truncate text-sm font-medium text-foreground">{connectorTitle(item, locale)}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {item.custom ? connectorSummary(item, locale) || item.url || c.noSummary : connectorSummary(item, locale)}
        </p>
        {item.error && <p className="mt-0.5 line-clamp-2 text-xs text-destructive">{item.error}</p>}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-1">
        <StatusChip item={item} />
        {unavailable && <Chip>{c.unavailableShort}</Chip>}
        {item.custom && <Chip>{c.customChip}</Chip>}
      </div>
    </button>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
      {children}
    </span>
  );
}

function StatusChip({ item }: { item: Pick<ConnectorInfo, "connected" | "status"> }) {
  const c = useT().connectors;
  if (item.connected) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] leading-none text-emerald-700 dark:text-emerald-400">
        <Check className="size-3" />
        {c.connected}
      </span>
    );
  }
  if (item.status === "reauth" || item.status === "pending") {
    return (
      <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] leading-none text-amber-700 dark:text-amber-400">
        {item.status === "reauth" ? c.needsReauth : c.pending}
      </span>
    );
  }
  return <Chip>{c.notConnected}</Chip>;
}

// ── Окно подключения ─────────────────────────────────────────────────────────

/** Имя тулы без префикса `mcp__<коннектор>__` — человеку нужен её смысл. */
/** Окно одного коннектора: слева — что это и как подключить, справа —
 *  инструменты, которые получит агент. Той же ширины, что просмотр навыка.
 *
 *  ДВА ХОЗЯИНА: раздел «Коннекторы» и карточка в ленте чата (агент попросил).
 *  Поэтому принимает и полную запись, и урезанную из карточки: у второй нет
 *  состояния — считаем «не подключено».
 *
 *  OAuth-ВХОД — во всплывающем окне. Открываем его СИНХРОННО по клику (иначе
 *  блокировщик всплывающих окон съест окно, открытое после ответа сервера), а
 *  адрес подставляем, когда он придёт. Завершение ловим двумя способами:
 *  postMessage со страницы коллбэка (обычный браузер) и опросом списка
 *  (десктоп открывает вход во внешнем браузере, у него нет opener).
 */
export function ConnectDialog({
  open,
  connector,
  onClose,
  onChanged,
  onConnected,
}: {
  open: boolean;
  connector: ConnectorInfo | ConnectorCardInfo;
  onClose: () => void;
  onChanged?: () => void;
  /** Подключение состоялось (любым способом) — для карточки в ленте. */
  onConnected?: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const c = t.connectors;
  const info: ConnectorInfo = {
    url: null,
    connected: false,
    status: null,
    connected_with: null,
    updated_at: null,
    ...connector,
  } as ConnectorInfo;

  const [token, setToken] = React.useState("");
  const [busy, setBusy] = React.useState<"" | "token" | "oauth" | "off">("");
  const [error, setError] = React.useState("");
  // Инструменты: undefined — ещё не запрашивали, null — сервер не ответил.
  const [tools, setTools] = React.useState<ConnectorTool[] | null | undefined>(undefined);
  const [justConnected, setJustConnected] = React.useState(false);
  const waitingRef = React.useRef<number | null>(null);
  // Вход кодом устройства: код на экране, человек вводит его на странице
  // сервиса, сервер сам забирает токен. deadline — когда код перестанет
  // действовать; now тикает раз в секунду ради обратного отсчёта.
  const [device, setDevice] = React.useState<(DeviceCode & { deadline: number; expired: boolean }) | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!device || device.expired) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [device]);

  const canOAuth = info.auth.includes("oauth") && info.missing_env.length === 0;
  const canToken = info.auth.includes("token");
  const canNone = info.auth.includes("none");
  // Вход формой (`auth: form`): поля описаны в каталоге, рисуем по ним.
  const formFields = info.fields ?? [];
  const canForm = info.auth.includes("form") && formFields.length > 0;
  const [formValues, setFormValues] = React.useState<Record<string, string | boolean>>({});
  const formReady = formFields.every((f) => {
    const v = formValues[f.name];
    return !f.required || (typeof v === "string" && v.trim() !== "");
  });
  const connected = info.connected || justConnected;
  const unavailable = info.missing_env.length > 0 && !canToken && !canNone && !canForm;
  const guide = info.guide?.[locale] ?? info.guide?.en ?? [];
  // Общие настройки подтверждений — сразу на сервер, без кнопки «сохранить»:
  // галочка и есть решение.
  const [settings, setSettings] = React.useState<ConnectorSettings | null>(info.settings ?? null);
  const [settingsBusy, setSettingsBusy] = React.useState(false);
  const confirmed = generalConfirm({ settings, confirm_default: info.confirm_default });
  const saveSettings = async (next: ConnectorSettings | null) => {
    setSettingsBusy(true);
    setError("");
    const res = await saveConnectorSettings(info.id, next);
    setSettingsBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSettings(res.connector.settings ?? null);
    onChanged?.();
  };
  // Список объектов подключения — только у подключённого: до входа его не
  // у кого спросить. Открывается первым: за ним в карточку и приходят.
  const showResources = connected && !!info.resources;
  const [pane, setPane] = React.useState<"resources" | "tools">("resources");
  const activePane = showResources ? pane : "tools";

  const stopWaiting = React.useCallback(() => {
    if (waitingRef.current !== null) {
      window.clearInterval(waitingRef.current);
      waitingRef.current = null;
    }
  }, []);
  React.useEffect(() => stopWaiting, [stopWaiting]);

  // Подключённый коннектор показывает инструменты сразу — за ними и открывают
  // окно. Список приходит с сервера сервиса, поэтому запрос идёт по факту
  // открытия, а не вместе со списком коннекторов.
  const wantTools = open && connected && tools === undefined;
  React.useEffect(() => {
    if (!wantTools) return;
    let alive = true;
    fetchConnectorTools(info.id).then((loaded) => {
      if (alive) setTools(loaded);
    });
    return () => {
      alive = false;
    };
  }, [wantTools, info.id]);

  const finish = React.useCallback(
    (loaded?: ConnectorTool[]) => {
      stopWaiting();
      setBusy("");
      setJustConnected(true);
      setTools(loaded ?? undefined);
      onChanged?.();
      onConnected?.();
    },
    // Сеттеры в списке — для React Compiler: он выводит их как зависимости
    // и без них отказывается сохранять ручную мемоизацию.
    [onChanged, onConnected, stopWaiting, setBusy, setJustConnected, setTools],
  );

  // Страница коллбэка сообщает окну-родителю, что вход завершён.
  React.useEffect(() => {
    if (!open) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; id?: string; ok?: boolean } | null;
      if (!d || d.type !== "avy-connector" || d.id !== info.id) return;
      if (d.ok) finish();
      else {
        stopWaiting();
        setBusy("");
        setError(c.oauthFailed);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [open, info.id, finish, stopWaiting, c.oauthFailed]);

  const openExternal = (url: string) => {
    const external = typeof window !== "undefined" ? window.avyDesktop?.openExternal : undefined;
    if (external) void external(url);
    else window.open(url, "_blank", "noopener");
  };

  const signInWithCode = async () => {
    setError("");
    setBusy("oauth");
    setCopied(false);
    const res = await startConnectorOAuth(info.id);
    if (!res.ok || !res.device) {
      setBusy("");
      setError(res.ok ? c.oauthFailed : res.error);
      return;
    }
    beginDevice(res.device);
  };

  const beginDevice = (code: DeviceCode) => {
    setDevice({ ...code, deadline: Date.now() + code.expiresIn * 1000, expired: false });
    stopWaiting();
    waitingRef.current = window.setInterval(async () => {
      const st = await fetchDeviceState(info.id);
      if (st.state === "connected") {
        setDevice(null);
        finish();
      } else if (st.state === "failed") {
        stopWaiting();
        setDevice(null);
        setBusy("");
        setError(c.deviceFailed(st.error || c.oauthFailed));
      } else if (st.state === "expired" || st.state === "none") {
        stopWaiting();
        setBusy("");
        setDevice((d) => (d ? { ...d, expired: true } : d));
      }
    }, 3000);
  };

  const copyCode = async () => {
    if (!device) return;
    try {
      await navigator.clipboard.writeText(device.userCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const signIn = async () => {
    if (info.sign_in === "device") return signInWithCode();
    setError("");
    setBusy("oauth");
    // В приложении вход — в браузере по умолчанию: там человек уже вошёл в
    // свой Google и только подтверждает доступ; окно Electron — чистый лист
    // без сессий. Сообщения от страницы коллбэка оттуда не придёт (другой
    // браузер), завершение ловит опрос списка ниже — поток входа сервер
    // находит по state, окно для этого не нужно.
    const external = typeof window !== "undefined" ? window.avyDesktop?.openExternal : undefined;
    // В браузере окно открываем СИНХРОННО по клику, до запроса ссылки: после
    // await блокировщик попапов его уже не пропустит.
    // Оболочка, собранная до коннекторов (моста openExternal в ней нет), пустое
    // окно не открывает: любой window.open она сама уводит в браузер по
    // умолчанию, и заготовка дала бы там лишнюю пустую вкладку. Блокировщика
    // попапов в оболочке нет — ссылку откроем ниже, когда она придёт.
    const inShell = typeof window !== "undefined" && !!window.avyDesktop;
    const popup = external || inShell
      ? null
      : window.open("", "avy-connector", "width=560,height=720,menubar=no,toolbar=no");
    const res = await startConnectorOAuth(info.id);
    if (!res.ok) {
      popup?.close();
      setBusy("");
      setError(res.error);
      return;
    }
    if (res.device) {
      // Сервер ответил кодом устройства (вход без адреса возврата): окно
      // сервиса не нужно — код показываем здесь.
      popup?.close();
      beginDevice(res.device);
      return;
    }
    if (external) void external(res.url);
    else if (popup) popup.location.href = res.url;
    else window.open(res.url, "_blank");
    stopWaiting();
    waitingRef.current = window.setInterval(async () => {
      const list = await fetchConnectors();
      const me = list.find((i) => i.id === info.id);
      if (me?.connected) finish();
    }, 2000);
  };

  const connectWithToken = async () => {
    setError("");
    setBusy("token");
    const res = await connectConnector(info.id, canToken ? token.trim() : undefined);
    if (!res.ok) {
      setBusy("");
      setError(res.error);
      return;
    }
    setToken("");
    finish(res.tools);
  };

  const connectWithForm = async () => {
    setError("");
    setBusy("token");
    const values: Record<string, string | boolean> = {};
    for (const f of formFields) {
      const v = formValues[f.name];
      values[f.name] = f.type === "checkbox" ? v === true : typeof v === "string" ? v.trim() : "";
    }
    const res = await connectConnector(info.id, undefined, values);
    if (!res.ok) {
      setBusy("");
      setError(res.error);
      return;
    }
    // Пароль в памяти страницы не держим: подключились — форма чистая.
    setFormValues({});
    finish(res.tools);
  };

  const disconnect = async () => {
    setBusy("off");
    await deleteConnector(info.id);
    setBusy("");
    setJustConnected(false);
    setTools(undefined);
    onChanged?.();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <div className="flex min-w-0 items-center gap-2.5">
          <ConnectorLogo src={info.logo} className="size-5" />
          <h2 className="min-w-0 truncate text-lg font-semibold">{connectorTitle(info, locale)}</h2>
        </div>
      }
      // Высота фиксированная, как у просмотра навыка: окно не прыгает между
      // «не подключено» и списком инструментов.
      className="flex h-[80dvh] w-full max-w-5xl flex-col max-md:h-[calc(100dvh-2rem)] max-md:p-4"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* На телефоне колонки друг под другом и прокручивается всё окно. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto md:flex-row md:overflow-visible">
          {/* Слева: что это, состояние, как подключить. */}
          <div className="flex shrink-0 flex-col gap-4 md:w-80 md:overflow-y-auto md:pr-1">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {info.custom ? connectorSummary(info, locale) || info.url || c.noSummary : connectorSummary(info, locale)}
              {info.site && (
                <>
                  {" "}
                  <a
                    href={info.site}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground"
                  >
                    {c.site}
                    <ExternalLink className="size-3" />
                  </a>
                </>
              )}
            </p>

            <div className="flex items-center gap-2 text-xs">
              <StatusChip item={{ connected, status: info.status }} />
              {connected && info.updated_at && (
                <span className="text-muted-foreground">{formatUpdated(info.updated_at, locale)}</span>
              )}
            </div>

            {unavailable && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                {c.unavailable(info.missing_env.join(", "))}
              </p>
            )}

            {info.custom && info.error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {info.error}
              </p>
            )}
            {info.custom && info.file && (
              <p className="text-xs text-muted-foreground">
                {c.customFile}: <code className="font-mono">{info.file}</code>
              </p>
            )}

            {guide.length > 0 && <ConnectGuide steps={guide} title={c.guideTitle} open={!connected} />}

            {!connected && !unavailable && (
              <div className="flex flex-col gap-4">
                {canOAuth && device && (
                  <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4">
                    <p className="text-sm text-muted-foreground">{c.deviceStep(device.verificationUrl.replace(/^https?:\/\//, ""))}</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className="select-all rounded-lg border border-border bg-background px-4 py-2 font-mono text-2xl font-semibold tracking-[0.18em]"
                        aria-label={device.userCode}
                      >
                        {device.userCode}
                      </span>
                      <button type="button" onClick={copyCode} className={BTN_OUTLINE}>
                        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                        {copied ? c.deviceCopied : c.deviceCopy}
                      </button>
                    </div>
                    {device.expired ? (
                      <div className="flex flex-col gap-2">
                        <span className="text-xs text-muted-foreground">{c.deviceExpired}</span>
                        <button type="button" disabled={busy !== ""} onClick={signInWithCode} className={cn(BTN_PRIMARY, "self-start")}>
                          <LogIn className="size-4" />
                          {c.deviceRetry}
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <button type="button" onClick={() => openExternal(device.verificationUrl)} className={cn(BTN_PRIMARY, "self-start")}>
                          <ExternalLink className="size-4" />
                          {c.deviceOpen}
                        </button>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" />
                          {c.deviceWaiting(formatLeft(Math.max(0, device.deadline - now)))}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {canOAuth && !device && (
                  <div className="flex flex-col gap-1.5">
                    <button type="button" disabled={busy !== ""} onClick={signIn} className={cn(BTN_PRIMARY, "self-start")}>
                      {busy === "oauth" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <LogIn className="size-4" />
                      )}
                      {busy === "oauth" ? c.waiting : c.signIn(connectorTitle(info, locale))}
                    </button>
                    <span className="text-[11px] leading-snug text-muted-foreground">{c.signInHint}</span>
                  </div>
                )}

                {canOAuth && canToken && (
                  <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    {c.or}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                )}

                {canToken && (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (busy === "" && token.trim()) void connectWithToken();
                    }}
                  >
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-foreground">{c.tokenLabel}</span>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        placeholder={c.tokenPlaceholder}
                        value={token}
                        disabled={busy !== ""}
                        onChange={(e) => setToken(e.target.value)}
                      />
                      {info.token_hint && (
                        <span className="text-[11px] leading-snug text-muted-foreground">{info.token_hint}</span>
                      )}
                    </label>
                    <button
                      type="submit"
                      disabled={busy !== "" || !token.trim()}
                      className={cn(canOAuth ? BTN_OUTLINE : BTN_PRIMARY, "self-start")}
                    >
                      {busy === "token" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <KeyRound className="size-4" />
                      )}
                      {c.connectWithToken}
                    </button>
                  </form>
                )}

                {canForm && (
                  <form
                    className="flex flex-col gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (busy === "" && formReady) void connectWithForm();
                    }}
                  >
                    {formFields.map((f) => {
                      const label = f.label[locale] ?? f.label.en ?? f.name;
                      const hint = f.hint[locale] ?? f.hint.en ?? "";
                      if (f.type === "checkbox") {
                        return (
                          <label key={f.name} className="flex cursor-pointer items-start gap-2">
                            <input
                              type="checkbox"
                              className="mt-0.5 size-4 shrink-0 accent-foreground"
                              checked={formValues[f.name] === true}
                              disabled={busy !== ""}
                              onChange={(e) => setFormValues((v) => ({ ...v, [f.name]: e.target.checked }))}
                            />
                            <span className="flex flex-col gap-0.5">
                              <span className="text-xs font-medium text-foreground">{label}</span>
                              {hint && <span className="text-[11px] leading-snug text-muted-foreground">{hint}</span>}
                            </span>
                          </label>
                        );
                      }
                      return (
                        <label key={f.name} className="flex flex-col gap-1.5">
                          <span className="text-xs font-medium text-foreground">{label}</span>
                          <Input
                            type={f.type === "password" ? "password" : f.type === "email" ? "email" : "text"}
                            autoComplete={f.type === "password" ? "new-password" : "off"}
                            placeholder={f.placeholder}
                            value={typeof formValues[f.name] === "string" ? (formValues[f.name] as string) : ""}
                            disabled={busy !== ""}
                            onChange={(e) => setFormValues((v) => ({ ...v, [f.name]: e.target.value }))}
                          />
                          {hint && <span className="text-[11px] leading-snug text-muted-foreground">{hint}</span>}
                        </label>
                      );
                    })}
                    <button type="submit" disabled={busy !== "" || !formReady} className={cn(BTN_PRIMARY, "self-start")}>
                      {busy === "token" ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
                      {c.connect}
                    </button>
                  </form>
                )}

                {!canOAuth && !canToken && !canForm && canNone && (
                  <button type="button" disabled={busy !== ""} onClick={connectWithToken} className={cn(BTN_PRIMARY, "self-start")}>
                    {busy === "token" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plug className="size-4" />
                    )}
                    {c.connect}
                  </button>
                )}
              </div>
            )}

            {error && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            <p className="mt-auto flex items-start gap-2 pt-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              <span>{c.privacy}</span>
            </p>
          </div>

          {/* Справа: объекты подключения (если есть) и инструменты. */}
          <div className="flex min-h-[50dvh] min-w-0 flex-1 flex-col gap-2 md:min-h-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
              {showResources ? (
                <div role="tablist" className="flex items-center gap-1">
                  {(["resources", "tools"] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={pane === key}
                      onClick={() => setPane(key)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-sm transition-colors",
                        pane === key
                          ? "bg-accent font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {key === "resources" ? label(info.resources?.title, locale, c.toolsTitle) : c.toolsTitle}
                      {key === "tools" && tools && tools.length > 0 && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">{tools.length}</span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-sm font-medium text-foreground">
                  {c.toolsTitle}
                  {tools && tools.length > 0 && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">{tools.length}</span>
                  )}
                </span>
              )}
              {activePane === "tools" && <span className="text-[11px] text-muted-foreground">{c.toolsHint}</span>}
            </div>
            {activePane === "resources" ? (
              <ResourcesPane info={info} />
            ) : (
            <>
            {connected && tools && tools.length > 0 && (
              <ConfirmSettings settings={settings} onSave={saveSettings} busy={settingsBusy} />
            )}
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/60">
              {!connected ? (
                <p className="p-4 text-sm text-muted-foreground">{c.toolsBeforeConnect}</p>
              ) : tools === undefined ? (
                <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {c.toolsLoading}
                </p>
              ) : tools === null ? (
                <p className="p-4 text-sm text-muted-foreground">{c.toolsFailed}</p>
              ) : tools.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">{c.toolsEmpty}</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {tools.map((tool) => {
                    const short = toolShortName(tool.name);
                    const on = confirmed.includes(short);
                    return (
                      <li key={tool.name} className="flex items-start gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-sm font-medium text-foreground">{toolLabel(info, short, locale)}</span>
                            <span className="font-mono text-[11px] text-muted-foreground">{short}</span>
                          </div>
                          {tool.description && (
                            <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                              {tool.description}
                            </p>
                          )}
                        </div>
                        <label
                          className={cn(
                            "flex shrink-0 items-center gap-1.5 pt-0.5 text-xs",
                            settings?.autoApprove ? "text-muted-foreground/60" : "text-muted-foreground",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={settingsBusy || !!settings?.autoApprove}
                            onChange={() =>
                              void saveSettings({
                                confirm: on ? confirmed.filter((x) => x !== short) : [...confirmed, short],
                                autoApprove: false,
                              })
                            }
                            className="size-4 accent-primary"
                          />
                          {c.confirmColumn}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border/60 pt-3">
          {(connected || info.status === "reauth" || info.status === "pending") && (
            <button type="button" disabled={busy !== ""} onClick={disconnect} className={BTN_DANGER}>
              <Unplug className="size-4" />
              {c.disconnect}
            </button>
          )}
          <div className="ml-auto">
            <button type="button" onClick={onClose} className={BTN_GHOST}>
              {c.close}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Над списком инструментов: «всё без подтверждения» и «по умолчанию». */
function ConfirmSettings({
  settings,
  onSave,
  busy,
}: {
  settings: ConnectorSettings | null;
  onSave: (s: ConnectorSettings | null) => void;
  busy: boolean;
}) {
  const t = useT();
  const c = t.connectors;
  const auto = !!settings?.autoApprove;
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={auto}
            disabled={busy}
            onChange={() => onSave(auto ? { confirm: settings?.confirm ?? null, autoApprove: false } : {
              confirm: settings?.confirm ?? null,
              autoApprove: true,
            })}
            className="size-4 accent-primary"
          />
          {c.autoApprove}
        </label>
        {settings && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave(null)}
            className="ml-auto rounded-lg px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {c.resetDefaults}
          </button>
        )}
        {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      </div>
      <span className="text-[11px] leading-snug text-muted-foreground">
        {auto ? c.autoApproveHint : c.confirmHint}
      </span>
    </div>
  );
}

/** Подпись из YAML коннектора на языке интерфейса (запасной — английский). */
function label(map: Record<string, string> | undefined, locale: string, fallback: string): string {
  return map?.[locale] || map?.en || fallback;
}

/** Шаги «как подключить» из YAML коннектора. До подключения — раскрыты (без
 *  них не подключиться), после — свёрнуты: нужны, когда добавляешь бота в
 *  новую группу. */
function ConnectGuide({ steps, title, open }: { steps: string[]; title: string; open: boolean }) {
  return (
    <details open={open} className="group rounded-xl border border-border/60 px-4 py-3">
      <summary className="cursor-pointer select-none text-sm font-medium text-foreground marker:text-muted-foreground">
        {title}
      </summary>
      <ol className="mt-2.5 flex list-decimal flex-col gap-2 pl-5 text-xs leading-relaxed text-muted-foreground">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </details>
  );
}

/** Список объектов подключения (чаты бота Telegram и т.п.): что это за
 *  объекты и как их добавлять, знает бэкенд коннектора — здесь только
 *  список, «Обновить», поле добавления и «убрать из списка». */
function ResourcesPane({ info }: { info: ConnectorInfo }) {
  const t = useT();
  const { locale } = useLocale();
  const c = t.connectors;
  const labels = info.resources ?? {};
  // undefined — грузится; ошибка — отдельно, чтобы не терять прошлый список.
  const [items, setItems] = React.useState<ConnectorResource[] | undefined>(undefined);
  const [busy, setBusy] = React.useState<"" | "load" | "add" | string>("");
  const [error, setError] = React.useState("");
  const [value, setValue] = React.useState("");

  const apply = React.useCallback(
    (res: Awaited<ReturnType<typeof fetchConnectorResources>>) => {
      if (res.ok) setItems(res.items);
      else {
        setError(res.error);
        setItems((prev) => prev ?? []);
      }
    },
    [setItems, setError],
  );

  // Первая загрузка — при открытии (тот же приём, что у списка инструментов:
  // состояние меняется только в ответе, не в теле эффекта).
  React.useEffect(() => {
    let alive = true;
    fetchConnectorResources(info.id, locale).then((res) => {
      if (alive) apply(res);
    });
    return () => {
      alive = false;
    };
  }, [info.id, locale, apply]);

  const load = async () => {
    setBusy("load");
    setError("");
    const res = await fetchConnectorResources(info.id, locale);
    setBusy("");
    apply(res);
  };

  const add = async () => {
    const v = value.trim();
    if (!v) return;
    setBusy("add");
    setError("");
    const res = await addConnectorResource(info.id, locale, v);
    setBusy("");
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setValue("");
    setItems((prev) => [res.item, ...(prev ?? []).filter((i) => i.id !== res.item.id)]);
  };

  const remove = async (rid: string) => {
    setBusy(rid);
    const ok = await removeConnectorResource(info.id, locale, rid);
    setBusy("");
    if (ok) setItems((prev) => (prev ?? []).filter((i) => i.id !== rid));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy === "") void add();
          }}
        >
          <Input
            value={value}
            placeholder={label(labels.add, locale, "")}
            disabled={busy !== ""}
            onChange={(e) => setValue(e.target.value)}
            className="min-w-0 flex-1"
          />
          <button type="submit" disabled={busy !== "" || !value.trim()} className={BTN_OUTLINE}>
            {busy === "add" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {c.resourcesAdd}
          </button>
        </form>
        <button type="button" disabled={busy !== ""} onClick={() => void load()} className={BTN_OUTLINE}>
          <RefreshCw className={cn("size-4", busy === "load" && "animate-spin")} />
          <span className="max-sm:sr-only">{c.resourcesRefresh}</span>
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/60">
        {items === undefined ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {c.resourcesLoading}
          </p>
        ) : items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{label(labels.empty, locale, c.resourcesEmpty)}</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
                  {item.subtitle && <div className="text-xs text-muted-foreground">{item.subtitle}</div>}
                  {item.warning && (
                    <div className="mt-1 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <span>{item.warning}</span>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy !== ""}
                  onClick={() => void remove(item.id)}
                  title={c.resourcesRemove}
                  aria-label={`${c.resourcesRemove}: ${item.title}`}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  {busy === item.id ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatUpdated(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Свой сервер ──────────────────────────────────────────────────────────────

function CustomDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const c = t.connectors;
  const [title, setTitle] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [auth, setAuth] = React.useState<"oauth" | "token" | "none">("token");
  const [token, setToken] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [created, setCreated] = React.useState<ConnectorInfo | null>(null);

  const reset = () => {
    setTitle("");
    setUrl("");
    setAuth("token");
    setToken("");
    setError("");
    setCreated(null);
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    const res = await addCustomConnector({ title: title.trim(), url: url.trim(), auth, token: token || undefined });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChanged();
    if (auth === "oauth") {
      // Дальше — обычное окно подключения с кнопкой входа.
      setCreated(res.connector);
      return;
    }
    reset();
    onClose();
  };

  if (created) {
    return (
      <ConnectDialog
        open={open}
        connector={created}
        onClose={() => {
          reset();
          onClose();
        }}
        onChanged={onChanged}
      />
    );
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title={c.customTitle} className="max-w-lg">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void submit();
        }}
      >
        <p className="text-sm text-muted-foreground">{c.customIntro}</p>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground">{c.nameLabel}</span>
          <Input value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} placeholder={c.namePlaceholder} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground">{c.urlLabel}</span>
          <Input value={url} disabled={busy} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/mcp" />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground">{c.authLabel}</span>
          <div className="inline-flex gap-0.5 self-start rounded-lg bg-muted/60 p-0.5">
            {([
              ["token", c.authToken],
              ["oauth", c.authOAuth],
              ["none", c.authNone],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setAuth(key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  auth === key ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {auth === "token" && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">{c.tokenLabel}</span>
            <Input type="password" autoComplete="new-password" value={token} disabled={busy} onChange={(e) => setToken(e.target.value)} />
          </label>
        )}
        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => { reset(); onClose(); }} className={BTN_GHOST}>
            {c.cancel}
          </button>
          <button
            type="submit"
            disabled={busy || !title.trim() || !url.trim() || (auth === "token" && !token)}
            className={BTN_PRIMARY}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
            {auth === "oauth" ? c.continueToSignIn : c.connect}
          </button>
        </div>
      </form>
    </Modal>
  );
}
