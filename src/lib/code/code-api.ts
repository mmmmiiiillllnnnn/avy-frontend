// API-вызовы режима Avy Code. Вынесены из общего lib/api.ts, чтобы code-режим
// и обычный чат не делили один файл (меньше конфликтов при мердже).
//
// Здесь: workspace треды (per-thread папки проекта). Базовые примитивы
// (API_BASE) переиспользуем из общего api.ts; CREDENTIALS дублируем одной
// строкой — он не экспортируется.

import { API_BASE, type HistoryMessage } from "@/lib/api";

const CREDENTIALS: RequestCredentials = "include";

// --- Workspace треды (per-thread папки проекта) -----------------------------

/** Папки workspace треды (per-thread, Avy Code). */
export async function getThreadWorkspace(
  threadId: string,
): Promise<{ dirs: string[] }> {
  try {
    const res = await fetch(
      `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/workspace`,
      { credentials: CREDENTIALS },
    );
    if (!res.ok) return { dirs: [] };
    return await res.json();
  } catch {
    return { dirs: [] };
  }
}

// --- MCP-серверы сессии (Avy Code) -------------------------------------------

/** MCP-сервер, подключённый к сессии (то, что отдаёт GET /mcp). */
/** Инструмент MCP-сервера: имя + оригинальное (английское) описание из протокола. */
export type McpToolInfo = { name: string; description?: string };

export type McpServerInfo = {
  name: string;
  transport: string; // "streamable_http" | "stdio"
  url?: string | null;
  command?: string | null;
  tools?: McpToolInfo[];
};

/** Тело запроса на добавление сервера.
 *  Основной путь (UI): единое поле `target` — URL или команда, транспорт
 *  определяет бэк. Явные поля оставлены для совместимости. */
export type AddMcpBody = {
  name: string;
  // URL (http/https) ИЛИ команда локального сервера — бэк сам определит тип.
  target?: string;
  headers?: Record<string, string>;
  // «Добавить из библиотеки»: имя сохранённого шаблона. Бэк достаёт полный
  // конфиг (включая секреты) из БД сам — токен не ходит через клиент.
  from_template?: string;
  // Явные поля (не нужны при target).
  transport?: "streamable_http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
};

/** Ответ на добавление: список тулов (http — сразу, stdio — на след. ходе). */
export type AddMcpResult = {
  ok: boolean;
  name?: string;
  tools?: string[];
  error?: string | null;
  note?: string;
  transport?: string; // что определил бэк: streamable_http | stdio
};

/** Сохранённый MCP-шаблон пользователя. */
export type McpTemplate = {
  id: string;
  name: string;
  transport: string;
  url?: string | null;
  command?: string | null;
  args?: string[];
};

/** Список сохранённых MCP-шаблонов пользователя. */
export async function listUserMcpTemplates(): Promise<McpTemplate[]> {
  try {
    const res = await fetch(`${API_BASE}/api/user/mcp-templates`, {
      credentials: CREDENTIALS,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.templates ?? [];
  } catch {
    return [];
  }
}

/** Сохранить/обновить MCP-шаблон пользователя (upsert по имени). Раньше это
 *  делал сервер сам, неявно, при добавлении сервера в сессию (routes.py:
 *  _save_mcp_template внутри set_mcp_server). Для IPC-пути (addMcpServer
 *  ниже, локальный агент) сервер эту сессию больше не видит, поэтому
 *  автосохранение в библиотеку нужно дёргать явно с клиента. */
export async function saveUserMcpTemplate(cfg: {
  name: string;
  transport: "streamable_http" | "stdio";
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/user/mcp-templates`, {
      method: "POST",
      credentials: CREDENTIALS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Удалить MCP-шаблон по ID. */
export async function deleteUserMcpTemplate(templateId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${API_BASE}/api/user/mcp-templates/${encodeURIComponent(templateId)}`,
      {
        method: "DELETE",
        credentials: CREDENTIALS,
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Локальный агент доступен (Electron) → MCP-серверы сессии идут через IPC
 *  (SessionManager.mcpRegistry в apps/code-cli), а не через сервер — см.
 *  code-streams.ts:hasLocalCodeAgent для того же паттерна на стороне стрима. */
function hasLocalCodeAgent(): boolean {
  return typeof window !== "undefined" && !!window.avyDesktop?.codeAgent;
}

/**
 * Лента avy-code треда для восстановления при открытии. Локальный агент
 * (Electron) реконструирует её из ЛОКАЛЬНОГО чекпоинта графа через IPC-мост
 * (window.avyDesktop.codeAgent.loadHistory → SessionManager.loadHistory), а НЕ
 * с сервера: после миграции «всё локально» серверный code_history снесён, и
 * GET /api/threads/{id}/messages для avy-code больше ничего не отдаёт. Вне
 * Electron (нет локального агента) вернём пусто — режим avy-code без него всё
 * равно не работает (тулы/чекпоинт живут в main-процессе).
 */
export async function fetchCodeHistory(threadId: string): Promise<HistoryMessage[]> {
  if (!hasLocalCodeAgent()) return [];
  try {
    return await window.avyDesktop!.codeAgent!.loadHistory(threadId);
  } catch {
    return [];
  }
}

/**
 * Удалить локальные следы avy-code треда (чекпоинт графа + downloads) при
 * удалении в UI. Дополняет серверный deleteThread (тот сносит запись в БД): без
 * этого локальный <threadId>.json копился бы навсегда — сервер о нём не знает.
 * Вне Electron — no-op (локального агента нет, чистить нечего). Best-effort:
 * ошибку глушим, чтобы не ломать удаление треда в UI из-за локальной ФС.
 */
export async function deleteCodeThreadLocal(threadId: string): Promise<void> {
  if (!hasLocalCodeAgent()) return;
  try {
    await window.avyDesktop!.codeAgent!.deleteThread(threadId);
  } catch {
    // best-effort
  }
}

/** Определить транспорт по одной строке (URL или команда) — портировано из
 *  routes.py:_detect_mcp_target для IPC-пути (сервер это больше не делает
 *  для локального агента). */
function detectMcpTarget(target: string): { transport: "streamable_http" | "stdio"; url?: string; command?: string; args?: string[] } {
  const t = target.trim();
  if (/^https?:\/\//i.test(t)) return { transport: "streamable_http", url: t };
  // Простой аналог shlex.split: кавычки не поддерживаем на клиенте (редкий
  // случай для stdio-команд), обычный сплит по пробелам достаточен для
  // подавляющего большинства команд (npx -y ..., uvx ...).
  const parts = t.split(/\s+/).filter(Boolean);
  return { transport: "stdio", command: parts[0], args: parts.slice(1) };
}

/** Добавить MCP-сервер из шаблона в сессию (одна кнопка).
 *  Сервер: шлём имя шаблона, бэк сам достаёт полный конфиг из БД.
 *  Локальный агент (Electron): секретов в списке шаблонов нет (list не отдаёт
 *  headers/env), поэтому сначала резолвим полный шаблон через отдельный
 *  эндпоинт (см. routes.py:resolve_user_mcp_template), затем добавляем в
 *  сессию через IPC напрямую — сервер-посредник для локального агента не нужен. */
export async function addMcpFromTemplate(
  threadId: string,
  template: McpTemplate,
): Promise<AddMcpResult> {
  if (!hasLocalCodeAgent()) {
    return addMcpServer(threadId, { name: template.name, from_template: template.name });
  }
  try {
    const res = await fetch(
      `${API_BASE}/api/user/mcp-templates/resolve?name=${encodeURIComponent(template.name)}`,
      { credentials: CREDENTIALS },
    );
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const full = await res.json();
    return addMcpServer(threadId, {
      name: full.name,
      transport: full.transport,
      url: full.url ?? undefined,
      headers: full.headers ?? undefined,
      command: full.command ?? undefined,
      args: full.args ?? undefined,
      env: full.env ?? undefined,
    });
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Список MCP-серверов сессии. */
export async function listMcpServers(threadId: string): Promise<McpServerInfo[]> {
  if (hasLocalCodeAgent()) {
    try {
      return (await window.avyDesktop!.codeAgent!.listMcpServers(threadId)) as McpServerInfo[];
    } catch {
      return [];
    }
  }
  try {
    const res = await fetch(
      `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/mcp`,
      { credentials: CREDENTIALS },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.servers ?? [];
  } catch {
    return [];
  }
}

/** Добавить MCP-сервер к сессии. */
export async function addMcpServer(
  threadId: string,
  body: AddMcpBody,
): Promise<AddMcpResult> {
  if (hasLocalCodeAgent()) {
    try {
      const cfg = body.target && body.target.trim()
        ? { name: body.name, ...detectMcpTarget(body.target), headers: body.headers }
        : {
            name: body.name,
            transport: (body.transport ?? "streamable_http") as "streamable_http" | "stdio",
            url: body.url,
            headers: body.headers,
            command: body.command,
            args: body.args,
            env: body.env,
          };
      if (cfg.transport === "stdio" && !cfg.command) {
        return { ok: false, error: "нужна команда для локального сервера" };
      }
      if (cfg.transport === "streamable_http" && !cfg.url) {
        return { ok: false, error: "нужен URL или команда" };
      }
      // Автосохранение в библиотеку — только для ручного добавления, не для
      // повторного добавления УЖЕ существующего шаблона (from_template),
      // как раньше делал сервер (routes.py:set_mcp_server вызывал
      // _save_mcp_template только вне ветки from_template).
      if (!body.from_template) void saveUserMcpTemplate(cfg);
      const result = await window.avyDesktop!.codeAgent!.addMcpServer(threadId, cfg);
      return { ok: result.ok, name: cfg.name, tools: result.tools, error: result.error, transport: cfg.transport };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
  try {
    const res = await fetch(
      `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/mcp`,
      {
        method: "POST",
        credentials: CREDENTIALS,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", ...body }),
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.detail ?? `http_${res.status}` };
    return data;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Убрать MCP-сервер из сессии. */
export async function removeMcpServer(
  threadId: string,
  name: string,
): Promise<{ ok: boolean }> {
  if (hasLocalCodeAgent()) {
    try {
      return await window.avyDesktop!.codeAgent!.removeMcpServer(threadId, name);
    } catch {
      return { ok: false };
    }
  }
  try {
    const res = await fetch(
      `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/mcp`,
      {
        method: "POST",
        credentials: CREDENTIALS,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", name }),
      },
    );
    if (!res.ok) return { ok: false };
    return await res.json();
  } catch {
    return { ok: false };
  }
}

/** Привязать/отвязать папку проекта к треде. Возвращает актуальный список папок. */
export async function setThreadWorkspace(
  threadId: string,
  folder: string,
  action: "add" | "remove" = "add",
): Promise<{ dirs: string[]; error?: string }> {
  try {
    const res = await fetch(
      `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/workspace`,
      {
        method: "POST",
        credentials: CREDENTIALS,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder, action }),
      },
    );
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      return { dirs: [], error: detail.detail ?? `http_${res.status}` };
    }
    return await res.json();
  } catch (e) {
    return { dirs: [], error: String(e) };
  }
}
