"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  compactContext,
  fetchContextUsage,
  type ContextUsage,
} from "@/lib/api";
import { hasLocalCodeAgent } from "@/lib/code/code-streams";
import { compactCodeAgent, fetchCodeAgentContextUsage, stopCodeAgent } from "@/lib/code/code-agent-stream";

/**
 * Локальный ли источник контекста у ЭТОГО треда.
 *
 * Условие двойное — ровно как в use-code-chat.ts:93 (`opts.mode !== "avy-code"
 * || !hasLocalCodeAgent()`). Одного моста НЕДОСТАТОЧНО: в Electron он есть
 * всегда, включая обычный чат, а локальный агент знает только треды кодера.
 * Чатовую историю он ищет в своём файле чекпоинта, не находит и возвращает
 * null — метр рендерится только при непустом usage, поэтому в приложении он
 * пропадал в чате, а в браузере (моста нет → серверный путь) работал.
 */
function isLocalThread(mode: string | undefined): boolean {
  return mode === "avy-code" && hasLocalCodeAgent();
}

/**
 * Источник заполненности контекста: локальный агент в Electron (без сервера,
 * см. sessionManager.ts:getContextUsage/compact) или серверный REST — тот же
 * выбор транспорта, что chat-streams.ts делает для самого хода (runCodeTurn).
 */
function getUsage(threadId: string, mode: string | undefined): Promise<ContextUsage | null> {
  return isLocalThread(mode) ? fetchCodeAgentContextUsage(threadId) : fetchContextUsage(threadId);
}

/**
 * Заполненность окна контекста активной сессии + ручное сжатие.
 *
 * Сервер считает токены, которые РЕАЛЬНО уйдут в модель (с учётом сжатия), и
 * делит на порог сжатия. Поэтому после авто- или ручного сжатия процент падает,
 * хотя лента в UI остаётся полной.
 *
 * Обновляем при смене сессии и по `refresh()` (вызывается после каждого хода).
 * Песочницу чтение не будит — это чистый расчёт по истории чекпойнтера.
 */
export function useContextUsage(
  threadId: string | undefined,
  // Режим треда ("avy-code" — кодер, иначе чат). Определяет ИСТОЧНИК контекста:
  // локальный агент или сервер. Без него в Electron чатовый тред уходил бы в
  // локальный агент, которому эта история неизвестна (см. isLocalThread).
  mode: string | undefined,
  // Вызывается ПОСЛЕ успешного РУЧНОГО сжатия — контейнер по нему добавляет блок
  // «Контекст сжат» В КОНЕЦ ленты (тот же live-патч, что и авто-сжатие через
  // chat-streams.ts:summary). НЕ перезагрузка с сервера: она конкурировала с
  // live-вставкой и дублировала историю треды (см. историю бага). Авто-сжатие
  // сюда не идёт — там блок вставляет стрим хода сам.
  onManualSummary?: (summary: { text: string; tokens: number | null }) => void,
) {
  const [usage, setUsage] = useState<ContextUsage | null>(null);
  const [compacting, setCompacting] = useState(false);
  // Контроллер текущего запроса сжатия — чтобы отменить его по Esc.
  const compactAbort = useRef<AbortController | null>(null);
  // Всегда свежий колбэк без влияния на deps (вызывающий передаёт инлайн-стрелку).
  const onManualSummaryRef = useRef(onManualSummary);
  useEffect(() => {
    onManualSummaryRef.current = onManualSummary;
  });
  // Последний известный used_tokens ЭТОЙ сессии — база для детекта автосжатия:
  // без сжатия использование только растёт, падение после хода означает, что
  // middleware сжал историю посреди хода (событие в стрим не приходит).
  const lastUsed = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!threadId) {
      setUsage(null);
      return;
    }
    const u = await getUsage(threadId, mode);
    if (u) {
      // Обновляем только само число заполненности. Блок «Контекст сжат» при
      // АВТО-сжатии вставляет стрим хода (chat-streams.ts:summary) — детектить
      // падение контекста и перезагружать ленту здесь больше не нужно (перезагрузка
      // конкурировала с live-вставкой и дублировала историю треды).
      lastUsed.current = u.used_tokens;
      setUsage(u);
    }
  }, [threadId, mode]);

  // Подгружаем при смене сессии. Грузим во внутренней async-функции с guard'ом
  // `alive`: setState вызывается только ПОСЛЕ await (не синхронно в теле эффекта),
  // что и нужно для синхронизации с внешним источником (историей на сервере).
  useEffect(() => {
    let alive = true;
    lastUsed.current = null; // новая сессия — новая база сравнения (без ложного детекта)
    // СИНХРОННО гасим метр при смене сессии: getUsage(threadId) — это await
    // (для локального агента ещё и IPC-раунд в main-процесс), и до его ответа в
    // usage висело бы значение ПРЕДЫДУЩЕЙ сессии. Из-за этого новый/другой чат
    // показывал чужой процент заполненности, пока с задержкой не доедет свой.
    // null прячет метр (рендерится только при contextUsage) — правильное
    // «пусто» для новой сессии, число появится, когда придёт своё.
    setUsage(null);
    (async () => {
      if (!threadId) return;
      const u = await getUsage(threadId, mode);
      if (alive && u) {
        lastUsed.current = u.used_tokens;
        setUsage(u);
      }
    })();
    return () => {
      alive = false;
    };
  }, [threadId, mode]);

  const compact = useCallback(async () => {
    if (!threadId || compacting) return;
    setCompacting(true);
    try {
      if (isLocalThread(mode)) {
        // Локальный агент: нет HTTP-запроса для отмены сигналом — Esc идёт
        // через stopCodeAgent (session.abortController.abort() в main-процессе),
        // см. cancelCompact ниже. compactCodeAgent сам дождётся terminal-события.
        const res = await compactCodeAgent(threadId);
        if (res) {
          lastUsed.current = res.used_tokens;
          setUsage({ used_tokens: res.used_tokens, max_tokens: res.max_tokens });
          // Блок «Контекст сжат» здесь НЕ вставляем. У локального агента то же
          // summary-событие приходит постоянной onEvent-подпиской (use-chat.ts →
          // applyBackgroundEvent → case "summary" в chat-streams), которая и
          // рисует маркер: ручное сжатие идёт МИМО consume() (compactCodeAgent
          // сам вычерпывает свой поток), r.ctrl не занят, фоновый канал активен.
          // Вставка и там, и здесь давала ДВА одинаковых блока подряд (живой
          // баг 2026-07-25; после рестарта оставался один — лента перечитывалась
          // из чекпоинта, где summary-сообщение одно). onManualSummaryRef —
          // только для серверного пути ниже, у которого live-событий нет.
        }
        return;
      }
      const ctrl = new AbortController();
      compactAbort.current = ctrl;
      const res = await compactContext(threadId, ctrl.signal);
      // null → Esc/обрыв: клиентский abort рвёт HTTP-запрос, сервер видит
      // дисконнект и ОТМЕНЯЕТ сжатие целиком (событие не пишется, блок не
      // появится) — это настоящая отмена, ничего не делаем.
      if (res) {
        lastUsed.current = res.used_tokens; // не детектить это же сжатие повторно в refresh
        setUsage({ used_tokens: res.used_tokens, max_tokens: res.max_tokens });
        // Реально что-то сжали → вставить блок «Контекст сжат» в конец ленты.
        // Серверный путь (не-code режим) число свёрнутых токенов не отдаёт —
        // tokens:null, блок покажется без подписи количества (как было раньше).
        if (res.compacted && res.summary) {
          onManualSummaryRef.current?.({ text: res.summary, tokens: null });
        }
      }
    } finally {
      compactAbort.current = null;
      setCompacting(false);
    }
  }, [threadId, mode, compacting]);

  // Отменить идущее сжатие (Esc): для серверного пути рвём fetch (finally в
  // compact() снимет флаг); для локального агента — тот же IPC-стоп, что и
  // обычная остановка хода (sessionManager.ts:stop прерывает forceCompact-ход
  // так же, как обычную генерацию).
  const cancelCompact = useCallback(() => {
    if (isLocalThread(mode)) {
      if (threadId) stopCodeAgent(threadId);
      return;
    }
    compactAbort.current?.abort();
  }, [threadId, mode]);

  return { usage, compacting, refresh, compact, cancelCompact };
}
