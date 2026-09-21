"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { ChatWorkspace as CodeWorkspace } from "@/components/code/code-workspace";
import { AuthGate } from "@/components/auth/auth-gate";
import { EntryPrompts } from "@/components/chat/entry-prompts";
import { SupportDialog } from "@/components/chat/support-screen";
import { fetchUnreadTickets } from "@/lib/api";
import { MODES } from "@/components/sidebar-modes";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { useThreads } from "@/hooks/use-threads";
import type { FileTreeHandle } from "@/components/code/file-tree";

export default function Home() {
  const isDesktop = useIsDesktop();
  const [mode, setMode] = useState<string>(MODES[0].id);

  // Список сессий поднят сюда (общий предок сайдбара и воркспейса), чтобы
  // сайдбар показывал сессии тем же стейтом, каким чат ими управляет. mode
  // маппится в раздел тредов (chat / avy-code) — списки разные, не смешиваем.
  const threadMode = mode === "avy-code" ? "avy-code" : "chat";
  const sessions = useThreads(threadMode);

  // Воркспейс режима: у чата и кодера они РАЗНЫЕ (см. комментарий у рендера).
  // Пропсы совпадают, поэтому подменяем сам компонент, а не ветвим разметку.
  const Workspace = mode === "avy-code" ? CodeWorkspace : ChatWorkspace;

  // Страж режима: avy-code работает только в десктопе (через локальный avy-host).
  // Если в браузере режим как-то оказался avy-code (залипшее состояние, прямая
  // ссылка, старый клиент) — откатываем на дефолтный чат-режим.
  useEffect(() => {
    if (!isDesktop && mode === "avy-code") setMode(MODES[0].id);
  }, [isDesktop, mode]);

  const activeThreadId = sessions.activeId;
  const [codeRoots, setCodeRoots] = useState<string[]>([]);
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
  // Полноэкранный раздел «Обратная связь» (аналогично двум выше).
  const [supportOpen, setSupportOpen] = useState(false);
  // Обращений с непрочитанным ответом — бейдж в сайдбаре. Считается на сервере;
  // здесь только зеркалим и обновляем после действий в разделе.
  const [unreadSupport, setUnreadSupport] = useState(0);

  const refreshUnread = useCallback(() => {
    void fetchUnreadTickets().then(setUnreadSupport);
  }, []);

  useEffect(() => refreshUnread(), [refreshUnread]);

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

  const fileTreeRef = useRef<FileTreeHandle>(null);

  // Персистентная карта threadId → roots[] в localStorage.
  const LS_KEY = "avy_code_roots_v2";
  function loadRootsMap(): Record<string, string[]> {
    try {
      const v2 = JSON.parse(localStorage.getItem(LS_KEY) ?? "{}") as Record<string, string[]>;
      // Миграция со старого ключа (string → string[])
      const v1 = JSON.parse(localStorage.getItem("avy_code_roots") ?? "{}") as Record<string, string>;
      let migrated = false;
      for (const [tid, root] of Object.entries(v1)) {
        if (root && !v2[tid]) { v2[tid] = [root]; migrated = true; }
      }
      if (migrated) localStorage.setItem(LS_KEY, JSON.stringify(v2));
      return v2;
    } catch { return {}; }
  }
  function getRoots(id: string): string[] { return loadRootsMap()[id] ?? []; }
  function saveRoots(id: string, roots: string[]) {
    const map = loadRootsMap();
    if (roots.length) map[id] = roots; else delete map[id];
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  }

  // Смена активной сессии (в т.ч. из сайдбара): подтянуть её roots и закрыть
  // открытый файл. Раньше это делал колбэк onActiveIdChange от воркспейса; теперь
  // activeId — общий стейт (sessions), реагируем эффектом.
  useEffect(() => {
    setCodeRoots(activeThreadId ? getRoots(activeThreadId) : []);
    setOpenedFile(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  const handleCodeRootsChange = useCallback((roots: string[]) => {
    saveRoots(activeThreadId, roots);
    setCodeRoots(roots);
  }, [activeThreadId]);

  const handleFileSaved = useCallback((path: string) => {
    fileTreeRef.current?.refreshParent(path);
  }, []);

  return (
    <AuthGate>
      {/* Приветствие выданной роли и опрос по окончании периода. Внутри
          AuthGate: оба долга привязаны к пользователю, гостю показывать нечего. */}
      <EntryPrompts />
      {/* Обратная связь — диалог поверх интерфейса (как настройки), открывается
          из меню пользователя внизу сайдбара. */}
      <SupportDialog
        open={supportOpen}
        onClose={() => setSupportOpen(false)}
        onUnreadChange={refreshUnread}
      />
      <SidebarProvider
        style={{ "--sidebar-width": "19rem", height: "100%" } as React.CSSProperties}
      >
        <AppSidebar
          mode={mode}
          onModeChange={setMode}
          sessions={sidebarSessions}
          codeRoots={codeRoots}
          onCodeRootsChange={handleCodeRootsChange}
          codeThreadId={activeThreadId}
          onOpenFile={setOpenedFile}
          onOpenFiles={() => { setTasksOpen(false); setAgentsOpen(false); setSpacesOpen(false); setAllFilesOpen(true); }}
          onOpenTasks={() => { setAllFilesOpen(false); setAgentsOpen(false); setSpacesOpen(false); setTasksOpen(true); }}
          onOpenTask={(id) => { setAllFilesOpen(false); setAgentsOpen(false); setSpacesOpen(false); setOpenTaskId(id); setTasksOpen(true); }}
          onOpenAgents={() => { setAllFilesOpen(false); setTasksOpen(false); setSpacesOpen(false); setAgentsOpen(true); }}
          onOpenSpaces={() => { setAllFilesOpen(false); setTasksOpen(false); setAgentsOpen(false); setSpacesOpen(true); }}
          onOpenSpace={(id) => { setAllFilesOpen(false); setTasksOpen(false); setAgentsOpen(false); setOpenSpaceId(id); setSpacesOpen(true); }}
          onOpenSupport={() => setSupportOpen(true)}
          unreadSupport={unreadSupport}
          fileTreeRef={fileTreeRef}
        />
        <SidebarInset className="h-svh min-h-0 overflow-hidden !bg-transparent shadow-none">
          {/* Чат и кодер — РАЗНЫЕ компоненты (своя лента, свой стор, свой инпут).
              Общими остаются только сайдбар и хедер. Кодер обязан идти через
              CodeWorkspace: только его стор умеет исполнять ход локальным
              агентом (runCodeTurn); стор чата такого пути не знает и ушёл бы на
              серверную песочницу, которой у кодера больше нет. */}
          <Workspace
            mode={mode}
            sessions={sessions}
            openedFile={openedFile}
            searchText={searchText}
            highlightLines={highlightLines}
            onCloseFile={() => { setOpenedFile(null); setSearchText(undefined); setHighlightLines(undefined); }}
            onFileSaved={handleFileSaved}
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
