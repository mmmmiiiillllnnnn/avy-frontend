"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Plug } from "lucide-react";

import { ConnectDialog, ConnectorLogo } from "@/components/agents/connectors-panel";
import { useLocale, useT } from "@/i18n/i18n-context";
import { connectorSummary, type ConnectorCardInfo } from "@/lib/api";
import { connectorTitle } from "@/lib/connector-labels";

/** Карточка на паузе: агент просит подключить сервис. */
export type PendingConnector = {
  interruptId: string | null;
  connector: ConnectorCardInfo;
};

/**
 * Карточка «Подключить <сервис>» над полем ввода — агент вызвал `connector`
 * для сервиса, которого у человека нет (или вход в него протух). Ход стоит в
 * interrupt; «Подключить» открывает то же окно, что в разделе «Коннекторы»,
 * и по факту подключения отвечает {connected: true}; «Не сейчас» — false.
 *
 * Компоновка как у карточки вопроса (question-card.tsx): шапка сворачивает,
 * Esc — отказ.
 */
export function ConnectorCard({
  pending,
  onAnswer,
  busy,
}: {
  pending: PendingConnector;
  onAnswer: (connected: boolean) => void;
  busy?: boolean;
}) {
  const t = useT();
  const c = t.connectors;
  const { locale } = useLocale();
  const { connector } = pending;
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !open) {
        e.preventDefault();
        onAnswer(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onAnswer, open]);

  const reauth = connector.reason === "reauth";

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background text-sm shadow-md">
      <div
        className="flex cursor-pointer items-center gap-2 p-3 hover:bg-muted/60"
        onClick={() => setCollapsed((v) => !v)}
      >
        {connector.logo ? (
          <ConnectorLogo src={connector.logo} className="size-4" />
        ) : (
          <Plug className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">
          {reauth
            ? c.cardReauth(connectorTitle(connector, locale))
            : c.cardTitle(connectorTitle(connector, locale))}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`}
        />
      </div>

      {!collapsed && (
        <>
          <div className="border-t border-border px-3 py-3">
            <p className="text-sm text-muted-foreground">{connectorSummary(connector, locale)}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">{reauth ? c.cardReauthHint : c.cardHint}</p>
          </div>
          <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => onAnswer(false)}
              className="inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              {c.notNow}
            </button>
            <div className="flex-1" />
            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Plug className="size-3.5" />
              {reauth ? c.reconnect : c.connect}
            </button>
          </div>
        </>
      )}

      {open && (
        <ConnectDialog
          open
          connector={connector}
          onClose={() => setOpen(false)}
          onConnected={() => {
            setOpen(false);
            onAnswer(true);
          }}
        />
      )}
    </div>
  );
}
