/**
 * Что показывает блок DashScope в настройках — по состоянию с сервера.
 *
 * Вынесено из компонента, чтобы проверить тестом: три состояния (ключа нет /
 * ключ есть, выключено / включено) дают разные подписи и разные действия, и
 * перепутать их — значит показать «идём в DashScope» при работе через контур.
 */

import type { ModelSettings } from "@/lib/api";

export type DashscopeView = {
  /** Тумблер включён (ключ есть и выключатель включён). */
  on: boolean;
  /** Тумблер доступен (без ключа включать нечего). */
  toggleEnabled: boolean;
  /** Показывать кнопку «Удалить ключ». */
  canDelete: boolean;
  /** Какую строку состояния показывать. */
  status: "no_key" | "on" | "off";
  /** Хвост ключа для подписи («…a1b2»), пусто без ключа. */
  keyHint: string;
  /** Куда реально идут ходы по данным сервера. */
  provider: ModelSettings["provider"];
};

export function dashscopeView(s: ModelSettings | null): DashscopeView {
  const keySet = Boolean(s?.dashscope.key_set);
  const on = keySet && Boolean(s?.dashscope.enabled);
  return {
    on,
    toggleEnabled: keySet,
    canDelete: keySet,
    status: !keySet ? "no_key" : on ? "on" : "off",
    keyHint: keySet ? s?.dashscope.key_hint ?? "" : "",
    provider: s?.provider ?? "contour",
  };
}

/** Ключ из поля ввода годится к отправке: непустой и без пробелов внутри. */
export function isPlausibleKey(raw: string): boolean {
  const k = raw.trim();
  return k.length >= 8 && !/\s/.test(k);
}
