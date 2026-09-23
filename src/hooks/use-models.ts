"use client";

/**
 * Список моделей — С БЭКЕНДА, а не из кода.
 *
 * В облачной версии модели были прошиты во фронте (qwen3.7-plus → «Enso»,
 * qwen3.8-max → «Gaia»). В локальной сборке модель развёрнута в контуре и
 * называется так, как её назвал администратор (AVY_LLM_MODELS); прошитый список
 * там не существует — бэкенд молча подменял выбранную «Gaia» дефолтом, а человек
 * видел в интерфейсе модели, которых у него нет.
 *
 * Имена показываем как есть: это настоящие имена моделей у эндпоинта, и
 * подменять их выдуманными марками нечем и незачем.
 *
 * Кэш на приложение и один запрос на всех подписчиков — как у useAgents:
 * список задаётся при установке и меняется только с ней.
 */

import { useEffect, useState } from "react";

import { fetchModels } from "@/lib/api";

export type ModelsInfo = {
  /** Идентификаторы моделей в порядке из AVY_LLM_MODELS. */
  models: string[];
  /** Модель по умолчанию — первая в списке. null, пока не загружено. */
  defaultModel: string | null;
};

let cache: ModelsInfo | null = null;
let inflight: Promise<ModelsInfo> | null = null;

const EMPTY: ModelsInfo = { models: [], defaultModel: null };

async function load(): Promise<ModelsInfo> {
  const res = await fetchModels();
  const models = Array.isArray(res.models) ? res.models.filter(Boolean) : [];
  return { models, defaultModel: res.default || models[0] || null };
}

/** Сбросить кэш (тесты). */
export function invalidateModels() {
  cache = null;
  inflight = null;
}

export function useModels(): ModelsInfo & { loading: boolean } {
  const [info, setInfo] = useState<ModelsInfo>(cache ?? EMPTY);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    if (cache !== null) return;
    let alive = true;
    inflight = inflight ?? load();
    inflight
      .then((data) => {
        cache = data;
        if (alive) setInfo(data);
      })
      .catch(() => {
        // Без списка чат работает: бэкенд подставит модель по умолчанию сам.
        // Селектор при этом пуст, а не показывает выдуманные имена.
        cache = EMPTY;
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return { ...info, loading };
}
