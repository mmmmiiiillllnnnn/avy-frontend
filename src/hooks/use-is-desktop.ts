import * as React from "react"

// Запущены ли мы внутри десктоп-оболочки (Electron). Мост preload.js выставляет
// window.avyDesktop только в приложении; в браузере он undefined.
//
// SSR-безопасно: на сервере и первом клиентском рендере возвращает false (как
// браузер), затем эффект уточняет значение — гидрация не рассинхронизируется.
export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = React.useState(false)

  React.useEffect(() => {
    setIsDesktop(typeof window !== "undefined" && !!window.avyDesktop)
  }, [])

  return isDesktop
}
