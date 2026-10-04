/**
 * Вычисления для карточки задачи субагенту (тикет в ленте) и строки панели
 * субагентов — ОДНИ на обоих, чтобы статус и заголовок не расходились.
 *
 * Источники (всё уже есть в шаге task):
 *  - заголовок: `title` (фраза flash-модели по брифу, кадр task_title /
 *    история) → `background.title` (первая строка брифа с бэка) → первая
 *    строка брифа на клиенте;
 *  - статус: у фонового — background.status; у синхронного — вопрос без
 *    ответа = «ждёт», с ответом = «продолжает», результат = готово/ошибка,
 *    иначе «работает», пока ход идёт;
 *  - «что делает сейчас»: последний шаг ленты субагента (describeTool);
 *  - итог: первая строка финального текста субагента.
 */

import type { SubagentQuestion } from "@/lib/api";
import {
  subagentSteps,
  subagentText,
  type ChatMessage,
  type MessagePart,
  type SubagentRun,
  type ThoughtStep,
} from "@/lib/chat-streams";
import type { Locale } from "@/lib/locale";
import { describeTool } from "@/lib/tool-labels";

export type TaskStep = Extract<ThoughtStep, { kind: "tool" }>;

export type TaskStatus =
  | "running"
  | "waiting"
  | "answered"
  | "done"
  | "error"
  | "cancelled"
  | "interrupted";

/**
 * Заголовок задачи — ТОЛЬКО фраза модели (кадр task_title / история). Пока
 * её нет (или flash недоступен) — пусто, и карточка с панелью показывают
 * нейтральное «Задача для агента»: первая строка брифа в заголовок не идёт —
 * бриф бывает на абзац, и заголовок из него нечитаем (решение владельца 20.09).
 */
export function taskTitle(step: TaskStep): string {
  return step.title ?? "";
}

/** Полный текст задания (бриф) — для раскрытия на карточке / в панели. */
export function descriptionOf(step: TaskStep): string {
  const d = step.args?.description;
  if (typeof d === "string" && d.trim()) return d.trim();
  const p = step.args?.prompt;
  return typeof p === "string" ? p.trim() : "";
}

/** Тип субагента (slug) — второстепенная подпись. */
export function taskType(step: TaskStep): string {
  const t = step.args?.subagent_type;
  return typeof t === "string" && t ? t : (step.background?.subagent_type ?? "");
}

/** Продолжение прежнего субагента (ответ на вопрос / дозадание). */
export function isContinuation(step: TaskStep): boolean {
  const a = step.args?.agent_id;
  return typeof a === "string" && a.length > 0;
}

/**
 * Статус шага. `turnRunning` — ход, в котором живёт шаг, ещё идёт: только
 * тогда синхронный шаг без результата считается работающим (в истории
 * незавершённый шаг прошлого хода — просто законченный).
 */
export function taskStatus(step: TaskStep, turnRunning: boolean): TaskStatus {
  if (step.background) {
    const s = step.background.status;
    if (s === "waiting") return step.answer ? "answered" : "waiting";
    return s;
  }
  // Фоновый запуск, у которого ещё нет статуса агента: тула task УЖЕ вернула
  // успешный результат («запущен в фоне»), а кадр subagent_started с
  // background ещё в пути. По result это читалось как «готово» — карточка
  // на секунду (или дольше, если стрим отстаёт) врала, что агент закончил.
  if (step.args?.background === true) return "running";
  if (step.question) return step.answer ? "answered" : "waiting";
  if (step.result) return step.result.ok ? "done" : "error";
  return turnRunning ? "running" : "done";
}

/** Вопрос субагента (синхронного — из кадра, фонового — из статуса). */
export function taskQuestion(step: TaskStep): SubagentQuestion | null {
  if (step.question?.text) return step.question;
  const q = step.background?.question;
  return q ? { kind: "other", text: q } : null;
}

/** Что субагент делает прямо сейчас — по последней части его ленты. */
export function taskLiveAction(step: TaskStep, locale: Locale): string | null {
  const parts = step.subagent?.parts ?? [];
  const lastPart = parts[parts.length - 1];
  if (!lastPart) return null;
  // Пишет видимый текст — формулирует ответ оркестратору.
  if (lastPart.type === "text") return locale === "ru" ? "Пишу ответ…" : "Writing the answer…";
  const last = lastPart.steps[lastPart.steps.length - 1];
  if (!last) return null;
  if (last.kind === "reasoning") return locale === "ru" ? "Думаю…" : "Thinking…";
  const { title, target } = describeTool(last.name, last.args, locale, "running");
  // Цель (файл, навык) уточняет действие; команда bash и URL — шум.
  const showTarget = target && !["bash", "web_fetch", "task"].includes(last.name);
  return showTarget ? `${title} ${target}` : title;
}

/** Первая строка итога субагента без markdown-мусора. */
export function taskResultLine(step: TaskStep): string | null {
  const line = firstLine(subagentText(step.subagent), 160);
  return line || null;
}

/** Число вызовов тулов в ленте субагента. */
export function taskToolCount(step: TaskStep): number {
  return subagentSteps(step.subagent).filter((s) => s.kind === "tool").length;
}

/** «7 шагов» / «1 шаг» / «3 steps» — формы из словаря. */
export function pluralize(n: number, forms: readonly [string, string, string], locale: Locale): string {
  if (locale === "ru") {
    const m10 = n % 10;
    const m100 = n % 100;
    const form =
      m10 === 1 && m100 !== 11
        ? forms[0]
        : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)
          ? forms[1]
          : forms[2];
    return `${n} ${form}`;
  }
  return `${n} ${n === 1 ? forms[0] : forms[1]}`;
}

/** Прошедшее время как «1:42» / «1:02:07». */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

// ---- Беседа с одним агентом: цепочка вызовов task по адресу ---------------

/**
 * Адрес агента для шага task: у продолжения — его `agent_id`, у фонового —
 * `background.agent_id`, иначе id самого вызова (новый агент = этот вызов).
 */
export function agentAddress(s: TaskStep, fallback = ""): string {
  const a = s.args?.agent_id;
  if (typeof a === "string" && a) return a;
  return s.background?.agent_id || s.id || fallback;
}

/**
 * Сгруппировать вызовы task по адресу агента, в порядке появления в ленте:
 * исходная задача, затем продолжения (ответы на вопросы, дозадания). Одна
 * запись — одна беседа с агентом; так её показывают и карточка, и панель.
 */
export function groupTaskChains(messages: ChatMessage[]): Map<string, TaskStep[]> {
  const chains = new Map<string, TaskStep[]>();
  messages.forEach((m, mi) => {
    if (m.role !== "assistant" || !m.parts) return;
    m.parts.forEach((p, pi) => {
      if (p.type !== "chain") return;
      p.steps.forEach((s, si) => {
        if (s.kind !== "tool" || s.name !== "task") return;
        const addr = agentAddress(s, `${mi}:${pi}:${si}`);
        const chain = chains.get(addr);
        if (chain) chain.push(s);
        else chains.set(addr, [s]);
      });
    });
  });
  return chains;
}

/** Событие истории беседы с агентом — строка раскрываемой истории карточки. */
export type TaskEvent = {
  kind: "question" | "answer" | "result" | "error" | "cancelled" | "interrupted";
  text: string;
};

/**
 * История беседы: по каждому вызову — что в него вошло (ответ оркестратора,
 * если это продолжение) и чем он кончился (вопрос субагента / итог / ошибка).
 * Порядок хронологический: вопрос субагента → ответ оркестратора → итог.
 */
export function chainEvents(chain: TaskStep[]): TaskEvent[] {
  const out: TaskEvent[] = [];
  chain.forEach((s, i) => {
    if (i > 0) {
      const answer = descriptionOf(s);
      if (answer) out.push({ kind: "answer", text: answer });
    }
    const q = taskQuestion(s);
    if (q?.text) {
      out.push({ kind: "question", text: q.text });
      return; // вызов кончился вопросом — итога у него нет
    }
    const st = taskStatus(s, false);
    if (st === "done") {
      const line = taskResultLine(s);
      if (line) out.push({ kind: "result", text: line });
    } else if (st === "error") {
      out.push({ kind: "error", text: firstLine(s.result?.output ?? "", 160) });
    } else if (st === "cancelled" || st === "interrupted") {
      out.push({ kind: st, text: "" });
    }
  });
  return out;
}

/** Шаги тулов за всю беседу. */
export function chainToolCount(chain: TaskStep[]): number {
  return subagentSteps(mergeChainRuns(chain)).filter((s) => s.kind === "tool").length;
}

/**
 * Лента работы агента за ВСЮ беседу — для окна «Подробнее» и счётчиков.
 *
 * Вживую кадры продолжения ложатся в шаг продолжения (у него только хвост
 * после ответа), а у исходного вызова — начало до вопроса: склеиваем по
 * порядку. В истории оба вызова несут одну и ту же полную ленту (один ns
 * чекпойнта) — поэтому части дедуплицируем: тулы по id вызова, рассуждения и
 * текст по содержимому. Соседние цепочки сливаются в одну (как в основной
 * ленте), тексты остаются отдельными частями: между ответом субагента и его
 * следующей репликой был ответ оркестратора, склеивать их в один абзац нельзя.
 */
export function mergeChainRuns(chain: TaskStep[]): SubagentRun | undefined {
  const runs = chain.map((s) => s.subagent).filter((r): r is SubagentRun => !!r);
  if (runs.length === 0) return undefined;
  if (runs.length === 1) return runs[0];
  const seen = new Set<string>();
  const parts: MessagePart[] = [];
  for (const run of runs) {
    for (const p of run.parts) {
      if (p.type === "text") {
        const key = `x:${p.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        parts.push(p);
        continue;
      }
      const steps = p.steps.filter((st) => {
        const key = st.kind === "tool" ? `t:${st.id ?? `${st.name}:${JSON.stringify(st.args)}`}` : `r:${st.text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (steps.length === 0) continue;
      const last = parts[parts.length - 1];
      if (last && last.type === "chain") {
        parts[parts.length - 1] = { ...last, steps: [...last.steps, ...steps] };
      } else {
        parts.push({ type: "chain", steps });
      }
    }
  }
  return { parts };
}

/** Первая непустая строка без markdown-разметки, обрезанная до max. */
function firstLine(text: string, max: number): string {
  const line = text
    .split("\n")
    .map((l) => l.replace(/^[#>*\-\s]+/, "").replace(/[*_`]/g, "").trim())
    .find((l) => l.length > 0);
  if (!line) return "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}
