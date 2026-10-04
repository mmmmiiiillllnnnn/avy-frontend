"use client";

import * as React from "react";
import { Check } from "lucide-react";

import type { PickerItem } from "@/components/ui/library-picker-modal";
import { useLocale, useT } from "@/i18n/i18n-context";
import { connectorSummary, fetchConnectors, type ConnectorInfo } from "@/lib/api";
import { connectorTitle } from "@/lib/connector-labels";

/** Коннекторы как карточки для окна выбора (агент, задача, пространство).
 *
 *  Универсальный ассистент видит все подключённые сервисы сам; все остальные
 *  объявляют их явно, и «ничего не выбрано» значит «не видит ни одного» — не
 *  «как у ассистента». Неподключённые выбирать можно: агент попросит
 *  подключить, когда дойдёт до дела (карточка в ленте). Чип состояния
 *  показывает, придётся ли этого ждать.
 *
 *  null — каталог ещё грузится. Грузим один раз на форму: он меняется только
 *  из раздела «Коннекторы», а туда из формы не уйти, не закрыв её.
 */
export function useConnectorItems(list?: ConnectorInfo[] | null): PickerItem[] | null {
  const own = useConnectorList(list === undefined);
  return useConnectorPickerItems(list === undefined ? own : list);
}

/** Полные записи коннекторов (с состоянием, названиями инструментов и
 *  настройками) — форме, которой нужно окно настроек коннектора.
 *  enabled=false — не грузить (список уже есть у вызывающего). */
export function useConnectorList(enabled = true): ConnectorInfo[] | null {
  const [list, setList] = React.useState<ConnectorInfo[] | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchConnectors().then((items) => alive && setList(items));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return list;
}

function useConnectorPickerItems(list: ConnectorInfo[] | null): PickerItem[] | null {
  const t = useT();
  const c = t.connectors;
  const { locale } = useLocale();

  return React.useMemo(
    () =>
      list?.map((it) => ({
        id: it.id,
        name: connectorTitle(it, locale),
        // У своего сервера описания нет — показываем адрес: по нему сервер и
        // узнают.
        description: it.custom ? it.url || c.noSummary : connectorSummary(it, locale),
        logo: it.logo,
        badge: it.connected ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] leading-none text-emerald-700 dark:text-emerald-400">
            <Check className="size-3" />
            {c.connected}
          </span>
        ) : (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
            {c.notConnected}
          </span>
        ),
      })) ?? null,
    [list, locale, c.noSummary, c.connected, c.notConnected],
  );
}
