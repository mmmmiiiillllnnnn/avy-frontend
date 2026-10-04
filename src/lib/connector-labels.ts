/**
 * Человеческие названия коннекторов и их инструментов + что подтверждается.
 *
 * Названия — из YAML коннектора (`titles:`, `tools:` на бэкенде): здесь ни
 * одного имени сервиса. Чего в YAML нет (инструмент своего MCP-сервера),
 * показываем по техническому имени.
 */

import type { ConnectorInfo, ConnectorRule } from "@/lib/api";

type Titled = Pick<ConnectorInfo, "title"> & Partial<Pick<ConnectorInfo, "titles">>;

export function connectorTitle(c: Titled, locale: string): string {
  return c.titles?.[locale] || c.titles?.en || c.title;
}

/** Имя инструмента без префикса `mcp__<коннектор>__`. */
export function toolShortName(name: string): string {
  const m = /^mcp__.+?__(.+)$/.exec(name);
  return m ? m[1] : name;
}

export function toolLabel(c: Pick<ConnectorInfo, "tool_labels">, name: string, locale: string): string {
  const short = toolShortName(name);
  const labels = c.tool_labels?.[short];
  return labels?.[locale] || labels?.en || short;
}

/** Что подтверждается в обычных чатах: общие настройки человека или умолчание. */
export function generalConfirm(c: Pick<ConnectorInfo, "settings" | "confirm_default">): string[] {
  if (c.settings?.autoApprove) return [];
  return c.settings?.confirm ?? c.confirm_default ?? [];
}

/** Что подтверждается у сущности: её правило, иначе общие настройки. */
export function entityConfirm(
  c: Pick<ConnectorInfo, "settings" | "confirm_default">,
  rule: ConnectorRule | undefined,
): string[] {
  return rule?.confirm ?? generalConfirm(c);
}

/** Правило без пустых полей; null — у сущности для коннектора ничего своего. */
export function compactRule(rule: ConnectorRule): ConnectorRule | null {
  const out: ConnectorRule = {};
  if (rule.tools != null) out.tools = rule.tools;
  if (rule.confirm != null) out.confirm = rule.confirm;
  return Object.keys(out).length ? out : null;
}
