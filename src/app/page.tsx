"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { AuthGate } from "@/components/auth/auth-gate";
import { EntryPrompts } from "@/components/chat/entry-prompts";
import { MODES } from "@/components/sidebar-modes";
import { useThreads } from "@/hooks/use-threads";

export default function Home() {
  // Режим один (ассистент): переключателя в шапке сайдбара больше нет.
  const mode = MODES[0].id;

  // Список сессий поднят сюда (общий предок сайдбара и воркспейса), чтобы
  // сайдбар показывал сессии тем же стейтом, каким чат ими управляет.
  const sessions = useThreads("chat");

  const activeThreadId = sessions.activeId;
  const [openedFile, setOpenedFile] = useState<string | null>(null);
  // Полноэкранный раздел «Файлы» (все сессии): открывается из сайдбара, показывается
  // в области воркспейса. Общий стейт — оба компонента живут здесь.
  const [allFilesOpen, setAllFilesOpen] = useState(false);
  // Полноэкранный раздел «Регулярные задачи» (аналогично «Файлам»).
  const [tasksOpen, setTasksOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  // Deep-link в раздел задач: строка задачи в списке сессий сайдбара открывает
  // сразу её детальный экран, а не список. Одноразовый — раздел подтверждает
  // потребление через onOpenTaskConsumed.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  // Полноэкранный раздел «Пространства» (аналогично задачам) + deep-link на
  // конкретное пространство (стрелка ↗ на папке в сайдбаре).
  const [spacesOpen, setSpacesOpen] = useState(false);
  const [openSpaceId, setOpenSpaceId] = useState<string | null>(null);

  // Обёртка sessions для САЙДБАРА: выбор сессии дополнительно закрывает
  // полноэкранные разделы («Файлы», «Задачи», «Мои агенты»). Без этого клик по
  // УЖЕ активной сессии в сайдбаре не менял activeId, и раздел не закрывался
  // (эффект в chat-workspace завязан на смену activeId).
  const sidebarSessions = useMemo(
    () => ({
      ...sessions,
      select: (id: string) => {
        setAllFilesOpen(false);
        setTasksOpen(false);
        setAgentsOpen(false);
        setSpacesOpen(false);
        sessions.select(id);
      },
    }),
    [sessions],
  );

  const [searchText, setSearchText] = useState<string | undefined>(undefined);
  const [highlightLines, setHighlightLines] = useState<{ start: number; end?: number } | undefined>(undefined);

  const handleOpenFile = useCallback((path: string, text?: string, lines?: { start: number; end?: number }) => {
    setOpenedFile(path);
    setSearchText(text);
    setHighlightLines(lines);
  }, []);

  // Смена активной сессии: закрыть открытый файл.
  useEffect(() => {
    setOpenedFile(null);
  }, [activeThreadId]);

  return (
    <AuthGate>
      {/* Приветствие выданной роли и опрос по окончании периода. Внутри
          AuthGate: оба долга привязаны к пользователю, гостю показывать нечего. */}
      <EntryPrompts />
      <SidebarProvider
        style={{ "--sidebar-width": "19rem", height: "100%" } as React.CSSProperties}
      >
        <AppSidebar
          mode={mode}
          sessions={sidebarSessions}
          onOpenFiles={() => { setTasksOpen(false); setAgentsOpen(false); setSpacesOpen(false); setAllFilesOpen(true); }}
          onOpenTasks={() => { setAllFilesOpen(false); setAgentsOpen(false); setSpacesOpen(false); setTasksOpen(true); }}
          onOpenTask={(id) => { setAllFilesOpen(false); setAgentsOpen(false); setSpacesOpen(false); setOpenTaskId(id); setTasksOpen(true); }}
          onOpenAgents={() => { setAllFilesOpen(false); setTasksOpen(false); setSpacesOpen(false); setAgentsOpen(true); }}
          onOpenSpaces={() => { setAllFilesOpen(false); setTasksOpen(false); setAgentsOpen(false); setSpacesOpen(true); }}
          onOpenSpace={(id) => { setAllFilesOpen(false); setTasksOpen(false); setAgentsOpen(false); setOpenSpaceId(id); setSpacesOpen(true); }}
        />
        <SidebarInset className="h-svh min-h-0 overflow-hidden !bg-transparent shadow-none">
          <ChatWorkspace
            mode={mode}
            sessions={sessions}
            openedFile={openedFile}
            searchText={searchText}
            highlightLines={highlightLines}
            onCloseFile={() => { setOpenedFile(null); setSearchText(undefined); setHighlightLines(undefined); }}
            onOpenFile={handleOpenFile}
            allFilesOpen={allFilesOpen}
            onAllFilesChange={setAllFilesOpen}
            tasksOpen={tasksOpen}
            onTasksChange={setTasksOpen}
            openTaskId={openTaskId}
            onOpenTaskConsumed={() => setOpenTaskId(null)}
            spacesOpen={spacesOpen}
            onSpacesChange={setSpacesOpen}
            openSpaceId={openSpaceId}
            onOpenSpaceConsumed={() => setOpenSpaceId(null)}
            agentsOpen={agentsOpen}
            onAgentsChange={setAgentsOpen}
          />
        </SidebarInset>
      </SidebarProvider>
    </AuthGate>
  );
}
