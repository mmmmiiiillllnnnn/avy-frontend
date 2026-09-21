"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchUsage, type UsageInfo } from "@/lib/api";

/**
 * Лимит/кредиты текущего пользователя. Грузим при монтировании и даём refresh()
 * — вызывающий дёргает его после завершения хода чата, чтобы остаток/плашка были
 * актуальны (без лупов/поллинга).
 */
export function useUsage(): { usage: UsageInfo | null; refresh: () => void } {
  const [usage, setUsage] = useState<UsageInfo | null>(null);

  const refresh = useCallback(() => {
    fetchUsage().then(setUsage).catch(() => {});
  }, []);

  useEffect(() => refresh(), [refresh]);

  return { usage, refresh };
}
