"use client"

import * as React from "react"
import { FolderKanban, ListChecks, Files, SquarePen, Bot } from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { SidebarModes, MODES } from "@/components/sidebar-modes"
import { SidebarUser } from "@/components/sidebar-user"
import { SidebarSessions } from "@/components/sidebar-sessions"
import type { SessionsApi } from "@/hooks/use-threads"
import { useT } from "@/i18n/i18n-context"

export function AppSidebar({
  mode,
  sessions,
  onOpenFiles,
  onOpenTasks,
  onOpenTask,
  onOpenAgents,
  onOpenSpaces,
  onOpenSpace,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  mode?: string
  sessions: SessionsApi
  /** Открыть полноэкранный раздел «Файлы» (все сессии). */
  onOpenFiles?: () => void
  /** Открыть полноэкранный раздел «Регулярные задачи». */
  onOpenTasks?: () => void
  /** Открыть детальный экран конкретной задачи (строка задачи в списке сессий). */
  onOpenTask?: (taskId: string) => void
  /** Открыть полноэкранный раздел «Мои агенты». */
  onOpenAgents?: () => void
  /** Открыть полноэкранный раздел «Пространства». */
  onOpenSpaces?: () => void
  /** Открыть детальный экран конкретного пространства (↗ на папке в списке). */
  onOpenSpace?: (spaceId: string) => void
  /** Открыть диалог «Обратная связь» (пункт в меню пользователя внизу). */
  /** Обращений с непрочитанным ответом — бейдж в меню пользователя. */
}) {
  // Режим сайдбар только показывает (шапка) и по нему выбирает тело; менять
  // его отсюда нельзя — переключателя в шапке больше нет.
  const value = mode ?? MODES[0].id
  const { isMobile, setOpenMobile } = useSidebar()

  // На мобильном сайдбар — шторка поверх контента: после перехода она обязана
  // закрыться сама, иначе результат клика не виден. Ловим здесь, а не в каждом
  // обработчике: точек навигации много (новый чат, задачи, файлы, строки
  // сессий), и следующая добавленная кнопка про это забыла бы.
  //
  // Признак навигации — data-sidebar="menu-button". Вспомогательные контролы
  // строки сессии (удалить, ⋮-меню, переименование) им не помечены и шторку не
  // закрывают: они меняют список, а не уводят из него.
  const closeOnNavigate = (e: React.MouseEvent) => {
    if (!isMobile) return
    const el = e.target as HTMLElement | null
    if (el?.closest('[data-sidebar="menu-button"]')) setOpenMobile(false)
  }

  return (
    <Sidebar
      // Дефолтный variant="sidebar" (сплошная колонка во всю высоту), НЕ
      // floating: у карточки своя система отступов, из-за которой её сетка
      // не совпадала с хедером контента. Стеклянная отделка панели живёт в
      // globals.css («Стеклянный сайдбар»).
      // Уменьшаем весь текст сайдбара на ступень, переопределяя токен --text-sm
      // (Tailwind v4 берёт из него размер для text-sm) в скоупе сайдбара. Так не
      // нужно править text-sm в каждом дочернем компоненте, и логотип (text-base)
      // не затрагивается.
      style={{ "--text-sm": "0.8125rem" } as React.CSSProperties}
      {...props}
    >
      {/* h-14 = высота хедера рабочей области (56px), justify-center — чтобы
          блок режима стоял ровно по его середине. Без этого SidebarHeader
          давал свои p-2, и центр шапки сайдбара сидел на 26.75px против 28px
          у хедера: расхождение в пару пикселей, но по горизонтали оно видно. */}
      <SidebarHeader className="h-14 justify-center py-0">
        {/* Марка продукта — текстом, название режима («Avy Chat»; в локальной
            сборке он один). Ни логотипа, ни переключателя: см. SidebarModes. */}
        <SidebarModes value={value} />
      </SidebarHeader>
      {/* SidebarContent сам НЕ скроллится (overflow-hidden) — вертикальный
          контейнер. Скролл живёт только внутри списка сессий.
          onClick (фаза всплытия, не capture) — чтобы stopPropagation у кнопки
          удаления сессии не давал шторке закрыться. */}
      <SidebarContent className="overflow-hidden" onClick={closeOnNavigate}>
        {/* Системный блок сверху — статичный, вне скролла (shrink-0). */}
        <div className="shrink-0">
          <ModeBody
            mode={value}
            onNewChat={sessions.newSession}
            onOpenFiles={onOpenFiles}
            onOpenTasks={onOpenTasks}
            onOpenAgents={onOpenAgents}
            onOpenSpaces={onOpenSpaces}
          />
        </div>
        {/* Ниже — список сессий: единственная скролл-зона (flex-1 min-h-0). */}
        <SidebarSessions
          threads={sessions.threads}
          activeId={sessions.activeId}
          onSelect={sessions.select}
          onDelete={sessions.remove}
          onRename={sessions.rename}
          onTogglePin={sessions.togglePin}
          onOpenTask={onOpenTask}
          onOpenSpace={onOpenSpace}
        />
      </SidebarContent>
      <SidebarUser />
    </Sidebar>
  )
}

function ModeBody({
  mode,
  onNewChat,
  onOpenFiles,
  onOpenTasks,
  onOpenAgents,
  onOpenSpaces,
}: {
  mode: string
  onNewChat: () => void
  onOpenFiles?: () => void
  onOpenTasks?: () => void
  onOpenAgents?: () => void
  onOpenSpaces?: () => void
}) {
  void mode
  const t = useT()
  // Системные пункты. Высота h-7 и gap-0 у SidebarMenu — такой же компактный
  // ритм, как у строк сессий ниже. «Задачи» открывают раздел регулярных задач,
  // «Файлы» — полноэкранный раздел файлов всех сессий.
  const items = [
    { icon: FolderKanban, label: t.sidebar.projects, onClick: onOpenSpaces, soon: false },
    { icon: Bot, label: t.sidebar.agents, onClick: onOpenAgents, soon: false },
    { icon: ListChecks, label: t.sidebar.tasks, onClick: onOpenTasks, soon: false },
    { icon: Files, label: t.sidebar.files, onClick: onOpenFiles, soon: false },
  ]
  // pt-0: свои 8px сверху группа не добавляет — шапка (h-14, текст по центру)
  // и так оставляет под маркой пустоту, и с ещё одним отступом «Новый чат»
  // отваливался от неё (замечание владельца 26.09).
  return (
    <SidebarGroup className="pt-0">
      <SidebarMenu>
        {/* Главное действие — создать новый чат. Акцентная строка над пунктами. */}
        <SidebarMenuItem>
          <SidebarMenuButton onClick={onNewChat} className="h-7">
            <SquarePen className="size-4" />
            <span>{t.chat.newChat}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {items.map(({ icon: Icon, label, onClick, soon }) => (
          <SidebarMenuItem key={label}>
            <SidebarMenuButton
              className="h-7"
              onClick={onClick}
              disabled={soon}
              // Выключенный пункт остаётся видимым — он показывает, что раздел
              // будет; подпись объясняет, почему по нему нельзя кликнуть.
              title={soon ? t.sidebar.soon : undefined}
            >
              <Icon className="size-4" />
              <span>{label}</span>
              {soon && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {t.sidebar.soon}
                </span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
