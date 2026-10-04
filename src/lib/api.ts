// Клиент к бэкенду avy-chat (FastAPI). Стриминг ответа — через fetch + чтение
// тела как потока SSE-фреймов. Используем POST, поэтому нативный EventSource
// не подходит (он только GET); SSE-фрейминг разбирает parseSSE (см. lib/sse.ts).

import { parseSSE, readBody } from "@/lib/sse";
import { initialLocale } from "@/lib/locale";

// Пусто по умолчанию = запросы идут на СВОЙ origin (/api/...), а сервер Next
// проксирует их на backend (см. next.config.ts rewrites). Так браузер никогда
// не знает адрес бэка напрямую: один образ на все среды, нет CORS, cookie летит
// как same-origin. Переопределить можно через NEXT_PUBLIC_API_BASE (напр. чтобы
// бить в бэк напрямую в обход прокси), но по умолчанию прокси предпочтительнее.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

// Все запросы к API идут с credentials: сервер аутентифицирует пользователя по
// httpOnly-cookie сессии (см. server/auth.py), а не по полю user_id в запросе.
// Поэтому user_id с фронта БОЛЬШЕ НЕ ШЛЁТСЯ. Параметры userId в функциях ниже
// сохранены для совместимости сигнатур вызовов, но не используются.
const CREDENTIALS: RequestCredentials = "include";

// Идентификатор агента-источника события. null/undefined = оркестратор (главный
// агент). Непустая строка = ключ конкретного сабагента (режим deep-research) —
// по нему фронт раскладывает стрим по окнам субагентов (см. chat-streams).
type AgentTag = { agent?: string | null };

/** События, которые шлёт сервер (см. server/streaming.py + app.py). */
/** Один вариант ответа в карточке ask_user. */
export type AskUserOption = {
  label: string;
  description?: string;
};

/** Один вопрос карточки ask_user (форма из тулы askUserTool.ts). */
export type AskUserQuestionSpec = {
  question: string;
  header: string;
  options: AskUserOption[];
  multiSelect?: boolean;
};

/** Ответ пользователя на один вопрос ask_user (уходит в resolveQuestions). */
export type AskUserAnswer = {
  /** Метки выбранных вариантов (и/или свободный текст из «Другое»). */
  selected: string[];
  /** Свободный ввод из поля «Другое». */
  other?: string;
};

/** Состояние погоды — определяет иконку и фон виджета. Список закрытый: 28
 *  кодов WMO сводятся к нему на бэке, см. tools/weather.py. */
export type WeatherCondition =
  | "clear"
  | "mostly-clear"
  | "partly-cloudy"
  | "overcast"
  | "fog"
  | "drizzle"
  | "rain"
  | "freezing-rain"
  | "snow"
  | "thunderstorm";

export type WeatherDay = {
  date: string;
  condition: WeatherCondition;
  max: number;
  min: number;
  /** Вероятность осадков, %. null — метрика недоступна для этого дня. */
  precipitation: number | null;
  /** Сумма осадков, мм: 90% при 0.1 мм и при 12 мм — разные вещи. */
  precipitationMm?: number | null;
  sunrise?: string;
  sunset?: string;
  uvIndex?: number | null;
  windMax?: number | null;
};

/** Час прогноза на сегодня — отвечает на «будет ли дождь днём». */
export type WeatherHour = {
  time: string;
  temp: number | null;
  precipitation: number | null;
  condition: WeatherCondition;
};

/** Данные виджета погоды (artifact тулы get_weather). */
export type Weather = {
  city: string;
  country: string;
  condition: WeatherCondition;
  description: string;
  /** День/ночь: ясная ночь рисуется луной, а не солнцем. */
  isDay: boolean;
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  forecast: WeatherDay[];
  /** Локальное время места (ISO без зоны — API уже пересчитал по его поясу). */
  observedAt?: string;
  timezone?: string;
  /** Сводка по сегодняшнему дню: диапазон, осадки, восход/закат. null — если
   *  запрошен диапазон дат, куда сегодня не попадает. */
  today?: WeatherDay | null;
  /** Почасовой прогноз на сегодня. */
  hours?: WeatherHour[];
  /** Режим виджета — решает бэкенд по тому, что спросили:
   *  now (сегодня), day (конкретный другой день), period (несколько дней). */
  view?: "now" | "day" | "period";
  /** День, про который спрашивали (ISO). */
  targetDate?: string;
};

/** Статус фонового субагента. interrupted — оборван рестартом сервера;
 *  waiting — встал на вопросе оркестратору (любой interrupt), ждёт ответа. */
export type BackgroundStatus =
  | "running"
  | "done"
  | "error"
  | "cancelled"
  | "interrupted"
  | "waiting";

/** Вопрос субагента оркестратору — для карточки. kind: ask_user / hitl
 *  (просит разрешение на действие) / other. */
export type SubagentQuestion = { kind: string; text: string };

/** Фоновый субагент сессии — строка списка и кадр `report`. */
export type SubagentReport = {
  agent_id: string;
  subagent_type: string;
  title: string;
  status: string;
  started_at?: string;
  finished_at?: string | null;
  delivered?: boolean;
  error?: string | null;
  /** Только у status=waiting: текст вопроса. */
  question?: string | null;
};

export type ChatEvent =
  | ({ type: "text"; value: string } & AgentTag)
  | ({ type: "reasoning"; value: string } & AgentTag)
  // Фраза-сжатие завершённого блока рассуждений (qwen3.8-flash). seq —
  // порядковый номер блока среди reasoning-шагов ОСНОВНОГО агента в этом ходе.
  | { type: "reasoning_summary"; seq: number; text: string }
  | ({
      type: "tool";
      id: string;
      name: string;
      args: Record<string, unknown>;
      // "streaming" — аргументы ещё дозревают; "available" — вызов завершён.
      state?: "streaming" | "available";
    } & AgentTag)
  | ({
      type: "sources";
      tool_call_id: string;
      sources: { title: string; url: string }[];
    } & AgentTag)
  | ({
      type: "fetched";
      tool_call_id: string;
      file: {
        path: string;
        content_type: string;
        bytes: number;
        url: string;
      };
    } & AgentTag)
  | ({
      // Результат get_weather: данные виджета. Текст самой тулы в UI не
      // показывается — вместо него рисуется виджет.
      type: "weather";
      tool_call_id: string;
      weather: Weather;
    } & AgentTag)
  | ({
      // Режим Avy Code: результат выполнения тула (bash/file-тулы).
      type: "tool_result";
      tool_call_id: string;
      output: string;
      truncated: boolean;
      ok: boolean;
    } & AgentTag)
  | {
      // Тула task с background=true: оркестратор запустил субагента в фон и
      // пошёл дальше. tool_call_id — шаг task в ленте (пометить фоновым),
      // agent_id — адрес ленты агента: к ней клиент приаттачивается отдельным
      // SSE (attachSubagent), стрим хода её больше не несёт.
      type: "subagent_started";
      tool_call_id: string;
      agent_id: string;
      subagent_type?: string | null;
      title?: string | null;
    }
  | {
      // Последний кадр ленты фонового агента — итог. follow_up: репорт ждёт
      // вручения, и клиент просит доставку сам (deliverSubagentReports) — он
      // единственный, кто точно дочитал прошлый буфер хода.
      type: "subagent_done";
      agent_id: string;
      status: BackgroundStatus;
      error?: string | null;
      follow_up?: boolean;
      // status=waiting: вопрос — сразу на карточку, не дожидаясь репорта.
      question?: string | null;
    }
  | {
      // Синхронный субагент встал на вопросе оркестратору: шаг task
      // переходит в «ждёт ответа» с текстом вопроса. Ответ — следующий вызов
      // task с agent_id этого шага (клиент связывает их сам).
      type: "subagent_question";
      tool_call_id: string;
      question: SubagentQuestion;
    }
  | {
      // Заголовок задачи субагенту — фраза flash-модели по брифу
      // (server/task_titles.py), по tool_call_id шага task.
      type: "task_title";
      tool_call_id: string;
      text: string;
    }
  // Репорт фонового агента во входе хода: карточка «агент закончил» в ленте
  // ПЕРЕД ответом ассистента, как её потом покажет история.
  | ({ type: "report" } & SubagentReport)
  // Реплика человека посреди хода дошла до агента (перед следующим вызовом
  // модели). id — тот, что клиент дал при отправке (interjectTurn): по нему
  // снимается пометка «ожидает»; ответ агента после неё — новый пузырь.
  | { type: "interject"; id: string | null; text: string }
  | { type: "title"; value: string }
  | {
      // Режим Avy Code: агент хочет выполнить изменяющий тул (write/edit/bash),
      // ход приостановлен в ожидании решения пользователя (approve/reject).
      type: "permission_request";
      interrupt_id: string | null;
      tool: string;
      args: Record<string, unknown>;
      /** Готовый текст карточки: его собирает тула, объявившая подтверждение
       *  (см. confirm: в AGENT.md). Фронт его только показывает и потому не
       *  знает ничего о конкретных тулах. */
      description: string;
    }
  | {
      // Режим Avy Code: агент вызвал ask_user — уточняющий вопрос с вариантами
      // ответа. Ход приостановлен; UI показывает карточку (QuestionCard), ответ
      // уходит обратно через resolveQuestions. Отдельный interrupt-канал, не
      // permission_request (тот про approve/reject изменяющего тула).
      type: "ask_user_request";
      interrupt_id: string | null;
      questions: AskUserQuestionSpec[];
    }
  | {
      /** Агент просит подключить сервис (тула connector) — ход на паузе. */
      type: "connector_request";
      interrupt_id: string | null;
      connector: ConnectorCardInfo;
    }
  | { type: "stopped" }
  // /attach: offset клиента — из прежнего хода. Сервер поднял новый ход без
  // клиента (доставка репорта фонового агента), нумерация кадров началась с
  // нуля. Клиент сбрасывает счётчик и перечитывает историю; если ход ещё
  // жив, следом идут его кадры с первого.
  | { type: "reset" }
  // Сжатие контекста (SummarizationMiddleware): агент шлёт текст summary, чтобы
  // фронт вставил маркер «Контекст сжат» в конец ленты БЕЗ перезагрузки истории.
  // Приходит один раз за ход/ручное сжатие, если сработал middleware. tokens —
  // объём свёрнутой истории (подпись блока), null если неизвестен.
  | { type: "summary"; text: string; tokens?: number | null }
  // message_id — стабильный id финального AIMessage хода (для лайка/ретрая/edit
  // на свежем ответе, без перезагрузки истории). follow_up — за ход закончил
  // фоновый агент, репорт ждёт: клиент просит доставку по концу стрима.
  | { type: "done"; message_id?: string | null; follow_up?: boolean }
  // Транзиентный обрыв (timeout/gateway) — сервер повторяет ход с чекпойнта.
  // Фронт сбрасывает недописанный пузырь, чтобы перестримленный шаг не задвоился.
  | { type: "retry"; code?: ErrorCode; attempt: number }
  | { type: "error"; code?: ErrorCode; message: string };

/** Класс ошибки хода (с бэка, streaming.classify_error). По нему фронт
 *  показывает локализованное сообщение, не сырой текст исключения. */
export type ErrorCode =
  | "limit_exceeded"
  | "gateway_unavailable"
  | "timeout"
  | "model_error"
  | "internal"
  // Ход не дождался лока сессии (её держала выгрузка файлов в S3). Сообщение
  // до агента не дошло — человеку надо отправить его ещё раз.
  | "session_busy";

/** Сессия (тред) — метаданные из таблицы threads. */
export type ThreadInfo = {
  id: string;
  user_id: string;
  title: string;
  mode: string;
  pinned: boolean;
  /** Пространство чата (spaces.id) или null — обычный одиночный чат.
   *  По нему сайдбар группирует чаты в папку пространства. */
  project_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatRequest = {
  message: string;
  userId?: string;
  threadId?: string;
  modelId?: string;
  effort?: string | null;
  mode?: string | null;
  /** Режим Avy Code: уровень автономии approval (ask | accept-edits | plan). */
  permissionMode?: string | null;
  /** Агент из библиотеки (/api/agents). null = универсальный чат. */
  agentId?: string | null;
  /** Режим Avy Code: возобновление после approval — решения по permission_request. */
  resume?: { type: string; [k: string]: unknown }[] | null;
  /** Ответы на ask_user_request — по одному на вопрос, в порядке questions.
   *  Отдельно от resume: у HITL-канала своя форма, у вопросов своя.
   *  Словарь {connected} — ответ на карточку коннектора (connector_request):
   *  тот же канал, форму ждёт та тула, что подняла interrupt. */
  answers?: AskUserAnswer[] | ConnectorAnswer | null;
};

/** Ответ на карточку «Подключить <сервис>»: подключил или отказался. */
export type ConnectorAnswer = { connected: boolean };

/**
 * Отправить сообщение и асинхронно получать события ответа.
 * Возвращает async-итератор ChatEvent — удобно потреблять через for-await.
 */
export async function* streamChat(
  req: ChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: req.message,
      thread_id: req.threadId ?? "main",
      model_id: req.modelId ?? null,
      effort: req.effort ?? null,
      mode: req.mode ?? null,
      permission_mode: req.permissionMode ?? null,
      // Агент из библиотеки. null = универсальный чат: бэк тогда собирает
      // прежнего ассистента, поэтому старое поведение сохраняется.
      agent_id: req.agentId ?? null,
      resume: req.resume ?? null,
      answers: req.answers ?? null,
      // Таймзона браузера -> агент знает местное «сейчас» пользователя.
      timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
      // Локаль интерфейса -> тулы отдают данные на языке пользователя
      // (например geocoding: «Москва» против «Moscow»).
      locale: initialLocale(),
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Сервер вернул ${res.status}`);
  }

  for await (const msg of parseSSE(readBody(res.body))) {
    try {
      yield JSON.parse(msg.data) as ChatEvent;
    } catch {
      // Битый JSON в data — пропускаем фрейм.
    }
  }
}

/**
 * Перегенерировать последний ответ агента (SSE, как streamChat). Сервер срезает
 * последний ход и заново отрабатывает прежнее сообщение пользователя.
 */
export async function* streamRetry(
  req: { threadId: string; modelId?: string; effort?: string | null; mode?: string | null },
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const res = await fetch(
    `${API_BASE}/api/chat/${encodeURIComponent(req.threadId)}/retry`,
    {
      method: "POST",
      credentials: CREDENTIALS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model_id: req.modelId ?? null,
        effort: req.effort ?? null,
        mode: req.mode ?? null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
        locale: initialLocale(),
      }),
      signal,
    },
  );
  if (!res.ok || !res.body) {
    throw new Error(`Сервер вернул ${res.status}`);
  }
  for await (const msg of parseSSE(readBody(res.body))) {
    try {
      yield JSON.parse(msg.data) as ChatEvent;
    } catch {
      /* битый кадр — пропускаем */
    }
  }
}

/**
 * Отредактировать сообщение пользователя и перегенерировать ответ (SSE).
 * Сервер срезает историю с этого сообщения и отрабатывает новый текст.
 */
export async function* streamEdit(
  req: {
    threadId: string;
    messageId: string;
    text: string;
    modelId?: string;
    effort?: string | null;
    mode?: string | null;
  },
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const res = await fetch(
    `${API_BASE}/api/chat/${encodeURIComponent(req.threadId)}/edit`,
    {
      method: "POST",
      credentials: CREDENTIALS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message_id: req.messageId,
        text: req.text,
        model_id: req.modelId ?? null,
        effort: req.effort ?? null,
        mode: req.mode ?? null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
        locale: initialLocale(),
      }),
      signal,
    },
  );
  if (!res.ok || !res.body) {
    throw new Error(`Сервер вернул ${res.status}`);
  }
  for await (const msg of parseSSE(readBody(res.body))) {
    try {
      yield JSON.parse(msg.data) as ChatEvent;
    } catch {
      /* битый кадр — пропускаем */
    }
  }
}

/**
 * Переподключиться к идущему ходу сессии и дочитать его SSE-поток.
 *
 * Ход на сервере живёт независимо от HTTP: если клиент отвалился (reload,
 * переключение сессии, закрытие вкладки), ход продолжается. Этот вызов отдаёт
 * кадры начиная с `offset` (сколько клиент уже видел) + продолжение. Если живого
 * хода нет — сервер сразу пришлёт один кадр `done`.
 */
export async function* attachChat(
  threadId: string,
  offset = 0,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const res = await fetch(
    `${API_BASE}/api/chat/${encodeURIComponent(threadId)}/attach?offset=${offset}`,
    { credentials: CREDENTIALS, signal },
  );
  if (!res.ok || !res.body) {
    throw new Error(`Сервер вернул ${res.status}`);
  }
  for await (const msg of parseSSE(readBody(res.body))) {
    try {
      yield JSON.parse(msg.data) as ChatEvent;
    } catch {
      // Битый JSON в data — пропускаем фрейм.
    }
  }
}

/**
 * Отменить идущий ход на сервере. Надёжный путь остановки (работает за прокси):
 * сервер прерывает astream, сохраняет недописанный ответ + маркер в историю и
 * шлёт кадр `stopped`. Best-effort — локальный abort fetch'а в хуке дублирует.
 */
export async function stopChat(threadId = "main"): Promise<void> {
  await fetch(
    `${API_BASE}/api/chat/${encodeURIComponent(threadId)}/stop`,
    { method: "POST", credentials: CREDENTIALS },
  ).catch(() => {});
}

// --- Фоновые субагенты ---------------------------------------------------------
//
// Субагент, запущенный в фон, живёт дольше хода: его лента — отдельный буфер
// кадров на сервере со своим /attach, а результат приходит в разговор
// отдельным ходом ассистента («репорт»). Клиент участвует в двух вещах:
// показывает ленту (attachSubagent) и просит доставку репорта
// (deliverSubagentReports), когда точно дочитал прошлый ход.

/** Живая лента фонового агента — как attachChat, но по адресу агента. */
export async function* attachSubagent(
  threadId: string,
  agentId: string,
  offset = 0,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const res = await fetch(
    `${API_BASE}/api/chat/${encodeURIComponent(threadId)}/subagents/${encodeURIComponent(agentId)}/attach?offset=${offset}`,
    { credentials: CREDENTIALS, signal },
  );
  if (!res.ok || !res.body) {
    throw new Error(`Сервер вернул ${res.status}`);
  }
  for await (const msg of parseSSE(readBody(res.body))) {
    try {
      yield JSON.parse(msg.data) as ChatEvent;
    } catch {
      // Битый JSON в data — пропускаем фрейм.
    }
  }
}

/** Остановить фонового агента. Репорт (status=cancelled) всё равно придёт. */
export async function stopSubagent(threadId: string, agentId: string): Promise<boolean> {
  const res = await fetch(
    `${API_BASE}/api/chat/${encodeURIComponent(threadId)}/subagents/${encodeURIComponent(agentId)}/stop`,
    { method: "POST", credentials: CREDENTIALS },
  ).catch(() => null);
  if (!res || !res.ok) return false;
  const data = await res.json().catch(() => ({}));
  return Boolean(data?.stopped);
}

/**
 * Реплика посреди идущего хода: агент получит её перед следующим вызовом
 * модели. id даёт клиент — им он узнает свою строку в кадре `interject`.
 * "no_turn" — хода на сервере нет (409): реплику надо отправить обычным
 * сообщением.
 */
export async function interjectTurn(
  threadId: string,
  message: string,
  id: string,
): Promise<"queued" | "no_turn" | "error"> {
  const res = await fetch(
    `${API_BASE}/api/chat/${encodeURIComponent(threadId)}/interject`,
    {
      method: "POST",
      credentials: CREDENTIALS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, id }),
    },
  ).catch(() => null);
  if (!res) return "error";
  if (res.status === 409) return "no_turn";
  return res.ok ? "queued" : "error";
}

/** Фоновые агенты сессии со статусами (для открытия сессии). */
export async function listSubagents(threadId: string): Promise<SubagentReport[]> {
  const res = await fetch(
    `${API_BASE}/api/chat/${encodeURIComponent(threadId)}/subagents`,
    { credentials: CREDENTIALS },
  ).catch(() => null);
  if (!res || !res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return data?.agents ?? [];
}

/** Параметры хода доставки — те же, что у обычного сообщения: репорт должен
 *  разбирать та же модель и тот же агент, что ведут разговор. */
export type DeliverParams = {
  modelId?: string;
  effort?: string | null;
  mode?: string | null;
  agentId?: string | null;
};

/**
 * Попросить сервер вручить накопившиеся репорты фоновых агентов: он поднимает
 * ход ассистента и стримит его как /chat. Пустой поток — вручать нечего (204)
 * или ход уже идёт (409): тогда репорты заберёт его конец.
 */
export async function* deliverSubagentReports(
  threadId: string,
  params: DeliverParams,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const res = await fetch(
    `${API_BASE}/api/chat/${encodeURIComponent(threadId)}/subagents/deliver`,
    {
      method: "POST",
      credentials: CREDENTIALS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model_id: params.modelId ?? null,
        effort: params.effort ?? null,
        mode: params.mode ?? null,
        agent_id: params.agentId ?? null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
        locale: initialLocale(),
      }),
      signal,
    },
  );
  if (res.status === 204) return;
  if (res.status === 409) {
    // Ход уже идёт — скорее всего, сервер сам поднял доставку (путь 1) на
    // секунду раньше нас. Клиенту надо к нему ПРИАТТАЧИТЬСЯ, а не молчать:
    // иначе ответ ассистента на репорт появится только после reload.
    yield { type: "turn_in_progress" } as unknown as ChatEvent;
    return;
  }
  if (!res.ok || !res.body) {
    throw new Error(`Сервер вернул ${res.status}`);
  }
  for await (const msg of parseSSE(readBody(res.body))) {
    try {
      yield JSON.parse(msg.data) as ChatEvent;
    } catch {
      // Битый JSON в data — пропускаем фрейм.
    }
  }
}

/**
 * Поставить/снять оценку ответа агента (лайк/дизлайк). value=null снимает.
 * Best-effort: при ошибке UI откатит подсветку.
 */
export async function sendFeedback(
  threadId: string,
  messageId: string,
  value: "up" | "down" | null,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/feedback`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: CREDENTIALS,
        body: JSON.stringify({ message_id: messageId, value }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Заполненность окна контекста сессии (токены, которые видит модель). */
export type ContextUsage = { used_tokens: number; max_tokens: number };

/** Получить заполненность контекста сессии (used/max токены). */
export async function fetchContextUsage(
  threadId = "main",
): Promise<ContextUsage | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/context`,
      { credentials: CREDENTIALS },
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Принудительно сжать контекст сейчас; возвращает новую заполненность. */
export async function compactContext(
  threadId = "main",
  signal?: AbortSignal,
  // summary — текст сжатия (null, если сжимать было нечего). UI по нему
  // показывает свёрнутый блок «Контекст сжат» сразу, не дожидаясь релоада.
): Promise<
  (ContextUsage & { compacted: boolean; summary: string | null }) | null
> {
  try {
    const res = await fetch(
      `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/compact`,
      { method: "POST", credentials: CREDENTIALS, signal },
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // AbortError (отмена по Esc) и сетевые ошибки — оба гасим в null.
    return null;
  }
}

export async function fetchModels(): Promise<{
  models: string[];
  default: string;
}> {
  const res = await fetch(`${API_BASE}/api/models`, { credentials: CREDENTIALS });
  return res.json();
}

// --- Аутентификация ---------------------------------------------------------

/** Текущий пользователь (то, что отдают /auth/me, /login, /register). */
export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role?: string;
  is_admin?: boolean;
};

/** Ошибка auth с http-статусом и кодом детали (для разбора на форме). */
export class AuthError extends Error {
  constructor(
    public status: number,
    public code: string,
    /** Полный объект detail, если бэк вернул его словарём (напр. account_deleted
     *  несёт {code, days_left}). null — detail был строкой/отсутствовал. */
    public detail: Record<string, unknown> | null = null,
  ) {
    super(code);
    this.name = "AuthError";
  }
}

/** Достать (code, detail-объект) из ответа-ошибки. detail у FastAPI бывает
 *  строкой ("invalid_credentials") ИЛИ объектом ({code, days_left, ...}). */
async function errorDetail(
  res: Response,
): Promise<{ code: string; detail: Record<string, unknown> | null }> {
  try {
    const data = await res.json();
    const d = data?.detail;
    if (typeof d === "string") return { code: d, detail: null };
    if (d && typeof d === "object" && typeof d.code === "string") {
      return { code: d.code, detail: d };
    }
  } catch {
    // тело не JSON
  }
  return { code: `http_${res.status}`, detail: null };
}

/** POST с JSON-телом и куками; бросает AuthError(code, detail) при !ok. */
async function jsonPost(url: string, body: unknown): Promise<Response> {
  const res = await fetch(url, {
    method: "POST",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const { code, detail } = await errorDetail(res);
    throw new AuthError(res.status, code, detail);
  }
  return res;
}

async function authPost(path: string, body: unknown): Promise<AuthUser> {
  const res = await jsonPost(`${API_BASE}/api/auth/${path}`, body);
  return res.json();
}

export function register(input: {
  email: string;
  name: string;
  password: string;
  inviteCode: string;
  consent: boolean;
}): Promise<AuthUser> {
  return authPost("register", {
    email: input.email,
    name: input.name,
    password: input.password,
    invite_code: input.inviteCode,
    consent: input.consent,
  });
}

export function login(input: {
  email: string;
  password: string;
}): Promise<AuthUser> {
  return authPost("login", input);
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    credentials: CREDENTIALS,
  }).catch(() => {});
}

/** Восстановить soft-удалённый аккаунт в пределах grace (без авторизации). */
export function recoverAccount(input: {
  email: string;
  password: string;
}): Promise<AuthUser> {
  return authPost("recover", input);
}

// --- Управление своим аккаунтом ---------------------------------------------
//
// Смена пароля, выход со всех устройств и удаление аккаунта убраны из клиента:
// установка на одного человека на его машине, учётка создаётся установщиком.
// Осталось имя — оно видно в сайдбаре и уходит агенту как обращение.

/** Сменить отображаемое имя. Возвращает обновлённого пользователя. */
export async function changeName(name: string): Promise<AuthUser> {
  const res = await jsonPost(`${API_BASE}/api/me/profile`, { name });
  return res.json();
}

/** Текущий пользователь по сессии (null — не залогинен). */
export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      credentials: CREDENTIALS,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.user ?? null;
  } catch {
    return null;
  }
}

/** Что показать пользователю при входе (то же /auth/me, поле prompts). */
export type EntryPrompts = {
  /** Приветствие выданной роли, Markdown. null — показывать нечего. */
  welcome: string | null;
};

/** Приветствие при входе. Отдельным вызовом от fetchMe: тот
 *  зовут в нескольких местах ради самого пользователя, а это нужно один раз
 *  при загрузке — и его отказ не должен мешать входу. */
export async function fetchEntryPrompts(): Promise<EntryPrompts> {
  const empty: EntryPrompts = { welcome: null };
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      credentials: CREDENTIALS,
    });
    if (!res.ok) return empty;
    const data = await res.json();
    return {
      welcome: data.prompts?.welcome ?? null,
    };
  } catch {
    return empty;
  }
}

/** Отметить приветствие показанным — больше оно не всплывёт. */
export async function markWelcomeSeen(): Promise<void> {
  await jsonPost(`${API_BASE}/api/me/welcome-seen`, {});
}

// --- Лимит / кредиты пользователя -------------------------------------------

export type UsageInfo = {
  plan: string;
  limited: boolean;
  exhausted: boolean;
  credits_per_usd: number;
  limit_credits: number | null;
  spent_credits: number;
  remaining_credits: number | null;
  reset_at: string | null; // ISO
};

export async function fetchUsage(): Promise<UsageInfo | null> {
  try {
    const res = await fetch(`${API_BASE}/api/me/usage`, {
      credentials: CREDENTIALS,
    });
    if (!res.ok) return null;
    return (await res.json()) as UsageInfo;
  } catch {
    return null;
  }
}

// --- Агенты -----------------------------------------------------------------

export type Agent = {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  /** model_id, effort, mode, fs_tools, memory — см. server/agents.py. */
  config: Record<string, unknown>;
  /** Коробочный: правке и удалению не подлежит (бэк вернёт 403). */
  builtin: boolean;
  /** Считает БЭКЕНД — фронт не повторяет правило «коробочные только чтение». */
  editable: boolean;
  /** Показывать ли в выборе агента над полем ввода. */
  enabled: boolean;
  /** Может ли ассистент запускать его как субагента. НЕЗАВИСИМ от enabled:
   *  оба тумблера про личный список над полем ввода, и там, где агента
   *  добавили явно (команда пространства, субагенты кастомного агента), ни
   *  один из них не спрашивается. */
  delegatable: boolean;
  /** Латинское имя: файл в /agents/ и имя субагента при вызове. */
  slug: string | null;
  /** Навыки агента. Пусто = набор по умолчанию. */
  skills: string[];
  /** Виды подключений из конфига агента, которых у человека НЕТ. Непусто —
   *  агент выключен: сервер не отдаёт его в выбор и не даёт ход; карточка
   *  показывает «Нужно подключение» и кнопку. */
  missing_connections: string[];
  /** Когда заведён — для сортировки «сначала новые». */
  created_at: string | null;
};

export type AgentInput = {
  name: string;
  description: string;
  system_prompt: string;
  config: Record<string, unknown>;
  enabled: boolean;
  delegatable: boolean;
  skills: string[];
};

/** `onlyEnabled` — для выбора агента над полем ввода: там место готовым.
 *  Раздел «Мои агенты» зовёт без него и видит всех. */
export async function fetchAgents(
  opts: { onlyEnabled?: boolean } = {},
): Promise<Agent[]> {
  const qs = opts.onlyEnabled ? "?only_enabled=true" : "";
  const res = await fetch(`${API_BASE}/api/agents${qs}`, {
    credentials: CREDENTIALS,
  });
  if (!res.ok) throw new Error(String(res.status));
  const data = await res.json();
  return (data.agents ?? []) as Agent[];
}

/** Одно поле формы подключения. Описание приходит С БЭКЕНДА (конфиг агента),
 *  поэтому здесь ни одного имени поля и ни одного вида подключения: новый вид
 *  появляется файлом рядом с агентом и рисуется этим же кодом. */
export type ConnectionField = {
  name: string;
  label: string;
  /** Секретное: поле пароля, значение НИКОГДА не приходит с сервера обратно. */
  secret: boolean;
  required: boolean;
  hint: string;
  placeholder: string;
};

/** Описание формы подключения — приходит В ЗАПИСИ АГЕНТА (config.connection_forms):
 *  по нему карточка решает, рисовать ли кнопку, не спрашивая сервер. */
export type ConnectionForm = {
  /** Вид: им адресуются PUT/DELETE. */
  kind: string;
  title: string;
  description: string;
  fields: ConnectionField[];
};

export type AgentConnection = ConnectionForm & {
  connected: boolean;
  /** ТОЛЬКО открытые поля — секретов здесь нет по построению (см. бэкенд).
   *  Ими подписываем «подключено как …» и предзаполняем форму. */
  values: Record<string, string>;
  updated_at: string | null;
};

/** Подключения агента: описание формы + состояние каждого, одним запросом. */
export async function fetchAgentConnections(
  slug: string,
): Promise<AgentConnection[]> {
  const res = await fetch(
    `${API_BASE}/api/agents/${encodeURIComponent(slug)}/connections`,
    { credentials: CREDENTIALS },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.connections ?? []) as AgentConnection[];
}

/** Подключить или переподключить. Текст ошибки — от бэкенда: он знает, какое
 *  поле не заполнено и доступно ли хранилище ключей. */
export async function saveAgentConnection(
  slug: string,
  kind: string,
  values: Record<string, string>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(
    `${API_BASE}/api/agents/${encodeURIComponent(slug)}/connections/${encodeURIComponent(kind)}`,
    {
      method: "PUT",
      credentials: CREDENTIALS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    },
  );
  if (res.ok) return { ok: true };
  let error = `Ошибка ${res.status}`;
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") error = data.detail;
  } catch {
    // Ответ без JSON — оставляем код статуса: он лучше пустого сообщения.
  }
  return { ok: false, error };
}

/** Отключить: сервер удаляет значения вместе с зашифрованным секретом. */
export async function deleteAgentConnection(
  slug: string,
  kind: string,
): Promise<boolean> {
  const res = await fetch(
    `${API_BASE}/api/agents/${encodeURIComponent(slug)}/connections/${encodeURIComponent(kind)}`,
    { method: "DELETE", credentials: CREDENTIALS },
  );
  return res.ok;
}

// ── MCP-коннекторы (раздел «Коннекторы») ─────────────────────────────────────

/** Коннектор из каталога или свой сервер + состояние подключения. Ни одного
 *  имени сервиса здесь нет: каталог живёт на бэкенде (connectors/*.yaml). */
/** Поле формы входа коннектора (`auth: form`, блок `fields:` каталога). */
export type ConnectorField = {
  name: string;
  type: "text" | "email" | "url" | "password" | "checkbox";
  label: Record<string, string>;
  hint: Record<string, string>;
  placeholder: string;
  required: boolean;
  secret: boolean;
};

export type ConnectorInfo = {
  id: string;
  title: string;
  description: string;
  /** Способы входа в порядке предпочтения: oauth | token | none | form. */
  auth: string[];
  /** Поля формы входа; пусто у коннекторов без `auth: form`. */
  fields?: ConnectorField[];
  site: string;
  token_hint: string;
  /** Переменные окружения, без которых вход невозможен (OAuth-клиент Google). */
  missing_env: string[];
  custom: boolean;
  /** Путь к логотипу (web/public/connectors/*.svg); у своего сервера нет. */
  logo: string | null;
  /** Как проходит вход: окно сервиса с возвратом к нам или код на странице
   *  сервиса (Яндекс ID). Нет поля — старый сервер, значит redirect. */
  sign_in?: "redirect" | "device";
  /** Описание для человека по языкам ({ru, en}); `description` — строка для модели. */
  summary: Record<string, string>;
  /** Как подключить — шаги по языкам; пусто, если хватает поля токена. */
  guide?: Record<string, string[]>;
  /** Список объектов подключения в карточке (чаты бота): подписи по языкам.
   *  null/нет — списка у коннектора нет. */
  resources?: ConnectorResourceLabels | null;
  /** Название для человека по языкам; `title` — запасное. */
  titles?: Record<string, string>;
  /** Человеческие названия инструментов: {send: {ru, en}}. */
  tool_labels?: Record<string, Record<string, string>>;
  /** Что подтверждается по умолчанию (`confirm:` каталога). */
  confirm_default?: string[];
  /** Общие настройки человека; null — умолчание. */
  settings?: ConnectorSettings | null;
  url?: string | null;
  /** Свой сервер: его файл в мире агента и почему файл не разобран. */
  file?: string | null;
  error?: string | null;
  connected: boolean;
  status: "pending" | "connected" | "reauth" | null;
  connected_with: string | null;
  updated_at: string | null;
};

export type ConnectorTool = { name: string; description: string };

/** Общие настройки коннектора: какие инструменты подтверждать в обычных
 *  чатах. confirm=null — умолчание каталога; autoApprove — всё без спроса. */
export type ConnectorSettings = { confirm: string[] | null; autoApprove: boolean };

/** Правило коннектора у сущности (агент, задача, пространство). Поле null или
 *  его нет — этот уровень молчит: tools — все доступны, confirm — как в
 *  общих настройках (connectors/rules.py на бэкенде). */
export type ConnectorRule = { tools?: string[] | null; confirm?: string[] | null };
export type ConnectorRules = Record<string, ConnectorRule>;

export type ConnectorResourceLabels = {
  title?: Record<string, string>;
  add?: Record<string, string>;
  empty?: Record<string, string>;
};

/** Объект подключения (чат бота и т.п.). Подписи — уже на языке интерфейса. */
export type ConnectorResource = { id: string; title: string; subtitle?: string; warning?: string };

/** Карточка коннектора в ленте чата: агент просит подключить сервис. */
export type ConnectorCardInfo = Pick<
  ConnectorInfo,
  "id" | "title" | "description" | "auth" | "site" | "token_hint" | "missing_env" | "custom" | "logo" | "summary"
> &
  Partial<Pick<ConnectorInfo, "titles" | "tool_labels" | "guide" | "resources" | "confirm_default">> & {
    reason?: "not_connected" | "reauth";
  };

/** Описание коннектора на языке интерфейса; без перевода — строка для модели. */
export function connectorSummary(
  c: Pick<ConnectorInfo, "summary" | "description">,
  locale: string,
): string {
  return c.summary?.[locale] || c.summary?.en || c.description;
}

async function errorText(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
  } catch {
    // без JSON — код статуса информативнее пустой строки
  }
  return fallback;
}

export async function fetchConnectors(): Promise<ConnectorInfo[]> {
  const res = await fetch(`${API_BASE}/api/connectors`, { credentials: CREDENTIALS });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.connectors ?? []) as ConnectorInfo[];
}

/** Подключить коннектор каталога токеном (или без входа, если он это умеет).
 *  Бэкенд проверяет подключение сразу — ходит за списком инструментов. */
export async function connectConnector(
  id: string,
  token?: string,
  /** Значения формы входа (`auth: form`): адрес сервера, логин, пароль… */
  fields?: Record<string, string | boolean>,
): Promise<{ ok: true; tools: ConnectorTool[] } | { ok: false; error: string }> {
  const res = await fetch(`${API_BASE}/api/connectors/${encodeURIComponent(id)}/connect`, {
    method: "POST",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields ? { token: null, fields } : { token: token ?? null }),
  });
  if (!res.ok) return { ok: false, error: await errorText(res, `Ошибка ${res.status}`) };
  const data = await res.json();
  return { ok: true, tools: (data.tools ?? []) as ConnectorTool[] };
}

/** Свой MCP-сервер: адрес и способ входа. */
export async function addCustomConnector(body: {
  title: string;
  url: string;
  auth: "oauth" | "token" | "none";
  token?: string;
}): Promise<{ ok: true; connector: ConnectorInfo } | { ok: false; error: string }> {
  const res = await fetch(`${API_BASE}/api/connectors`, {
    method: "POST",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: await errorText(res, `Ошибка ${res.status}`) };
  return { ok: true, connector: (await res.json()) as ConnectorInfo };
}

/** Вход кодом устройства: код, который человек вводит на странице сервиса. */
export type DeviceCode = { userCode: string; verificationUrl: string; expiresIn: number };

export type OAuthStart =
  | { ok: true; url: string; device?: undefined }
  | { ok: true; url?: undefined; device: DeviceCode }
  | { ok: false; error: string };

/** Ответ /oauth/start: ссылка на окно сервиса или код устройства. */
export function parseOAuthStart(data: unknown): OAuthStart {
  const d = (data ?? {}) as { url?: unknown; device?: Record<string, unknown> | null };
  if (d.device && typeof d.device === "object") {
    const code = String(d.device.user_code ?? "");
    const url = String(d.device.verification_url ?? "");
    if (!code || !url) return { ok: false, error: "Сервис не выдал код входа" };
    return { ok: true, device: { userCode: code, verificationUrl: url, expiresIn: Number(d.device.expires_in) || 300 } };
  }
  const url = String(d.url ?? "");
  return url ? { ok: true, url } : { ok: false, error: "Сервис не выдал ссылку входа" };
}

/** Начать OAuth-вход. Обычно сервер отдаёт ссылку, куда отправить человека
 *  (вернувшись на наш коллбэк, сервис завершает вход сам), а для сервисов без
 *  своего адреса возврата — код устройства: его вводят на странице сервиса,
 *  токен сервер забирает сам. */
export async function startConnectorOAuth(id: string): Promise<OAuthStart> {
  const res = await fetch(`${API_BASE}/api/connectors/${encodeURIComponent(id)}/oauth/start`, {
    method: "POST",
    credentials: CREDENTIALS,
  });
  if (!res.ok) return { ok: false, error: await errorText(res, `Ошибка ${res.status}`) };
  return parseOAuthStart(await res.json());
}

export type DeviceState = { state: "none" | "pending" | "connected" | "failed" | "expired"; error?: string | null };

/** Чем кончилось ожидание кода устройства. */
export async function fetchDeviceState(id: string): Promise<DeviceState> {
  const res = await fetch(`${API_BASE}/api/connectors/${encodeURIComponent(id)}/oauth/device`, {
    credentials: CREDENTIALS,
  });
  if (!res.ok) return { state: "none" };
  return (await res.json()) as DeviceState;
}

export async function fetchConnectorTools(id: string): Promise<ConnectorTool[] | null> {
  const res = await fetch(`${API_BASE}/api/connectors/${encodeURIComponent(id)}/tools`, {
    credentials: CREDENTIALS,
  });
  if (!res.ok) return null;
  const data = await res.json();
  return (data.tools ?? []) as ConnectorTool[];
}

function resourcesUrl(id: string, lang: string, rid?: string): string {
  const tail = rid ? `/${encodeURIComponent(rid)}` : "";
  return `${API_BASE}/api/connectors/${encodeURIComponent(id)}/resources${tail}?lang=${encodeURIComponent(lang)}`;
}

/** Список объектов подключения; сервер заодно забирает свежее у сервиса. */
export async function fetchConnectorResources(
  id: string,
  lang: string,
): Promise<{ ok: true; items: ConnectorResource[] } | { ok: false; error: string }> {
  const res = await fetch(resourcesUrl(id, lang), { credentials: CREDENTIALS });
  if (!res.ok) return { ok: false, error: await errorText(res, `Ошибка ${res.status}`) };
  const data = await res.json();
  return { ok: true, items: (data.items ?? []) as ConnectorResource[] };
}

export async function addConnectorResource(
  id: string,
  lang: string,
  value: string,
): Promise<{ ok: true; item: ConnectorResource } | { ok: false; error: string }> {
  const res = await fetch(resourcesUrl(id, lang), {
    method: "POST",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) return { ok: false, error: await errorText(res, `Ошибка ${res.status}`) };
  const data = await res.json();
  return { ok: true, item: data.item as ConnectorResource };
}

export async function removeConnectorResource(id: string, lang: string, rid: string): Promise<boolean> {
  const res = await fetch(resourcesUrl(id, lang, rid), { method: "DELETE", credentials: CREDENTIALS });
  return res.ok;
}

export async function saveConnectorSettings(
  id: string,
  settings: ConnectorSettings | null,
): Promise<{ ok: true; connector: ConnectorInfo } | { ok: false; error: string }> {
  const res = await fetch(`${API_BASE}/api/connectors/${encodeURIComponent(id)}/settings`, {
    method: "PUT",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings ?? { confirm: null, autoApprove: false }),
  });
  if (!res.ok) return { ok: false, error: await errorText(res, `Ошибка ${res.status}`) };
  return { ok: true, connector: (await res.json()) as ConnectorInfo };
}

export async function deleteConnector(id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/connectors/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: CREDENTIALS,
  });
  return res.ok;
}
// --- Подключение к модели: DashScope ---------------------------------------

/** Куда сейчас идут ходы и состояние DashScope. Самого ключа здесь нет и не
 *  будет — сервер отдаёт только факт и хвост («…a1b2»). */
export type ModelSettings = {
  provider: "dashscope" | "contour" | "direct";
  dashscope: {
    key_set: boolean;
    key_hint: string;
    enabled: boolean;
    updated_at: string | null;
  };
};

export async function fetchModelSettings(): Promise<ModelSettings | null> {
  const res = await fetch(`${API_BASE}/api/settings/model`, { credentials: CREDENTIALS });
  if (!res.ok) return null;
  return res.json();
}

async function modelSettingsResult(
  res: Response,
): Promise<{ ok: true; settings: ModelSettings } | { ok: false; error: string }> {
  if (res.ok) return { ok: true, settings: await res.json() };
  let error = `Ошибка ${res.status}`;
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") error = data.detail;
  } catch {
    // Ответ без JSON — оставляем код статуса.
  }
  return { ok: false, error };
}

/** Сохранить ключ и/или выключатель. apiKey не задан — ключ не меняется. */
export async function saveDashscope(body: { apiKey?: string; enabled: boolean }) {
  const res = await fetch(`${API_BASE}/api/settings/model/dashscope`, {
    method: "PUT",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: body.apiKey ?? null, enabled: body.enabled }),
  });
  return modelSettingsResult(res);
}

/** Убрать ключ совсем: ходы снова идут прежним путём. */
export async function deleteDashscope() {
  const res = await fetch(`${API_BASE}/api/settings/model/dashscope`, {
    method: "DELETE",
    credentials: CREDENTIALS,
  });
  return modelSettingsResult(res);
}

/** Навыки, которые можно подключить агенту. Список читается на бэкенде из
 *  каталога поставки — здесь его не дублируем. */
export async function fetchSkills(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/skills`, { credentials: CREDENTIALS });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.skills ?? []) as string[];
}

/** Навык с описанием — для вкладки «Навыки». */
export type SkillInfo = {
  name: string;
  description: string;
  /** Группа для списка («Documents», «Media»…). Пустая = «Прочее». */
  category: string;
  /** Подключён ли ассистенту (кнопка «Добавить/Убрать» в каталоге). */
  added: boolean;
};

/** Добавить/убрать коробочный навык из набора ассистента. */
export async function patchBuiltinSkill(
  name: string,
  added: boolean,
): Promise<boolean> {
  const res = await fetch(
    `${API_BASE}/api/skills/catalog/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      credentials: CREDENTIALS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ added }),
    },
  );
  return res.ok;
}

/** Каталог навыков с описаниями. Отдельная ручка от fetchSkills: та отдаёт
 *  имена для чипов в форме агента, эта — тексты для списка. */
export async function fetchSkillsCatalog(): Promise<SkillInfo[]> {
  const res = await fetch(`${API_BASE}/api/skills/catalog`, { credentials: CREDENTIALS });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.skills ?? []) as SkillInfo[];
}

/** Коробочный навык целиком: описание и ПУТИ его файлов.
 *
 *  Содержимое не здесь: навык — это десятки файлов, и слать их скопом значит
 *  гонять по сети то, что человек, скорее всего, не откроет. */
export type SkillDetail = SkillInfo & { files: string[] };

export async function fetchSkillDetail(name: string): Promise<SkillDetail | null> {
  const res = await fetch(
    `${API_BASE}/api/skills/catalog/${encodeURIComponent(name)}`,
    { credentials: CREDENTIALS },
  );
  if (!res.ok) return null;
  return (await res.json()) as SkillDetail;
}

/** Содержимое одного файла коробочного навыка.
 *
 *  `null` значит «файл есть, но показать нечего»: картинка, архив или он
 *  больше потолка. Это не ошибка — в дереве он остаётся видимым. */
export async function fetchSkillFile(
  name: string,
  path: string,
): Promise<string | null> {
  const res = await fetch(
    `${API_BASE}/api/skills/catalog/${encodeURIComponent(name)}/file`
      + `?path=${encodeURIComponent(path)}`,
    { credentials: CREDENTIALS },
  );
  if (!res.ok) return null;
  const data = await res.json();
  return (data.content ?? null) as string | null;
}

/** Сделать свой навык на основе коробочного — единственный путь его «править».
 *
 *  Копия приходит ВЫКЛЮЧЕННОЙ: человек сначала смотрит, что получилось. */
export async function forkBuiltinSkill(name: string): Promise<MySkill | null> {
  const res = await fetch(
    `${API_BASE}/api/skills/my/from-builtin/${encodeURIComponent(name)}`,
    { method: "POST", credentials: CREDENTIALS },
  );
  if (!res.ok) return null;
  return (await res.json()) as MySkill;
}

// --- файлы своего навыка ----------------------------------------------------
//
// Скрипты, шаблоны, requirements.txt. Живут в S3 (их запускает bash в
// песочнице), в отличие от SKILL.md — тот в БД, это текст навыка.

export async function fetchMySkillFiles(skillId: string): Promise<string[]> {
  const res = await fetch(
    `${API_BASE}/api/skills/my/${encodeURIComponent(skillId)}/files`,
    { credentials: CREDENTIALS },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.files ?? []) as string[];
}

/** Содержимое файла навыка — для предпросмотра в форме.
 *
 *  `null` — файл есть, но показать нечего: картинка, архив или больше потолка. */
export async function fetchMySkillFile(
  skillId: string,
  path: string,
): Promise<string | null> {
  const res = await fetch(
    `${API_BASE}/api/skills/my/${encodeURIComponent(skillId)}/files/content`
      + `?path=${encodeURIComponent(path)}`,
    { credentials: CREDENTIALS },
  );
  if (!res.ok) return null;
  const data = await res.json();
  return (data.content ?? null) as string | null;
}

/** Загрузить файлы. Одноимённый ЗАМЕЩАЕТСЯ — это и есть «обновить скрипт»:
 *  инструкция навыка ссылается на файл по имени, и переименование её сломало бы. */
export async function uploadMySkillFiles(
  skillId: string,
  files: File[],
): Promise<{ saved: string[]; errors: Array<{ name: string; error: string }> }> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  const res = await fetch(
    `${API_BASE}/api/skills/my/${encodeURIComponent(skillId)}/files`,
    { method: "POST", credentials: CREDENTIALS, body: form },
  );
  if (!res.ok) return { saved: [], errors: [] };
  return await res.json();
}

export async function deleteMySkillFile(
  skillId: string,
  path: string,
): Promise<boolean> {
  const res = await fetch(
    `${API_BASE}/api/skills/my/${encodeURIComponent(skillId)}/files`
      + `?path=${encodeURIComponent(path)}`,
    { method: "DELETE", credentials: CREDENTIALS },
  );
  return res.ok;
}

/** Свой навык. От коробочного (SkillInfo) отличается тем, что у него есть
 *  владелец, тело инструкции и его можно править. */
export type MySkill = {
  id: string;
  name: string;
  /** Имя каталога в /skills/my/. Не меняется при переименовании. */
  slug: string;
  description: string;
  category: string;
  /** Тело SKILL.md — сама инструкция. */
  body: string;
  enabled: boolean;
  builtin: false;
  editable: true;
  created_at: string | null;
};

export type MySkillInput = {
  name: string;
  description?: string;
  category?: string;
  body?: string;
  enabled?: boolean;
  /** Навык ПРОСТРАНСТВА: виден только в его чатах. Пусто — личный. */
  space_id?: string;
};

/** Свои навыки, включая выключенные: иначе их негде было бы включить обратно. */
export async function fetchMySkills(): Promise<MySkill[]> {
  const res = await fetch(`${API_BASE}/api/skills/my`, { credentials: CREDENTIALS });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.skills ?? []) as MySkill[];
}

/** Текст ошибки от бэкенда, а не просто null.
 *
 *  У навыков проверки содержательные («Описание длиннее 500 символов — оно
 *  висит в промпте каждый ход»), и молча превратив их в «не получилось», мы
 *  оставили бы человека угадывать, что именно не так. */
async function skillCall(
  path: string,
  init: RequestInit,
): Promise<{ skill?: MySkill; error?: string }> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data?.detail || "Не удалось сохранить навык" };
  return { skill: data as MySkill };
}

export function createMySkill(body: MySkillInput) {
  return skillCall("/api/skills/my", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateMySkill(id: string, body: Partial<MySkillInput>) {
  return skillCall(`/api/skills/my/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteMySkill(id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/skills/my/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: CREDENTIALS,
  });
  return res.ok;
}

/** Комплекты тулов СВЕРХ файловых. Файловые (чтение/запись/шелл) есть у любого
 *  агента всегда и в списке не появляются: предлагать их выключить значило бы
 *  предлагать сломать агента. */
export async function fetchToolsets(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/toolsets`, { credentials: CREDENTIALS });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.toolsets ?? []) as string[];
}

/** Middleware, которые можно подключить агенту. Отдаётся только СОСТАВ:
 *  порядок в конвейере — свойство самого middleware (память после файловых
 *  тулов, но до суммаризатора), он живёт в реестре на бэкенде и ручкой в
 *  интерфейсе быть не должен. */
export async function fetchMiddleware(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/middleware`, { credentials: CREDENTIALS });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.middleware ?? []) as string[];
}

export async function createAgent(body: AgentInput): Promise<Agent | null> {
  const res = await fetch(`${API_BASE}/api/agents`, {
    method: "POST",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function updateAgent(
  id: string,
  body: Partial<AgentInput>,
): Promise<Agent | null> {
  const res = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function deleteAgent(id: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: CREDENTIALS,
  });
  return res.ok;
}

// --- Память агента ----------------------------------------------------------

// Что агент помнит. Список — РОВНО то, что уходит в промпт каждый ход, поэтому
// человек видит свой настоящий контекст, а не пересказ. Тела фактов не приходят
// со списком: их читают по одному, когда раскрывают строку.

export type MemoryFact = {
  id: string;
  /** Имя файла в /memory — под ним факт лежит у агента. */
  name: string;
  /** Строка индекса: та самая, что видит модель. */
  description: string;
  type: string;
  /** ISO. Срок жизни факта; null = бессрочно. */
  expires_at: string | null;
  created_at: string | null;
};

/** Память одного владельца. Личная память принадлежит ЧЕЛОВЕКУ (одна на всех
 *  агентов), поэтому владелец здесь ровно один; группировка остаётся для
 *  будущей памяти пространств, у которых владельцем будет пространство. */
export type MemoryOwner = {
  owner_id: string;
  default: boolean;
  name: string | null;
  scope: string;
  facts: MemoryFact[];
};

/** Память по владельцам. С threadId — только слои, ДЕЙСТВУЮЩИЕ в этой
 *  сессии (личный + пространство треда): панель сессии показывает контекст
 *  агента, а не архив всех слоёв. Без threadId — всё (экран настроек). */
export async function fetchMyMemory(threadId?: string): Promise<MemoryOwner[]> {
  const qs = threadId ? `?thread_id=${encodeURIComponent(threadId)}` : "";
  const res = await fetch(`${API_BASE}/api/me/memory${qs}`, {
    credentials: CREDENTIALS,
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.owners ?? []) as MemoryOwner[];
}

/** Состояние выключателей. thread_enabled: null = сессия наследует общую
 *  настройку (это НЕ то же, что false). */
export type MemorySettings = {
  enabled: boolean;
  thread_enabled: boolean | null;
};

export async function fetchMemorySettings(
  threadId?: string,
): Promise<MemorySettings> {
  const qs = threadId ? `?thread_id=${encodeURIComponent(threadId)}` : "";
  const res = await fetch(`${API_BASE}/api/me/memory/settings${qs}`, {
    credentials: CREDENTIALS,
  });
  if (!res.ok) return { enabled: true, thread_enabled: null };
  return res.json();
}

/** Выключить память целиком. Записанное остаётся: это «не подставляй и не
 *  пиши», а не «забудь». */
export async function setMemoryEnabled(enabled: boolean): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/me/memory/settings`, {
    method: "PUT",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  return res.ok;
}

/** Пометка на одной сессии. null возвращает её к общей настройке. */
export async function setThreadMemoryEnabled(
  threadId: string,
  enabled: boolean | null,
): Promise<boolean> {
  const res = await fetch(
    `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/memory`,
    {
      method: "PUT",
      credentials: CREDENTIALS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
  );
  return res.ok;
}

export async function fetchMemoryFact(
  factId: string,
): Promise<(MemoryFact & { body: string }) | null> {
  const res = await fetch(
    `${API_BASE}/api/memory/${encodeURIComponent(factId)}`,
    { credentials: CREDENTIALS },
  );
  if (!res.ok) return null;
  return res.json();
}

/** Забыть факт. Это и есть контроль человека над памятью — без него запись,
 *  однажды сделанная моделью по ошибке, осталась бы навсегда. */
export async function forgetMemoryFact(factId: string): Promise<boolean> {
  const res = await fetch(
    `${API_BASE}/api/memory/${encodeURIComponent(factId)}`,
    { method: "DELETE", credentials: CREDENTIALS },
  );
  return res.ok;
}

// --- Сессии (треды) ---------------------------------------------------------

export async function listThreads(mode?: string | null): Promise<ThreadInfo[]> {
  // mode фильтрует список по разделу (avy-code / chat). Без mode — все треды.
  const qs = mode ? `?mode=${encodeURIComponent(mode)}` : "";
  const res = await fetch(`${API_BASE}/api/threads${qs}`, {
    credentials: CREDENTIALS,
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.threads ?? [];
}

export async function createThread(
  threadId: string,
  title = "Новый чат",
  mode?: string | null,
): Promise<ThreadInfo> {
  const res = await fetch(`${API_BASE}/api/threads`, {
    method: "POST",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thread_id: threadId, title, mode: mode ?? null }),
  });
  return res.json();
}

export async function renameThread(
  threadId: string,
  title: string,
): Promise<void> {
  await fetch(`${API_BASE}/api/threads/${encodeURIComponent(threadId)}`, {
    method: "PATCH",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export async function setThreadPinned(
  threadId: string,
  pinned: boolean,
): Promise<void> {
  await fetch(`${API_BASE}/api/threads/${encodeURIComponent(threadId)}/pin`, {
    method: "PATCH",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned }),
  });
}

export async function deleteThread(threadId: string): Promise<void> {
  await fetch(`${API_BASE}/api/threads/${encodeURIComponent(threadId)}`, {
    method: "DELETE",
    credentials: CREDENTIALS,
  });
}

/** Шаг свёрнутой цепочки (reasoning/tool); см. ThoughtStep на фронте. */
export type HistoryStep =
  | { kind: "reasoning"; text: string }
  | {
      kind: "tool";
      id?: string;
      name: string;
      args: Record<string, unknown>;
      // Вызов task с background=true: адрес и статус фонового агента. По
      // running клиент приаттачивается к живой ленте (см. chat-streams).
      background?: {
        agent_id: string;
        status: BackgroundStatus;
        subagent_type?: string | null;
        title?: string | null;
      };
    };

/** Часть ответа: свёрнутая цепочка или видимый текст (см. MessagePart). */
export type HistoryPart =
  | { type: "chain"; steps: HistoryStep[] }
  | { type: "text"; text: string };

/** Прошлое сообщение из истории (упорядоченные части ответа). */
export type HistoryMessage = {
  // "summary" — служебная строка сжатия контекста (Avy Code): в точке сжатия
  // сервер вставляет её с текстом summary, UI рисует свёрнутым блоком.
  // "report" — репорт фонового субагента (сообщение от системы, не реплика
  // человека): карточка «агент закончил», сам текст живёт в ленте агента.
  role: "user" | "assistant" | "summary" | "report";
  content: string;
  parts?: HistoryPart[];
  // Только role="report".
  report?: SubagentReport;
  // Только для role="summary": объём свёрнутой истории в токенах (до сжатия) —
  // подпись маркера «Контекст сжат (NNNк токенов)». null у старых событий.
  tokens?: number | null;
  // Стабильный id хода/реплики из чекпойнтера (для лайка/ретрая/edit).
  id?: string | null;
  // Только role="user": реплика, отправленная ПОСРЕДИ хода (interject) — не
  // начало хода. Нужна слиянию живой ленты с историей (chatStreams.setHistory).
  interject?: boolean;
  // Оценка ответа, восстановленная с сервера.
  feedback?: "up" | "down" | null;
  // Только role="user", Avy Code: чипы вложений (файл никогда не пишется в ФС —
  // path фиктивный, thumbUrl — data:-URL для картинок). См. code-cli/session/historyBuilder.ts.
  attachments?: { path: string; name: string; mime: string; thumbUrl?: string }[];
};

/** Прошлые сообщения сессии (для восстановления ленты при переключении). */
export async function fetchThreadMessages(
  threadId: string,
): Promise<HistoryMessage[]> {
  return (await fetchThreadHistory(threadId)).messages;
}

/** Ход на паузе: те же события, что шлёт стрим (permission_request,
 *  ask_user_request, connector_request) — карточки восстанавливаются по ним. */
export type PendingEvent = {
  type: "permission_request" | "ask_user_request" | "connector_request";
  interrupt_id?: string | null;
  tool?: string;
  args?: Record<string, unknown>;
  description?: string;
  questions?: unknown[];
  connector?: unknown;
};

/** История треда вместе с тем, что ждёт ответа человека. */
export async function fetchThreadHistory(
  threadId: string,
): Promise<{ messages: HistoryMessage[]; pending: PendingEvent[] }> {
  const res = await fetch(
    `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/messages`,
    { credentials: CREDENTIALS },
  );
  if (!res.ok) return { messages: [], pending: [] };
  const data = await res.json();
  return { messages: data.messages ?? [], pending: data.pending ?? [] };
}

// --- Файлы сессии -----------------------------------------------------------

/** Файл в песочнице сессии (для панели «Файлы» и inline-превью). */
export type SessionFile = {
  path: string;
  name: string;
  size: number;
  mtime: number;
  mime: string;
};

/**
 * Какую область сессии показывать в панели:
 *  - "outputs" — только финальные артефакты агента (дефолт);
 *  - "work"    — рабочая область (черновики, промежуточные рендеры) для отладки.
 */
export type FilesScope = "outputs" | "work";

/** Список файлов сессии для панели «Файлы» (по умолчанию — папка результатов). */
export async function fetchSessionFiles(
  threadId: string,
  scope: FilesScope = "outputs",
): Promise<SessionFile[]> {
  const res = await fetch(
    `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/files` +
      `?scope=${encodeURIComponent(scope)}`,
    { credentials: CREDENTIALS },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.files ?? [];
}

/**
 * Удалить файлы сессии из раздела «Файлы».
 *  - paths задан → удаляем ровно эти файлы;
 *  - paths не задан → удаляем ВСЕ файлы сессии в области scope («удалить всё»).
 * Гибрид на бэке: живой контейнер — rm + ресинк в S3; потушенная сессия —
 * правка S3-снапшота (песочница не будится). Возвращает число удалённых файлов.
 */
export async function deleteSessionFiles(
  threadId: string,
  paths?: string[],
  scope: FilesScope = "outputs",
): Promise<number> {
  const res = await fetch(
    `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/files`,
    {
      method: "DELETE",
      credentials: CREDENTIALS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: paths ?? [], scope }),
    },
  );
  if (!res.ok) {
    throw new Error(`Не удалось удалить файлы (${res.status})`);
  }
  const data = await res.json();
  return data.deleted ?? 0;
}

/** Файл, загруженный пользователем (ответ /files/upload). */
export type UploadedFile = {
  path: string;
  name: string;
  size: number;
  mime: string;
  /** data:-URL мини-превью картинки (Avy Code: файла в ФС нет). */
  thumbUrl?: string;
};

export type UploadResult = {
  files: UploadedFile[];
  errors: { name: string; error: string }[];
};

/**
 * Загрузить прикреплённые файлы в каталог /uploads сессии (multipart). Файлы
 * попадают в песочницу (видны агенту и в панели «Файлы») и выгружаются в S3.
 * Возвращает сохранённые файлы и ошибки по отдельным файлам (напр. too_large).
 */
export async function uploadSessionFiles(
  threadId: string,
  files: File[],
  mode?: string | null,
): Promise<UploadResult> {
  const form = new FormData();
  for (const f of files) form.append("files", f, f.name);
  const url = `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/files/upload${mode ? `?mode=${encodeURIComponent(mode)}` : ""}`;
  const res = await fetch(
    url,
    { method: "POST", credentials: CREDENTIALS, body: form },
  );
  if (!res.ok) {
    throw new Error(`Загрузка файлов не удалась (${res.status})`);
  }
  const data = await res.json();
  return { files: data.files ?? [], errors: data.errors ?? [] };
}

/**
 * Загрузить ОДИН файл в /uploads сессии с реальным прогрессом (XMLHttpRequest —
 * fetch не даёт upload-прогресс). Файлы грузятся сразу при прикреплении, поэтому
 * нужен один-файл-за-раз с колбэком onProgress (0..1) для кольца на чипе.
 *
 * Только обычный чат (mode !== "avy-code": там upload инжектит в сообщение, а не
 * пишет в ФС — грузим по-старому на отправке). Возвращает сохранённый файл или
 * ошибку (too_large и пр.). Отмену даёт возвращаемый abort().
 */
export function uploadSessionFile(
  threadId: string,
  file: File,
  onProgress: (fraction: number) => void,
  mode?: string | null,
): { promise: Promise<UploadedFile>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const url = `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/files/upload${
    mode ? `?mode=${encodeURIComponent(mode)}` : ""
  }`;
  const promise = new Promise<UploadedFile>((resolve, reject) => {
    const form = new FormData();
    form.append("files", file, file.name);
    xhr.open("POST", url);
    xhr.withCredentials = true; // cookie сессии (как CREDENTIALS: include)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Загрузка не удалась (${xhr.status})`));
        return;
      }
      let data: UploadResult;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error("Некорректный ответ загрузки"));
        return;
      }
      const uploaded = data.files?.[0];
      if (!uploaded) {
        const err = data.errors?.[0]?.error ?? "unknown";
        reject(new Error(err));
        return;
      }
      onProgress(1);
      resolve(uploaded);
    };
    xhr.onerror = () => reject(new Error("Сеть недоступна"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

/** URL сырых байтов файла сессии (для <img>/<iframe>/скачивания).
 *
 * Это прямой src для тега (картинка/iframe/ссылка), не fetch — браузер сам
 * приложит cookie сессии (same-site). user_id в URL больше не нужен. */
export function sessionFileRawUrl(threadId: string, path: string): string {
  const qs = new URLSearchParams({ path });
  return `${API_BASE}/api/threads/${encodeURIComponent(threadId)}/files/raw?${qs}`;
}

// ============================================================================
// Регулярные задачи (recurring tasks)
//
// Пользовательские автоматизации, исполняемые по расписанию с участием LLM.
// Бэк: /api/recurring-tasks (CRUD), /{id}/run (запустить сейчас), /{id}/runs
// (история прогонов), /{id}/secrets (защищённые env, значения только на запись).
// Сессии прогонов НЕ показываются в общем списке чатов (kind='recurring') —
// открываются только отсюда, через thread_id прогона (как обычный чат, read-only).
// ============================================================================

export type RecurringTask = {
  id: string;
  thread_id: string;
  title: string;
  schedule: string; // cron (5 полей) — UI строит его человеко-конструктором
  timezone: string;
  instruction: string; // промпт: что агент делает при каждом запуске
  agent_config: Record<string, unknown>;
  error_policy: Record<string, unknown>;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null; // ok | error | running
  next_run_at: string | null;
  created_at: string;
  /** Пространство, к которому задача прикреплена (прогоны на его облаке). */
  space_id?: string | null;
  /** Агент из библиотеки, которым идёт прогон. null — ассистент. */
  agent_id?: string | null;
};

export type TaskRun = {
  id: string;
  thread_id: string | null; // сессия прогона — открывается как чат
  started_at: string;
  finished_at: string | null;
  status: string; // running | ok | error
  attempt: number;
  error: string | null;
  tokens: number | null;
  summary: string | null;
};

export type SecretMeta = { key: string; updated_at: string };

export type CreateTaskInput = {
  title: string;
  schedule: string;
  instruction: string;
  timezone?: string;
  agent_config?: Record<string, unknown>;
  error_policy?: Record<string, unknown> | null;
  enabled?: boolean;
  /** Агент из библиотеки, которым идёт прогон. Пусто — ассистент. */
  agent_id?: string | null;
};

export type UpdateTaskInput = Partial<{
  title: string;
  schedule: string;
  instruction: string;
  timezone: string;
  agent_config: Record<string, unknown>;
  error_policy: Record<string, unknown> | null;
  enabled: boolean;
  /** "" снимает агента (ассистент); id — ставит. */
  agent_id: string | null;
}>;

const RT_BASE = `${API_BASE}/api/recurring-tasks`;

export async function listRecurringTasks(): Promise<RecurringTask[]> {
  const res = await fetch(RT_BASE, { credentials: CREDENTIALS });
  if (!res.ok) return [];
  const data = await res.json();
  return data.tasks ?? [];
}

export async function createRecurringTask(
  input: CreateTaskInput,
): Promise<RecurringTask> {
  const res = await fetch(RT_BASE, {
    method: "POST",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.text()) || `Ошибка ${res.status}`);
  return res.json();
}

export async function updateRecurringTask(
  id: string,
  input: UpdateTaskInput,
): Promise<RecurringTask> {
  const res = await fetch(`${RT_BASE}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.text()) || `Ошибка ${res.status}`);
  return res.json();
}

export async function deleteRecurringTask(id: string): Promise<void> {
  await fetch(`${RT_BASE}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: CREDENTIALS,
  });
}

/** Запустить задачу немедленно (тест/ручной прогон). 409 — уже выполняется. */
export async function runRecurringTaskNow(id: string): Promise<void> {
  const res = await fetch(`${RT_BASE}/${encodeURIComponent(id)}/run`, {
    method: "POST",
    credentials: CREDENTIALS,
  });
  if (!res.ok) throw new Error((await res.text()) || `Ошибка ${res.status}`);
}

export async function listTaskRuns(id: string): Promise<TaskRun[]> {
  const res = await fetch(`${RT_BASE}/${encodeURIComponent(id)}/runs`, {
    credentials: CREDENTIALS,
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.runs ?? [];
}

/** Удалить один прогон из истории. Файлы задачи НЕ трогаются (общее облако). */
export async function deleteTaskRun(taskId: string, runId: string): Promise<void> {
  const res = await fetch(
    `${RT_BASE}/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(runId)}`,
    { method: "DELETE", credentials: CREDENTIALS },
  );
  if (!res.ok) throw new Error((await res.text()) || `Ошибка ${res.status}`);
}

// --- файлы задачи: вложения (/inputs, вход) и артефакты (/outputs, выход) ------

/** Один файл для загрузки: содержимое + относительный путь (для папок). */
export type TaskUpload = { file: File; relPath: string };

/** Загрузить файлы/папки во вложения задачи (/inputs). relPath сохраняет
 *  структуру папок (webkitRelativePath). */
export async function uploadTaskInputs(
  taskId: string,
  uploads: TaskUpload[],
): Promise<{ files: SessionFile[]; errors: { name: string; error: string }[] }> {
  const form = new FormData();
  for (const u of uploads) {
    form.append("files", u.file, u.file.name);
    form.append("paths", u.relPath);
  }
  const res = await fetch(`${RT_BASE}/${encodeURIComponent(taskId)}/inputs`, {
    method: "POST",
    credentials: CREDENTIALS,
    body: form,
  });
  if (!res.ok) throw new Error((await res.text()) || `Ошибка ${res.status}`);
  const data = await res.json();
  return { files: data.files ?? [], errors: data.errors ?? [] };
}

/** Файлы задачи из облака проекта. scope: "inputs" (вложения) | "outputs". */
export async function listTaskFiles(
  taskId: string,
  scope: "inputs" | "outputs",
): Promise<SessionFile[]> {
  const res = await fetch(
    `${RT_BASE}/${encodeURIComponent(taskId)}/files?scope=${scope}`,
    { credentials: CREDENTIALS },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.files ?? [];
}

/** Удалить одно вложение (только /inputs; артефакты не трогаем). */
/** Удалить файл(ы) задачи — вложения (/inputs) или артефакты (/outputs).
 * Принимает один путь или массив (папка целиком) — уходит repeated ?path=. */
export async function deleteTaskFile(
  taskId: string,
  path: string | string[],
): Promise<void> {
  const paths = Array.isArray(path) ? path : [path];
  const qs = new URLSearchParams();
  for (const p of paths) qs.append("path", p);
  await fetch(`${RT_BASE}/${encodeURIComponent(taskId)}/inputs?${qs}`, {
    method: "DELETE",
    credentials: CREDENTIALS,
  });
}

/** URL сырых байтов файла задачи (для превью/скачивания в теге). */
export function taskFileRawUrl(taskId: string, path: string): string {
  const qs = new URLSearchParams({ path });
  return `${RT_BASE}/${encodeURIComponent(taskId)}/files/raw?${qs}`;
}

// ── Пространства ─────────────────────────────────────────────────────────────
// Контейнер контекста: несколько чатов делят одно файловое облако
// (см. docs/spaces-design.md). CRUD + чаты + файлы облака.

export type Space = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  /** Правила пространства — рамка, всегда в промпте его сессий. Процедуры
   *  живут навыками, знание — памятью. */
  instruction: string;
  archived: boolean;
  /** Закреплено в сайдбаре: папка живёт над скролл-зоной, как пин у чатов. */
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

const SPACES_BASE = `${API_BASE}/api/spaces`;

export async function listSpaces(includeArchived = false): Promise<Space[]> {
  const qs = includeArchived ? "?include_archived=true" : "";
  const res = await fetch(`${SPACES_BASE}${qs}`, { credentials: CREDENTIALS });
  if (!res.ok) return [];
  const data = await res.json();
  return data.spaces ?? [];
}

export async function createSpace(input: {
  name: string;
  description?: string;
  instruction?: string;
}): Promise<Space> {
  const res = await fetch(SPACES_BASE, {
    method: "POST",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.text()) || `Ошибка ${res.status}`);
  return res.json();
}

export async function updateSpace(
  id: string,
  input: {
    name?: string;
    description?: string;
    instruction?: string;
    archived?: boolean;
    pinned?: boolean;
  },
): Promise<Space> {
  const res = await fetch(`${SPACES_BASE}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.text()) || `Ошибка ${res.status}`);
  return res.json();
}

export async function deleteSpace(id: string): Promise<void> {
  await fetch(`${SPACES_BASE}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: CREDENTIALS,
  });
}

export async function listSpaceThreads(id: string): Promise<ThreadInfo[]> {
  const res = await fetch(
    `${SPACES_BASE}/${encodeURIComponent(id)}/threads`,
    { credentials: CREDENTIALS },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.threads ?? [];
}

/** Создать чат внутри пространства (project_id проставит сервер). */
export async function createSpaceThread(
  id: string,
  threadId: string,
): Promise<void> {
  const res = await fetch(
    `${SPACES_BASE}/${encodeURIComponent(id)}/threads`,
    {
      method: "POST",
      credentials: CREDENTIALS,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: threadId }),
    },
  );
  if (!res.ok) throw new Error((await res.text()) || `Ошибка ${res.status}`);
}

export async function listSpaceFiles(
  id: string,
  scope: "outputs" | "all" = "outputs",
): Promise<SessionFile[]> {
  const res = await fetch(
    `${SPACES_BASE}/${encodeURIComponent(id)}/files?scope=${scope}`,
    { credentials: CREDENTIALS },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.files ?? [];
}

/** URL сырых байтов файла пространства (превью/скачивание). */
export function spaceFileRawUrl(id: string, path: string): string {
  const qs = new URLSearchParams({ path });
  return `${SPACES_BASE}/${encodeURIComponent(id)}/files/raw?${qs}`;
}

/** Навык в контексте пространства: свой (own) или подключённый из библиотеки. */
export type SpaceSkill = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  /** Заведён ДЛЯ этого пространства (иначе — подключён из библиотеки). */
  own: boolean;
};

export async function listSpaceSkills(
  id: string,
): Promise<{ skills: SpaceSkill[]; linked: string[] }> {
  const res = await fetch(`${SPACES_BASE}/${encodeURIComponent(id)}/skills`, {
    credentials: CREDENTIALS,
  });
  if (!res.ok) return { skills: [], linked: [] };
  const data = await res.json();
  return { skills: data.skills ?? [], linked: data.linked ?? [] };
}

/** Перезаписать список навыков, подключённых из библиотеки (PUT = replace). */
export async function setSpaceSkills(id: string, slugs: string[]): Promise<void> {
  await fetch(`${SPACES_BASE}/${encodeURIComponent(id)}/skills`, {
    method: "PUT",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slugs }),
  });
}

/** id коннекторов, которые видят агенты пространства. Пусто — не видят ни
 *  одного: всё, кроме универсального ассистента, объявляет коннекторы явно. */
export async function listSpaceConnectors(id: string): Promise<string[]> {
  const res = await fetch(`${SPACES_BASE}/${encodeURIComponent(id)}/connectors`, {
    credentials: CREDENTIALS,
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.ids ?? [];
}

/** Правила коннекторов пространства (доступные инструменты, подтверждения). */
export async function fetchSpaceConnectorRules(id: string): Promise<ConnectorRules> {
  const res = await fetch(`${SPACES_BASE}/${encodeURIComponent(id)}/connectors`, {
    credentials: CREDENTIALS,
  });
  if (!res.ok) return {};
  const data = await res.json();
  return (data.rules ?? {}) as ConnectorRules;
}

/** Перезаписать список коннекторов пространства целиком (PUT = replace).
 *  rules — заодно и их правила; без них правила остаются как были. */
export async function setSpaceConnectors(
  id: string,
  ids: string[],
  rules?: ConnectorRules,
): Promise<string[]> {
  const res = await fetch(`${SPACES_BASE}/${encodeURIComponent(id)}/connectors`, {
    method: "PUT",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rules ? { ids, rules } : { ids }),
  });
  if (!res.ok) return ids;
  const data = await res.json();
  return data.ids ?? ids;
}
/** id агентов, подключённых к пространству (команда). */
export async function listSpaceAgents(id: string): Promise<string[]> {
  const res = await fetch(
    `${SPACES_BASE}/${encodeURIComponent(id)}/agents`,
    { credentials: CREDENTIALS },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.agent_ids ?? [];
}

/** Перезаписать команду пространства целиком. */
export async function setSpaceAgents(
  id: string,
  agentIds: string[],
): Promise<void> {
  await fetch(`${SPACES_BASE}/${encodeURIComponent(id)}/agents`, {
    method: "PUT",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_ids: agentIds }),
  });
}

/** Лёгкая строка задачи пространства (вкладка настроек). */
export type SpaceTask = {
  id: string;
  title: string;
  enabled: boolean;
  last_status: string | null;
  last_run_at: string | null;
};

export async function listSpaceTasks(id: string): Promise<SpaceTask[]> {
  const res = await fetch(
    `${SPACES_BASE}/${encodeURIComponent(id)}/tasks`,
    { credentials: CREDENTIALS },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.tasks ?? [];
}

/** Прикрепить задачу: её файлы переезжают в облако пространства, прогоны
 *  дальше работают на общих материалах. */
export async function attachSpaceTask(id: string, taskId: string): Promise<void> {
  const res = await fetch(
    `${SPACES_BASE}/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "PUT", credentials: CREDENTIALS },
  );
  if (!res.ok) throw new Error((await res.text()) || `Ошибка ${res.status}`);
}

export async function detachSpaceTask(id: string, taskId: string): Promise<void> {
  await fetch(
    `${SPACES_BASE}/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "DELETE", credentials: CREDENTIALS },
  );
}

/** Факты общего слоя памяти пространства (вкладка «Память»).
 *  Удаление — существующим forgetMemoryFact (по id факта). */
export async function listSpaceMemory(id: string): Promise<MemoryFact[]> {
  const res = await fetch(
    `${SPACES_BASE}/${encodeURIComponent(id)}/memory`,
    { credentials: CREDENTIALS },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.facts ?? [];
}

/** Список секретов задачи — ТОЛЬКО имена, значения никогда не отдаются. */
export async function listTaskSecrets(id: string): Promise<SecretMeta[]> {
  const res = await fetch(`${RT_BASE}/${encodeURIComponent(id)}/secrets`, {
    credentials: CREDENTIALS,
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.secrets ?? [];
}

export async function setTaskSecret(
  id: string,
  key: string,
  value: string,
): Promise<void> {
  const res = await fetch(`${RT_BASE}/${encodeURIComponent(id)}/secrets`, {
    method: "PUT",
    credentials: CREDENTIALS,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) throw new Error((await res.text()) || `Ошибка ${res.status}`);
}

export async function deleteTaskSecret(id: string, key: string): Promise<void> {
  await fetch(
    `${RT_BASE}/${encodeURIComponent(id)}/secrets/${encodeURIComponent(key)}`,
    { method: "DELETE", credentials: CREDENTIALS },
  );
}
