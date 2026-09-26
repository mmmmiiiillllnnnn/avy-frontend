import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { AppReady } from "./app-ready";
import { InstallPrompt } from "@/components/install-prompt";

// Основной шрифт интерфейса.
const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin", "cyrillic"],
});

// Отдельная переменная для логотипа «Avy Chat» (см. components/brand.tsx): если
// сменить UI-шрифт (--font-sans), логотип останется на Geist через --font-brand.
const geistBrand = Geist({
  variable: "--font-brand",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Avy Chat",
  description: "AI ассистент",
  // iOS не читает манифест: standalone-режим и иконку он берёт из своих
  // мета-тегов. Без них «на экран Домой» даст ярлык, открывающий Safari с
  // адресной строкой, — то есть не приложение.
  appleWebApp: {
    capable: true,
    title: "Avy",
    // default, а НЕ black-translucent. Translucent уводит контент ПОД
    // статус-бар: вьюпорт начинается от нуля экрана, и хедер приложения
    // оказывается под часами. Компенсировать это можно только padding-ом на
    // env(safe-area-inset-top) по всему каркасу — вёрстка на такое не
    // рассчитана, и на iPhone заголовок обрезался. С default система сама
    // отводит место под статус-бар.
    statusBarStyle: "default",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
  other: {
    // Next отдаёт только современный mobile-web-app-capable. iOS до 17 знает
    // лишь apple-префикс, и без него «на экран Домой» открывает Safari с
    // адресной строкой. Дублируем — теги не конфликтуют.
    "apple-mobile-web-app-capable": "yes",
  },
};

// viewport-fit=cover: включает env(safe-area-inset-*) — без него на iPhone
// хедер лезет под «чёлку»/Dynamic Island.
//
// interactive-widget=resizes-content: просим браузер при появлении клавиатуры
// УМЕНЬШАТЬ вьюпорт (и layout, и 100dvh), а НЕ сдвигать окно скроллом. Тогда
// каркас на 100dvh сам ужимается под клавиатуру, документу нечего скроллить —
// нет нативного «улёта» окна вверх и нет скачка (как в ChatGPT/Telegram). JS с
// visualViewport для этого больше не нужен.
export const viewport: Viewport = {
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: next-themes проставляет класс темы на <html> до
    // гидрации (inline-скрипт), что создаёт серверно-клиентское расхождение
    // атрибута class — это ожидаемо и подавляется.
    <html
      lang="ru"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistBrand.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-screen flex flex-col overflow-hidden">
        {/* Заставка на время загрузки. Инлайном в разметке, а не React-
            компонентом: она обязана быть на экране ДО гидрации — иначе в
            standalone-режиме PWA человек несколько секунд смотрит в пустой
            экран. Снимается классом на <html> из app-ready.tsx, когда
            приложение смонтировалось. */}
        <div id="app-splash" aria-hidden>
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            {/* Цвета = components/ui/logo.tsx («графит»: в тёмной светлый
                квадрат с тёмным знаком, в светлой — наоборот). Инлайн — тёмный
                вариант (SSR-база тёмная); светлый подменяет globals.css той же
                media, что и фон заставки: класса темы до гидрации ещё нет. */}
            <rect width="24" height="24" rx="6.24" ry="6.24" fill="#e4e4e4" />
            <path
              d="M12 15.5l-5-5h10z"
              fill="#121212"
              stroke="#121212"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <AppReady />
        <div className="flex-1 min-h-0 isolate">
          {/* InstallPrompt внутри Providers — ему нужен словарь (useT). */}
          <Providers>
            {children}
            <InstallPrompt />
          </Providers>
        </div>
      </body>
    </html>
  );
}
