import * as React from "react"

/** Ответ проверки обновлений: версия стоит, версия на сервере, есть ли новее. */
export type UpdateCheck = {
  current: string
  latest?: string
  available?: boolean
  /** Сервер не ответил или ответил не тем — текст причины. */
  error?: string
  /** Почему: нет токена в .env, сервер токен не принял, сеть. */
  code?: "no_token" | "unauthorized" | "network"
}

/** Мост десктоп-оболочки (desktop/src/preload.js). Только то, что окно
 *  умеет и чего браузер не может: обновить установку. */
export type AvyDesktopBridge = {
  version: string
  platform: string
  updates: {
    current: () => Promise<string>
    check: () => Promise<UpdateCheck>
    /** Окно на время установки уходит в свои экраны; промис до страницы
     *  не доживает — страница выгружается вместе со старым стеком. */
    install: (version: string) => Promise<unknown>
  }
}

declare global {
  interface Window {
    avyDesktop?: AvyDesktopBridge
  }
}

/** Мост, если мы внутри приложения; в браузере — null. */
export function desktopBridge(): AvyDesktopBridge | null {
  if (typeof window === "undefined") return null
  return window.avyDesktop ?? null
}

// Мост появляется до первого рендера и не меняется — подписываться не на что.
const subscribeNever = () => () => {}

// Запущены ли мы внутри десктоп-оболочки (Electron). Мост preload.js выставляет
// window.avyDesktop только в приложении; в браузере он undefined.
//
// SSR-безопасно: серверный снимок — false (как браузер), клиентский читает
// window; useSyncExternalStore сам разводит гидрацию без setState в эффекте.
export function useIsDesktop() {
  return React.useSyncExternalStore(
    subscribeNever,
    () => desktopBridge() !== null,
    () => false,
  )
}
