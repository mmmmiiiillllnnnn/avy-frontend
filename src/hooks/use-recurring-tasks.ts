"use client";

import { useCallback, useEffect, useState } from "react";
import {
  listRecurringTasks,
  createRecurringTask,
  updateRecurringTask,
  deleteRecurringTask,
  runRecurringTaskNow,
  type RecurringTask,
  type CreateTaskInput,
  type UpdateTaskInput,
} from "@/lib/api";

/**
 * Состояние списка регулярных задач + мутации (оптимистичные, как use-threads).
 *
 * Прогоны и секреты конкретной задачи грузятся ЛЕНИВО в её детальном экране —
 * этот хук держит только список задач (лёгкий, обновляется при create/update/
 * delete/toggle). refresh() перечитывает список (напр. после запуска, чтобы
 * подхватить обновлённый last_status/next_run_at).
 */
export function useRecurringTasks() {
  const [tasks, setTasks] = useState<RecurringTask[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const list = await listRecurringTasks();
    setTasks(list);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await listRecurringTasks();
      if (!cancelled) {
        setTasks(list);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const create = useCallback(async (input: CreateTaskInput) => {
    const task = await createRecurringTask(input);
    // Пустую заготовку формы (draft при её открытии) в список НЕ кладём —
    // висела бы безымянной карточкой. Она попадёт туда при сохранении, через
    // update(draft:false). Задачу от ассистента сервер отдаёт уже заполненной.
    setTasks((prev) => (task.draft && !task.title ? prev : [task, ...prev]));
    return task;
  }, []);

  const update = useCallback(async (id: string, input: UpdateTaskInput) => {
    const task = await updateRecurringTask(id, input);
    setTasks((prev) =>
      // Задачи может НЕ БЫТЬ в списке: форма создаёт её черновиком (он скрыт),
      // а «Сохранить» — это update(draft:false). Прежний map() в таком случае
      // просто ничего не находил, и созданная задача не появлялась до
      // перезагрузки страницы. Нет в списке — добавляем.
      prev.some((t) => t.id === id)
        ? prev.map((t) => (t.id === id ? task : t))
        : [task, ...prev],
    );
    return task;
  }, []);

  const remove = useCallback(async (id: string) => {
    // Оптимистично убираем из списка; при ошибке перечитаем.
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      await deleteRecurringTask(id);
    } catch {
      await refresh();
    }
  }, [refresh]);

  const toggle = useCallback(
    async (id: string, enabled: boolean) => {
      // Оптимистично переключаем флаг; сервер пересчитает next_run_at.
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, enabled } : t)));
      try {
        const task = await updateRecurringTask(id, { enabled });
        setTasks((prev) => prev.map((t) => (t.id === id ? task : t)));
      } catch {
        await refresh();
      }
    },
    [refresh],
  );

  const runNow = useCallback(
    async (id: string) => {
      await runRecurringTaskNow(id);
      // Статус обновится в фоне — перечитаем список чуть позже.
      void refresh();
    },
    [refresh],
  );

  return { tasks, loaded, refresh, create, update, remove, toggle, runNow };
}

export type RecurringTasksApi = ReturnType<typeof useRecurringTasks>;
