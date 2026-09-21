"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  compactContext,
  fetchContextUsage,
  type ContextUsage,
} from "@/lib/api";

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
    const u = await fetchContextUsage(threadId);
    if (u) {
      // Обновляем только само число заполненности. Блок «Контекст сжат» при
      // АВТО-сжатии вставляет стрим хода (chat-streams.ts:summary) — детектить
      // падение контекста и перезагружать ленту здесь больше не нужно (перезагрузка
      // конкурировала с live-вставкой и дублировала историю треды).
      lastUsed.current = u.used_tokens;
      setUsage(u);
    }
  }, [threadId]);

  // Подгружаем при смене сессии. Грузим во внутренней async-функции с guard'ом
  // `alive`: setState вызывается только ПОСЛЕ await (не синхронно в теле эффекта),
  // что и нужно для синхронизации с внешним источником (историей на сервере).
  useEffect(() => {
    let alive = true;
    lastUsed.current = null; // новая сессия — новая база сравнения (без ложного детекта)
    // СИНХРОННО гасим метр при смене сессии: fetchContextUsage(threadId) — это
    // await, и до его ответа в
    // usage висело бы значение ПРЕДЫДУЩЕЙ сессии. Из-за этого новый/другой чат
    // показывал чужой процент заполненности, пока с задержкой не доедет свой.
    // null прячет метр (рендерится только при contextUsage) — правильное
    // «пусто» для новой сессии, число появится, когда придёт своё.
    setUsage(null);
    (async () => {
      if (!threadId) return;
      const u = await fetchContextUsage(threadId);
      if (alive && u) {
        lastUsed.current = u.used_tokens;
        setUsage(u);
      }
    })();
    return () => {
      alive = false;
    };
  }, [threadId]);

  const compact = useCallback(async () => {
    if (!threadId || compacting) return;
    setCompacting(true);
    try {
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
        // Число свёрнутых токенов сервер не отдаёт — tokens:null, блок
        // покажется без подписи количества.
        if (res.compacted && res.summary) {
          onManualSummaryRef.current?.({ text: res.summary, tokens: null });
        }
      }
    } finally {
      compactAbort.current = null;
      setCompacting(false);
    }
  }, [threadId, compacting]);

  // Отменить идущее сжатие (Esc): рвём fetch, finally в compact() снимет флаг.
  const cancelCompact = useCallback(() => {
    compactAbort.current?.abort();
  }, []);

  return { usage, compacting, refresh, compact, cancelCompact };
}
