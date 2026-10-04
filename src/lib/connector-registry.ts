/**
 * Названия коннекторов и их инструментов для ленты хода.
 *
 * Шаг в цепочке рассуждений подписывается синхронно (describeTool в
 * tool-labels.ts), а названия инструментов коннекторов живут в каталоге на
 * бэкенде (connectors/*.yaml: `titles:`, `tools:`). Поэтому каталог грузится
 * один раз на страницу в этот справочник, а компоненты ленты подписываются на
 * его версию (useConnectorLabels) и перерисовываются, когда он пришёл. До
 * загрузки шаг показывается по техническому имени — как раньше.
 */

import * as React from "react";

import { fetchConnectors, type ConnectorInfo } from "@/lib/api";
import { connectorTitle, toolLabel } from "@/lib/connector-labels";

type Entry = Pick<ConnectorInfo, "title" | "titles" | "tool_labels">;

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
let loading: Promise<void> | null = null;

/** Положить каталог в справочник (загрузка; тесты — напрямую). */
export function primeConnectorLabels(list: Array<Entry & { id: string }>): void {
  for (const c of list) entries.set(c.id, { title: c.title, titles: c.titles, tool_labels: c.tool_labels });
  version += 1;
  listeners.forEach((fn) => fn());
}

function load(): void {
  if (loading) return;
  loading = fetchConnectors()
    .then(primeConnectorLabels)
    .catch(() => {
      loading = null; // не вышло — попробуем при следующем монтировании
    });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Подписка компонента ленты: грузит справочник и перерисовывает по приходу. */
export function useConnectorLabels(): number {
  React.useEffect(load, []);
  return React.useSyncExternalStore(subscribe, () => version, () => 0);
}

/** `mcp__<коннектор>__<инструмент>` → «Telegram: Отправить сообщение».
 *  null — не инструмент коннектора. */
export function connectorToolTitle(name: string, locale: string): string | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  if (!m) return null;
  const [, cid, tool] = m;
  const entry = entries.get(cid);
  const service = entry ? connectorTitle(entry, locale) : cid;
  const action = entry ? toolLabel(entry, tool, locale) : tool.replace(/_/g, " ");
  return `${service}: ${action}`;
}
