// Типы моста Electron (preload.js → window.avyDesktop). Доступны только когда
// приложение запущено в десктоп-оболочке; в браузере window.avyDesktop === undefined.

export type DirEntry = {
  name: string;
  path: string;
  isDir: boolean;
};

export type ListDirResult = { items: DirEntry[] } | { error: string };
export type ReadFileResult = { content: string } | { error: string };
export type WriteFileResult = { ok: true } | { error: string };
export type MutationResult = { ok: true } | { error: string };
export type GitStatusResult = { entries: Record<string, string> } | { error: string };
export type GitDiffResult = { added: number[]; removed: number[] } | { error: string };

export interface AvyDesktop {
  /** Платформа ОС: "win32" | "darwin" | "linux". */
  platform?: "win32" | "darwin" | "linux" | NodeJS.Platform;
  /** Открыть нативный диалог выбора папки; путь или null. */
  pickFolder(): Promise<string | null>;
  /** Текущая выбранная папка проекта (или null). */
  getRoot(): Promise<string | null>;
  /** Содержимое директории (один уровень). */
  listDir(dirPath: string): Promise<ListDirResult>;
  /** Текст файла для чтения/редактирования. */
  readFile(filePath: string): Promise<ReadFileResult>;
  /** Записать текст в файл на диске. */
  writeFile(filePath: string, content: string): Promise<WriteFileResult>;
  /** Установить папку проекта вручную (без диалога выбора). */
  setRoot(folder: string): Promise<MutationResult>;
  /** Переименовать/переместить файл или папку. */
  renamePath?(oldPath: string, newPath: string): Promise<MutationResult>;
  /** Удалить файл или папку (рекурсивно). Показывает нативное подтверждение;
   *  { canceled: true } — пользователь отменил (не ошибка, ничего не менять). */
  deletePath?(targetPath: string): Promise<MutationResult | { canceled: true }>;
  /** Создать пустой файл (ошибка если уже существует). */
  createFile?(filePath: string): Promise<MutationResult>;
  /** Создать папку (рекурсивно, ok если уже существует). */
  createDir?(dirPath: string): Promise<MutationResult>;
  /** Скопировать файл или папку рекурсивно. */
  copyPath?(srcPath: string, destPath: string): Promise<MutationResult>;
  /** Записать текст в системный буфер обмена Electron. */
  writeClipboardText?(text: string): Promise<MutationResult>;
  /** Прочитать текст из системного буфера обмена Electron. */
  readClipboardText?(): Promise<string>;
  /** Git-статус файлов в папке repoPath (git status --porcelain). */
  gitStatus?(repoPath: string): Promise<GitStatusResult>;
  /** Git diff конкретного файла. Возвращает номера строк добавленных и удалённых. */
  gitDiffFile?(filePath: string): Promise<GitDiffResult>;
  /** Все папки текущего workspace. */
  getRoots?(): Promise<string[]>;
  /** Добавить папку в workspace. */
  addRoot?(folder: string): Promise<{ ok: true; roots: string[] } | { error: string }>;
  /** Удалить папку из workspace. */
  removeRoot?(folder: string): Promise<{ ok: true; roots: string[] }>;
  /** Сообщить папки АКТИВНОЙ треды — нативный вотчер следит РОВНО за ними (полная
   *  замена набора, не накопление глобального джейла). Fire-and-forget: шлём при
   *  входе в треду и её переключении. */
  setActiveRoots?(roots: string[]): void;
  /** Сообщить, какие папки сейчас раскрыты в дереве — нативный вотчер их
   *  точечно поллит (страховка на ФС, где fs.watch слеп: 9p/сеть/overlay).
   *  Fire-and-forget: шлём при каждом expand/collapse. */
  setVisibleDirs?(dirs: string[]): void;
  /** Запустить терминальную сессию bash -i. */
  terminalStart?(opts: { sessionId: string; cwd?: string; cols?: number; rows?: number }): Promise<{ ok: true } | { error: string }>;
  /** Отправить ввод (клавиши) в stdin. */
  terminalInput?(sessionId: string, data: string): void;
  /** Изменить размер терминала. */
  terminalResize?(sessionId: string, cols: number, rows: number): void;
  /** Убить сессию. */
  terminalKill?(sessionId: string): Promise<{ ok: true }>;
  /** Подписаться на вывод (stdout+stderr). Возвращает функцию отписки. */
  onTerminalData?(cb: (sessionId: string, data: string) => void): () => void;
  /** Подписаться на завершение процесса. Возвращает функцию отписки. */
  onTerminalExit?(cb: (sessionId: string, code: number) => void): () => void;
  /** Свернуть окно (кастомные кнопки на Linux; на Win/macOS кнопки рисует ОС). */
  minimizeWindow?(): void;
  /** Развернуть/восстановить окно. */
  maximizeWindow?(): void;
  /** Закрыть окно. */
  closeWindow?(): void;
  /** Развёрнуто ли окно сейчас. */
  isWindowMaximized?(): Promise<boolean>;
  /** Перекрасить нативные кнопки overlay под тему приложения. */
  setTitlebarOverlay?(colors: { color: string; symbolColor: string }): void;
  /** Подписка на смену maximize-состояния. Возвращает функцию отписки. */
  onMaximizedChange?(cb: (maximized: boolean) => void): () => void;
  /** Подписка на изменения файлов в workspace (нативный вотчер avy-host).
   *  Колбэк получает массив затронутых путей. Возвращает функцию отписки. */
  onFileChanged?(cb: (paths: string[]) => void): () => void;

  /** Локальный агент Avy Code (LangChain.js в Electron main-процессе).
   *  Заменяет HTTP+SSE клиент (fetch("/api/chat")) для code-режима — тот же
   *  формат событий (ChatEvent, см. lib/api.ts), транспорт — IPC. */
  codeAgent?: {
    /** Начать ход. Не ждёт завершения — события идут через onEvent.
     *  attachments: файлы уже прочитаны и base64-закодированы в renderer —
     *  локальный агент инжектит их содержимое в сообщение напрямую, без сервера. */
    sendMessage(
      threadId: string,
      message: string,
      roots: string[],
      opts: {
        modelId?: string;
        effort?: string | null;
        permissionMode?: string | null;
        temperature?: number;
      },
      attachments?: Array<{ name: string; mime: string; data: string }>,
    ): Promise<{ ok: true }>;
    /** Возобновить ход после approval — decisions в порядке пришедших permission_request. */
    resolvePermissions(
      threadId: string,
      decisions: Array<{ type: "approve" | "reject"; message?: string }>,
    ): Promise<{ ok: true }>;
    /** Возобновить ход после ask_user — answers в порядке вопросов из ask_user_request. */
    resolveQuestions(
      threadId: string,
      answers: import("@/lib/api").AskUserAnswer[],
    ): Promise<{ ok: true }>;
    /** Ответ на approval-карточку фонового сабагента — резюмит именно его граф
     *  (subId), а не основной. Ход сабагента идёт в панель, не отдельным потоком. */
    resolveSubagentPermission(
      threadId: string,
      subId: string,
      decisions: Array<{ type: "approve" | "reject"; message?: string }>,
    ): Promise<{ ok: true }>;
    /** Прочитать tmp-файл треда (виртуальные /downloads или /tmp) для показа в UI.
     *  Текст → {content}; картинка → {dataUrl} (data-URL для превью); прочий
     *  бинарь → {binary}; ошибка → {error}. */
    readTmpFile(
      threadId: string,
      filePath: string,
    ): Promise<{ content: string } | { dataUrl: string } | { binary: true } | { error: string }>;
    /** Прочитать файл проектной памяти (клик по плашке remember в ленте).
     *  Отдельный канал от readFile: тот джейлит по корням workspace, а память
     *  лежит в userData, вне проекта. roots нужны, чтобы поднять хранилище на
     *  лету, если сессии треда нет в памяти (клик после перезагрузки). */
    readMemoryFile(
      threadId: string,
      filePath: string,
      roots?: string[],
    ): Promise<{ content: string } | { error: string }>;
    /** Убить фоновый процесс треда по pid (кнопка «стоп» в панели фоновых задач). */
    killBackground(threadId: string, pid: number): Promise<{ ok: true }>;
    /** Список фоновых задач треда (durable-история, переживает рестарт). Панель
     *  зовёт при входе в тред, чтобы показать ранее запущенные задачи. */
    listBackground(threadId: string): Promise<import("@/lib/chat-streams").BgTask[]>;
    /** Удалить завершённую фоновую задачу из истории (кнопка «удалить»). */
    removeBackground(threadId: string, id: string): Promise<{ ok: true }>;
    /** Запустить команду задачи заново в том же cwd (кнопка «запустить снова»). */
    restartBackground(threadId: string, id: string): Promise<{ ok: true }>;
    /** Остановить активный ход треда. */
    stop(threadId: string): Promise<{ ok: true }>;
    /** Лента треда для UI — реконструируется локально из чекпоинта графа
     *  (без сервера), заменяет GET /api/threads/{id}/messages для avy-code.
     *  Пустой массив, если чекпоинт пуст (тред ещё не запускался). */
    loadHistory(threadId: string): Promise<import("@/lib/api").HistoryMessage[]>;
    deleteThread(threadId: string): Promise<void>;
    /** Заполненность контекста треда — считается локально (без сервера).
     *  null, если сессия ещё не создавалась в этом процессе Electron. */
    getContextUsage(threadId: string): Promise<{ used_tokens: number; max_tokens: number } | null>;
    /** Принудительно сжать контекст (тот же промпт/модель, что и авто-сжатие).
     *  Не ждёт завершения — события идут через onEvent (в т.ч. "summary"). */
    compact(threadId: string): Promise<{ ok: true }>;
    /** Привязать/обновить папки workspace треда. */
    setWorkspaceRoots(threadId: string, roots: string[]): Promise<{ ok: true }>;
    /** Подписка на поток событий хода этого треда. Возвращает функцию отписки. */
    onEvent(threadId: string, cb: (event: import("@/lib/api").ChatEvent) => void): () => void;

    /** MCP-серверы сессии треда (локальный реестр в этом же процессе). */
    listMcpServers(threadId: string): Promise<
      Array<{
        name: string;
        transport: string;
        url?: string | null;
        command?: string | null;
        tools?: Array<{ name: string; description?: string }>;
      }>
    >;
    /** Добавить MCP-сервер к сессии треда. */
    addMcpServer(
      threadId: string,
      cfg: {
        name: string;
        transport: "streamable_http" | "stdio";
        url?: string;
        headers?: Record<string, string>;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
      },
    ): Promise<{ ok: boolean; tools: string[]; error: string | null }>;
    /** Убрать MCP-сервер из сессии треда. */
    removeMcpServer(threadId: string, name: string): Promise<{ ok: boolean }>;
  };
}

declare global {
  interface Window {
    avyDesktop?: AvyDesktop;
  }
}
