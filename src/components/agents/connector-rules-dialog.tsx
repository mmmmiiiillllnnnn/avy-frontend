"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { ConnectorLogo } from "@/components/agents/connectors-panel";
import { Modal } from "@/components/ui/modal";
import { useLocale, useT } from "@/i18n/i18n-context";
import { fetchConnectorTools, type ConnectorInfo, type ConnectorRule } from "@/lib/api";
import { compactRule, connectorTitle, entityConfirm, toolLabel, toolShortName } from "@/lib/connector-labels";

/** Настройки коннектора у одной сущности — агента, регулярной задачи,
 *  пространства: какие инструменты ей доступны и какие она подтверждает.
 *
 *  Перекрывают общие настройки коннектора только здесь (уровни — в
 *  connectors/rules.py на бэкенде). По умолчанию доступно всё, а
 *  подтверждения — как в общих настройках; пока человек их не тронул,
 *  правило так и остаётся «молчащим» и следует за общими.
 *
 *  unattended — сущность работает без человека (регулярная задача): там
 *  подтверждать некому, предупреждаем прямо в окне.
 */
export function ConnectorRulesDialog({
  connector,
  rule,
  unattended = false,
  onChange,
  onClose,
}: {
  connector: ConnectorInfo;
  rule: ConnectorRule | undefined;
  unattended?: boolean;
  /** Новое правило; null — у сущности для коннектора ничего своего. */
  onChange: (rule: ConnectorRule | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const c = t.connectors;
  const [tools, setTools] = React.useState<string[] | null | undefined>(
    // У неподключённого встроенного коннектора инструменты известны по YAML;
    // у MCP-сервера — только после подключения.
    connector.connected ? undefined : Object.keys(connector.tool_labels ?? {}),
  );

  React.useEffect(() => {
    if (!connector.connected) return;
    let alive = true;
    fetchConnectorTools(connector.id).then((list) => {
      if (alive) setTools(list ? list.map((x) => toolShortName(x.name)) : null);
    });
    return () => {
      alive = false;
    };
  }, [connector.connected, connector.id]);

  const enabled = (name: string) => rule?.tools == null || rule.tools.includes(name);
  const confirmed = entityConfirm(connector, rule);
  const all = tools ?? [];

  const set = (patch: ConnectorRule) => onChange(compactRule({ ...rule, ...patch }));

  const toggleEnabled = (name: string) => {
    const current = rule?.tools ?? all;
    const next = current.includes(name) ? current.filter((x) => x !== name) : [...current, name];
    // Отмечено всё — это «все доступны», а не перечень: новый инструмент
    // коннектора тоже окажется доступен.
    set({ tools: all.every((x) => next.includes(x)) ? null : next });
  };
  const toggleConfirm = (name: string) => {
    const next = confirmed.includes(name) ? confirmed.filter((x) => x !== name) : [...confirmed, name];
    set({ confirm: next });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <div className="flex min-w-0 items-center gap-2.5">
          <ConnectorLogo src={connector.logo} className="size-5" />
          <h2 className="min-w-0 truncate text-lg font-semibold">{c.rulesTitle(connectorTitle(connector, locale))}</h2>
        </div>
      }
      className="flex max-h-[85dvh] w-full max-w-2xl flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <p className="text-sm text-muted-foreground">{c.rulesHint}</p>
        {unattended && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{c.rulesUnattended}</span>
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/60">
          {tools === undefined ? (
            <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {c.toolsLoading}
            </p>
          ) : tools === null || tools.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{c.rulesNeedConnect}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="px-4 py-2 text-left font-normal">{c.toolsTitle}</th>
                  <th className="w-24 px-2 py-2 text-center font-normal">{c.availableColumn}</th>
                  <th className="w-28 px-2 py-2 text-center font-normal">{c.confirmColumn}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {all.map((name) => {
                  const on = enabled(name);
                  return (
                    <tr key={name} className={on ? "" : "text-muted-foreground"}>
                      <td className="px-4 py-2">
                        <div className="font-medium">{toolLabel(connector, name, locale)}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">{name}</div>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggleEnabled(name)}
                          aria-label={`${c.availableColumn}: ${toolLabel(connector, name, locale)}`}
                          className="size-4 accent-primary"
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={on && confirmed.includes(name)}
                          disabled={!on}
                          onChange={() => toggleConfirm(name)}
                          aria-label={`${c.confirmColumn}: ${toolLabel(connector, name, locale)}`}
                          className="size-4 accent-primary disabled:opacity-40"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <span className="text-xs text-muted-foreground">
            {rule?.confirm == null ? c.rulesInherited : ""}
          </span>
          {rule?.confirm != null && (
            <button
              type="button"
              onClick={() => set({ confirm: null })}
              className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {c.rulesInheritReset}
            </button>
          )}
          {rule?.tools != null && (
            <button
              type="button"
              onClick={() => set({ tools: null })}
              className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {c.rulesAllTools}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {c.done}
          </button>
        </div>
      </div>
    </Modal>
  );
}
