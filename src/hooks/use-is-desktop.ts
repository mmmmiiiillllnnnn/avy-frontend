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
/** Что сейчас лежит в папке сертификатов контура. */
export type CertStatus = {
  dir: string
  cert: boolean
  key: boolean
}

export type AvyDesktopBridge = {
  version: string
  platform: string
  /** Открыть https-ссылку в браузере по умолчанию (вход в коннекторы).
   *  В оболочках, собранных до коннекторов, метода нет. */
  openExternal?: (url: string) => Promise<{ ok: true } | { error: string }>
  certs: {
    status: () => Promise<CertStatus>
    pick: (kind: "cert" | "key") => Promise<{ ok: boolean; name?: string; error?: string }>
    clear: () => Promise<{ ok: boolean }>
    reveal: () => Promise<{ ok: boolean }>
  }
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
