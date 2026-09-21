"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EffortLevel, ChatModelId } from "@/components/ui/ai-chat-input";
import type { PermissionMode, ModelId } from "@/components/code/chat-code-input";
import { Files, SlidersHorizontal, SquarePen, ListChecks, ArrowLeft } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Chat } from "@/components/chat/chat";
import { ChatCode } from "@/components/code/chat-code";
import { AgentConfigDialog } from "@/components/code/agent-config-dialog";
import { SessionTitleMenu } from "@/components/chat/session-title-menu";
import { HeaderAction } from "@/components/chat/header-action";
import { HeaderBrand } from "@/components/chat/header-brand";
import { BotIcon } from "@/components/chat/bot-icon";
import { FilesPanel } from "@/components/chat/files-panel";
import { SubagentsPanel, collectSubagents } from "@/components/chat/subagents-panel";
import { SessionSettingsPanel } from "@/components/chat/session-settings-panel";
import {
  AllFilesScreen,
  FilePreviewPanel,
  type PreviewTarget,
} from "@/components/chat/all-files-screen";
import { RecurringTasksScreen } from "@/components/recurring/recurring-tasks-screen";
import { AgentsScreen } from "@/components/agents/agents-screen";
import { SpacesScreen } from "@/components/spaces/spaces-screen";
import {
  FileChipProvider,
  sizeIndex,
  type FileChipApi,
} from "@/components/chat/file-chip-context";
import { FileEditor } from "@/components/code/file-editor";
import type { SessionsApi } from "@/hooks/use-threads";
import { useChat } from "@/hooks/use-chat";
import { useFiles } from "@/hooks/use-files";
import { useContextUsage } from "@/hooks/use-context-usage";
import { useUsage } from "@/hooks/use-usage";
import { createSpaceThread, fetchThreadMessages, sessionFileRawUrl } from "@/lib/api";
import { chatStreams } from "@/lib/chat-streams";
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
  tasksOpen: tasksOpenProp,
  agentsOpen: agentsOpenProp,
  onTasksChange,
  onAgentsChange,
  openTaskId,
  onOpenTaskConsumed,
  spacesOpen: spacesOpenProp,
  onSpacesChange,
  openSpaceId,
  onOpenSpaceConsumed,
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
  /** Полноэкранный раздел «Регулярные задачи» (открывается из сайдбара). */
  tasksOpen?: boolean;
  agentsOpen?: boolean;
  onTasksChange?: (open: boolean) => void;
  onAgentsChange?: (open: boolean) => void;
  /** Deep-link из сайдбара: открыть раздел задач сразу на этой задаче. */
  openTaskId?: string | null;
  onOpenTaskConsumed?: () => void;
  /** Полноэкранный раздел «Пространства» + deep-link на конкретное. */
  spacesOpen?: boolean;
  onSpacesChange?: (open: boolean) => void;
  openSpaceId?: string | null;
  onOpenSpaceConsumed?: () => void;
}) {
  const { activeId, loaded } = sessions;
  const t = useT();

  // Активна ли сейчас сессия-прогон регулярной задачи (thread `<task>:run-<id>`).
  // Если да — в хедере показываем «← К задаче» для возврата в раздел задач, на
  // экран той самой задачи (её id — префикс до ":run-").
  const activeRunTaskId = activeId.includes(":run-")
    ? activeId.slice(0, activeId.indexOf(":run-"))
    : null;
  // Какую задачу открыть при возврате в раздел (deep-link на её детальный экран).
  const [returnToTaskId, setReturnToTaskId] = useState<string | null>(null);
  // Обработчик «назад» внутри раздела задач (деталь/форма → список). Раздел
  // задач сообщает его через onBackChange; хедер рисует иконку ←. null — список.
  const [tasksBack, setTasksBack] = useState<(() => void) | null>(null);
  // То же для раздела «Мои агенты»: форма → список.
  const [agentsBack, setAgentsBack] = useState<(() => void) | null>(null);
  // И для «Пространств»: деталь → список.
  const [spacesBack, setSpacesBack] = useState<(() => void) | null>(null);

  const [filesOpen, setFilesOpen] = useState(false);
  // Правая панель со списком субагентов сессии (открывается кнопкой в хедере).
  const [subagentsOpen, setSubagentsOpen] = useState(false);
  // Полноэкранный раздел «Файлы» (все сессии) — замещает область чата+хедер.
  // Состояние поднято в page.tsx (открывается из сайдбара), приходит пропсами.
  const allFilesOpen = allFilesOpenProp ?? false;
  const setAllFilesOpen = (v: boolean) => onAllFilesChange?.(v);
  // Полноэкранный раздел «Регулярные задачи» — состояние поднято в page.tsx.
  const tasksOpen = tasksOpenProp ?? false;
  const agentsOpen = agentsOpenProp ?? false;
  const spacesOpen = spacesOpenProp ?? false;
  const setTasksOpen = (v: boolean) => onTasksChange?.(v);
  const setAgentsOpen = (v: boolean) => onAgentsChange?.(v);
  const setSpacesOpen = (v: boolean) => onSpacesChange?.(v);
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
  const [sessionSettingsOpen, setSessionSettingsOpen] = useState(false);
  const [effort, setEffort] = useState<EffortLevel>("medium");
  // Выбранный агент из библиотеки. null = универсальный чат. При СМЕНЕ СЕССИИ
  // сбрасывается в null (эффект по activeId ниже): выбор «Режима» принадлежит
  // чату, в котором его сделали, — в соседнем чате снова дефолт. Раньше жил на
  // уровне рабочей области и переезжал между тредами — переиграно.
  const [agentId, setAgentId] = useState<string | null>(null);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("ask");
  const [model, setModel] = useState<ModelId>("qwen3.7-plus");
  // Модель ОБЫЧНОГО чата — отдельным стейтом от кодерской выше, а не общим.
  // Наборы не совпадают: у кодера есть kimi-k3, kimi-k2.7-code и
  // qwen3.5-397b, которых нет у чата. С одним стейтом переключение раздела
  // оставляло бы выбранной модель, которой в этом разделе не существует.
  const [chatModel, setChatModel] = useState<ChatModelId>("qwen3.7-plus");
  const isCode = mode === "avy-code";
  // Режим больше НЕ выводится из кнопки «Глубокое исследование» — она убрана.
  // Исследователь стал агентом библиотеки, и его deep-research приходит из
  // config агента на бэкенде. Здесь остаётся только кодер: у него свой контур.
  const agentMode = isCode ? "avy-code" : undefined;
  // Панель показывает единый список файлов сессии (результаты агента + загрузки);
  // рабочая директория агента (/work) больше не отображается.
  const files = useFiles(activeId, filesOpen, "outputs");

  // При переключении сессии закрываем панель файлов И полноэкранный раздел
  // «Файлы»: любой переход в чат (выбор сессии, новый чат) меняет activeId и
  // должен вернуть из раздела в чат. ref не даёт закрывать зря на первом рендере.
  const prevActiveIdRef = useRef(activeId);
  // Пространство АКТИВНОГО чата — для ensureListed: свежесозданный чат
  // пространства ещё не в списке, и без project_id сайдбар положил бы его в
  // общий поток вместо папки (до перезагрузки страницы). ref, а не state:
  // значение читают колбэки стрима, которым нужна свежая величина.
  const activeSpaceIdRef = useRef<string | null>(null);
  // Одноразовая метка «пространство выставлено явно» (onOpenThread из раздела
  // пространства выставляет реф ДО select). Только она разрешает неизвестному
  // треду унаследовать реф: без метки «Новый чат» после чата пространства
  // сохранял бы его space id, и обычная сессия падала бы в чужую папку.
  const spaceIdPinnedRef = useRef(false);
  // То же пространство — СТЕЙТОМ для капсулы «Режима»: пользователь должен
  // видеть, где работает. ref остаётся для колбэков стрима (им нужна свежая
  // величина без ререндера).
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  // Пространство, выбранное в «Режиме», но ещё НЕ привязанное: сессии не
  // существует, пока нет первого хода, — привязываем тред при отправке
  // (см. sendBindingSpace), а не в момент выбора. Выбор — только капсула.
  const pendingSpaceBindRef = useRef<string | null>(null);
  // Агент для НОВОГО чата, выбранный в дропдауне «Новый чат» пространства:
  // эффект смены activeId сбрасывает «Режим» в null, а этот реф говорит ему
  // один раз поставить выбранного агента вместо сброса.
  const pendingAgentIdRef = useRef<{ threadId: string; agentId: string } | null>(
    null,
  );
  useEffect(() => {
    if (prevActiveIdRef.current !== activeId) {
      prevActiveIdRef.current = activeId;
      // Известный тред — берём его пространство; неизвестный (только что
      // созданный) — пространство раздела, если тред открыт оттуда, иначе
      // это новый чат вне пространств.
      const known = sessions.threads.find((tr) => tr.id === activeId);
      if (known) activeSpaceIdRef.current = known.project_id ?? null;
      else if (!spaceIdPinnedRef.current) activeSpaceIdRef.current = null;
      // Метку читаем ДО сброса: она же защищает отложенную привязку. Чат,
      // открытый из раздела «Пространства», ставит и её, и pendingSpaceBind —
      // без этой проверки эффект смены activeId стирал бы привязку раньше,
      // чем человек успел отправить первый ход, и чат уходил бы личным.
      const openedFromSpace = spaceIdPinnedRef.current;
      spaceIdPinnedRef.current = false;
      setActiveSpaceId(activeSpaceIdRef.current);
      if (!openedFromSpace) pendingSpaceBindRef.current = null;
      setFilesOpen(false);
      setSubagentsOpen(false);
      setAllFilesOpen(false);
      setTasksOpen(false);
      setAgentsOpen(false);
      setSpacesOpen(false);
      setAllFilesPreview(null);
      // Сброс императивного запроса «открыть файл X»: иначе новый инстанс
      // FilesPanel (пересоздаётся по key при смене сессии) на маунте увидит
      // стухший nonce прошлой сессии и восстановит предпросмотр её файла —
      // которого в новой сессии нет («предпросмотр недоступен»).
      setFileOpenRequest(null);
      // Выбор «Режима» принадлежит чату, где его сделали, — в другом чате
      // снова универсальный агент. Исключение: чат открыт из дропдауна
      // «Новый чат» пространства с выбранным агентом — ставим его.
      const pendingAgent = pendingAgentIdRef.current;
      if (pendingAgent && pendingAgent.threadId === activeId) {
        setAgentId(pendingAgent.agentId);
      } else {
        setAgentId(null);
      }
      pendingAgentIdRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Закрыт раздел «Файлы» → закрываем и его панель предпросмотра.
  useEffect(() => {
    if (!allFilesOpen) setAllFilesPreview(null);
  }, [allFilesOpen]);

  // Открыт полноэкранный раздел («Файлы» или «Задачи») → закрываем панели,
  // относящиеся к чат-сессии (файлы сессии, субагенты). Раздел открывается БЕЗ
  // смены activeId (сессия живёт в сторе и не размонтируется — так задумано,
  // чтобы стрим/история переживали переключение), поэтому эффект по activeId их
  // не закрывает — панели иначе висели бы поверх раздела.
  useEffect(() => {
    if (allFilesOpen || tasksOpen || agentsOpen || spacesOpen) {
      setFilesOpen(false);
      setSubagentsOpen(false);
    }
  }, [allFilesOpen, tasksOpen, agentsOpen, spacesOpen]);
  // reloadHistory объявлен ниже (нужен chat), но useContextUsage требует колбэк
  // сейчас → зовём через ref, чтобы не завязываться на порядок объявления.
  const reloadHistoryRef = useRef<() => void>(() => {});
  const context = useContextUsage(activeId, mode, () => reloadHistoryRef.current());
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
    // Модель берём по разделу: у кодера и чата свои наборы и свои стейты
    // (см. объявление chatModel). До появления селектора в чате сюда всегда
    // уходила кодерская — в обычном разговоре это было незаметно, потому что
    // менять её было нечем.
    modelId: isCode ? model : chatModel,
    effort,
    mode: agentMode,
    // Агент из библиотеки — только в обычном чате: у кодера свой контур.
    agentId: isCode ? undefined : agentId,
    permissionMode: isCode ? permissionMode : undefined,
    // Сессия попадает в сайдбар СРАЗУ при отправке первого сообщения, а не по
    // завершении хода. Раньше её показывал только onDone/onTitle — и пока агент
    // работал (а с задачами и картинками ход идёт минутами), сессии в списке не
    // было; а если пользователь уходил из неё, onDone не срабатывал вовсе
    // (AbortError → ранний return), и сессия не появлялась до перезагрузки.
    onSend: () => {
      sessions.ensureListed(activeId, activeSpaceIdRef.current);
      // Опрос заголовка — с ОТПРАВКИ, а не только с onDone: уйди пользователь
      // из сессии до конца хода, onDone не сработает, и «Новый чат» висел бы
      // до перезагрузки. Повторный вызов в onDone дубля не даёт (см. guard).
      sessions.refreshTitle(activeId);
    },
    onTitle: (title) => {
      sessions.setTitleLocal(activeId, title);
      sessions.ensureListed(activeId, activeSpaceIdRef.current);
    },
    onDone: (threadId) => {
      sessions.ensureListed(threadId, activeSpaceIdRef.current);
      sessions.refreshTitle(threadId);
      if (filesOpen) files.refresh();
      void context.refresh();
    },
  });

  // Первый ход в выбранном из «Режима» пространстве: привязываем тред ДО
  // отправки (createSpaceThread идемпотентен для своего треда), чтобы сервер
  // завёл сессию сразу в облаке пространства. Дальше — обычный send.
  const sendBindingSpace = useCallback(
    async (...args: Parameters<typeof chat.send>) => {
      const sid = pendingSpaceBindRef.current;
      if (sid) {
        pendingSpaceBindRef.current = null;
        try {
          await createSpaceThread(sid, activeId);
        } catch {
          // Привязка не удалась — ход всё равно уходит, но личным чатом;
          // капсула не должна врать про пространство.
          activeSpaceIdRef.current = null;
          setActiveSpaceId(null);
        }
        void sessions.refresh();
      }
      return chat.send(...args);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat.send, activeId, sessions.refresh],
  );

  // Перезагрузить ленту из истории (открытие сессии + после ручного сжатия,
  // чтобы показать блок «Контекст сжат»). Не трогает идущий стрим (setHistory
  // сам это проверяет).
  const reloadHistory = useCallback(async () => {
    if (!activeId) return;
    const history = await fetchThreadMessages(activeId);
    chat.setHistory(history);
  }, [activeId, chat]);
  useEffect(() => {
    reloadHistoryRef.current = () => void reloadHistory();
  }, [reloadHistory]);

  // Треды, открытые «извне» списка сессий (прогоны регулярных задач). У них есть
  // история в чекпойнтере, но их нет в sessions.threads — помечаем как известные,
  // чтобы грузить историю, а не сбрасывать ленту.
  const externalOpenIds = useRef<Set<string>>(new Set());

  const lastLoaded = useRef<string>("");
  useEffect(() => {
    if (!loaded || !activeId || lastLoaded.current === activeId) return;
    lastLoaded.current = activeId;
    // Лента уже наполнена — второй раз не грузим. НО: если мы приаттачились к
    // идущему ходу, в ленте лежат только его сообщения (пузырь ассистента), а
    // история выше отсутствует — её как раз надо дотянуть. Иначе, зайдя в
    // сессию посреди работы агента, пользователь видел только текущий ход.
    if (chatStreams.hasMessages(activeId) && !chatStreams.isStreaming(activeId)) {
      return;
    }
    // Тред прогона регулярной задачи (открыт из раздела «Задачи») НЕ лежит в
    // списке сессий (kind='recurring' отфильтрован), но у него ЕСТЬ история в
    // чекпойнтере — грузим её, а не сбрасываем ленту. externalOpenIds помнит
    // такие «внешне открытые» треды.
    const known =
      externalOpenIds.current.has(activeId) ||
      sessions.threads.some((t) => t.id === activeId && t.created_at !== "");
    if (!known) {
      chat.reset();
      return;
    }
    (async () => {
      const history = await fetchThreadMessages(activeId);
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

  // Заготовка первого сообщения для нового треда («Создать агента → с помощью
  // ассистента»). Отправить сразу после newSession() нельзя: chat.send держит
  // threadId в замыкании и увёл бы сообщение в ПРЕДЫДУЩИЙ тред. Поэтому кладём
  // текст в ref, а эффект ниже шлёт его, когда chat уже пересобран на новый id.
  //
  // ref, а не состояние: отправка — разовый побочный эффект, перерисовка для неё
  // не нужна, и «уже отправлено» снимается синхронно — иначе повторный прогон
  // эффекта (strict mode) отправил бы заготовку дважды.
  const pendingOpenerRef = useRef<{ threadId: string; text: string } | null>(null);

  const askAssistant = useCallback(
    (opener: string) => {
      // Закрываем ВСЕ разделы, а не только агентов: заготовку шлют из любого
      // (агенты, навыки, пространства, задачи), а открытый раздел перекрыл бы
      // чат — человек отправил бы сообщение и не увидел ответа.
      setAgentsOpen(false);
      setSpacesOpen(false);
      setTasksOpen(false);
      const id = sessions.newSession();
      pendingOpenerRef.current = { threadId: id, text: opener };
    },
    // setAgentsOpen — обёртка над пропом, в deps не нужна (пересоздаётся каждый рендер).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions],
  );

  useEffect(() => {
    const pending = pendingOpenerRef.current;
    if (!pending || pending.threadId !== activeId) return;
    // Агента НЕ выбираем намеренно: навык agent-builder и каталог /agents/
    // монтируются только универсальному ассистенту (см. agent.py: build_agent).
    // С выбранным агентом в библиотеку писать было бы нечем.
    pendingOpenerRef.current = null;
    void chat.send(pending.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

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

  // Правые панели взаимоисключающие: открытие одной закрывает остальные (все
  // они — соседи колонки чата, вместе не помещаются).
  const toggleFiles = useCallback(() => {
    setFilesOpen((prev) => {
      const next = !prev;
      if (next) {
        setSubagentsOpen(false);
        setSessionSettingsOpen(false);
      }
      return next;
    });
  }, []);
  const toggleSubagents = useCallback(() => {
    setSubagentsOpen((prev) => {
      const next = !prev;
      if (next) {
        setFilesOpen(false);
        setSessionSettingsOpen(false);
      }
      return next;
    });
  }, []);
  const toggleSessionSettings = useCallback(() => {
    setSessionSettingsOpen((prev) => {
      const next = !prev;
      if (next) {
        setFilesOpen(false);
        setSubagentsOpen(false);
      }
      return next;
    });
  }, []);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 overflow-hidden px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-auto"
          />
          {tasksOpen ? (
            /* Раздел «Регулярные задачи»: заголовок + кнопка «назад» (когда внутри
               открыта деталь/форма — раздел сообщает обработчик через onBackChange). */
            <div className="flex items-center gap-1.5">
              {tasksBack && (
                <button
                  type="button"
                  onClick={() => tasksBack()}
                  aria-label={t.recurringTasks.backToList}
                  title={t.recurringTasks.backToList}
                  className="-ml-1 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ArrowLeft className="size-5" />
                </button>
              )}
              <span className="text-base font-semibold">{t.sidebar.tasks}</span>
            </div>
          ) : spacesOpen ? (
            /* Раздел «Пространства»: заголовок + «назад» из детали к списку. */
            <div className="flex items-center gap-1.5">
              {spacesBack && (
                <button
                  type="button"
                  onClick={() => spacesBack()}
                  aria-label={t.recurringTasks.backToList}
                  title={t.recurringTasks.backToList}
                  className="-ml-1 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ArrowLeft className="size-5" />
                </button>
              )}
              <span className="text-base font-semibold">{t.sidebar.projects}</span>
            </div>
          ) : agentsOpen ? (
            /* Раздел «Мои агенты»: заголовок + «назад» из формы к списку. */
            <div className="flex items-center gap-1.5">
              {agentsBack && (
                <button
                  type="button"
                  onClick={() => agentsBack()}
                  aria-label={t.recurringTasks.backToList}
                  title={t.recurringTasks.backToList}
                  className="-ml-1 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ArrowLeft className="size-5" />
                </button>
              )}
              <span className="text-base font-semibold">{t.sidebar.agents}</span>
            </div>
          ) : allFilesOpen ? (
            /* Раздел «Файлы»: заголовок раздела. Возврат к чату — клик по сессии. */
            <span className="text-base font-semibold">{t.sidebar.files}</span>
          ) : (
            <>
              {/* Прогон регулярной задачи, открытый как живой чат: вместо меню
                  сессии — кнопка возврата в раздел «Задачи» (на экран той задачи).
                  Остальные кнопки чата (Файлы сессии, Субагенты) остаются ниже. */}
              {activeRunTaskId ? (
                <HeaderAction
                  icon={ListChecks}
                  label={t.recurringTasks.backToTask}
                  onClick={() => {
                    setReturnToTaskId(activeRunTaskId);
                    setTasksOpen(true);
                  }}
                />
              ) : (
                /* В хедере — название ТЕКУЩЕЙ сессии + меню действий над ней
                   (переименовать/удалить). Список всех сессий переехал в сайдбар. */
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
              )}
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
              {/* «Настройки сессии» — только в чат-режиме: память этого чата и
                  список того, что уже запомнено. */}
              {!isCode && (
                <HeaderAction
                  icon={SlidersHorizontal}
                  label={t.chat.sessionSettings}
                  onClick={toggleSessionSettings}
                  disabled={!activeId}
                  active={sessionSettingsOpen}
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
          <div className="ml-auto pr-1">
            <HeaderBrand />
          </div>
        </header>
        {tasksOpen ? (
          /* Раздел «Регулярные задачи»: список задач → детали задачи. Прогон
             открывается как НАСТОЯЩАЯ живая сессия чата: закрываем раздел и
             делаем тред прогона активной сессией (с полем ввода, продолжаемой). */
          <RecurringTasksScreen
            // Возврат «К задаче» из прогона приоритетнее deep-link из сайдбара:
            // он — явное действие в текущем контексте.
            initialTaskId={returnToTaskId ?? openTaskId ?? null}
            onConsumedInitial={() => {
              setReturnToTaskId(null);
              onOpenTaskConsumed?.();
            }}
            // setState с функцией трактует её как updater — оборачиваем, чтобы
            // СОХРАНИТЬ функцию-обработчик, а не вызвать её.
            onBackChange={(back) => setTasksBack(() => back)}
            onAskAssistant={askAssistant}
            onOpenRunThread={(threadId) => {
              externalOpenIds.current.add(threadId);
              setTasksOpen(false);
              sessions.select(threadId);
            }}
          />
        ) : spacesOpen ? (
          /* Раздел «Пространства»: список → деталь (Чаты/Файлы). Чат
             пространства открывается как обычная активная сессия. */
          <SpacesScreen
            // Тот же канал, что у агентов и навыков: «создать с ассистентом»
            // открывает новый чат с заготовленным первым сообщением.
            onAskAssistant={askAssistant}
            initialSpaceId={openSpaceId ?? null}
            onConsumedInitial={() => onOpenSpaceConsumed?.()}
            onBackChange={(back) => setSpacesBack(() => back)}
            onOpenThread={(threadId, spaceId, opener, agentId) => {
              // externalOpenIds: тред открыт не из сайдбара — его историю надо
              // догрузить (у нового чата её нет, запрос вернёт пусто — ок).
              externalOpenIds.current.add(threadId);
              // Пространство чата — сразу в ref: при первом ходе ensureListed
              // положит сессию в ЕГО папку, не дожидаясь перезагрузки. Метка
              // не даёт эффекту смены activeId сбросить значение как «новый
              // чат вне пространств».
              activeSpaceIdRef.current = spaceId ?? null;
              spaceIdPinnedRef.current = true;
              setActiveSpaceId(spaceId ?? null);
              // Заготовка первого сообщения («создать с ассистентом» из
              // пространства) — тем же механизмом, что askAssistant: эффект
              // отправит её, когда chat пересоберётся на новый тред.
              if (opener) pendingOpenerRef.current = { threadId, text: opener };
              // Агент команды из дропдауна «Новый чат» — преднастроить
              // «Режим» нового чата на него.
              if (agentId) pendingAgentIdRef.current = { threadId, agentId };
              // ОТЛОЖЕННАЯ ПРИВЯЗКА, как у выбора пространства в «Режиме»:
              // тред ещё не существует на сервере, и createSpaceThread сделает
              // sendBindingSpace при первой отправке. Правило одно на все
              // входы — пока хода нет, нет и сессии.
              if (spaceId) pendingSpaceBindRef.current = spaceId;
              setSpacesOpen(false);
              sessions.select(threadId);
            }}
          />
        ) : agentsOpen ? (
          /* Раздел «Мои агенты»: библиотека → форма создания/правки. */
          <AgentsScreen
            // setState с функцией трактует её как updater — оборачиваем, чтобы
            // СОХРАНИТЬ функцию-обработчик, а не вызвать её.
            onBackChange={(back) => setAgentsBack(() => back)}
            onAskAssistant={askAssistant}
          />
        ) : allFilesOpen ? (
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
              onOpenFile={onOpenFile}
              onLoadMore={chat.loadMore}
              hasMore={chat.hasMore}
            />
          ) : (
            <FileChipProvider value={fileChipApi}>
              {/* key: НОВЫЙ инстанс чата на каждую сессию — недописанный текст
                  и черновик вложений принадлежат своему чату и в соседний не
                  переносятся (как FilesPanel, пересоздаваемая по key). */}
              <Chat
                key={activeId}
                messages={chat.messages}
                isStreaming={chat.isStreaming}
                error={chat.error}
                onSend={sendBindingSpace}
                onRetry={chat.retry}
                onEdit={chat.edit}
                onStop={chat.stop}
                contextUsage={context.usage}
                compacting={context.compacting}
                onCompact={context.compact}
                threadId={activeId}
                effort={effort}
                onEffortChange={setEffort}
                model={chatModel}
                onModelChange={setChatModel}
                agentId={agentId}
                onAgentChange={setAgentId}
                // Пространство из «Режима» — новый чат В НЁМ, тем же путём,
                // что «Новый чат» на странице пространства: сервер привязывает
                // тред до первого хода, песочница сразу смотрит в его облако.
                activeSpaceId={activeSpaceId}
                // Выбор пространства в «Режиме» — ТОЛЬКО состояние капсулы:
                // сессии не существует, пока нет хода, поэтому ничего не
                // создаём и никуда не переключаем. Привязка треда — при
                // отправке (sendBindingSpace).
                onSpacePick={(spaceId, spaceAgentId) => {
                  activeSpaceIdRef.current = spaceId;
                  setActiveSpaceId(spaceId);
                  pendingSpaceBindRef.current = spaceId;
                  setAgentId(spaceAgentId);
                }}
                // Повторный клик по активному пространству — возврат к
                // умолчанию: снимаем и отложенную привязку, и агента.
                onSpaceClear={() => {
                  pendingSpaceBindRef.current = null;
                  activeSpaceIdRef.current = null;
                  setActiveSpaceId(null);
                  setAgentId(null);
                }}
                limitExhausted={usage?.exhausted ?? false}
                limitResetAt={usage?.reset_at ?? null}
                pendingQuestions={chat.pendingQuestions}
                onQuestionsSubmit={chat.answerQuestions}
                // Отказ отвечать — это ПУСТОЙ ответ, а не остановка хода:
                // граф стоит в interrupt, останавливать нечего, а тула на
                // пустой массив вернёт «The user did not answer» (см.
                // tools/ask_user.py) — агент продолжит и спросит словами.
                onQuestionsDismiss={() => chat.answerQuestions([])}
              />
            </FileChipProvider>
          )}
          {isCode && openedFile && (
            <FileEditor
              path={openedFile}
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
      {/* Панель «Настройки сессии» — сосед колонки, как FilesPanel.
          Пересоздаём при смене сессии, чтобы состояние (тумблер памяти, список
          фактов) перечитывалось, а не оставалось от прошлого чата. Ключ с
          ПРЕФИКСОМ: FilesPanel — сосед по тому же родителю и берёт key={activeId},
          и один голый activeId на двоих дал бы двух детей с одинаковым ключом. */}
      {!isCode && activeId && (
        <SessionSettingsPanel
          key={`session-settings:${activeId}`}
          open={sessionSettingsOpen}
          threadId={activeId}
          onClose={() => setSessionSettingsOpen(false)}
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
