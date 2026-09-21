"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EffortLevel } from "@/components/code/code-chat-input-base";
import type { PermissionMode, ModelId } from "@/components/code/chat-code-input";
import { Files, SlidersHorizontal, SquarePen, Terminal } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Chat } from "@/components/code/code-chat-view";
import { ChatCode } from "@/components/code/chat-code";
import { AgentConfigDialog } from "@/components/code/agent-config-dialog";
import { SessionTitleMenu } from "@/components/chat/session-title-menu";
import { HeaderAction } from "@/components/chat/header-action";
import { HeaderBrand } from "@/components/chat/header-brand";
import { BotIcon } from "@/components/chat/bot-icon";
import { FilesPanel } from "@/components/chat/files-panel";
import { BackgroundTasksPanel } from "@/components/code/background-tasks-panel";
import { SubagentsPanel, collectSubagents } from "@/components/chat/subagents-panel";
import {
  AllFilesScreen,
  FilePreviewPanel,
  type PreviewTarget,
} from "@/components/chat/all-files-screen";
import {
  FileChipProvider,
  sizeIndex,
  type FileChipApi,
} from "@/components/chat/file-chip-context";
import { FileEditor } from "@/components/code/file-editor";
import type { SessionsApi } from "@/hooks/use-threads";
import { useChat } from "@/hooks/use-code-chat";
import { useFiles } from "@/hooks/use-files";
import { useContextUsage } from "@/hooks/use-context-usage";
import { useUsage } from "@/hooks/use-usage";
import { fetchThreadMessages, sessionFileRawUrl } from "@/lib/api";
import { fetchCodeHistory } from "@/lib/code/code-api";
import { chatStreams, type ChatMessage } from "@/lib/code/code-chat-streams";
import { useT } from "@/i18n/i18n-context";

export function ChatWorkspace({
  mode,
  sessions,
  openedFile,
  searchText,
  highlightLines,
  onCloseFile,
  onFileSaved,
  onOpenFile,
  allFilesOpen: allFilesOpenProp,
  onAllFilesChange,
}: {
  mode: string;
  sessions: SessionsApi;
  openedFile?: string | null;
  searchText?: string;
  highlightLines?: { start: number; end?: number };
  onCloseFile?: () => void;
  onFileSaved?: (path: string) => void;
  onOpenFile?: (path: string, searchText?: string, highlightLines?: { start: number; end?: number }) => void;
  allFilesOpen?: boolean;
  onAllFilesChange?: (open: boolean) => void;
}) {
  const { activeId, loaded } = sessions;
  const t = useT();

  const [filesOpen, setFilesOpen] = useState(false);
  const [bgTasksOpen, setBgTasksOpen] = useState(false);
  // Правая панель со списком субагентов сессии (открывается кнопкой в хедере).
  const [subagentsOpen, setSubagentsOpen] = useState(false);
  // Полноэкранный раздел «Файлы» (все сессии) — замещает область чата+хедер.
  // Состояние поднято в page.tsx (открывается из сайдбара), приходит пропсами.
  const allFilesOpen = allFilesOpenProp ?? false;
  const setAllFilesOpen = (v: boolean) => onAllFilesChange?.(v);
  // Файл, открытый в правой панели предпросмотра раздела «Файлы». Живёт здесь
  // (а не внутри AllFilesScreen), чтобы панель была соседом колонки хедер+тело
  // и сдвигала их, как панель файлов сессии.
  const [allFilesPreview, setAllFilesPreview] = useState<PreviewTarget | null>(null);
  // Запрос «открыть файл X в панели» от плашки файла в сообщении. nonce — чтобы
  // повторный клик по тому же файлу переоткрывал предпросмотр.
  // Запрос «открыть файл X в панели» от плашки в сообщении. Тегируем сессией
  // (threadId): панель получает запрос ТОЛЬКО если он от текущей сессии — иначе
  // новый инстанс панели (пересоздаётся по key при смене сессии) восстановил бы
  // на маунте предпросмотр файла ПРОШЛОЙ сессии («предпросмотр недоступен»).
  const [fileOpenRequest, setFileOpenRequest] = useState<{
    threadId: string;
    path: string;
    nonce: number;
  } | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [effort, setEffort] = useState<EffortLevel>("medium");
  const [deepSearch, setDeepSearch] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("ask");
  // Дефолт Avy Code — Enso Code (kimi-k2.7-code), модель под кодинг. Должен
  // совпадать с DEFAULT_MODEL_ID в apps/code-cli/src/agent/model.ts.
  const [model, setModel] = useState<ModelId>("kimi-k2.7-code");
  const isCode = mode === "avy-code";
  const agentMode = isCode ? "avy-code" : deepSearch ? "deep-research" : undefined;
  // Панель показывает единый список файлов сессии (результаты агента + загрузки);
  // рабочая директория агента (/work) больше не отображается.
  const files = useFiles(activeId, filesOpen, "outputs");

  // При переключении сессии закрываем панель файлов И полноэкранный раздел
  // «Файлы»: любой переход в чат (выбор сессии, новый чат) меняет activeId и
  // должен вернуть из раздела в чат. ref не даёт закрывать зря на первом рендере.
  const prevActiveIdRef = useRef(activeId);
  useEffect(() => {
    if (prevActiveIdRef.current !== activeId) {
      prevActiveIdRef.current = activeId;
      setFilesOpen(false);
      setSubagentsOpen(false);
      // Панель «Фоновые задачи» (Avy Code) — тоже про конкретную сессию:
      // список bgTasks приходит из chat текущей треды, при переходе закрываем.
      setBgTasksOpen(false);
      setAllFilesOpen(false);
      setAllFilesPreview(null);
      // Сброс императивного запроса «открыть файл X»: иначе новый инстанс
      // FilesPanel (пересоздаётся по key при смене сессии) на маунте увидит
      // стухший nonce прошлой сессии и восстановит предпросмотр её файла —
      // которого в новой сессии нет («предпросмотр недоступен»).
      setFileOpenRequest(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Закрыт раздел «Файлы» → закрываем и его панель предпросмотра.
  useEffect(() => {
    if (!allFilesOpen) setAllFilesPreview(null);
  }, [allFilesOpen]);
  // reloadHistory объявлен ниже (нужен для открытия сессии) — держим ref, чтобы
  // не завязываться на порядок объявления.
  const reloadHistoryRef = useRef<() => void>(() => {});
  // Вставка блока «Контекст сжат» при РУЧНОМ сжатии — добавляем один summary в
  // КОНЕЦ текущей ленты (chat.messages + setHistory), НЕ перезагружая с сервера
  // (та конкурировала с live-вставкой и дублировала историю треды). Через ref,
  // т.к. chat объявлен ниже. Авто-сжатие сюда не идёт — там блок вставляет стрим.
  const appendSummaryRef = useRef<(s: { text: string; tokens: number | null }) => void>(() => {});
  const context = useContextUsage(activeId, mode, (s) => appendSummaryRef.current(s));
  const { usage, refresh: refreshUsage } = useUsage();

  // API для плашек файлов в сообщениях (FileChip). openInPanel открывает панель и
  // просит показать конкретный файл; rawUrl — прямая ссылка (скачивание);
  // sizeFor — размер из уже загруженного списка сессии (в markdown-ссылке его нет).
  const fileOpenNonceRef = useRef(0);
  const fileSizes = useMemo(() => sizeIndex(files.files), [files.files]);
  const fileChipApi = useMemo<FileChipApi>(
    () => ({
      openInPanel: (path) => {
        setFilesOpen(true);
        fileOpenNonceRef.current += 1;
        setFileOpenRequest({ threadId: activeId, path, nonce: fileOpenNonceRef.current });
      },
      rawUrl: (path) => sessionFileRawUrl(activeId, path),
      sizeFor: (path) => fileSizes.get(path),
    }),
    [activeId, fileSizes],
  );

  const chat = useChat({
    threadId: activeId,
    modelId: model,
    effort,
    mode: agentMode,
    permissionMode: isCode ? permissionMode : undefined,
    onTitle: (title) => {
      sessions.setTitleLocal(activeId, title);
      sessions.ensureListed(activeId);
    },
    onDone: (threadId) => {
      sessions.ensureListed(threadId);
      sessions.refreshTitle(threadId);
      if (filesOpen) files.refresh();
      void context.refresh();
    },
  });

  // Перезагрузить ленту из истории (ТОЛЬКО открытие сессии). Не трогает идущий
  // стрим (setHistory сам это проверяет). Больше не используется для сжатия —
  // блок «Контекст сжат» вставляется в ленту точечно, без перезагрузки.
  const reloadHistory = useCallback(async () => {
    if (!activeId) return;
    // avy-code: лента реконструируется ЛОКАЛЬНО из чекпоинта через IPC-мост
    // (fetchCodeHistory), сервер code_history снесён. Обычный чат — как раньше.
    const history = isCode
      ? await fetchCodeHistory(activeId)
      : await fetchThreadMessages(activeId);
    chat.setHistory(history);
  }, [activeId, chat, isCode]);
  useEffect(() => {
    reloadHistoryRef.current = () => void reloadHistory();
  }, [reloadHistory]);

  // Ручное сжатие: добавить блок «Контекст сжат» В КОНЕЦ текущей ленты (один
  // summary), не перезагружая с сервера. Тот же визуальный результат, что
  // авто-сжатие через стрим, но источник — результат compactCodeAgent.
  useEffect(() => {
    appendSummaryRef.current = ({ text, tokens }) => {
      const summaryMsg: ChatMessage = {
        id: `summary-${Date.now()}`,
        role: "summary",
        content: text,
        tokens,
      };
      chat.setHistory([...chat.messages, summaryMsg]);
    };
  }, [chat]);

  const lastLoaded = useRef<string>("");
  useEffect(() => {
    if (!loaded || !activeId || lastLoaded.current === activeId) return;
    lastLoaded.current = activeId;
    if (chatStreams.hasMessages(activeId)) return;
    const known = sessions.threads.some(
      (t) => t.id === activeId && t.created_at !== "",
    );
    if (!known) {
      chat.reset();
      return;
    }
    (async () => {
      const history = isCode
        ? await fetchCodeHistory(activeId)
        : await fetchThreadMessages(activeId);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          chat.setHistory(history);
        });
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, loaded]);

  const handleNew = useCallback(() => {
    sessions.newSession();
  }, [sessions]);

  // Субагенты сессии (шаги вызова task) — для кнопки в хедере и панели-списка.
  // Кнопка видна только если субагенты есть; шиммерит, пока хоть один работает.
  const subagents = useMemo(
    () => collectSubagents(chat.messages, chat.isStreaming),
    [chat.messages, chat.isStreaming],
  );
  const anySubagentRunning = useMemo(
    () => subagents.some((s) => s.running),
    [subagents],
  );

  // Панель субагентов и файловая панель взаимоисключающие: открытие одной
  // закрывает другую (обе — правые соседи колонки чата, вместе не помещаются).
  const toggleFiles = useCallback(() => {
    setFilesOpen((prev) => {
      const next = !prev;
      if (next) setSubagentsOpen(false);
      return next;
    });
  }, []);
  const toggleSubagents = useCallback(() => {
    setSubagentsOpen((prev) => {
      const next = !prev;
      if (next) setFilesOpen(false);
      return next;
    });
  }, []);

  const runningBgCount = chat.bgTasks.filter((t) => t.status === "running").length;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 overflow-hidden px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-auto"
          />
          {allFilesOpen ? (
            /* Раздел «Файлы»: заголовок раздела. Возврат к чату — клик по сессии. */
            <span className="text-base font-semibold">{t.sidebar.files}</span>
          ) : (
            <>
              {/* В хедере — название ТЕКУЩЕЙ сессии + меню действий над ней
                  (переименовать/удалить). Список всех сессий переехал в сайдбар. */}
              <SessionTitleMenu
                title={sessions.activeThread?.title || ""}
                hasSession={!!sessions.activeThread}
                onRename={(nextTitle) => {
                  if (sessions.activeThread) sessions.rename(activeId, nextTitle);
                }}
                onDelete={() => {
                  if (sessions.activeThread) sessions.remove(activeId);
                }}
              />
              {/* «Новый чат» — только в Avy Code: в режиме ассистента кнопка есть
                  в сайдбаре, в avy-code сайдбар занят проводником. */}
              {isCode && (
                <HeaderAction icon={SquarePen} label="Новый чат" onClick={handleNew} />
              )}
              {/* «Конфигурация агента» — только в Avy Code. */}
              {isCode && (
                <HeaderAction
                  icon={SlidersHorizontal}
                  label="Конфигурация агента"
                  onClick={() => setConfigOpen(true)}
                  disabled={!activeId}
                  active={configOpen}
                />
              )}
              {/* «Файлы сессии» — только в чат-режиме. */}
              {!isCode && (
                <HeaderAction
                  icon={Files}
                  label="Файлы сессии"
                  onClick={toggleFiles}
                  disabled={!activeId}
                  active={filesOpen}
                />
              )}
              {/* «Субагенты» — только в чат-режиме и только если они есть.
                  Иконка шиммерит оранжевым, пока хоть один субагент работает. */}
              {!isCode && subagents.length > 0 && (
                <HeaderAction
                  icon={BotIcon}
                  label={t.chat.subagents}
                  onClick={toggleSubagents}
                  active={subagentsOpen}
                  shimmer={anySubagentRunning}
                />
              )}
            </>
          )}
          {/* «Фоновые задачи» — только Avy Code: bash run_in_background. Бейдж —
              число ещё бегущих процессов, панель открыта/закрыта независимо от
              их наличия (не схлопывается сама, когда список опустел). */}
          {isCode && (
            <div className="relative">
              <HeaderAction
                icon={Terminal}
                label="Фоновые задачи"
                onClick={() => setBgTasksOpen((v) => !v)}
                disabled={!activeId}
                active={bgTasksOpen}
              />
              {runningBgCount > 0 && (
                <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-medium text-primary-foreground">
                  {runningBgCount}
                </span>
              )}
            </div>
          )}
          <div className="ml-auto pr-1">
            <HeaderBrand />
          </div>
        </header>
        {allFilesOpen ? (
          <AllFilesScreen
            onOpenSession={(id) => {
              // Явно закрываем раздел, а не полагаемся на смену activeId: клик по
              // УЖЕ активной сессии не меняет activeId. Превью сбросит эффект на
              // !allFilesOpen (см. выше) — здесь не дублируем.
              setAllFilesOpen(false);
              sessions.select(id);
            }}
            onOpenPreview={(threadId, file) => setAllFilesPreview({ threadId, file })}
            preview={allFilesPreview}
          />
        ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {isCode ? (
            <ChatCode
              messages={chat.messages}
              isStreaming={chat.isStreaming}
              error={chat.error}
              onSend={chat.send}
              onStop={chat.stop}
              contextUsage={context.usage}
              compacting={context.compacting}
              onCompact={context.compact}
              onCancelCompact={context.cancelCompact}
              threadId={activeId}
              effort={effort}
              onEffortChange={setEffort}
              permissionMode={permissionMode}
              onPermissionModeChange={setPermissionMode}
              model={model}
              onModelChange={setModel}
              pendingPermission={chat.pendingPermission}
              onPermissionDecision={chat.resolvePermission}
              permissionBusy={chat.isStreaming}
              pendingQueueSize={chat.pendingQueueSize}
              pendingQuestions={chat.pendingQuestions}
              onQuestionsSubmit={chat.resolveQuestions}
              onQuestionsDismiss={chat.dismissQuestions}
              questionsBusy={chat.isStreaming}
              onOpenFile={onOpenFile}
              // Память открывается тем же вьюером: путь просто уходит в
              // openedFile, а file-editor узнаёт его по каталогу памяти и
              // читает своим каналом (readMemoryFile) — см. isMemoryPath.
              onOpenMemory={onOpenFile ? (p) => onOpenFile(p) : undefined}
              onLoadMore={chat.loadMore}
              hasMore={chat.hasMore}
            />
          ) : (
            <FileChipProvider value={fileChipApi}>
              <Chat
                messages={chat.messages}
                isStreaming={chat.isStreaming}
                error={chat.error}
                onSend={chat.send}
                onRetry={chat.retry}
                onEdit={chat.edit}
                onStop={chat.stop}
                contextUsage={context.usage}
                compacting={context.compacting}
                onCompact={context.compact}
                threadId={activeId}
                effort={effort}
                onEffortChange={setEffort}
                deepSearch={deepSearch}
                onDeepSearchChange={setDeepSearch}
                limitExhausted={usage?.exhausted ?? false}
                limitResetAt={usage?.reset_at ?? null}
              />
            </FileChipProvider>
          )}
          {isCode && openedFile && (
            <FileEditor
              path={openedFile}
              threadId={activeId}
              searchText={searchText}
              highlightLines={highlightLines}
              onClose={() => onCloseFile?.()}
              onSave={onFileSaved}
            />
          )}
        </div>
        )}
      </div>
      {/* Окно «Конфигурация агента» (только Avy Code): обзор + подключение MCP. */}
      {isCode && (
        <AgentConfigDialog
          open={configOpen}
          onClose={() => setConfigOpen(false)}
          threadId={activeId}
        />
      )}
      {/* Панель «Файлы сессии» — только чат-режим (см. кнопку выше).
          key={activeId}: при смене сессии React ПЕРЕСОЗДАЁт панель, сбрасывая её
          внутреннее состояние (выбранный файл, зум, скролл). Без этого панель
          на кадр рисовала бы предпросмотр файла прошлой сессии с уже новым
          threadId → 404 в PdfViewer. Идиома «другая сущность → новый key». */}
      {!isCode && (
        <FilesPanel
          key={activeId}
          open={filesOpen}
          threadId={activeId}
          files={files.files}
          loading={files.loading}
          onRefresh={files.refresh}
          openRequest={
            fileOpenRequest?.threadId === activeId ? fileOpenRequest : undefined
          }
          onClose={() => setFilesOpen(false)}
        />
      )}
      {/* Панель «Фоновые задачи» — только Avy Code (см. кнопку выше). Живёт в
          потоке layout рядом с лентой, а не плавающей плашкой над инпутом —
          можно закрыть насовсем и не занимает место, пока не открыта. */}
      {isCode && (
        <BackgroundTasksPanel
          open={bgTasksOpen}
          threadId={activeId}
          tasks={chat.bgTasks}
          onKill={chat.killBackground}
          onRemove={chat.removeBackground}
          onRestart={chat.restartBackground}
          onClose={() => setBgTasksOpen(false)}
        />
      )}
      {/* Панель субагентов — сосед колонки (сдвигает чат влево), как FilesPanel.
          Открыта только в чат-режиме по кнопке; взаимоисключается с файлами. */}
      {!isCode && subagentsOpen && (
        <SubagentsPanel
          entries={subagents}
          threadId={activeId}
          onClose={() => setSubagentsOpen(false)}
        />
      )}
      {/* Панель предпросмотра раздела «Файлы» — сосед колонки хедер+тело (как
          FilesPanel), поэтому раздвигает их влево, а не наезжает поверх. */}
      <FilePreviewPanel
        target={allFilesPreview}
        onClose={() => setAllFilesPreview(null)}
      />
    </div>
  );
}
