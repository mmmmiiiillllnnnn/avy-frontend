"use client";

// Окно «Конфигурация агента» (Avy Code). Дизайн один в один с SettingsDialog:
// портал в body, блюр-бэкдроп, слева разделы, справа контент. Разделы:
//   1. «Агент» — обзор всего, что подключено к агенту (модель, режим, папки, MCP).
//   2. «MCP»   — форма ручного подключения MCP-сервера + список подключённых.
// Дальше сюда же добавим скиллы и прочее отдельными разделами.

import * as React from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  Bot,
  Blocks,
  Check,
  CheckCircle2,
  ChevronDown,
  Folder,
  Info,
  Loader2,
  Plus,
  Search,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocale } from "@/i18n/i18n-context";
import { getThreadWorkspace } from "@/lib/code/code-api";
import {
  addMcpFromTemplate,
  addMcpServer,
  deleteUserMcpTemplate,
  listMcpServers,
  listUserMcpTemplates,
  removeMcpServer,
  setThreadWorkspace,
  type AddMcpBody,
  type McpServerInfo,
  type McpTemplate,
} from "@/lib/code/code-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ── MCP Presets Library ──────────────────────────────────────────────────────

type McpPreset = {
  id: string;
  name: string;
  description: string;
  command?: string;
  url?: string;
  args?: string[];
};

const SHOW_MCP_LIBRARY = true;

const MCP_PRESETS: McpPreset[] = [
  {
    id: "nextjs",
    name: "Next.js MCP",
    description: "Доступ к ошибкам сборки, type-checking, runtime state и App Router (Next.js 16+)",
    command: "npx",
    args: ["-y", "next-devtools-mcp"],
  },
  {
    id: "shadcn-ui",
    name: "shadcn/ui MCP",
    description: "Официальный сервер shadcn: поиск, установка и код компонентов из реестра",
    command: "npx",
    args: ["-y", "shadcn@latest", "mcp"],
  },
  {
    id: "langchain-docs",
    name: "LangChain docs MCP",
    description: "Документация LangChain и LangGraph (Python) через llms.txt — от команды langchain-ai",
    command: "uvx",
    args: [
      "--from",
      "mcpdoc",
      "mcpdoc",
      "--urls",
      "LangChain:https://docs.langchain.com/llms.txt",
      "LangGraph:https://langchain-ai.github.io/langgraph/llms.txt",
    ],
  },
  {
    id: "context7",
    name: "Context7",
    description: "Актуальная версионированная документация и примеры кода для любой библиотеки",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
  },
];

type Section = "agent" | "mcp";

const FIELD_CLS =
  "w-full rounded-xl border border-border bg-foreground/5 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus:border-primary/60 focus:bg-primary/5 focus:outline-none";

// ── Раздел 1: обзор агента (карточки: workspace · MCP) ────────────────────────

/** Русское склонение по числу (n папок/инструментов). */
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/** Карточка-секция: иконка в тинтованном квадрате + заголовок + опц. счётчик. */
function SectionCard({
  icon: Icon,
  title,
  badge,
  children,
}: {
  icon: typeof Bot;
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <span className="flex-1 text-sm font-semibold text-foreground">{title}</span>
        {badge && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/** Строка MCP-сервера с аккордеоном: клик раскрывает список инструментов,
 *  корзина — ОТКЛЮЧАЕТ сервер от сессии (образа агента), не трогая библиотеку. */
function McpServerRow({
  server,
  en,
  onRemove,
}: {
  server: McpServerInfo;
  en: boolean;
  onRemove: (name: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const tools = server.tools ?? [];
  const count = tools.length;
  const clickable = count > 0;

  const countLabel = clickable
    ? en
      ? `${count} tool${count === 1 ? "" : "s"}`
      : `${count} ${plural(count, "инструмент", "инструмента", "инструментов")}`
    : en
      ? "on next turn"
      : "на след. ходе";

  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-background/40">
      {/* Шапка: ховер подсвечивает всю строку (group), без деления на зоны.
          Кнопка-раскрытие и корзина — сиблинги (не вложенные, валидный HTML). */}
      <div
        className={cn(
          "group flex items-center pr-1.5 transition-colors",
          clickable && "hover:bg-accent/40",
        )}
      >
        <button
          type="button"
          onClick={() => clickable && setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left",
            !clickable && "cursor-default",
          )}
        >
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
              !clickable && "opacity-0",
              open && "rotate-180",
            )}
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {server.name}
          </span>
          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {server.transport === "stdio" ? "stdio" : "http"}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{countLabel}</span>
        </button>
        <button
          type="button"
          onClick={() => onRemove(server.name)}
          aria-label={en ? "Detach from agent" : "Отключить от агента"}
          title={en ? "Detach from agent" : "Отключить от агента"}
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && clickable && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-1.5 border-t border-border/40 bg-muted/20 p-2">
              {tools.map((t) => (
                <div
                  key={t.name}
                  className="flex items-start gap-2 rounded-lg border border-border/40 bg-background/60 px-2.5 py-2"
                >
                  <Wrench className="mt-0.5 size-3 shrink-0 text-primary/70" />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs font-medium text-foreground">{t.name}</div>
                    {t.description && (
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        {t.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AgentSection({
  threadId,
  reloadServers,
}: {
  threadId: string;
  // Синхронизация с вкладкой MCP: после отключения сервера отсюда дёргаем
  // перезагрузку общего списка серверов диалога, чтобы вкладки не разъехались.
  reloadServers?: () => void;
}) {
  const { locale } = useLocale();
  const en = locale === "en";
  const [dirs, setDirs] = React.useState<string[]>([]);
  const [mcpServers, setMcpServers] = React.useState<McpServerInfo[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Отключить папку проекта от треды (не с диска — только из образа агента).
  const removeFolder = async (dir: string) => {
    const res = await setThreadWorkspace(threadId, dir, "remove");
    setDirs(res.dirs ?? dirs.filter((d) => d !== dir));
  };

  // Отключить MCP-сервер от СЕССИИ (реестр/образ агента). Библиотеку шаблонов
  // (БД) НЕ трогаем — сервер остаётся в «Мои серверы», вернуть можно кнопкой.
  const detachMcp = async (name: string) => {
    await removeMcpServer(threadId, name);
    setMcpServers((prev) => prev.filter((s) => s.name !== name));
    reloadServers?.();
  };

  React.useEffect(() => {
    if (!threadId) return;
    let alive = true;
    // loading стартует true — спиннер показан до первой загрузки. Синхронный
    // сброс в true при смене threadId не делаем (правило set-state-in-effect):
    // данные обновятся из .then, лишний спиннер при переключении не нужен.
    Promise.all([getThreadWorkspace(threadId), listMcpServers(threadId)]).then(
      ([w, servers]) => {
        if (!alive) return;
        setDirs(w.dirs ?? []);
        setMcpServers(servers);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [threadId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {en ? "Loading..." : "Загрузка..."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Workspace */}
      <SectionCard icon={Folder} title="Workspace">
        {dirs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {en ? "No folders connected." : "Папки не подключены."}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {dirs.map((d) => (
              <div
                key={d}
                className="flex items-center gap-2 rounded-lg border border-border/40 bg-background/50 pl-3 pr-1.5 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                  {d}
                </span>
                <button
                  type="button"
                  onClick={() => removeFolder(d)}
                  aria-label={en ? "Remove folder" : "Убрать папку"}
                  title={en ? "Remove folder" : "Убрать папку"}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* MCP */}
      <SectionCard icon={Blocks} title={en ? "MCP servers" : "MCP-серверы"}>
        {mcpServers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {en ? "No MCP servers connected." : "MCP-серверы не подключены."}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {mcpServers.map((s) => (
              <McpServerRow key={s.name} server={s} en={en} onRemove={detachMcp} />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ── Раздел 2: MCP ────────────────────────────────────────────────────────────

/** Объединённый сервер: шаблон + статус подключения к текущей сессии. */
type UnifiedMcpServer = McpTemplate & {
  isConnected: boolean;
  tools?: McpServerInfo["tools"];
};

/** Слить шаблоны (библиотека) и подключённые серверы в единый список.
 *  Подключённые серверы всегда идут первыми. */
function mergeServers(
  templates: McpTemplate[],
  connected: McpServerInfo[],
): UnifiedMcpServer[] {
  const connectedMap = new Map<string, McpServerInfo>();
  for (const s of connected) connectedMap.set(s.name, s);

  // Дедуп ПО ИМЕНИ: имя сервера — это и ключ реестра сессии (McpRegistry —
  // Map по name), и React-key строки в списке. В библиотеке шаблонов на
  // сервере уникальности нет, и одно и то же имя может лежать там несколько
  // раз (накопленная история переподключений) — тогда список рендерил двух
  // детей с одинаковым key (React: "Encountered two children with the same
  // key"). Побеждает ПОСЛЕДНИЙ шаблон с этим именем: подключить всё равно
  // можно только один сервер на имя, а свежая запись обычно актуальнее.
  const byName = new Map<string, McpTemplate>();
  for (const t of templates) byName.set(t.name, t);

  const unified = [...byName.values()].map((t) => ({
    ...t,
    isConnected: connectedMap.has(t.name),
    tools: connectedMap.get(t.name)?.tools,
  }));

  // Подключённые — вверх, остальные — вниз
  return unified.sort((a, b) => {
    if (a.isConnected === b.isConnected) return 0;
    return a.isConnected ? -1 : 1;
  });
}

function McpSection({
  threadId,
  servers,
  reload,
}: {
  threadId: string;
  servers: McpServerInfo[];
  reload: () => void;
}) {
  const { locale } = useLocale();
  const en = locale === "en";

  // Поиск по серверам
  const [search, setSearch] = React.useState("");

  // Шаблоны MCP (сохранённые конфигурации пользователя)
  const [templates, setTemplates] = React.useState<McpTemplate[]>([]);

  React.useEffect(() => {
    let alive = true;
    listUserMcpTemplates().then((t) => {
      if (alive) setTemplates(t);
    });
    return () => {
      alive = false;
    };
  }, []);

  const reloadTemplates = () => {
    listUserMcpTemplates().then(setTemplates);
  };

  const addFromTemplate = async (template: McpTemplate) => {
    // Тот же визуальный эффект загрузки, что и у пресетов из библиотеки
    // (connectingId → Loader2 на кнопке) — раньше здесь ничего не показывалось,
    // и добавление из «Мои серверы» выглядело так, будто не сработало.
    setConnectingId(template.name);
    try {
      const res = await addMcpFromTemplate(threadId, template);
      if (res.ok) {
        // Карточка сама показывает бейдж «Подключён» — отдельное сообщение
        // об успехе избыточно (в отличие от ошибки, которая на карточке не видна).
        reload();
      } else {
        setFormOpen(true);
        setMsg({
          ok: false,
          text: res.error || (en ? "Failed to add" : "Не удалось добавить"),
        });
      }
    } finally {
      setConnectingId(null);
    }
  };

  const deleteTemplate = async (id: string) => {
    const ok = await deleteUserMcpTemplate(id);
    if (ok) reloadTemplates();
  };

  const [formOpen, setFormOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [target, setTarget] = React.useState("");
  const [token, setToken] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // id пресета, который сейчас ставится (npx/uvx качают пакет — до минуты).
  // Нужен, чтобы крутить спиннер именно на его карточке, а не на всём диалоге.
  const [connectingId, setConnectingId] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  // Похоже ли на URL — только чтобы подсказать, что поле токена релевантно.
  const looksHttp = /^https?:\/\//i.test(target.trim());

  // Очистить ТОЛЬКО поля ввода (не сообщение): после успешного добавления
  // сообщение «Подключено — N тулов» должно остаться видимым.
  const clearFields = () => {
    setName("");
    setTarget("");
    setToken("");
  };

  const submit = async () => {
    if (busy) return;
    const nm = name.trim();
    if (!nm) {
      setMsg({ ok: false, text: en ? "Name is required" : "Укажите имя" });
      return;
    }
    if (!target.trim()) {
      setMsg({ ok: false, text: en ? "Enter a URL or command" : "Укажите URL или команду" });
      return;
    }
    // Единое поле target — транспорт определит бэк (URL vs команда).
    const body: AddMcpBody = { name: nm, target: target.trim() };
    if (looksHttp && token.trim()) {
      body.headers = { Authorization: `Bearer ${token.trim()}` };
    }

    setBusy(true);
    setMsg(null);
    try {
      const res = await addMcpServer(threadId, body);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error || (en ? "Failed" : "Не удалось") });
        return;
      }
      if (res.error) {
        // Сервер добавлен, но подключиться не удалось (http — недоступен;
        // stdio — хост выключен). Останется в реестре, поднимется на ходе.
        setMsg({
          ok: false,
          text:
            (en ? "Added, but not reachable: " : "Добавлен, но недоступен: ") +
            res.error,
        });
      } else {
        // И http, и stdio теперь подключаются сразу и возвращают список тулов.
        const n = res.tools?.length ?? 0;
        setMsg({
          ok: true,
          text: en ? `Connected — ${n} tool(s)` : `Подключено — инструментов: ${n}`,
        });
      }
      clearFields();
      reload();
      // После успешного добавления сворачиваем форму обратно в кнопку
      setFormOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const doRemove = async (nm: string) => {
    await removeMcpServer(threadId, nm);
    reload();
  };

  const handlePresetConnect = async (preset: McpPreset) => {
    if (!threadId) return;
    setBusy(true);
    setConnectingId(preset.id);
    try {
      const body: AddMcpBody = {
        name: preset.name,
        transport: preset.command ? "stdio" : "streamable_http",
        command: preset.command,
        args: preset.args,
        url: preset.url,
      };
      const res = await addMcpServer(threadId, body);
      if (res.ok) {
        // Карточка сама показывает бейдж «Подключён» — отдельное сообщение
        // об успехе избыточно (см. addFromTemplate выше).
        reload();
        reloadTemplates();
      } else {
        setMsg({
          ok: false,
          text:
            (en ? "Failed to connect: " : "Ошибка подключения: ") +
            (res.error || "unknown"),
        });
      }
    } finally {
      setBusy(false);
      setConnectingId(null);
    }
  };

  // Объединяем шаблоны и подключённые серверы в единый список, затем фильтруем по поиску.
  const unified = React.useMemo(() => {
    const merged = mergeServers(templates, servers);
    if (!search.trim()) return merged;
    const q = search.toLowerCase();
    return merged.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.command && s.command.toLowerCase().includes(q)) ||
        (s.url && s.url.toLowerCase().includes(q)),
    );
  }, [templates, servers, search]);

  // Поиск работает и по библиотеке пресетов (имя/описание/команда/аргументы).
  // Пока библиотека скрыта в UI (SHOW_MCP_LIBRARY=false) — отдаём пустой список,
  // тогда ни поиск, ни обзор её не рендерят (данные MCP_PRESETS сохранены).
  const filteredPresets = React.useMemo(() => {
    if (!SHOW_MCP_LIBRARY) return [];
    if (!search.trim()) return MCP_PRESETS;
    const q = search.toLowerCase();
    return MCP_PRESETS.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        (p.command && p.command.toLowerCase().includes(q)) ||
        (p.args && p.args.join(" ").toLowerCase().includes(q)) ||
        (p.url && p.url.toLowerCase().includes(q)),
    );
  }, [search]);

  // Рендер строки своего сервера (шаблон/подключённый) — переиспользуется в обоих
  // режимах (поиск/обзор), чтобы разметка не дублировалась.
  const renderServerRow = (s: (typeof unified)[number]) => (
    <div
      key={`srv:${s.name}`}
      className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-3"
    >
      <Blocks className="size-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{s.name}</span>
          {s.isConnected ? (
            <Badge
              variant="default"
              className="bg-green-500/10 text-green-600 border-green-500/20 dark:bg-green-500/20 dark:text-green-400"
            >
              <CheckCircle2 className="size-3 mr-1" />
              {en ? "Connected" : "Подключён"}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              {en ? "Not connected" : "Не подключён"}
            </Badge>
          )}
        </div>
        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
          {s.transport === "stdio" ? `stdio: ${s.command || ""}` : s.url || "streamable_http"}
        </div>
        {s.isConnected && s.tools && s.tools.length > 0 && (
          <div className="mt-1 text-xs text-muted-foreground">
            {s.tools.length}{" "}
            {plural(s.tools.length, "инструмент", "инструмента", "инструментов")}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {s.isConnected ? (
          <button
            type="button"
            onClick={() => doRemove(s.name)}
            aria-label={en ? "Disconnect from session" : "Отключить от сессии"}
            title={en ? "Disconnect from session" : "Отключить от сессии"}
            className="shrink-0 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
          >
            {en ? "Disconnect" : "Отключить"}
          </button>
        ) : (
          <button
            type="button"
            disabled={connectingId === s.name}
            onClick={() => addFromTemplate(s)}
            aria-label={en ? "Add to session" : "Добавить в сессию"}
            title={en ? "Add to session" : "Добавить в сессию"}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors",
              connectingId === s.name
                ? "cursor-not-allowed opacity-50"
                : "hover:bg-primary/10 hover:text-primary hover:border-primary/30",
            )}
          >
            {connectingId === s.name && <Loader2 className="size-3 animate-spin" />}
            {connectingId === s.name
              ? en
                ? "Connecting…"
                : "Подключается…"
              : en
                ? "Connect"
                : "Подключить"}
          </button>
        )}
        <button
          type="button"
          onClick={() => deleteTemplate(s.id)}
          aria-label={en ? "Delete from library" : "Удалить из библиотеки"}
          title={en ? "Delete from library" : "Удалить из библиотеки"}
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </div>
  );

  // Рендер строки пресета из библиотеки.
  const renderPresetRow = (preset: McpPreset) => {
    const isConnected = servers.some((s) => s.name === preset.name);
    const isConnecting = connectingId === preset.id;
    return (
      <div
        key={`preset:${preset.id}`}
        className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 px-4 py-3"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{preset.name}</span>
            {isConnected && (
              <Badge
                variant="default"
                className="bg-green-500/10 text-green-600 border-green-500/20 dark:bg-green-500/20 dark:text-green-400"
              >
                <CheckCircle2 className="size-3 mr-1" />
                {en ? "Connected" : "Подключён"}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{preset.description}</p>
        </div>
        {/* Кнопка — как в «Мои серверы»: лёгкая outline с текстом, единый стиль. */}
        <button
          type="button"
          disabled={isConnected || busy}
          onClick={() => handlePresetConnect(preset)}
          aria-label={en ? "Add to session" : "Добавить в сессию"}
          title={en ? "Add to session" : "Добавить в сессию"}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors",
            isConnected || isConnecting
              ? "cursor-not-allowed opacity-50"
              : "hover:bg-primary/10 hover:text-primary hover:border-primary/30",
          )}
        >
          {isConnecting && <Loader2 className="size-3 animate-spin" />}
          {isConnecting
            ? en
              ? "Connecting…"
              : "Подключается…"
            : isConnected
              ? en
                ? "Connected"
                : "Подключён"
              : en
                ? "Connect"
                : "Подключить"}
        </button>
      </div>
    );
  };

  const [infoOpen, setInfoOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-sm text-muted-foreground">
          {en
            ? "Connect MCP servers to give the agent extra tools (databases, browsers, APIs). Servers you add are saved to your library — reconnect them to any session in one click."
            : "Подключайте MCP-серверы, чтобы дать агенту новые инструменты (базы, браузер, API). Добавленные серверы сохраняются в библиотеку — в любую сессию их можно вернуть одной кнопкой."}
        </p>
        <button
          type="button"
          onClick={() => setInfoOpen((v) => !v)}
          aria-label={en ? "How to connect MCP servers" : "Как подключать MCP-серверы"}
          title={en ? "Connection guide" : "Памятка по подключению"}
          className={cn(
            "shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors",
            infoOpen
              ? "bg-primary/10 text-primary"
              : "hover:bg-accent/40 hover:text-foreground",
          )}
        >
          <Info className="size-4" />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {infoOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-xs leading-relaxed text-muted-foreground">
              <div className="mb-2 text-sm font-semibold text-foreground">
                {en ? "How to connect" : "Как подключить"}
              </div>
              <ul className="flex flex-col gap-1.5">
                {en ? (
                  <>
                    <li><span className="font-medium text-foreground">Library presets</span> — click «Connect» on a card below. The server starts automatically.</li>
                    <li><span className="font-medium text-foreground">Manual (URL)</span> — paste an HTTP URL into the + form. Add a Bearer token if the server requires auth.</li>
                    <li><span className="font-medium text-foreground">Manual (command)</span> — paste a command like <code className="rounded bg-muted px-1 font-mono">npx -y @foo/server</code>. Always include <code className="rounded bg-muted px-1 font-mono">-y</code> for npx to skip install prompts.</li>
                    <li><span className="font-medium text-foreground">My servers</span> — every server you add is saved to your library. Connect it to any other session in one click.</li>
                  </>
                ) : (
                  <>
                    <li><span className="font-medium text-foreground">Пресеты из библиотеки</span> — нажмите «Подключить» на карточке ниже. Сервер запустится автоматически.</li>
                    <li><span className="font-medium text-foreground">Вручную (URL)</span> — вставьте HTTP-адрес в форму +. Если сервер требует авторизацию — добавьте Bearer-токен.</li>
                    <li><span className="font-medium text-foreground">Вручную (команда)</span> — вставьте команду вроде <code className="rounded bg-muted px-1 font-mono">npx -y @foo/server</code>. Для npx обязательно указывайте <code className="rounded bg-muted px-1 font-mono">-y</code>, иначе установка зависнет на подтверждении.</li>
                    <li><span className="font-medium text-foreground">Мои серверы</span> — каждый добавленный сервер сохраняется в библиотеку. Подключайте его в любую другую сессию одной кнопкой.</li>
                  </>
                )}
              </ul>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Поиск + кнопка «Добавить» в одном ряду. Поиск фильтрует и свои серверы,
          и библиотеку пресетов ниже. */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={en ? "Search MCP servers..." : "Поиск MCP-серверов..."}
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          onClick={() => setFormOpen((v) => !v)}
          variant={formOpen ? "outline" : "default"}
          size="icon"
          className="shrink-0"
          aria-label={en ? "Add MCP server" : "Добавить MCP-сервер"}
          title={en ? "Add MCP server" : "Добавить MCP-сервер"}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {/* Форма добавления — сразу под поиском (раскрывается по кнопке справа). */}
      {formOpen && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-muted/20 p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={en ? "Name (e.g. github)" : "Имя (напр. github)"}
            className={FIELD_CLS}
          />
          {/* Единое поле: URL или команда — тип определим сами. */}
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={
              en
                ? "URL or command (e.g. https://… or npx -y @foo/server)"
                : "URL или команда (напр. https://… или npx -y @foo/server)"
            }
            className={cn(FIELD_CLS, "font-mono")}
          />
          {/* Токен показываем только когда ввод похож на URL (для http-сервера). */}
          {looksHttp && (
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={en ? "Bearer token (optional)" : "Токен (необязательно)"}
              className={FIELD_CLS}
            />
          )}
          <p className="text-xs text-muted-foreground">
            {en
              ? "Paste a URL for a remote server, or a command for a local one — we detect the type."
              : "Вставьте URL удалённого сервера или команду локального — тип определим сами."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {en ? "Connect" : "Подключить"}
            </button>
            <button
              type="button"
              onClick={() => {
                setFormOpen(false);
                clearFields();
                setMsg(null);
              }}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            >
              {en ? "Cancel" : "Отмена"}
            </button>
          </div>
        </div>
      )}

      {/* Сообщение об успехе/ошибке (добавление/подключение). */}
      {msg && (
        <p className={cn("text-sm", msg.ok ? "text-primary" : "text-destructive")}>
          {msg.text}
        </p>
      )}

      {search.trim() ? (
        /* ── Режим поиска: единый плоский результат (свои + библиотека), без
            разделения на секции. Пресеты, уже добавленные как свои, не дублируем. ── */
        (() => {
          const presetHits = filteredPresets.filter(
            (p) => !unified.some((u) => u.name === p.name),
          );
          if (unified.length === 0 && presetHits.length === 0) {
            return (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Search className="size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  {en ? "No servers found" : "Серверы не найдены"}
                </p>
              </div>
            );
          }
          return (
            <div className="flex flex-col gap-2">
              {unified.map(renderServerRow)}
              {presetHits.map(renderPresetRow)}
            </div>
          );
        })()
      ) : (
        /* ── Обзор (без поиска): два раздела — свои серверы и библиотека. ── */
        <>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {en ? "My servers" : "Мои серверы"}
          </div>
          {unified.length > 0 ? (
            <div className="flex flex-col gap-2">{unified.map(renderServerRow)}</div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {en
                ? "No servers yet. Add one via + or from the library below."
                : "Пока нет серверов. Добавьте через + или из библиотеки ниже."}
            </p>
          )}

          {filteredPresets.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {en ? "Library" : "Библиотека"}
              </div>
              {filteredPresets.map(renderPresetRow)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Окно ──────────────────────────────────────────────────────────────────────

export function AgentConfigDialog({
  open,
  onClose,
  threadId,
}: {
  open: boolean;
  onClose: () => void;
  threadId: string;
}) {
  const { locale } = useLocale();
  const en = locale === "en";
  const [section, setSection] = React.useState<Section>("agent");
  const [mounted, setMounted] = React.useState(false);
  const [servers, setServers] = React.useState<McpServerInfo[]>([]);

  const reloadServers = React.useCallback(() => {
    if (!threadId) return;
    listMcpServers(threadId).then(setServers);
  }, [threadId]);

  React.useEffect(() => setMounted(true), []);

  // Загружаем список серверов при открытии.
  React.useEffect(() => {
    if (open) reloadServers();
  }, [open, reloadServers]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  const sections: { id: Section; label: string; icon: typeof Bot }[] = [
    { id: "agent", label: en ? "Agent" : "Агент", icon: Bot },
    { id: "mcp", label: "MCP", icon: Blocks },
  ];

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-md"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            className="relative z-10 flex h-[70vh] w-[70vw] max-w-5xl overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl"
          >
            {/* Левый сайдбар разделов */}
            <aside className="flex w-48 shrink-0 flex-col gap-1 border-r border-border bg-muted/30 p-3">
              <h2 className="px-2 py-2 text-sm font-semibold">
                {en ? "Agent config" : "Конфигурация агента"}
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
                      "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
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

            {/* Контент */}
            <div className="relative flex-1 overflow-y-auto p-6">
              <button
                type="button"
                onClick={onClose}
                aria-label={en ? "Close" : "Закрыть"}
                className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
              <h3 className="mb-4 text-base font-semibold">
                {sections.find((s) => s.id === section)?.label}
              </h3>
              {section === "agent" && (
                <AgentSection threadId={threadId} reloadServers={reloadServers} />
              )}
              {section === "mcp" && (
                <McpSection
                  threadId={threadId}
                  servers={servers}
                  reload={reloadServers}
                />
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
