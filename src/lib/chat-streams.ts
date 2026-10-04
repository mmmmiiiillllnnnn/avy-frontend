"use client";

// Стор стримов чата, живущий НАД активной сессией.
//
// Зачем: ход агента не должен «падать» при переключении сессий. Раньше состояние
// хода жило в одном useChat, привязанном к активному threadId, и смена сессии
// его рвала. Теперь состояние и сам цикл стрима живут здесь — по ключу threadId,
// независимо от того, какая сессия открыта. Уйдя в другую сессию, пользователь
// оставляет ход работать в фоне (на сервере он тоже не прерывается — см.
// server/turn_buffer.py + /attach); вернувшись, видит живой прогресс.
//
// Сервер хранит ход и буфер кадров; клиентский цикл просто читает SSE. Если
// вкладку перезагрузили — цикла в памяти больше нет, но ход на сервере жив:
// reattach(threadId) подхватит его через /attach. Стор — внешний (вне React),
// компоненты подписываются через useSyncExternalStore.

import {
  attachChat,
  attachSubagent,
  deliverSubagentReports,
  fetchThreadHistory,
  interjectTurn,
  stopChat,
  stopSubagent,
  streamChat,
  streamRetry,
  streamEdit,
  type AskUserAnswer,
  type AskUserQuestionSpec,
  type ConnectorAnswer,
  type BackgroundStatus,
  type ChatEvent,
  type DeliverParams,
  type PendingEvent,
  type SubagentQuestion,
  type SubagentReport,
  type Weather,
} from "@/lib/api";
import type { PendingQuestions } from "@/components/chat/question-card";
import type { PendingConnector } from "@/components/chat/connector-card";
import {
  handlePermissionRequest,
  resolvePermission as codeResolvePermission,
} from "@/lib/chat-permissions";

// "summary" — служебная строка сжатия контекста (не реплика). Появляется в
// ленте кодера в точке, где старая история свёрнута в summary; рендерится
// отдельным свёрнутым блоком (CodeMessageRow), content = текст summary.
// "report" — репорт фонового субагента: сообщение от системы, в ленте —
// карточка «агент закончил» перед ответом ассистента.
export type Role = "user" | "assistant" | "summary" | "report";

export type WebSource = { title: string; url: string };

export type FetchedFile = {
  path: string;
  content_type: string;
  bytes: number;
  url: string;
};

export type { Weather, WeatherCondition, WeatherDay, WeatherHour } from "@/lib/api";

// Лента работы одного субагента — ТЕ ЖЕ упорядоченные части, что у ответа
// ассистента (MessagePart: свёрнутая цепочка reasoning+tool / видимый текст),
// поэтому окно «Подробнее» рисует её теми же компонентами, что основную ленту.
// Ответ оркестратору — последняя текстовая часть (subagentText). Привязана к
// шагу-вызову task. Раньше была плоским списком шагов + отдельным текстом: окно
// выглядело иначе, чем основная лента, а реплики субагента между тулами
// сливались в один «итог».
export type SubagentRun = { parts: MessagePart[] };

/** Все шаги ленты субагента подряд (по всем цепочкам) — для счётчиков и
 *  «что делает сейчас». */
export function subagentSteps(run: SubagentRun | undefined): ThoughtStep[] {
  return (run?.parts ?? []).flatMap((p) => (p.type === "chain" ? p.steps : []));
}

/** Итог субагента — его последний видимый текст (ответ оркестратору). */
export function subagentText(run: SubagentRun | undefined): string {
  const parts = run?.parts ?? [];
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.type === "text") return p.text;
  }
  return "";
}

export type ThoughtStep =
  // summary — фраза-сжатие блока (qwen3.8-flash, событие reasoning_summary или
  // история). Когда она есть, СЫРОЙ текст в UI не показывается вовсе (история
  // шлёт text="" вместе с summary); пока нет — text рисуется обрезанным.
  | { kind: "reasoning"; text: string; summary?: string }
  | {
      kind: "tool";
      // id вызова (tool_call_id) — для привязки результата (sources/file) к шагу
      // и для обновления шага на месте по мере дозревания аргументов.
      id?: string;
      name: string;
      args: Record<string, unknown>;
      // "streaming" — аргументы ещё стримятся (шиммер на шаге); "available" —
      // вызов завершён. undefined у старой истории = трактуем как available.
      state?: "streaming" | "available";
      // Результат выполнения тула (bash/file-тулы, avy-code).
      result?: { output: string; ok: boolean; truncated: boolean };
      // Источники из web_search (artifact). Приходят отдельным событием после
      // самого вызова, дописываются в шаг по id.
      sources?: WebSource[];
      // Скачанный файл из web_fetch (artifact) — для карточки/превью.
      file?: FetchedFile;
      // Погода из get_weather (artifact) — рисуется виджетом ВНЕ цепочки
      // рассуждений (как task). Текст самой тулы пользователю не показывается.
      weather?: Weather;
      // Только для вызова task (deep-research): лента работы запущенного
      // сабагента. Накапливается из событий с полем agent во время хода и
      // восстанавливается из истории. Открывается в отдельном окне.
      subagent?: SubagentRun;
      // Только task: заголовок задачи фразой (кадр task_title / история).
      // Нет — карточка берёт первую строку брифа.
      title?: string;
      // Только task, синхронный субагент: встал на вопросе оркестратору.
      question?: SubagentQuestion;
      // Только task: ответ оркестратора на вопрос ЭТОГО субагента — текст
      // description следующего вызова task с agent_id этого шага. Ставится
      // клиентом (linkTaskAnswers), в кадрах и истории поля нет.
      answer?: string;
      // Только task, живой стрим: когда вызов дозрел (для таймера на
      // карточке). В истории нет — там время не показываем.
      startedAt?: number;
      // Только для вызова task с background=true: адрес и статус фонового
      // агента. running — к его ленте приаттачен отдельный SSE
      // (openBackgroundStream), и subagent наполняется из него; остальное —
      // итог, лента полная (из истории).
      // Форма — как отдаёт сервер (история проходит в ленту как есть, без
      // перекладки полей — так же, как sources/file/weather).
      background?: {
        agent_id: string;
        status: BackgroundStatus;
        subagent_type?: string | null;
        title?: string | null;
        // status=waiting: текст вопроса оркестратору.
        question?: string | null;
      };
    };

export type MessagePart =
  | { type: "chain"; steps: ThoughtStep[] }
  | { type: "text"; text: string };

// thumbUrl — готовый URL мини-превью картинки (data:-URL для Avy Code, где файл
// не лежит в ФС; в обычном чате превью берётся из /files/raw по path).
export type Attachment = { path: string; name: string; mime: string; thumbUrl?: string };

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  parts?: MessagePart[];
  attachments?: Attachment[];
  // Стабильный id хода из чекпойнтера (для лайка/дизлайка/ретрая/edit). У свежих
  // (ещё не сохранённых) сообщений отсутствует — появляется после перезагрузки.
  serverId?: string | null;
  // Текущая оценка ответа пользователем (восстановлена с сервера / поставлена в UI).
  feedback?: "up" | "down" | null;
  // Только для role="summary": объём свёрнутой истории в токенах (до сжатия).
  tokens?: number | null;
  // Только для role="report": какой агент, чем кончил.
  report?: SubagentReport;
  // Только role="user": отправлено посреди хода и агентом ещё не забрано —
  // ждёт его следующего шага. Снимается кадром `interject` (или строка
  // уходит обычным сообщением, если ход кончился раньше — см. afterTurn).
  pending?: boolean;
  // Только role="user" из ИСТОРИИ: реплика посреди хода — не начало хода.
  // По ней setHistory находит границу текущего хода в истории.
  interject?: boolean;
};

// Текст маркера остановки (совпадает с server _STOP_MARKER).
export const STOP_MARKER = "\n\nОстановлено пользователем";

// Маркеры вставленного текста: большой кусок, вставленный в инпут, обрамляется
// ими в тексте сообщения. Модель видит обычный помеченный текст; бабл по этим
// маркерам показывает блок чипом-вложением, а не портянкой.
export const PASTED_TEXT_MARKER = "--- Вставленный текст ---";
export const PASTED_TEXT_MARKER_END = "--- Конец вставленного текста ---";

/** Сэмпл для чипа вставки: начало текста (CSS line-clamp обрежет до 2-3 строк). */
export function pastePreview(text: string): string {
  // Схлопываем лишние пустые строки, но переносы оставляем — чип покажет
  // несколько строк. ~280 символов с запасом на 3 строки.
  const trimmed = text.replace(/\n{2,}/g, "\n").trim();
  return trimmed.length > 280 ? `${trimmed.slice(0, 280)}…` : trimmed;
}

/** Состояние ленты одной сессии. */
/** Ожидающая заявка на approval (режим Avy Code): агент хочет изменить файлы/
 * запустить команду, ход на паузе до решения пользователя. */
export type PendingPermission = {
  interruptId: string | null;
  tool: string;
  args: Record<string, unknown>;
  /** Готовый текст карточки от бэкенда (HITL собирает его из описания тулы).
   *  Пусто — покажем имя тулы и её аргументы. */
  description: string;
};

export type ThreadState = {
  messages: ChatMessage[];
  isStreaming: boolean;
  // id пузыря ассистента, в который сейчас идут кадры (null — хода нет).
  // Лента по нему решает, какой ряд «работает». Раньше это был ПОСЛЕДНИЙ
  // ряд ленты — но реплика посреди хода встаёт после пузыря, и тот сразу
  // получал панель лайков и терял индикатор, хотя ход шёл.
  streamingId: string | null;
  error: string | null;
  // Очередь заявок approval (режим Avy Code). Пуста = нет паузы. Агент может
  // вызвать несколько тулов параллельно — они все придут как отдельные
  // permission_request. Показываем по одной; resume отправляем только после
  // последней (сразу все решения одним списком).
  pendingPermissions: PendingPermission[];
  // Вопрос агента (тула ask_user) — ход на паузе, ждём ответа человека. Всегда
  // ОДИН, не очередь: тула отдаёт все свои вопросы одной карточкой, и второй
  // вызов до ответа невозможен — граф стоит в interrupt.
  pendingQuestions: PendingQuestions | null;
  // Просьба агента подключить сервис (тула connector) — тот же interrupt, что
  // у вопроса, карточка своя. Тоже ОДНА: тула ждёт ответа на один сервис.
  pendingConnector: PendingConnector | null;
};

const EMPTY: ThreadState = {
  messages: [],
  isStreaming: false,
  streamingId: null,
  error: null,
  pendingPermissions: [],
  pendingQuestions: null,
  pendingConnector: null,
};

let _idCounter = 0;
const nextId = () => `m${++_idCounter}`;

/** Внутренняя запись потока сессии (не отдаётся в UI напрямую). */
type ThreadRecord = {
  state: ThreadState;
  // Кол-во уже полученных SSE-кадров текущего хода — offset для reattach.
  frames: number;
  // id сообщения ассистента, в которое стримим (для патчей).
  assistantId: string | null;
  // AbortController активного цикла чтения (НЕ сервера — только локального
  // fetch). Он же — ВЛАДЕЛЕЦ записи: цикл применяет кадры и завершает ход,
  // только пока r.ctrl — его контроллер. Уход из сессии (detach) и новый ход
  // (start) забирают владение, и прежний цикл замолкает: раньше он, дочитав
  // свой хвост (или упав по abort), снимал isStreaming и слал onDone поверх
  // уже идущего НОВОГО хода — лента шла, а поле ввода считало, что всё
  // закончилось.
  ctrl: AbortController | null;
  listeners: Set<() => void>;
  // Связка ключа сабагента (поле agent в событиях) → tool_call_id шага task, в
  // окно которого его лента пишется. Реального id вызова task в ns нет, поэтому
  // связываем по ПОРЯДКУ: первый увиденный сабагент → первый ещё не связанный
  // шаг task. Живёт на время хода, сбрасывается при старте нового.
  subagentMap: Map<string, string>;
  // id запланированного rAF-кадра уведомления подписчиков (0 = не запланирован).
  // Батчим: десятки событий за кадр (особенно при 8 параллельных сабагентах) →
  // один React-рендер на кадр экрана, а не на каждый токен.
  emitRaf: number;
  // Буфер дельт reasoning/text КАЖДОГО сабагента (ключ — agentKey). Эти потоки
  // самые «болтливые», и патчить ленту на каждый их токен дорого (клон parts/
  // steps). Копим и сливаем пачкой раз в SUBAGENT_FLUSH_MS одним patchMessages.
  subagentBuffer: Map<string, { reasoning: string; text: string }>;
  // id таймера слива буфера (0 = не запланирован).
  subagentFlush: ReturnType<typeof setTimeout> | 0;
  // Режим Avy Code: параметры текущего хода, нужные для возобновления после
  // approval (resolvePermission переотправляет ход с тем же режимом/моделью).
  codeRun: {
    modelId?: string;
    effort?: string | null;
    /** Режим хода (null = обычный чат). Возобновление после карточки идёт
     *  ТЕМ ЖЕ режимом: подтверждение бывает и в обычном чате (`confirm:` у
     *  агента, инструменты коннекторов), а с прошитым "avy-code" сервер
     *  отклонял продолжение — тред в другом режиме. */
    mode?: string | null;
    permissionMode?: string | null;
    /** Агент из библиотеки; undefined = универсальный чат. */
    agentId?: string | null;
    onTitle?: (title: string) => void;
    onDone?: (threadId: string) => void;
  } | null;
  // Накопленные решения по уже пройденным карточкам (для параллельных вызовов).
  // Когда очередь pendingPermissions опустеет — эти решения уйдут в resume.
  pendingDecisions: Array<{ type: "approve" | "reject"; comment?: string }>;
  // Полный массив истории (может быть 500+ сообщений). В state.messages держим
  // только хвост (последние HISTORY_PAGE), остальное подгружается по loadMore.
  allMessages: ChatMessage[];
  // Живые SSE фоновых агентов сессии: agentId → AbortController. Лента агента
  // идёт ОТДЕЛЬНО от стрима хода — ход мог давно закончиться.
  bgStreams: Map<string, AbortController>;
  // Буфер дельт фоновых агентов — как subagentBuffer, но с явной привязкой к
  // сообщению и шагу: связка subagentMap живёт один ход, а агент — дольше.
  bgBuffer: Map<
    string,
    { msgId: string; callId: string; nested: string[]; reasoning: string; text: string }
  >;
  bgFlush: ReturnType<typeof setTimeout> | 0;
  // Параметры последнего хода — ими идёт ход доставки репорта (та же модель,
  // тот же агент). Обновляет хук при каждом изменении выбора в UI.
  turnParams: DeliverParams | null;
  // Сервер сообщил, что репорт ждёт вручения (done.follow_up /
  // subagent_done.follow_up), а ход ещё шёл: попросить доставку по его концу.
  followUp: boolean;
  // Реплики, отправленные посреди хода и ещё не забранные агентом (кадра
  // `interject` с их id не было). Ключ — id, ушедший на сервер. Кончится ход
  // раньше, чем агент до них дойдёт, — afterTurn отправит их обычным
  // сообщением: ни одна не теряется и ни одна не уходит дважды (сервер чистит
  // очередь на старте любого хода).
  interjects: Map<string, TurnInput>;
  // id ПЕРВОГО сообщения текущего хода в state.messages: реплика человека
  // (start/edit) или пузырь ассистента (retry/reattach/доставка). Всё от него
  // и дальше — живой ход, авторитетный при слиянии с историей (setHistory);
  // всё до него история вправе заменить собой.
  turnStart: string | null;
};

// Сколько сообщений показываем из истории за раз (первоначально и при loadMore).
// Малый размер = быстрый первый рендер; пользователь скроллит вверх → loadMore.
const HISTORY_PAGE = 30;

// Как часто сливать накопленные дельты сабагентов в ленту. 120мс — глаз не
// замечает «рывков», а патчей ленты в секунду на порядок меньше, чем токенов.
const SUBAGENT_FLUSH_MS = 120;

// Map.set/delete сохраняют порядок вставки → используем Map как LRU: «свежесть»
// треда обновляем удалением+переустановкой в touch(), эвиктим с головы (самый
// давний). Без границы records копил бы messages[] всех открытых за сессию
// тредов (история + цепочки + ссылки на картинки) — память росла бесконечно.
const records = new Map<string, ThreadRecord>();

// Сколько неактивных тредов держать в памяти. Активный (стримящийся) и тред с
// живыми подписчиками НЕ считаются и не эвиктятся. 8 хватает на быстрые прыжки
// между сессиями, но не даёт копить десятки тяжёлых лент.
const MAX_IDLE_RECORDS = 8;

function rec(threadId: string): ThreadRecord {
  const existing = records.get(threadId);
  if (existing) return existing;
  const r: ThreadRecord = {
    state: EMPTY,
    frames: 0,
    assistantId: null,
    ctrl: null,
    listeners: new Set(),
    subagentMap: new Map(),
    emitRaf: 0,
    subagentBuffer: new Map(),
    subagentFlush: 0,
    codeRun: null,
    pendingDecisions: [],
    allMessages: [],
    bgStreams: new Map(),
    bgBuffer: new Map(),
    bgFlush: 0,
    turnParams: null,
    followUp: false,
    interjects: new Map(),
    turnStart: null,
  };
  records.set(threadId, r);
  return r;
}

/**
 * История БЕЗ текущего (живого) хода.
 *
 * Граница хода в истории — последняя реплика человека или репорт фонового
 * агента (вход хода доставки). Реплики посреди хода (interject) границей не
 * считаются: они внутри хода и приедут в живом хвосте.
 *
 * Живой хвост начинается с реплики человека (start/edit) — тогда она же
 * должна стоять границей в истории, и историю режем ДО неё. Если тексты не
 * совпадают, история этот ход ещё не знает (первый чекпойнт не записан) —
 * берём её целиком. Хвост начинается с пузыря ассистента (реаттач, ретрай,
 * доставка) — реплика-граница остаётся из истории, режем ПОСЛЕ неё.
 */
/**
 * Сообщения ленты, которых ещё нет в истории, — когда начало живого хода
 * неизвестно (turnStart пуст: ход подхвачен после обрыва или перезапуска
 * сервера). Реплики человека, отправленные в этой сессии, серверного id не
 * имеют, и раньше все они считались «живыми» и дописывались ПОСЛЕ истории,
 * где они уже есть: после рестарта бэкенда посреди хода обе реплики треда
 * всплывали дублями в конце ленты (dev, 28.09). Реплику без id узнаём по
 * тексту: история начинается с того, что человек видел у себя (дальше может
 * идти блок «Прикреплённые файлы:»). Каждая реплика истории закрывает одну
 * локальную — две одинаковые подряд не склеиваются в одну.
 */
export function unsavedMessages(live: ChatMessage[], history: ChatMessage[]): ChatMessage[] {
  const used = new Set<number>();
  return live.filter((m) => {
    if (m.serverId != null) return !history.some((h) => h.serverId === m.serverId);
    const text = m.content.trim();
    if (m.role !== "user" || m.pending || text === "") return true;
    const i = history.findIndex(
      (h, idx) => !used.has(idx) && h.role === "user" && h.content.trim().startsWith(text),
    );
    if (i < 0) return true;
    used.add(i);
    return false;
  });
}

export function historyBeforeLiveTurn(
  all: ChatMessage[],
  liveTail: ChatMessage[],
): ChatMessage[] {
  let boundary = -1;
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i];
    if ((m.role === "user" && !m.interject) || m.role === "report") {
      boundary = i;
      break;
    }
  }
  if (boundary < 0) return all;
  const first = liveTail[0];
  if (first?.role === "user" && !first.pending) {
    const h = all[boundary].content.trim();
    const l = first.content.trim();
    // Текст истории может быть длиннее (блок «Прикреплённые файлы:»), но
    // начинается с того, что человек видел у себя.
    if (l !== "" && !h.startsWith(l)) return all;
    return all.slice(0, boundary);
  }
  return all.slice(0, boundary + 1);
}

// id реплики посреди хода. Становится id HumanMessage в чекпойнте, поэтому
// обязан быть уникален в пределах треда; клиент по нему узнаёт свою строку в
// кадре `interject`.
function interjectId(): string {
  const c = globalThis.crypto;
  return c?.randomUUID
    ? c.randomUUID()
    : `ij-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Пометить тред как недавно использованный (переставить в конец LRU-порядка). */
function touch(threadId: string): void {
  const r = records.get(threadId);
  if (r) {
    records.delete(threadId);
    records.set(threadId, r);
  }
}

/**
 * Выгрузить давно не используемые треды, оставив в памяти не более
 * MAX_IDLE_RECORDS неактивных. Тред можно выгрузить, только если он НЕ стримит
 * и на него никто не подписан (его нет на экране) — иначе порвём живую ленту.
 * Перед удалением гасим возможные таймеры/rAF, чтобы не оставить висячих ссылок.
 */
function evictIdle(): void {
  let idle = 0;
  // Идём от свежих к старым (конец → начало): первые MAX_IDLE_RECORDS пригодных
  // к выгрузке оставляем, остальные эвиктим.
  for (const [id, r] of [...records.entries()].reverse()) {
    const evictable = !r.state.isStreaming && r.listeners.size === 0;
    if (!evictable) continue;
    idle += 1;
    if (idle > MAX_IDLE_RECORDS) {
      if (r.emitRaf) cancelAnimationFrame(r.emitRaf);
      if (r.subagentFlush) clearTimeout(r.subagentFlush);
      r.ctrl?.abort();
      abortBackgroundStreams(r);
      records.delete(id);
    }
  }
}

// rAF доступен только в браузере; на SSR падаем в синхронный вызов (там стрима
// нет, так что батчить нечего).
const _raf: (cb: () => void) => number =
  typeof requestAnimationFrame === "function"
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => {
        cb();
        return 0;
      };

/**
 * Уведомить подписчиков — НЕ синхронно, а раз в кадр экрана (rAF). Состояние
 * стора мутируется на каждое SSE-событие (десятки/сек при параллельных
 * сабагентах), но React-рендер происходит максимум раз в кадр: пока кадр не
 * наступил, повторные emit() лишь «взводят» уже запланированный rAF, а не плодят
 * рендеры. К моменту рендера стор уже содержит все накопленные изменения.
 */
function emit(r: ThreadRecord) {
  if (r.emitRaf) return;
  r.emitRaf = _raf(() => {
    r.emitRaf = 0;
    for (const l of r.listeners) l();
  });
}

/** Заменить state записи новым объектом (иммутабельно) и уведомить подписчиков. */
function setState(threadId: string, patch: Partial<ThreadState>) {
  const r = rec(threadId);
  r.state = { ...r.state, ...patch };
  emit(r);
}

function patchMessages(
  threadId: string,
  fn: (msgs: ChatMessage[]) => ChatMessage[],
) {
  const r = rec(threadId);
  r.state = { ...r.state, messages: fn(r.state.messages) };
  emit(r);
}

/** Гарантировать, что последний part — chain; вернуть его (для мутации копии). */
function lastChain(parts: MessagePart[]) {
  const last = parts[parts.length - 1];
  if (last && last.type === "chain") return last;
  const chain = { type: "chain" as const, steps: [] as ThoughtStep[] };
  parts.push(chain);
  return chain;
}

/**
 * Дописать результат тула (sources/file) в уже добавленный tool-шаг по
 * tool_call_id. Результат приходит отдельным событием после самого вызова.
 * Патчим первый совпавший шаг (вызов почти всегда последний; флаг гасит дубль).
 */
function patchToolStep(
  m: ChatMessage,
  callId: string,
  data: Partial<Extract<ThoughtStep, { kind: "tool" }>>,
): ChatMessage {
  let hit = false;
  const parts = (m.parts ?? []).map((p) => {
    if (p.type !== "chain") return p;
    const steps = p.steps.map((s) => {
      if (!hit && s.kind === "tool" && s.id && s.id === callId) {
        hit = true;
        return { ...s, ...data };
      }
      return s;
    });
    return hit ? { ...p, steps } : p;
  });
  return hit ? { ...m, parts } : m;
}

/** Как patchToolStep, но данные считает функция от шага; null — не трогать. */
function patchToolStepIf(
  m: ChatMessage,
  callId: string,
  fn: (s: Extract<ThoughtStep, { kind: "tool" }>) => Partial<Extract<ThoughtStep, { kind: "tool" }>> | null,
): ChatMessage {
  let hit = false;
  const parts = (m.parts ?? []).map((p) => {
    if (p.type !== "chain") return p;
    const steps = p.steps.map((s) => {
      if (!hit && s.kind === "tool" && s.id && s.id === callId) {
        hit = true;
        const data = fn(s);
        return data ? { ...s, ...data } : s;
      }
      return s;
    });
    return hit ? { ...p, steps } : p;
  });
  return hit ? { ...m, parts } : m;
}

/** Все tool_call_id шагов-вызовов task в сообщении (в порядке появления). */
function taskCallIds(m: ChatMessage): string[] {
  const ids: string[] = [];
  for (const p of m.parts ?? []) {
    if (p.type !== "chain") continue;
    for (const s of p.steps) {
      if (s.kind === "tool" && s.name === "task" && s.id) ids.push(s.id);
    }
  }
  return ids;
}

/**
 * Связать ключ сабагента с tool_call_id шага task.
 *
 * Сервер присылает НАСТОЯЩИЙ id вызова: тула `task` кладёт его в metadata
 * конфига субагента, а стрим-слой подставляет вместо ключа из namespace
 * (см. server/streaming.py). Тогда agentKey уже равен id шага — берём как есть.
 *
 * Запасной путь — связывание по порядку — остаётся для ходов, начатых старой
 * версией сервера. Он ошибался при ПАРАЛЛЕЛЬНОМ запуске: первым отвечает не
 * обязательно первый субагент, поэтому задачи менялись местами в UI (сами
 * субагенты при этом выполняли свои задачи верно). Держим его только как
 * совместимость, новые ходы сюда не попадают.
 */
function resolveTaskCallId(
  r: ThreadRecord,
  m: ChatMessage,
  agentKey: string,
): string | null {
  const known = r.subagentMap.get(agentKey);
  if (known) return known;

  // Ключ УЖЕ является id вызова task — сервер связал их за нас.
  const ids = taskCallIds(m);
  if (ids.includes(agentKey)) {
    r.subagentMap.set(agentKey, agentKey);
    return agentKey;
  }

  const taken = new Set(r.subagentMap.values());
  const free = ids.find((id) => !taken.has(id));
  if (!free) return null;
  r.subagentMap.set(agentKey, free);
  return free;
}

/**
 * Ключ агента у кадра — ПУТЬ вызовов task от верхнего до самого агента через
 * «/» (сервер: _feed_meta в тула task). Верхний сегмент — id вызова в основной
 * ленте (по нему находится окно), остальные — вложенные вызовы внутри ленты
 * этого субагента: исследователь, делегированный ассистенту, зовёт своих
 * researcher / wide-*, и их кадры должны лечь в ИХ шаги task, а не в ленту
 * внешнего одним потоком (там вложенный поиск выглядел так, будто внешний
 * ищет сам). Старый ключ без «/» — только верхний.
 */
function splitAgentKey(agentKey: string): { top: string; nested: string[] } {
  const [top, ...nested] = agentKey.split("/");
  return { top, nested };
}

/**
 * Применить правку к ленте ВЛОЖЕННОГО субагента по пути id вызовов task
 * внутри run (субагент субагента). Пустой путь — сама лента. Шага с таким id
 * нет (кадр опередил вызов — редкая гонка) — лента не меняется.
 */
function patchNestedRun(
  run: SubagentRun,
  path: string[],
  apply: (run: SubagentRun) => SubagentRun,
): SubagentRun {
  if (path.length === 0) return apply(run);
  const [head, ...rest] = path;
  let hit = false;
  const parts = run.parts.map((p) => {
    if (hit || p.type !== "chain") return p;
    const steps = p.steps.map((s) => {
      if (!hit && s.kind === "tool" && s.id === head) {
        hit = true;
        return { ...s, subagent: patchNestedRun(s.subagent ?? { parts: [] }, rest, apply) };
      }
      return s;
    });
    return hit ? { ...p, steps } : p;
  });
  return hit ? { parts } : run;
}

/** Применить событие к ленте сабагента внутри шага task с данным callId. */
function patchSubagentStep(
  m: ChatMessage,
  callId: string,
  apply: (run: SubagentRun) => SubagentRun,
): ChatMessage {
  let hit = false;
  const parts = (m.parts ?? []).map((p) => {
    if (p.type !== "chain") return p;
    const steps = p.steps.map((s) => {
      if (!hit && s.kind === "tool" && s.id === callId) {
        hit = true;
        const run = s.subagent ?? { parts: [] };
        return { ...s, subagent: apply(run) };
      }
      return s;
    });
    return hit ? { ...p, steps } : p;
  });
  return hit ? { ...m, parts } : m;
}

// Накопители ленты субагента — те же правила, что у applyEvent для ленты
// оркестратора: reasoning склеивается с последним reasoning-шагом текущей
// цепочки, текст — с последней текстовой частью, tool-шаг обновляется на месте
// по id или встаёт в конец текущей цепочки.

/** Дописать reasoning-дельту в ленту субагента (склейка с последним шагом). */
function appendSubagentReasoning(run: SubagentRun, text: string): SubagentRun {
  const parts = [...run.parts];
  const chain = lastChain(parts);
  const steps = [...chain.steps];
  const last = steps[steps.length - 1];
  if (last && last.kind === "reasoning") {
    steps[steps.length - 1] = { ...last, text: last.text + text };
  } else {
    steps.push({ kind: "reasoning", text });
  }
  parts[parts.length - 1] = { ...chain, steps };
  return { parts };
}

/** Дописать видимый текст субагента (склейка с последней текстовой частью). */
function appendSubagentText(run: SubagentRun, text: string): SubagentRun {
  const parts = [...run.parts];
  const last = parts[parts.length - 1];
  if (last && last.type === "text") {
    parts[parts.length - 1] = { ...last, text: last.text + text };
  } else {
    parts.push({ type: "text", text });
  }
  return { parts };
}

/** Обновить/добавить tool-шаг в ленте субагента (по id, как в основной ленте). */
function upsertSubagentTool(
  run: SubagentRun,
  data: { id: string; name: string; args: Record<string, unknown>; state: "streaming" | "available" },
): SubagentRun {
  const updated = patchSubagentToolResult(run, data.id, { args: data.args, state: data.state });
  if (updated !== run) return updated;
  const parts = [...run.parts];
  const chain = lastChain(parts);
  parts[parts.length - 1] = {
    ...chain,
    steps: [...chain.steps, { kind: "tool", id: data.id, name: data.name, args: data.args, state: data.state }],
  };
  return { parts };
}

/** Дописать sources/file/результат в tool-шаг ленты субагента по tool_call_id. */
function patchSubagentToolResult(
  run: SubagentRun,
  callId: string,
  data: Partial<Extract<ThoughtStep, { kind: "tool" }>>,
): SubagentRun {
  let hit = false;
  const parts = run.parts.map((p) => {
    if (hit || p.type !== "chain") return p;
    const steps = p.steps.map((s) => {
      if (!hit && s.kind === "tool" && s.id === callId) {
        hit = true;
        return { ...s, ...data };
      }
      return s;
    });
    return hit ? { ...p, steps } : p;
  });
  return hit ? { parts } : run;
}

// --- Фоновые субагенты --------------------------------------------------------
//
// Субагент, запущенный в фон, живёт дольше хода: стрим хода его токенов не
// несёт. Лента агента — свой буфер на сервере и свой SSE здесь; кадры ложатся
// в тот же `subagent` шага task, что и у синхронного, поэтому окно «Подробнее»
// одно на оба случая. Привязка к сообщению и шагу — явная (msgId/callId), а не
// через subagentMap: та живёт один ход, а агент переживает несколько.

/** Открыть SSE ленты фонового агента и лить его кадры в шаг task. */
function openBackgroundStream(
  threadId: string,
  msgId: string,
  callId: string,
  agentId: string,
  attempt = 0,
) {
  const r = rec(threadId);
  if (r.bgStreams.has(agentId)) return;
  const ctrl = new AbortController();
  r.bgStreams.set(agentId, ctrl);
  void (async () => {
    let first = true;
    // Лента дочитана до конца (subagent_done) либо её нет на сервере — тогда
    // переоткрывать нечего. Всё остальное (обрыв сети, прокси, засыпание
    // вкладки) — поток кончился раньше агента, и его надо поднять заново:
    // иначе карточка замирала на последнем полученном кадре, «Подробнее»
    // отставало от агента, а «готово» появлялось только после перезагрузки
    // страницы (прод 21.09).
    let settled = false;
    try {
      for await (const ev of attachSubagent(threadId, agentId, 0, ctrl.signal)) {
        const kind = (ev as { type: string }).type;
        if (first) {
          first = false;
          // Один кадр done = ленты на сервере нет. Либо она протухла по TTL
          // (тогда остаётся версия из истории), либо мы пришли раньше, чем
          // сервер её завёл, — сервер теперь открывает её до первого кадра,
          // но на случай любой похожей гонки пробуем ещё пару раз.
          if (kind === "done") {
            settled = true;
            if (attempt < 3 && !ctrl.signal.aborted) {
              setTimeout(() => {
                if (r.bgStreams.get(agentId) === ctrl) r.bgStreams.delete(agentId);
                openBackgroundStream(threadId, msgId, callId, agentId, attempt + 1);
              }, 1500);
            }
            break;
          }
          // Лента идёт с самого начала: частичную версию из истории (после
          // reload) замещаем, иначе шаги задвоятся. При truncated начало
          // потеряно — тогда история точнее, дописываем к ней.
          if (kind !== "truncated") {
            patchBackgroundRun(threadId, msgId, callId, [], () => ({ parts: [] }));
          }
        }
        if (ev.type === "subagent_done") {
          settled = true;
          flushBackgroundBuffer(threadId);
          markBackgroundStatus(threadId, agentId, ev.status, ev.question);
          if (ev.follow_up) requestDelivery(threadId);
          break;
        }
        applyBackgroundEvent(threadId, msgId, callId, agentId, ev);
      }
    } catch (e) {
      // AbortError — уход из сессии/выгрузка записи; всё остальное — сеть.
      if ((e as Error).name !== "AbortError") {
        console.warn("background stream failed", agentId, e);
      }
    } finally {
      flushBackgroundBuffer(threadId);
      if (r.bgStreams.get(agentId) === ctrl) r.bgStreams.delete(agentId);
      // Оборвались, не дочитав, и нас не отцепляли — переподключаемся. Лента
      // реплеится с нуля, первый кадр замещает частичную версию (см. выше).
      if (!settled && !ctrl.signal.aborted) {
        setTimeout(() => {
          if (!r.bgStreams.has(agentId)) openBackgroundStream(threadId, msgId, callId, agentId);
        }, 2000);
      }
    }
  })();
}

/**
 * Актуальная лента для поиска работающих агентов: полный список из истории,
 * поверх него — живые версии сообщений из state. patchMessages обновляет
 * только state (видимый срез), а allMessages — только загрузка истории, и
 * статус «работает», пришедший по стриму (subagent_started), в allMessages
 * не попадал. reattach искал агентов в нём — и после первого же обрыва
 * (свернул вкладку, переключился) ленты не переоткрывались: карточка
 * замирала до перезагрузки страницы (прод 21.09).
 */
export function liveMessages(r: { allMessages: ChatMessage[]; state: { messages: ChatMessage[] } }): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of r.allMessages) byId.set(m.id, m);
  for (const m of r.state.messages) byId.set(m.id, m);
  return [...byId.values()];
}

function abortBackgroundStreams(r: ThreadRecord) {
  for (const ctrl of r.bgStreams.values()) ctrl.abort();
  r.bgStreams.clear();
  if (r.bgFlush) {
    clearTimeout(r.bgFlush);
    r.bgFlush = 0;
  }
  r.bgBuffer.clear();
}

/** Приаттачиться к лентам всех агентов, которые по истории ещё работают. */
function attachRunningBackground(threadId: string, msgs: ChatMessage[]) {
  for (const m of msgs) {
    for (const p of m.parts ?? []) {
      if (p.type !== "chain") continue;
      for (const s of p.steps) {
        if (s.kind === "tool" && s.id && s.background?.status === "running") {
          openBackgroundStream(threadId, m.id, s.id, s.background.agent_id);
        }
      }
    }
  }
}

/** Правка ленты фонового агента (или, по пути nested, вложенного в неё субагента). */
function patchBackgroundRun(
  threadId: string,
  msgId: string,
  callId: string,
  nested: string[],
  apply: (run: SubagentRun) => SubagentRun,
) {
  patchMessages(threadId, (msgs) =>
    msgs.map((m) =>
      m.id === msgId
        ? patchSubagentStep(m, callId, (run) => patchNestedRun(run, nested, apply))
        : m,
    ),
  );
}

/** Путь вложенных вызовов внутри ленты фонового агента. Кадры самого агента
 *  несут ключ его корня (без «/»), кадры его субагентов — `корень/вызов/…`. */
function backgroundNestedPath(agentKey: string | null | undefined): string[] {
  return agentKey ? splitAgentKey(agentKey).nested : [];
}

/** Кадр ленты агента → его лента в шаге task; кадры вложенных субагентов —
 *  в их шаги task внутри неё (по пути в поле agent). */
function applyBackgroundEvent(
  threadId: string,
  msgId: string,
  callId: string,
  agentId: string,
  ev: ChatEvent,
) {
  const nested = backgroundNestedPath("agent" in ev ? ev.agent : null);
  switch (ev.type) {
    case "reasoning":
    case "text":
      bufferBackgroundDelta(threadId, msgId, callId, agentId, nested, ev.type, ev.value);
      return;
    case "tool":
      flushBackgroundBuffer(threadId);
      patchBackgroundRun(threadId, msgId, callId, nested, (run) =>
        upsertSubagentTool(run, {
          id: ev.id,
          name: ev.name,
          args: ev.args,
          state: ev.state ?? "available",
        }),
      );
      return;
    case "sources":
      patchBackgroundRun(threadId, msgId, callId, nested, (run) =>
        patchSubagentToolResult(run, ev.tool_call_id, { sources: ev.sources }),
      );
      return;
    case "fetched":
      patchBackgroundRun(threadId, msgId, callId, nested, (run) =>
        patchSubagentToolResult(run, ev.tool_call_id, { file: ev.file }),
      );
      return;
    case "weather":
      patchBackgroundRun(threadId, msgId, callId, nested, (run) =>
        patchSubagentToolResult(run, ev.tool_call_id, { weather: ev.weather }),
      );
      return;
    case "tool_result":
      patchBackgroundRun(threadId, msgId, callId, nested, (run) =>
        patchSubagentToolResult(run, ev.tool_call_id, {
          result: { output: ev.output, ok: ev.ok, truncated: ev.truncated },
        }),
      );
      return;
    default:
      return;
  }
}

function bufferBackgroundDelta(
  threadId: string,
  msgId: string,
  callId: string,
  agentId: string,
  nested: string[],
  type: "reasoning" | "text",
  value: string,
) {
  const r = rec(threadId);
  // Свой буфер на каждого вложенного: дельты разных агентов не склеиваются.
  const key = `${agentId}\n${nested.join("/")}`;
  let buf = r.bgBuffer.get(key);
  if (!buf) {
    buf = { msgId, callId, nested, reasoning: "", text: "" };
    r.bgBuffer.set(key, buf);
  }
  buf[type] += value;
  if (!r.bgFlush) {
    r.bgFlush = setTimeout(() => flushBackgroundBuffer(threadId), SUBAGENT_FLUSH_MS);
  }
}

function flushBackgroundBuffer(threadId: string) {
  const r = rec(threadId);
  if (r.bgFlush) {
    clearTimeout(r.bgFlush);
    r.bgFlush = 0;
  }
  if (r.bgBuffer.size === 0) return;
  const entries = [...r.bgBuffer.values()];
  r.bgBuffer.clear();
  patchMessages(threadId, (msgs) =>
    msgs.map((m) => {
      let mm = m;
      for (const b of entries) {
        if (b.msgId !== m.id) continue;
        if (b.reasoning) {
          mm = patchSubagentStep(mm, b.callId, (run) =>
            patchNestedRun(run, b.nested, (inner) => appendSubagentReasoning(inner, b.reasoning)),
          );
        }
        if (b.text) {
          mm = patchSubagentStep(mm, b.callId, (run) =>
            patchNestedRun(run, b.nested, (inner) => appendSubagentText(inner, b.text)),
          );
        }
      }
      return mm;
    }),
  );
}

/** Проставить итоговый статус агента на его шаге task (где бы тот ни был).
 *  question — текст вопроса при status=waiting (на карточку). */
function markBackgroundStatus(
  threadId: string,
  agentId: string,
  status: BackgroundStatus,
  question?: string | null,
) {
  patchMessages(threadId, (msgs) =>
    msgs.map((m) => {
      let hit = false;
      const parts = (m.parts ?? []).map((p) => {
        if (p.type !== "chain") return p;
        const steps = p.steps.map((s) => {
          if (
            s.kind === "tool" &&
            s.background?.agent_id === agentId &&
            (s.background.status !== status || (question && s.background.question !== question))
          ) {
            hit = true;
            return {
              ...s,
              background: { ...s.background, status, question: question ?? s.background.question },
            };
          }
          return s;
        });
        return hit ? { ...p, steps } : p;
      });
      return hit ? { ...m, parts } : m;
    }),
  );
}

/**
 * Связать ответы оркестратора с вопросами субагентов. Ответ на вопрос — это
 * новый вызов task с `agent_id` того субагента; его description и есть ответ.
 * Ставим его полем `answer` на ИСХОДНЫЙ шаг (id === agent_id, у фоновых —
 * background.agent_id): карточка показывает «вопрос → ответ» на одном месте, а
 * продолжение рисуется своей карточкой с пометкой. Идемпотентно: неизменённые
 * шаги сохраняют ссылку (memo строк не ломается).
 */
function linkTaskAnswers(msgs: ChatMessage[]): ChatMessage[] {
  const answers = new Map<string, string>(); // agent_id -> ответ (последний)
  const answered = new Set<string>(); // id вызовов-ответов: сами не адресаты
  for (const m of msgs) {
    for (const p of m.parts ?? []) {
      if (p.type !== "chain") continue;
      for (const s of p.steps) {
        if (s.kind !== "tool" || s.name !== "task") continue;
        const agentId = typeof s.args?.agent_id === "string" ? s.args.agent_id : "";
        const text = typeof s.args?.description === "string" ? s.args.description.trim() : "";
        if (agentId && text && s.id) {
          answers.set(agentId, text);
          answered.add(s.id);
        }
      }
    }
  }
  if (answers.size === 0) return msgs;
  let changed = false;
  const out = msgs.map((m) => {
    let hit = false;
    const parts = (m.parts ?? []).map((p) => {
      if (p.type !== "chain") return p;
      const steps = p.steps.map((s) => {
        if (s.kind !== "tool" || s.name !== "task" || !s.id || answered.has(s.id)) return s;
        const answer = answers.get(s.id) ?? answers.get(s.background?.agent_id ?? "");
        if (!answer || s.answer === answer) return s;
        hit = true;
        return { ...s, answer };
      });
      return hit ? { ...p, steps } : p;
    });
    if (hit) changed = true;
    return hit ? { ...m, parts } : m;
  });
  return changed ? out : msgs;
}

/** Попросить доставку репорта — сразу, если сессия свободна, иначе по концу хода. */
function requestDelivery(threadId: string) {
  const r = rec(threadId);
  if (r.state.isStreaming || r.ctrl) {
    r.followUp = true;
    return;
  }
  void chatStreams.deliver(threadId);
}

/** Конец любого хода: если сервер пометил репорт ждущим — просим доставку. */
function afterTurn(threadId: string, cbs: RunCallbacks) {
  const r = rec(threadId);
  // Реплики, до которых агент не дошёл (ход кончился раньше границы), уходят
  // обычным сообщением — и первыми: это слова человека, а репорты фоновых
  // агентов сервер сам подклеит к ним (claim_for_turn в /chat).
  if (r.interjects.size) {
    const items = [...r.interjects.values()];
    r.interjects.clear();
    r.followUp = false;
    patchMessages(threadId, (msgs) => msgs.filter((m) => !m.pending));
    const attachments = items.flatMap((i) => i.attachments ?? []);
    void chatStreams.start(threadId, {
      ...items[0],
      visibleText: items.map((i) => i.visibleText).join("\n\n"),
      sendMessage: items.map((i) => i.sendMessage).join("\n\n"),
      attachments: attachments.length ? attachments : undefined,
      onTitle: cbs.onTitle ?? items[0].onTitle,
      onDone: cbs.onDone ?? items[0].onDone,
    });
    return;
  }
  if (!r.followUp) return;
  r.followUp = false;
  void chatStreams.deliver(threadId, cbs);
}

/** Скопить дельту reasoning/text сабагента в буфер и запланировать слив. */
function bufferSubagentDelta(
  threadId: string,
  assistantId: string,
  agentKey: string,
  type: "reasoning" | "text",
  value: string,
) {
  const r = rec(threadId);
  let buf = r.subagentBuffer.get(agentKey);
  if (!buf) {
    buf = { reasoning: "", text: "" };
    r.subagentBuffer.set(agentKey, buf);
  }
  buf[type] += value;
  if (!r.subagentFlush) {
    r.subagentFlush = setTimeout(() => flushSubagentBuffer(threadId, assistantId), SUBAGENT_FLUSH_MS);
  }
}

/**
 * Слить накопленные дельты всех сабагентов в ленту ОДНИМ patchMessages. Карта
 * хранит вставку в порядке первого появления агента, поэтому привязка
 * agentKey→task (resolveTaskCallId) сохраняет порядок. После слива буфер пуст.
 */
function flushSubagentBuffer(threadId: string, assistantId: string) {
  const r = rec(threadId);
  if (r.subagentFlush) {
    clearTimeout(r.subagentFlush);
    r.subagentFlush = 0;
  }
  if (r.subagentBuffer.size === 0) return;
  const entries = [...r.subagentBuffer.entries()];
  r.subagentBuffer.clear();

  patchMessages(threadId, (msgs) =>
    msgs.map((m) => {
      if (m.id !== assistantId) return m;
      let mm = m;
      for (const [agentKey, buf] of entries) {
        const { top, nested } = splitAgentKey(agentKey);
        const callId = resolveTaskCallId(r, mm, top);
        if (!callId) continue;
        if (buf.reasoning) {
          mm = patchSubagentStep(mm, callId, (run) =>
            patchNestedRun(run, nested, (inner) => appendSubagentReasoning(inner, buf.reasoning)),
          );
        }
        if (buf.text) {
          mm = patchSubagentStep(mm, callId, (run) =>
            patchNestedRun(run, nested, (inner) => appendSubagentText(inner, buf.text)),
          );
        }
      }
      return mm;
    }),
  );
}

/**
 * Применить событие сабагента (поле agent задано) к ленте соответствующего шага
 * task. Возвращает true, если событие обработано как сабагентское (тогда базовый
 * applyEvent его дальше не трогает).
 *
 * reasoning/text сабагентов буферизуются (throttle, см. bufferSubagentDelta) —
 * их потоки самые болтливые. Структурные события (tool/sources/fetched) идут
 * сразу, НО перед ними буфер сливается, иначе reasoning «перепрыгнул» бы через
 * tool и порядок шагов в ленте сабагента сломался бы.
 */
function applySubagentEvent(
  threadId: string,
  ev: ChatEvent,
  assistantId: string,
): boolean {
  // Только события с этими типами носят поле agent; у остальных его нет.
  if (
    ev.type !== "text" &&
    ev.type !== "reasoning" &&
    ev.type !== "tool" &&
    ev.type !== "sources" &&
    ev.type !== "fetched" &&
    ev.type !== "weather"
  ) {
    return false;
  }
  const agentKey = ev.agent;
  if (!agentKey) return false; // оркестратор → обычный путь

  // Болтливые потоки — в буфер (throttle). Слив раз в SUBAGENT_FLUSH_MS.
  if (ev.type === "reasoning" || ev.type === "text") {
    bufferSubagentDelta(threadId, assistantId, agentKey, ev.type, ev.value);
    return true;
  }

  // Структурные события — сразу, но СНАЧАЛА сливаем буфер, чтобы reasoning/text,
  // пришедшие до этого tool, легли в ленту ПЕРЕД ним (иначе порядок шагов
  // сабагента сломается: дельты из буфера допишутся уже после tool-шага).
  flushSubagentBuffer(threadId, assistantId);

  const r = rec(threadId);
  patchMessages(threadId, (msgs) =>
    msgs.map((m) => {
      if (m.id !== assistantId) return m;
      const { top, nested } = splitAgentKey(agentKey);
      const callId = resolveTaskCallId(r, m, top);
      if (!callId) return m; // шага task ещё нет — пропускаем (редкая гонка)
      const patch = (fn: (run: SubagentRun) => SubagentRun) =>
        patchSubagentStep(m, callId, (run) => patchNestedRun(run, nested, fn));
      switch (ev.type) {
        case "tool":
          return patch((run) =>
            upsertSubagentTool(run, {
              id: ev.id,
              name: ev.name,
              args: ev.args,
              state: ev.state ?? "available",
            }),
          );
        case "sources":
          return patch((run) =>
            patchSubagentToolResult(run, ev.tool_call_id, { sources: ev.sources }),
          );
        case "fetched":
          return patch((run) => patchSubagentToolResult(run, ev.tool_call_id, { file: ev.file }));
        case "weather":
          return patch((run) =>
            patchSubagentToolResult(run, ev.tool_call_id, { weather: ev.weather }),
          );
        default:
          return m;
      }
    }),
  );
  return true;
}

/** Применить один SSE-кадр к сообщению ассистента сессии. */
function applyEvent(
  threadId: string,
  ev: ChatEvent,
  assistantId: string,
  onTitle?: (title: string) => void,
) {
  // События сабагентов (deep-research) уходят в ленту своего шага task, а не в
  // основную ленту оркестратора. Если событие сабагентское — здесь и завершаем.
  if (applySubagentEvent(threadId, ev, assistantId)) return;

  const patch = (fn: (m: ChatMessage) => ChatMessage) =>
    patchMessages(threadId, (msgs) =>
      msgs.map((m) => (m.id === assistantId ? fn(m) : m)),
    );

  switch (ev.type) {
    case "text":
      patch((m) => {
        const parts = [...(m.parts ?? [])];
        const last = parts[parts.length - 1];
        if (last && last.type === "text") {
          parts[parts.length - 1] = { ...last, text: last.text + ev.value };
        } else {
          parts.push({ type: "text", text: ev.value });
        }
        return { ...m, parts, content: m.content + ev.value };
      });
      break;
    case "reasoning":
      patch((m) => {
        const parts = [...(m.parts ?? [])];
        const chain = lastChain(parts);
        const steps = [...chain.steps];
        const last = steps[steps.length - 1];
        if (last && last.kind === "reasoning") {
          steps[steps.length - 1] = { ...last, text: last.text + ev.value };
        } else {
          steps.push({ kind: "reasoning", text: ev.value });
        }
        parts[parts.length - 1] = { ...chain, steps };
        return { ...m, parts };
      });
      break;
    case "reasoning_summary":
      // Блок рассуждений завершён и сжат в фразу. Находим seq-й reasoning-шаг
      // ОСНОВНОЙ ленты (по всем chain-частям в порядке следования) и вешаем
      // фразу. Сырой text НЕ затираем: он нужен анимации замены (старый текст
      // растворяется под выезжающей фразой, см. ReasoningSummarySwap) — но
      // после неё не рисуется нигде. История, в отличие от стрима, шлёт
      // text="" сразу: там анимации нет и сырой текст на фронт не уходит.
      // Шаги сабагентов живут внутри tool-шагов (subagent) и в счёт не входят
      // — как и на бэке, который считает только события без поля agent.
      patch((m) => {
        let n = -1;
        let hit = false;
        const parts = (m.parts ?? []).map((p) => {
          if (hit || p.type !== "chain") return p;
          const steps = p.steps.map((s) => {
            if (hit || s.kind !== "reasoning") return s;
            n += 1;
            if (n !== ev.seq) return s;
            hit = true;
            return { ...s, summary: ev.text };
          });
          return { ...p, steps };
        });
        // Шаг не нашёлся (retry успел смыть ленту) — событие устарело, молча
        // пропускаем.
        return hit ? { ...m, parts } : m;
      });
      break;
    case "tool":
      // Стрим аргументов: первое событие (streaming) добавляет шаг, последующие
      // (дозревающие args, затем available) обновляют его НА МЕСТЕ по id —
      // иначе один вызов превратился бы в десяток шагов.
      patch((m) => {
        const state = ev.state ?? "available";
        // Дозревший вызов task: отметка старта для таймера на карточке.
        const extra: Partial<Extract<ThoughtStep, { kind: "tool" }>> =
          ev.name === "task" && state === "available" ? { startedAt: Date.now() } : {};
        // Уже есть шаг с этим id? → обновляем args/state. sources/file/прочее
        // (приходят отдельными событиями) не трогаем. startedAt не
        // перезаписываем: кадр available приходит и повторно (снимок).
        const updated = patchToolStep(m, ev.id, { args: ev.args, state });
        if (updated !== m) {
          return extra.startedAt
            ? patchToolStepIf(updated, ev.id, (s) => (s.startedAt ? null : extra))
            : updated;
        }
        // Нового шага ещё нет → добавляем.
        const parts = [...(m.parts ?? [])];
        const chain = lastChain(parts);
        parts[parts.length - 1] = {
          ...chain,
          steps: [
            ...chain.steps,
            { kind: "tool", id: ev.id, name: ev.name, args: ev.args, state, ...extra },
          ],
        };
        return { ...m, parts };
      });
      // Ответ оркестратора субагенту (task с agent_id) — на исходный шаг.
      if (ev.name === "task" && (ev.state ?? "available") === "available" && ev.args?.agent_id) {
        patchMessages(threadId, linkTaskAnswers);
      }
      break;
    case "tool_result":
      // Результат bash/file-тула (avy-code): output + ok/error статус.
      patch((m) =>
        patchToolStep(m, ev.tool_call_id, {
          result: { output: ev.output, ok: ev.ok, truncated: ev.truncated },
        }),
      );
      break;
    case "sources":
      // Результат web_search: привязываем источники к tool-шагу по tool_call_id.
      patch((m) => patchToolStep(m, ev.tool_call_id, { sources: ev.sources }));
      break;
    case "fetched":
      // Результат web_fetch: скачанный файл → в tool-шаг (карточка/превью).
      patch((m) => patchToolStep(m, ev.tool_call_id, { file: ev.file }));
      break;
    case "weather":
      // Результат get_weather: данные → в tool-шаг, дальше рисуется виджетом
      // вне цепочки рассуждений (см. tool-steps.tsx).
      patch((m) => patchToolStep(m, ev.tool_call_id, { weather: ev.weather }));
      break;
    case "title":
      onTitle?.(ev.value);
      break;
    case "summary":
      // Автоматическое сжатие контекста: вставляем маркер «Контекст сжат» ПЕРЕД
      // текущим ответом ассистента. Summary описывает, что было свёрнуто из
      // старой истории; текущий ответ — уже после сжатия. id генерируем на
      // месте (не стабильный, но и не нужен — summary не лайкают/не ретраят).
      patchMessages(threadId, (msgs) => {
        const idx = msgs.findIndex((m) => m.id === assistantId);
        if (idx === -1) return msgs; // текущий ответ не найден — не вставляем
        const summaryMsg: ChatMessage = {
          id: `summary-${Date.now()}`,
          role: "summary",
          content: ev.text,
        };
        return [...msgs.slice(0, idx), summaryMsg, ...msgs.slice(idx)];
      });
      break;
    case "permission_request": {
      // Code-режим: делегируем в code-streams (изолирован от основного стора).
      handlePermissionRequest(
        { rec, setState, beginRun, runTurn, resumeBubble },
        threadId,
        ev as { interrupt_id?: string; tool: string; args: Record<string, unknown> },
      );
      break;
    }
    case "ask_user_request": {
      // Агент вызвал ask_user — граф встал в interrupt, ждёт ответа человека.
      // isStreaming снимаем СРАЗУ: ход на паузе в чекпойнте, и пока карточка не
      // отвечена, стрим закрыт. Иначе инпут и кнопки остались бы заблокированы
      // «идущим» ходом, которого нет.
      const q = ev as { interrupt_id?: string; questions?: AskUserQuestionSpec[] };
      setState(threadId, {
        isStreaming: false,
        pendingQuestions: {
          interruptId: q.interrupt_id ?? null,
          questions: q.questions ?? [],
        },
      });
      break;
    }
    case "connector_request": {
      // Агент вызвал connector для неподключённого сервиса — граф в interrupt,
      // как у ask_user; карточка «Подключить» вместо поля ввода.
      const q = ev as { interrupt_id?: string; connector?: PendingConnector["connector"] };
      if (!q.connector) break;
      setState(threadId, {
        isStreaming: false,
        pendingConnector: { interruptId: q.interrupt_id ?? null, connector: q.connector },
      });
      break;
    }
    case "stopped":
      patch((m) => {
        const parts = [
          ...(m.parts ?? []),
          { type: "text" as const, text: STOP_MARKER },
        ];
        return { ...m, parts, content: m.content + STOP_MARKER };
      });
      break;
    case "retry":
      // Сервер повторяет ход после транзиентного обрыва (граф продолжит с
      // чекпойнта). Сбрасываем недописанный пузырь ассистента: перестримленный
      // шаг придёт заново, иначе текст/цепочка задвоятся. Завершённые ранее
      // тулы сервер НЕ перевыполняет — но их события мы уже показали; чистим
      // весь пузырь и ждём чистый перестрим (для пользователя — «подвисло и
      // продолжило»). isStreaming не трогаем — ход продолжается.
      patch((m) => ({ ...m, parts: [], content: "" }));
      break;
    case "error":
      // Бэк присылает code (limit_exceeded/gateway_unavailable/…). Кладём в стейт
      // ИМЕННО code — компонент переведёт его в локализованное сообщение. Старые
      // ходы без code (или ошибки не из стрима) показываем как есть (message).
      setState(threadId, { error: ev.code ?? ev.message });
      break;
    case "done":
      // Проставляем serverId на свежий ответ ПО МЕСТУ (только этот один пузырь),
      // чтобы сразу заработали лайк/дизлайк/ретрай. Высота не меняется (меняется
      // лишь serverId), цепочка уже свёрнута → скролл не дёргается.
      if (ev.message_id) {
        patch((m) => ({ ...m, serverId: ev.message_id }));
      }
      // За ход закончил фоновый агент — репорт ждёт. Доставку просим ПОСЛЕ
      // конца стрима (afterTurn): мы единственные, кто точно дочитал буфер.
      if (ev.follow_up) rec(threadId).followUp = true;
      break;
    case "subagent_started": {
      // Тула task ушла в фон: помечаем шаг и открываем ленту агента отдельным
      // SSE — стрим хода её не несёт, а сам ход сейчас закончится.
      const background = {
        agent_id: ev.agent_id,
        status: "running" as const,
        subagent_type: ev.subagent_type ?? null,
        title: ev.title ?? null,
      };
      patch((m) => patchToolStep(m, ev.tool_call_id, { background }));
      openBackgroundStream(threadId, assistantId, ev.tool_call_id, ev.agent_id);
      break;
    }
    case "report":
      // Репорт — сообщение для ассистента, не для ленты. В UI отдельной
      // карточки нет: итог виден на исходном блоке «Задача для агента» —
      // переводим его бейдж в конечный статус (лента агента уже полная).
      markBackgroundStatus(threadId, ev.agent_id, ev.status as BackgroundStatus, ev.question);
      break;
    case "task_title":
      // Заголовок задачи субагенту дозрел у flash-модели — на шаг по id.
      patch((m) => patchToolStep(m, ev.tool_call_id, { title: ev.text }));
      break;
    case "subagent_question":
      // Синхронный субагент встал на вопросе: шаг task — в «ждёт ответа».
      patch((m) => patchToolStep(m, ev.tool_call_id, { question: ev.question }));
      break;
    case "interject": {
      // Реплика человека дошла до агента: снимаем «ожидает» с её строки и
      // открываем НОВЫЙ пузырь ответа сразу после неё — так же ленту потом
      // покажет история (реплика → новый ответ). Хвост дельт сабагентов
      // сливаем в прежний пузырь ДО переключения.
      const r = rec(threadId);
      flushSubagentBuffer(threadId, assistantId);
      if (ev.id) r.interjects.delete(ev.id);
      const fresh: ChatMessage = { id: nextId(), role: "assistant", content: "", parts: [] };
      patchMessages(threadId, (msgs) => {
        // Две реплики забраны одной границей — кадры идут подряд, и пузырь,
        // открытый первым, пуст: не оставляем его между ними.
        const cur = msgs.find((m) => m.id === assistantId);
        const curEmpty = !!cur && !cur.content && !cur.parts?.length;
        const base = curEmpty ? msgs.filter((m) => m.id !== assistantId) : msgs;
        const idx = ev.id ? base.findIndex((m) => m.pending && m.serverId === ev.id) : -1;
        if (idx >= 0) {
          // Строка на месте (ожидающие стоят хвостом в порядке отправки):
          // ответ встаёт за ней, остальные ожидающие — после ответа.
          return [
            ...base.slice(0, idx),
            { ...base[idx], pending: false },
            fresh,
            ...base.slice(idx + 1),
          ];
        }
        // Чужая реплика (другая вкладка, или отправлена до перезагрузки):
        // строки у нас нет — рисуем по тексту кадра.
        return [
          ...base,
          { id: nextId(), role: "user", content: ev.text, serverId: ev.id ?? null },
          fresh,
        ];
      });
      r.assistantId = fresh.id;
      setState(threadId, { streamingId: fresh.id });
      break;
    }
  }
}

type RunCallbacks = {
  onTitle?: (title: string) => void;
  onDone?: (threadId: string) => void;
};

/** Вход хода от человека: что показать, что отправить, с какими параметрами.
 *  Общий для start (новый ход) и interject (реплика посреди идущего). */
type TurnInput = {
  visibleText: string;
  sendMessage: string;
  attachments?: Attachment[];
  modelId?: string;
  effort?: string | null;
  mode?: string | null;
  permissionMode?: string | null;
  agentId?: string | null;
} & RunCallbacks;

/**
 * Кадры, после которых ход на сервере окончен: done — штатный конец, stopped —
 * остановка (человеком или брошенный ход), error — ход упал. Дальше в ленте
 * ничего не будет, и ждать закрытия HTTP-потока незачем — конец хода
 * определяется СОДЕРЖАНИЕМ кадров, а не транспортом: прокси может подержать
 * соединение, сервер — дописать служебные кадры (фразы рассуждений) после.
 */
function isTerminal(ev: ChatEvent): boolean {
  return ev.type === "done" || ev.type === "stopped" || ev.type === "error";
}

/**
 * Прокрутить async-итератор кадров хода: считать каждый кадр, применить к
 * состоянию, вести счётчик frames (offset для reattach). Любой кадр учитывается
 * в frames — так reattach с offset=frames не повторит уже показанное.
 *
 * `ctrl` — контроллер этого цикла. Кадр применяется, только пока цикл владеет
 * записью (r.ctrl === ctrl): после detach/нового хода оставшиеся в буфере
 * fetch-а кадры не должны ни лечь в ленту, ни сдвинуть frames — иначе reattach,
 * уже стартовавший с прежнего offset, показал бы их второй раз.
 *
 * Пузырь-приёмник читаем из записи на каждом кадре: реплика человека (кадр
 * `interject`) открывает новый посреди хода.
 */
async function consume(
  threadId: string,
  source: AsyncGenerator<ChatEvent>,
  ctrl: AbortController,
  cbs: RunCallbacks,
): Promise<void> {
  const r = rec(threadId);
  try {
    for await (const ev of source) {
      if (r.ctrl !== ctrl) return;
      r.frames += 1;
      applyEvent(threadId, ev, r.assistantId ?? "", cbs.onTitle);
      if (isTerminal(ev)) return;
    }
  } finally {
    // Слить хвост буфера сабагентов: последние дельты (за <FLUSH_MS до конца или
    // до отмены/ошибки) иначе не попали бы в ленту. finally покрывает и throw.
    flushSubagentBuffer(threadId, r.assistantId ?? "");
  }
}

/**
 * Пузырь-приёмник для ПРОДОЛЖЕНИЯ хода после карточки (подтверждение, вопрос,
 * подключение). Ход тот же самый, и продолжение должно дописаться в прежний
 * пузырь. Но прежнего пузыря в ленте может уже не быть: после перечитывания
 * истории (реаттач, возврат в окно, вход в сервис во внешнем браузере) у
 * сообщений новые id, а r.assistantId сброшен или указывает в пустоту — и все
 * кадры продолжения падали бы мимо ленты. Тогда открываем новый пузырь в
 * конце ленты.
 */
function resumeBubble(threadId: string): string {
  const r = rec(threadId);
  const known = r.assistantId;
  if (known && r.state.messages.some((m) => m.id === known)) return known;
  const fresh = nextId();
  patchMessages(threadId, (msgs) => [
    ...msgs,
    { id: fresh, role: "assistant", content: "", parts: [] },
  ]);
  r.assistantId = fresh;
  if (!r.turnStart) r.turnStart = fresh;
  return fresh;
}

/**
 * Начать локальный цикл хода: пузырь-приёмник, флаг стрима, владение записью.
 * Возвращает контроллер, которым цикл потом завершает ход (finishRun).
 */
function beginRun(threadId: string, assistantId: string): AbortController {
  const r = rec(threadId);
  const ctrl = new AbortController();
  r.ctrl = ctrl;
  r.assistantId = assistantId;
  setState(threadId, { isStreaming: true, streamingId: assistantId, error: null });
  return ctrl;
}

/**
 * Ход, который вёл этот цикл, окончен (терминальный кадр, конец потока,
 * ошибка сети или abort по «Стоп»). Ничего не делает, если запись уже у
 * другого цикла: тогда конец ЭТОГО цикла ничего не значит для ленты.
 */
function finishRun(threadId: string, ctrl: AbortController, cbs: RunCallbacks): void {
  const r = rec(threadId);
  if (r.ctrl !== ctrl) return;
  r.ctrl = null;
  // Кадры кончились раньше потока (терминальный кадр) — отпускаем соединение.
  ctrl.abort();
  setState(threadId, { isStreaming: false, streamingId: null });
  cbs.onDone?.(threadId);
  afterTurn(threadId, cbs);
}

/**
 * Прогнать ход целиком: цикл кадров + завершение. Ошибка сети — в состояние;
 * AbortError при живом владении — это «Стоп» (stop() рвёт fetch, не отдавая
 * запись), и ход тоже завершён. Потеря владения (detach, новый ход) — выход
 * молча: ход на сервере жив или уже чужой.
 */
async function runTurn(
  threadId: string,
  ctrl: AbortController,
  source: AsyncGenerator<ChatEvent>,
  cbs: RunCallbacks,
): Promise<void> {
  const r = rec(threadId);
  try {
    await consume(threadId, source, ctrl, cbs);
  } catch (e) {
    if (r.ctrl !== ctrl) return;
    if ((e as Error).name !== "AbortError") {
      setState(threadId, { error: (e as Error).message });
    }
  }
  finishRun(threadId, ctrl, cbs);
}

/**
 * Продолжить ход после карточки (вопрос ask_user или коннектор): тот же путь,
 * что обычный ход, но с полем `answers` вместо сообщения — бэк подаёт его в
 * граф как Command(resume=...), граф выходит из interrupt и досчитывает ход.
 */
async function resumeWithAnswers(threadId: string, answers: AskUserAnswer[] | ConnectorAnswer) {
  const r = rec(threadId);
  // Пузырь ассистента переиспользуем: ход тот же самый, продолжение должно
  // дописаться в него, а не начать новый (иначе в ленте два ответа на одну
  // реплику пользователя). Нет его в ленте — новый (см. resumeBubble).
  const assistantId = resumeBubble(threadId);

  const run = r.codeRun;
  const cbs = { onTitle: run?.onTitle, onDone: run?.onDone };
  const ctrl = beginRun(threadId, assistantId);
  await runTurn(
    threadId,
    ctrl,
    streamChat(
      {
        message: "",
        threadId,
        modelId: run?.modelId,
        effort: run?.effort,
        agentId: run?.agentId,
        permissionMode: run?.permissionMode,
        answers,
      },
      ctrl.signal,
    ),
    cbs,
  );
}

export const chatStreams = {
  /** Снимок состояния сессии (для useSyncExternalStore). */
  getState(threadId: string): ThreadState {
    return records.get(threadId)?.state ?? EMPTY;
  },

  /** Выставить текст ошибки сессии (напр. неудачное прикрепление файла). */
  setError(threadId: string, message: string | null) {
    setState(threadId, { error: message });
  },

  /** Идёт ли сейчас ход в сессии. */
  isStreaming(threadId: string): boolean {
    return records.get(threadId)?.state.isStreaming ?? false;
  },

  /** Есть ли у сессии уже сообщения в сторе (живые/завершённые/загруженные). */
  hasMessages(threadId: string): boolean {
    return (records.get(threadId)?.state.messages.length ?? 0) > 0;
  },

  subscribe(threadId: string, cb: () => void): () => void {
    const r = rec(threadId);
    r.listeners.add(cb);
    touch(threadId); // открыли/смотрим тред — он самый свежий в LRU
    return () => {
      r.listeners.delete(cb);
    };
  },

  /** Загрузить готовую историю (открытие сессии без активного хода). */
  setHistory(
    threadId: string,
    history: {
      role: Role;
      content: string;
      parts?: MessagePart[];
      tokens?: number | null;
      id?: string | null;
      interject?: boolean;
      feedback?: "up" | "down" | null;
      report?: SubagentReport;
    }[],
  ) {
    const r = rec(threadId);
    // Сообщения истории получают новые id — ленты агентов, открытые на прежние,
    // патчили бы пустоту. Закрываем и переоткрываем на свежие (ниже).
    abortBackgroundStreams(r);
    const all: ChatMessage[] = linkTaskAnswers(
      history.map((h) => ({
        id: nextId(),
        role: h.role,
        content: h.content,
        parts: h.parts,
        tokens: h.tokens ?? null,
        serverId: h.id ?? null,
        feedback: h.feedback ?? null,
        report: h.report,
        interject: h.interject,
      })),
    );

    // Вход в сессию, где УЖЕ идёт ход: reattach обычно успевает раньше загрузки
    // истории (кадры лежат в буфере и приходят сразу, а история — это ещё один
    // HTTP + два rAF). Раньше здесь стоял ранний выход при isStreaming, и
    // история молча терялась. Поэтому не отбрасываем её, а подставляем ПЕРЕД
    // живым ходом; сам стрим и его состояние не трогаем.
    if (r.state.isStreaming) {
      // Живой ход — авторитет для своего отрезка (реплей буфера отдаёт его с
      // первого кадра), история — для всего, что было до него. Прежняя логика
      // считала живым любое сообщение без serverId, а чекпойнт пишется после
      // КАЖДОГО шага: пузыри ассистента идущего хода уже лежали в истории и
      // без serverId — и ответ показывался дважды при каждом входе в сессию
      // с работающим агентом (поймано 20.09 на реплике посреди хода: дубль
      // обоих пузырей).
      const live = r.state.messages;
      const startIdx = r.turnStart ? live.findIndex((m) => m.id === r.turnStart) : -1;
      const liveTail = startIdx >= 0 ? live.slice(startIdx) : unsavedMessages(live, all);
      r.allMessages = [...historyBeforeLiveTurn(all, liveTail), ...liveTail];
      setState(threadId, {
        messages: r.allMessages.slice(-HISTORY_PAGE),
      });
      attachRunningBackground(threadId, r.allMessages);
      return;
    }

    r.turnStart = null;
    r.allMessages = all;
    // Агенты, которые по истории ещё работают, — к их живым лентам.
    attachRunningBackground(threadId, all);
    // В state кладём только хвост — React рендерит малый срез, не весь массив.
    r.state = {
      messages: all.slice(-HISTORY_PAGE),
      isStreaming: false,
      streamingId: null,
      error: null,
      pendingPermissions: [],
      pendingQuestions: null,
      pendingConnector: null,
    };
    r.frames = 0;
    r.assistantId = null;
    emit(r);
  },

  /**
   * Карточки хода на паузе — из истории (сервер отдаёт `pending`). Раньше
   * карточка жила только в памяти вкладки: любое перечитывание истории
   * (возврат в окно, переподключение, повторное открытие) убирало её без
   * возврата, и ход висел на паузе (29.09: «пропала, будто нажал Esc»).
   * Очередь приходит целиком — уже данные в этой паузе решения сбрасываем.
   */
  setPending(threadId: string, pending: PendingEvent[]) {
    const r = rec(threadId);
    if (r.state.isStreaming || !pending.length) return;
    // Продолжение идёт параметрами прерванного хода; после перезагрузки их
    // нет — берём текущие параметры чата (модель, глубина, режим, агент).
    if (!r.codeRun && r.turnParams) {
      r.codeRun = {
        modelId: r.turnParams.modelId,
        effort: r.turnParams.effort,
        mode: r.turnParams.mode ?? null,
        agentId: r.turnParams.agentId,
      };
    }
    r.pendingDecisions = [];
    const permissions: PendingPermission[] = pending
      .filter((e) => e.type === "permission_request")
      .map((e) => ({
        interruptId: e.interrupt_id ?? null,
        tool: e.tool ?? "",
        args: e.args ?? {},
        description: e.description ?? "",
      }));
    const question = pending.find((e) => e.type === "ask_user_request");
    const connector = pending.find((e) => e.type === "connector_request" && e.connector);
    setState(threadId, {
      pendingPermissions: permissions,
      pendingQuestions: question
        ? { interruptId: question.interrupt_id ?? null, questions: (question.questions ?? []) as AskUserQuestionSpec[] }
        : null,
      pendingConnector: connector
        ? { interruptId: connector.interrupt_id ?? null, connector: connector.connector as PendingConnector["connector"] }
        : null,
    });
  },

  /** Подгрузить следующую порцию истории (scroll вверх). */
  loadMore(threadId: string): boolean {
    const r = rec(threadId);
    const shown = r.state.messages.length;
    const total = r.allMessages.length;
    if (shown >= total) return false;
    const newSlice = r.allMessages.slice(-Math.min(shown + HISTORY_PAGE, total));
    setState(threadId, { messages: newSlice });
    return newSlice.length < total;
  },

  /** Есть ли ещё история выше видимых сообщений. */
  hasMore(threadId: string): boolean {
    const r = rec(threadId);
    return r.state.messages.length < r.allMessages.length;
  },

  /** Сбросить ленту черновика (новая пустая сессия). */
  reset(threadId: string) {
    const r = rec(threadId);
    if (r.state.isStreaming) return; // активный ход не трогаем
    r.state = EMPTY;
    r.frames = 0;
    r.assistantId = null;
    r.turnStart = null;
    emit(r);
  },

  /**
   * Запустить ход: добавить сообщения пользователя+ассистента, открыть стрим.
   * sendMessage уже содержит блок «Прикреплённые файлы:» (готовит вызывающий).
   */
  async start(threadId: string, opts: TurnInput) {
    const r = rec(threadId);
    if (r.state.isStreaming) return;

    // Параметры хода для возобновления с паузы. Раньше сохранялись ТОЛЬКО в
    // режиме Avy Code (там пауза бывает на approval); теперь пауза возможна и в
    // обычном чате — на вопросе тулы ask_user, — и возобновлять его надо теми же
    // моделью/агентом, иначе продолжение уехало бы на другой агент.
    r.codeRun = {
      modelId: opts.modelId,
      effort: opts.effort,
      mode: opts.mode,
      permissionMode: opts.permissionMode,
      agentId: opts.agentId,
      onTitle: opts.onTitle,
      onDone: opts.onDone,
    };

    const userMsgId = nextId();
    const assistantId = nextId();
    r.frames = 0;
    r.turnStart = userMsgId; // ход начинается с этой реплики (см. setHistory)
    r.subagentMap = new Map(); // связки сабагентов — на каждый ход свои
    // Буфер дельт сабагентов — тоже на каждый ход свой (хвост прошлого хода уже
    // слит в consume.finally; на всякий случай гасим возможный висящий таймер).
    if (r.subagentFlush) {
      clearTimeout(r.subagentFlush);
      r.subagentFlush = 0;
    }
    r.subagentBuffer = new Map();
    // Параметры хода — ими пойдёт ход доставки репорта, если агент закончит.
    r.turnParams = {
      modelId: opts.modelId,
      effort: opts.effort,
      mode: opts.mode,
      agentId: opts.agentId,
    };

    patchMessages(threadId, (msgs) => [
      ...msgs,
      {
        id: userMsgId,
        role: "user",
        content: opts.visibleText,
        attachments: opts.attachments,
      },
      { id: assistantId, role: "assistant", content: "", parts: [] },
    ]);
    r.pendingDecisions = [];
    setState(threadId, { pendingPermissions: [] });

    const ctrl = beginRun(threadId, assistantId);
    await runTurn(
      threadId,
      ctrl,
      streamChat(
        {
          message: opts.sendMessage,
          threadId,
          modelId: opts.modelId,
          effort: opts.effort,
          mode: opts.mode,
          permissionMode: opts.permissionMode,
          agentId: opts.agentId,
        },
        ctrl.signal,
      ),
      opts,
    );
  },

  /**
   * Реплика посреди идущего хода: агент получит её перед следующим вызовом
   * модели. Строка сразу встаёт в ленту с пометкой «ожидает»; кадр `interject`
   * снимает пометку и открывает новый пузырь ответа. Хода уже нет — это
   * обычный start.
   */
  async interject(threadId: string, opts: TurnInput) {
    const r = rec(threadId);
    if (!r.state.isStreaming) return chatStreams.start(threadId, opts);
    const id = interjectId();
    r.interjects.set(id, opts);
    patchMessages(threadId, (msgs) => [
      ...msgs,
      {
        id: nextId(),
        role: "user",
        content: opts.visibleText,
        attachments: opts.attachments,
        serverId: id,
        pending: true,
      },
    ]);
    const res = await interjectTurn(threadId, opts.sendMessage, id);
    if (res === "queued") return;
    if (res === "no_turn" && r.state.isStreaming) {
      // Сервер хода не видит, а мы ещё дочитываем его хвост (или он не успел
      // начаться): `done` вот-вот придёт, и afterTurn отправит реплику
      // обычным сообщением. Строка остаётся ждать.
      return;
    }
    r.interjects.delete(id);
    patchMessages(threadId, (msgs) => msgs.filter((m) => !(m.pending && m.serverId === id)));
    if (res === "no_turn") return chatStreams.start(threadId, opts);
    setState(threadId, { error: "Не удалось передать сообщение агенту — попробуйте ещё раз." });
  },

  /**
   * Ответить на карточку вопроса (тула ask_user) и продолжить ход.
   *
   * Все вопросы карточки отвечаются разом — тула ждёт массив по числу вопросов
   * (см. tools/ask_user.py). Продолжение идёт тем же путём, что обычный ход, но
   * с полем `answers` вместо сообщения: бэк подаёт его в граф как
   * Command(resume=...), граф выходит из interrupt и досчитывает ход.
   */
  async answerQuestions(threadId: string, answers: AskUserAnswer[]) {
    const r = rec(threadId);
    if (!r.state.pendingQuestions) return;

    // Карточку снимаем сразу: ответ зафиксирован, второй раз её показывать
    // нечего, а её присутствие блокирует инпут. Флаг стрима ставит
    // resumeWithAnswers вместе с пузырём-приёмником.
    setState(threadId, { pendingQuestions: null });
    await resumeWithAnswers(threadId, answers);
  },

  /**
   * Ответить на карточку коннектора (тула connector): подключил или отказался.
   * Тот же канал `answers`, что у вопроса, — словарём {connected}.
   */
  async answerConnector(threadId: string, connected: boolean) {
    const r = rec(threadId);
    if (!r.state.pendingConnector) return;
    setState(threadId, { pendingConnector: null });
    await resumeWithAnswers(threadId, { connected });
  },

  /**
   * Режим Avy Code: ответить на одну карточку из очереди.
   * Делегируем в code-streams (изолирован от основного стора).
   */
  async resolvePermission(threadId: string, decision: "approve" | "reject", comment?: string) {
    await codeResolvePermission(
      { rec, setState, beginRun, runTurn, resumeBubble },
      threadId,
      decision,
      comment,
    );
  },

  /**
   * Перегенерировать последний ответ агента. Срезаем последний ассистентский
   * пузырь из ленты, ставим пустой под новый стрим и открываем /retry. Сервер
   * чистит историю и заново отрабатывает прежнее сообщение пользователя.
   */
  async retry(
    threadId: string,
    opts: {
      modelId?: string;
      effort?: string | null;
      mode?: string | null;
    } & RunCallbacks = {},
  ) {
    const r = rec(threadId);
    if (r.state.isStreaming) return;
    // Нечего ретраить, если последнее сообщение не от ассистента.
    const msgs0 = r.state.messages;
    if (!msgs0.length || msgs0[msgs0.length - 1].role !== "assistant") return;

    const assistantId = nextId();
    r.turnStart = assistantId; // ход = новый пузырь, реплика человека — из истории
    r.frames = 0;
    r.subagentMap = new Map();
    if (r.subagentFlush) {
      clearTimeout(r.subagentFlush);
      r.subagentFlush = 0;
    }
    r.subagentBuffer = new Map();

    // Заменяем последний ассистентский пузырь пустым под новый стрим.
    patchMessages(threadId, (msgs) => [
      ...msgs.slice(0, -1),
      { id: assistantId, role: "assistant", content: "", parts: [] },
    ]);

    const ctrl = beginRun(threadId, assistantId);
    await runTurn(
      threadId,
      ctrl,
      streamRetry(
        {
          threadId,
          modelId: opts.modelId,
          effort: opts.effort,
          mode: opts.mode,
        },
        ctrl.signal,
      ),
      opts,
    );
  },

  /**
   * Отредактировать сообщение пользователя и перегенерировать ответ. Срезаем
   * ленту с этого сообщения (по serverId), ставим обновлённый пузырь юзера +
   * пустой ассистентский под стрим, открываем /edit.
   */
  async edit(
    threadId: string,
    serverId: string,
    newText: string,
    opts: {
      modelId?: string;
      effort?: string | null;
      mode?: string | null;
    } & RunCallbacks = {},
  ) {
    const r = rec(threadId);
    if (r.state.isStreaming) return;
    const idx = r.state.messages.findIndex((m) => m.serverId === serverId);
    if (idx < 0) return;

    const userMsgId = nextId();
    const assistantId = nextId();
    r.frames = 0;
    r.subagentMap = new Map();
    if (r.subagentFlush) {
      clearTimeout(r.subagentFlush);
      r.subagentFlush = 0;
    }
    r.subagentBuffer = new Map();

    // Оставляем всё ДО редактируемого сообщения, затем новый user + пустой ответ.
    r.turnStart = userMsgId;
    patchMessages(threadId, (msgs) => [
      ...msgs.slice(0, idx),
      { id: userMsgId, role: "user", content: newText },
      { id: assistantId, role: "assistant", content: "", parts: [] },
    ]);

    const ctrl = beginRun(threadId, assistantId);
    await runTurn(
      threadId,
      ctrl,
      streamEdit(
        {
          threadId,
          messageId: serverId,
          text: newText,
          modelId: opts.modelId,
          effort: opts.effort,
          mode: opts.mode,
        },
        ctrl.signal,
      ),
      opts,
    );
  },

  /**
   * Переподключиться к идущему на сервере ходу (после reload или возврата в
   * сессию, чей локальный цикл был отцеплен). Если хода нет — no-op (сервер
   * пришлёт только done). offset = сколько кадров уже показано (frames).
   */
  async reattach(threadId: string, cbs: RunCallbacks = {}) {
    const r = rec(threadId);
    // Уже есть живой локальный цикл (start или прошлый reattach) — второй не нужен.
    if (r.ctrl) return;

    // Ленты фоновых агентов — заново. detach() (уход из треда, возврат
    // вкладки) их обрывает, а переоткрывал только setHistory — который при
    // возврате в уже загруженный тред не зовётся. Так на проде 20.09 клиент
    // после первого же сворачивания вкладки переставал слышать агентов: не
    // видел их subagent_done, не просил доставку и не узнавал о ходе, который
    // сервер поднял сам. Повторное открытие живой ленты — no-op (bgStreams).
    // По ЖИВЫМ сообщениям, не по allMessages: см. liveMessages.
    attachRunningBackground(threadId, liveMessages(r));

    const ctrl = new AbortController();
    r.ctrl = ctrl;
    // ВАЖНО: isStreaming НЕ выставляем заранее — иначе параллельная загрузка
    // истории (setHistory) будет заблокирована, даже если живого хода нет. Ждём
    // первого СОДЕРЖАТЕЛЬНОГО кадра: если придёт только `done` (хода нет) —
    // состояние не трогаем, история загрузится как обычно.
    let started = false;
    // Мы СЧИТАЛИ, что ход идёт: локальный цикл отцепили (уход из сессии,
    // замороженная вкладка), а флаг остался ждать реаттача. Если сервер
    // ответит, что дочитывать нечего, — ход кончился без нас, и флаг надо
    // снять. Раньше такой ответ (одиночный done) выход «тихо» не трогал
    // состояние: ход в UI не заканчивался никогда — квадрат в поле ввода
    // горел, пока человек не жал «Стоп»; setHistory при живом флаге его тоже
    // сохранял, так что залипание переживало и переоткрытие сессии.
    const believedStreaming = r.state.isStreaming;
    // Сервер сказал, что наш offset — из прежнего хода (кадр `reset`): между
    // тем, что мы видели, и сейчас прошёл как минимум один ход без нас (сервер
    // сам вручил репорт фонового агента). Его ответ есть только в истории —
    // перечитываем её по концу стрима. Если ход ещё жив, кадры пойдут следом с
    // нуля — в новый пузырь.
    let resetSeen = false;
    try {
      const source = attachChat(threadId, r.frames, ctrl.signal);
      for await (const ev of source) {
        if (r.ctrl !== ctrl) return; // снова отцепились или стартовал новый ход
        if (!started) {
          if (ev.type === "reset") {
            resetSeen = true;
            r.frames = 0;
            r.assistantId = null;
            r.turnStart = null;
            continue;
          }
          if (ev.type === "done") {
            // Живого хода нет. Кадр не считаем: у пустого буфера он
            // синтетический, и offset уехал бы вперёд ленты. Но id ответа из
            // него — на пузырь: лайк и ретрай должны заработать.
            if (believedStreaming) applyEvent(threadId, ev, r.assistantId ?? "", cbs.onTitle);
            break;
          }
          started = true;
          // Нужен ассистентский пузырь под стрим. После reload его нет — создаём.
          if (!r.assistantId) {
            const assistantId = nextId();
            r.assistantId = assistantId;
            // Реплика человека этого хода в ленте отсутствует (кадры её не
            // несут) — она придёт из истории; живой ход начинается с пузыря.
            r.turnStart = assistantId;
            patchMessages(threadId, (msgs) => [
              ...msgs,
              { id: assistantId, role: "assistant", content: "", parts: [] },
            ]);
          }
          setState(threadId, { isStreaming: true, streamingId: r.assistantId, error: null });
        }
        r.frames += 1;
        applyEvent(threadId, ev, r.assistantId ?? "", cbs.onTitle);
        if (isTerminal(ev)) break;
      }
    } catch (e) {
      if (r.ctrl !== ctrl) return;
      if ((e as Error).name !== "AbortError") {
        if (started) setState(threadId, { error: (e as Error).message });
      }
    } finally {
      // Слить хвост буфера сабагентов и при успехе, и при отмене/ошибке reattach.
      if (started) flushSubagentBuffer(threadId, r.assistantId ?? "");
    }
    if (r.ctrl !== ctrl) return;
    r.ctrl = null;
    ctrl.abort();
    // Поток кончился — значит, хода на сервере больше нет (он закрывает
    // /attach только по концу хода). Флаг снимаем и если стримили сами, и
    // если лишь верили, что ход идёт.
    if (started || believedStreaming) {
      setState(threadId, { isStreaming: false, streamingId: null });
      cbs.onDone?.(threadId);
    }
    if (resetSeen) {
      // Пропущенные ходы лежат только в чекпойнте: тянем историю сами, не
      // дожидаясь, пока её перечитает компонент (он этого при возврате в
      // тред не делает). Ошибка сети не критична — история придёт при
      // следующем открытии треда.
      try {
        const history = await fetchThreadHistory(threadId);
        this.setHistory(threadId, history.messages);
        this.setPending(threadId, history.pending);
      } catch (e) {
        console.warn("history reload after reset failed", threadId, e);
      }
    }
    afterTurn(threadId, cbs);
  },

  /**
   * Попросить сервер вручить репорты фоновых агентов и показать ход
   * ассистента, который их разбирает. Зовётся, когда мы точно дочитали
   * прошлый ход (конец стрима с follow_up, конец ленты агента) и при
   * открытии сессии — вдруг агент закончил, пока вкладка была закрыта.
   * Пустой поток (204/409) — ничего не рисуем.
   */
  async deliver(threadId: string, cbs: RunCallbacks = {}) {
    const r = rec(threadId);
    if (r.ctrl || r.state.isStreaming) {
      r.followUp = true; // ход идёт — попросим по его концу
      return;
    }
    r.followUp = false;
    const ctrl = new AbortController();
    r.ctrl = ctrl;
    let started = false;
    let attachInstead = false;
    try {
      const source = deliverSubagentReports(threadId, r.turnParams ?? {}, ctrl.signal);
      for await (const ev of source) {
        if (r.ctrl !== ctrl) return; // отцепились или стартовал новый ход
        if (!started) {
          if (ev.type === "done") break;
          if ((ev as { type: string }).type === "turn_in_progress") {
            // Ход доставки поднял сам сервер — читаем его как чужой ход.
            attachInstead = true;
            break;
          }
          started = true;
          const assistantId = nextId();
          r.assistantId = assistantId;
          r.turnStart = assistantId; // репорт-вход хода придёт из истории
          r.frames = 0;
          r.subagentMap = new Map();
          if (r.subagentFlush) {
            clearTimeout(r.subagentFlush);
            r.subagentFlush = 0;
          }
          r.subagentBuffer = new Map();
          patchMessages(threadId, (msgs) => [
            ...msgs,
            { id: assistantId, role: "assistant", content: "", parts: [] },
          ]);
          setState(threadId, { isStreaming: true, streamingId: assistantId, error: null });
        }
        r.frames += 1;
        applyEvent(threadId, ev, r.assistantId ?? "", cbs.onTitle);
        if (isTerminal(ev)) break;
      }
    } catch (e) {
      if (r.ctrl !== ctrl) return;
      if ((e as Error).name !== "AbortError") {
        if (started) setState(threadId, { error: (e as Error).message });
      }
    } finally {
      if (started) flushSubagentBuffer(threadId, r.assistantId ?? "");
    }
    if (r.ctrl !== ctrl) return;
    r.ctrl = null;
    ctrl.abort();
    if (started) {
      setState(threadId, { isStreaming: false, streamingId: null });
      cbs.onDone?.(threadId);
    }
    if (attachInstead) {
      // Новый ход на сервере, начатый не нами: читаем с нуля в новый пузырь.
      r.frames = 0;
      r.assistantId = null;
      await this.reattach(threadId, cbs);
      return;
    }
    afterTurn(threadId, cbs);
  },

  /** Запомнить параметры хода (модель, агент) — ими пойдёт ход доставки. */
  setTurnParams(threadId: string, params: DeliverParams) {
    rec(threadId).turnParams = params;
  },

  /** Остановить фонового агента. Его репорт (cancelled) придёт как обычно. */
  stopBackground(threadId: string, agentId: string) {
    void stopSubagent(threadId, agentId);
  },

  /** Отцепить локальный цикл сессии БЕЗ отмены хода на сервере (уход из сессии). */
  detach(threadId: string) {
    const r = records.get(threadId);
    if (r?.ctrl) {
      r.ctrl.abort();
      r.ctrl = null;
    }
    // Ленты фоновых агентов — тоже: при возврате их переоткроет setHistory.
    if (r) abortBackgroundStreams(r);
    // Ушли из треда — момент почистить память от давно не открывавшихся сессий
    // (выгружаются только неактивные и без подписчиков; см. evictIdle).
    evictIdle();
  },

  /** Остановить ход (кнопка Stop / Esc): отменяем на сервере + локально. */
  stop(threadId: string) {
    void stopChat(threadId);
    const r = records.get(threadId);
    if (!r) return;
    // Инпут освобождаем СРАЗУ: ход на сервере уже отменён строкой выше
    // (stopChat), ждать нечего. Раньше флаг снимался только после abort через
    // 2 с и страховочного таймера — пользователь жал Stop и ещё три секунды
    // смотрел на заблокированное поле.
    setState(threadId, { isStreaming: false, streamingId: null });
    // Владение записью цикл СОХРАНЯЕТ: кадр `stopped` должен дойти и поставить
    // пометку «Остановлено пользователем», после него цикл завершит ход сам.
    // Если сервер молчит, fetch рвём через 2 с — abort при живом владении
    // тоже завершает ход (см. runTurn). Стартует новый ход раньше — он
    // заберёт владение, и этот цикл замолчит.
    const ctrl = r.ctrl;
    if (ctrl) setTimeout(() => ctrl.abort(), 2000);
  },
};
