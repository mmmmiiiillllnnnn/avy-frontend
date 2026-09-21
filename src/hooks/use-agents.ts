"use client";

/**
 * Библиотека агентов: коробочные (наши) + пользовательские.
 *
 * Два входа, потому что нужны они в разных местах и с разными требованиями:
 *
 *   useAgents()      — для ВЫБОРА агента над полем ввода. Только включённые,
 *                      кэш на приложение: список меняется редко (создание —
 *                      событие пользователя, а не фон), а запрашивается на
 *                      каждом монтировании инпута.
 *   useAgentLibrary() — для раздела «Мои агенты». ВСЕ, включая выключенных
 *                      (иначе выключенного негде было бы включить), плюс
 *                      действия. Без кэша: раздел открывают редко, а видеть
 *                      он должен свежее.
 */

import { useCallback, useEffect, useState } from "react";

import {
  createAgent,
  deleteAgent,
  fetchAgents,
  updateAgent,
  type Agent,
  type AgentInput,
} from "@/lib/api";

export type { Agent } from "@/lib/api";

let cache: Agent[] | null = null;
let inflight: Promise<Agent[]> | null = null;

/** Сбросить кэш выбора — после создания/правки/удаления агента. */
export function invalidateAgents() {
  cache = null;
  inflight = null;
}

/** Агенты для выбора над полем ввода: только включённые, с кэшем. */
export function useAgents(): { agents: Agent[]; loading: boolean } {
  const [agents, setAgents] = useState<Agent[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    if (cache !== null) return;
    let alive = true;
    // Один запрос на всех подписчиков: инпут монтируется в нескольких местах,
    // и без этого при старте уходило бы несколько одинаковых обращений.
    inflight = inflight ?? fetchAgents({ onlyEnabled: true });
    inflight
      .then((list) => {
        cache = list;
        if (alive) setAgents(list);
      })
      .catch(() => {
        // Молча: без списка агентов чат работает как раньше (универсальный
        // агент), и ронять из-за этого интерфейс незачем.
        cache = [];
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return { agents, loading };
}

export type AgentLibraryApi = {
  agents: Agent[];
  loaded: boolean;
  refresh: () => Promise<void>;
  create: (body: AgentInput) => Promise<Agent | null>;
  update: (id: string, body: Partial<AgentInput>) => Promise<Agent | null>;
  remove: (id: string) => Promise<boolean>;
  toggle: (id: string, enabled: boolean) => Promise<void>;
};

/** Раздел «Мои агенты»: все агенты + действия. */
export function useAgentLibrary(): AgentLibraryApi {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const list = await fetchAgents();
    setAgents(list);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let alive = true;
    // Грузим здесь, а не вызовом refresh(): синхронный setState внутри тела
    // эффекта даёт каскадный ререндер (react-hooks/set-state-in-effect).
    fetchAgents()
      .then((list) => alive && setAgents(list))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  // Любое изменение сбрасывает кэш выбора: иначе агент, включённый в разделе,
  // не появился бы в списке над полем ввода до перезагрузки страницы.
  const create = useCallback(
    async (body: AgentInput) => {
      const a = await createAgent(body);
      if (a) {
        invalidateAgents();
        await refresh();
      }
      return a;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, body: Partial<AgentInput>) => {
      const a = await updateAgent(id, body);
      if (a) {
        invalidateAgents();
        await refresh();
      }
      return a;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const ok = await deleteAgent(id);
      if (ok) {
        invalidateAgents();
        await refresh();
      }
      return ok;
    },
    [refresh],
  );

  const toggle = useCallback(
    async (id: string, enabled: boolean) => {
      // Переключаем сразу, не дожидаясь ответа: тумблер, который «думает»,
      // ощущается сломанным. При отказе список вернётся к правде на refresh.
      setAgents((cur) =>
        cur.map((a) => (a.id === id ? { ...a, enabled } : a)),
      );
      invalidateAgents();
      await updateAgent(id, { enabled });
      await refresh();
    },
    [refresh],
  );

  return { agents, loaded, refresh, create, update, remove, toggle };
}
