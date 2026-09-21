"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createThread,
  deleteThread,
  listThreads,
  renameThread,
  setThreadPinned,
  type ThreadInfo,
} from "@/lib/api";
import { deleteCodeThreadLocal } from "@/lib/code/code-api";

/** Сгенерировать уникальный id новой сессии (без внешних зависимостей). */
function newThreadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `t-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Состояние списка сессий + активная сессия.
 *
 * - При старте подгружает список с сервера; если пусто — создаёт первую.
 * - newSession(): переключиться на новую пустую сессию (id фиксируем сразу, но
 *   в список НЕ добавляем — пустой черновик там не висит). В список и в БД тред
 *   попадёт при первом сообщении (ensureListed() + /api/chat).
 * - remove(): удалить сессию (с историей) и переключиться на соседнюю.
 * - setTitleLocal(): обновить заголовок в списке (после автогенерации).
 */
export function useThreads(mode?: string | null) {
  const [threads, setThreads] = useState<ThreadInfo[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [loaded, setLoaded] = useState(false);

  // Первичная загрузка + перезагрузка при смене раздела (chat / avy-code).
  // Список тредов разный для каждого режима — не смешиваем.
  //
  // Активной ВСЕГДА становится НОВАЯ пустая сессия, а не list[0]. Сессия жёстко
  // принадлежит одному режиму (chat ИЛИ avy-code) и не может шариться между ними:
  // раньше при переключении режима подхватывался последний тред раздела, а общий
  // thread_id тащился между чатом и кодом → на сервере тред помечался одним mode,
  // но обрастал данными другого (workspace в chat-треде и т.п.). Новый тред на
  // каждое переключение убирает саму возможность коллизии. Прошлые треды раздела
  // остаются в списке (сайдбар) — их можно открыть вручную через select().
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setActiveId(newThreadId());
    (async () => {
      const list = await listThreads(mode);
      if (cancelled) return;
      setThreads(list);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const newSession = useCallback(() => {
    const id = newThreadId();
    // Только переключаем активную сессию — в список НЕ добавляем. Пустой
    // черновик не должен висеть в сессиях; тред попадёт туда через
    // ensureListed() после первого отправленного сообщения (он же
    // материализует запись на сервере первым ходом).
    setActiveId(id);
    return id;
  }, []);

  const select = useCallback((id: string) => setActiveId(id), []);

  const remove = useCallback(
    async (id: string) => {
      await deleteThread(id);
      // Локальные следы avy-code треда (чекпоинт + downloads). No-op вне Electron
      // и для не-code тредов (там локального чекпоинта нет) — вызываем всегда,
      // не блокируя удаление, если локальная чистка не удалась.
      void deleteCodeThreadLocal(id);
      setThreads((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        const next = prev.filter((t) => t.id !== id);
        if (id === activeId) {
          // Переключаемся на СОСЕДНЮЮ сессию по позиции в списке (сначала та, что
          // шла после удаляемой, иначе предыдущая) — выделение остаётся на месте,
          // а не прыгает на самую первую (next[0]), что дизориентировало. Если
          // список опустел — новая пустая сессия.
          const neighbour = next[idx] ?? next[idx - 1];
          setActiveId(neighbour?.id ?? newThreadId());
        }
        return next;
      });
    },
    [activeId],
  );

  const rename = useCallback(async (id: string, title: string) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...t, title } : t)),
    );
    await renameThread(id, title);
  }, []);

  /** Закрепить/открепить сессию. Оптимистично: ставим флаг и пересортируем
   * (закреплённые сверху, внутри — по свежести), затем шлём на сервер. */
  const togglePin = useCallback(async (id: string, pinned: boolean) => {
    setThreads((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, pinned } : t));
      return next
        .slice()
        .sort((a, b) =>
          a.pinned === b.pinned
            ? b.updated_at.localeCompare(a.updated_at)
            : a.pinned
              ? -1
              : 1,
        );
    });
    await setThreadPinned(id, pinned);
  }, []);

  /** Локально обновить заголовок (после серверной автогенерации). */
  const setTitleLocal = useCallback((id: string, title: string) => {
    setThreads((prev) =>
      prev.map((t) => (t.id === id ? { ...t, title } : t)),
    );
  }, []);

  /** Подхватить заголовок с сервера (генерится в фоне после первого хода).
   *
   * Сервер генерит заголовок асинхронно — опрашиваем список тредов, пока
   * заголовок не перестанет быть дефолтным. Окно опроса ~30 секунд с
   * бэкоффом: заголовок делает та же (нередко рассуждающая) модель, что и
   * ход, и прежние ~8 секунд она регулярно не успевала — название висело
   * «Новый чат» до перезагрузки страницы.
   */
  const pollingTitleIds = useRef<Set<string>>(new Set());
  const refreshTitle = useCallback((id: string) => {
    // Один опросчик на тред: refreshTitle зовётся и на отправке, и на
    // завершении хода — второй параллельный цикл только дублировал бы запросы.
    if (pollingTitleIds.current.has(id)) return;
    pollingTitleIds.current.add(id);
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      const list = await listThreads();
      const found = list.find((t) => t.id === id);
      if (found && found.title && found.title !== "Новый чат") {
        pollingTitleIds.current.delete(id);
        setThreads((prev) =>
          prev.map((t) => (t.id === id ? { ...t, title: found.title } : t)),
        );
        return;
      }
      if (attempts < 10) setTimeout(tick, attempts < 5 ? 1500 : 4500);
      else pollingTitleIds.current.delete(id);
    };
    setTimeout(tick, 800);
  }, []);

  /** Убедиться, что активная сессия есть в списке (после первого хода).
   *
   * Треды регулярных задач и их прогонов (`task-…`, `<task>:run-<id>`) в списке
   * чатов НЕ показываем — они живут только в разделе «Регулярные задачи». Их
   * можно открыть как живую сессию, но подмешивать в сайдбар нельзя.
   *
   * projectId — пространство чата (если он заведён внутри пространства). БЕЗ
   * него сайдбар не знал бы о принадлежности и клал бы свежий чат в общий
   * поток вместо папки пространства — до перезагрузки страницы. */
  const ensureListed = useCallback(
    (id: string, projectId?: string | null) => {
      if (id.includes(":run-") || id.startsWith("task-")) return;
      setThreads((prev) =>
        prev.some((t) => t.id === id)
          ? prev
          : [
              {
                id,
                user_id: "",
                title: "Новый чат",
                mode: mode === "avy-code" ? "avy-code" : "chat",
                pinned: false,
                project_id: projectId ?? null,
                created_at: "",
                updated_at: new Date().toISOString(),
              },
              ...prev,
            ],
      );
    },
    [mode],
  );

  /** Перечитать список с сервера (после действий в других разделах: создание
   *  чата в пространстве, привязка/удаление). Активную сессию не трогает. */
  const refresh = useCallback(async () => {
    const list = await listThreads(mode);
    setThreads((prev) => {
      // СЛИЯНИЕ, а не замена. refresh может прийти в момент, когда сессия уже
      // добавлена локально (ensureListed на отправке), но сервер про неё ещё
      // не знает — первый ход только идёт. Голое setThreads(list) в этот
      // момент стирало запись, а следующий ensureListed возвращал её: в списке
      // мелькал то пропадающий, то задвоенный «Новый чат» (ловилось при уходе
      // с экрана и возврате).
      const known = new Set(list.map((t) => t.id));
      const pending = prev.filter((t) => !known.has(t.id) && !t.created_at);
      return pending.length === 0 ? list : [...pending, ...list];
    });
  }, [mode]);

  const activeThread = threads.find((t) => t.id === activeId) ?? null;

  return {
    threads,
    activeId,
    activeThread,
    loaded,
    newSession,
    select,
    remove,
    rename,
    togglePin,
    setTitleLocal,
    refreshTitle,
    ensureListed,
    refresh,
  };
}

/** Публичная форма стейта сессий — прокидывается в сайдбар и воркспейс. */
export type SessionsApi = ReturnType<typeof useThreads>;

export { createThread };
