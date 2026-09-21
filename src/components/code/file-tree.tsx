"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Tree, type NodeRendererProps, type TreeApi } from "react-arborist";
import {
  ChevronRight,
  RefreshCw,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Copy,
  Scissors,
  Clipboard,
  Link,
  X,
} from "lucide-react";
import { fileIcon, folderIcon } from "@/components/code/file-icon";
import { cn } from "@/lib/utils";

export type FileTreeHandle = {
  refreshParent: (filePath: string) => void;
};

export type FsNode = {
  id: string;
  name: string;
  isDir: boolean;
  children?: FsNode[] | null;
};

type ClipboardEntry = { path: string; mode: "copy" | "cut" };

// ─── path helpers ─────────────────────────────────────────────────────────────

function parentPath(p: string): string {
  const sep = p.includes("/") ? "/" : "\\";
  return p.split(sep).slice(0, -1).join(sep) || sep;
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes("/") ? "/" : "\\";
  return dir.replace(new RegExp(`[${sep === "/" ? "/" : "\\\\"}]+$`), "") + sep + name;
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

// ─── FS helpers ───────────────────────────────────────────────────────────────

// Результат загрузки директории: либо дети, либо код ошибки. Раньше ЛЮБАЯ
// ошибка молча превращалась в [] — из-за этого недоступная папка (в частности
// outside_root, когда джейл хоста не знает про восстановленный root старой
// сессии) выглядела как ПУСТОЙ проект. Теперь ошибку возвращаем наверх, чтобы
// вызывающий мог переспросить хост (re-register root) или показать состояние.
type LoadDirResult = { ok: true; items: FsNode[] } | { ok: false; error: string };

async function loadDirResult(dirPath: string): Promise<LoadDirResult> {
  const desktop = window.avyDesktop;
  if (!desktop) return { ok: true, items: [] };
  const res = await desktop.listDir(dirPath);
  if ("error" in res) return { ok: false, error: res.error };
  return {
    ok: true,
    items: res.items.map((e) => ({
      id: e.path,
      name: e.name,
      isDir: e.isDir,
      children: e.isDir ? undefined : null,
    })),
  };
}

// Удобная обёртка: пробует загрузить, а при outside_root — переуведомляет хост о
// джейле и повторяет ОДИН раз. Закрывает гонку «setActiveRoots (fire-and-forget)
// ещё не долетел, а дерево уже дёрнуло listDir» при входе в сессию. Здесь берём
// addRoot (invoke → возвращает Promise), чтобы ДОЖДАТЬСЯ обновления джейла на
// хосте перед повтором; на хосте addRoot идемпотентен и роутится в setActiveRoots.
async function loadDir(dirPath: string, jailRoots?: string[]): Promise<FsNode[]> {
  let r = await loadDirResult(dirPath);
  if (!r.ok && r.error === "outside_root") {
    const desktop = window.avyDesktop;
    if (desktop?.addRoot && jailRoots) {
      // Регистрируем все текущие roots и ждём, чтобы джейл на хосте обновился.
      await Promise.all(jailRoots.map((f) => desktop.addRoot!(f)));
      r = await loadDirResult(dirPath);
    }
  }
  return r.ok ? r.items : [];
}

function childrenAccessor(n: FsNode): FsNode[] | null {
  if (!n.isDir) return null;
  return n.children ?? [];
}

// «Слепая» для fs.watch файловая система: там inotify не доставляет события
// (Windows-диски из WSL — 9p /mnt/*, сетевые шары UNC/network). На таких путях
// живой git-статус нельзя ловить только через нативный вотчер — нужен лёгкий
// heartbeat (см. эффект ниже). На ext4/нативной ФС (/home, C:\ напрямую) события
// приходят сами — heartbeat не нужен, не жжём цикл зря.
function isBlindWatchFs(root: string, platform?: string): boolean {
  if (!root) return false;
  // WSL-монтирование Windows-диска: /mnt/<буква>/... на win32-хосте = 9p.
  if (platform === "win32" && /^\/mnt\/[a-z]\//i.test(root)) return true;
  // UNC/сетевой путь (\\server\share или //server/share) — CIFS/NFS, тоже слепой.
  if (/^(\\\\|\/\/)/.test(root)) return true;
  return false;
}

function findNode(nodes: FsNode[], id: string): FsNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

function patchChildren(nodes: FsNode[], id: string, children: FsNode[]): FsNode[] {
  return nodes.map((n) => {
    if (n.id === id) return { ...n, children };
    if (n.children) return { ...n, children: patchChildren(n.children, id, children) };
    return n;
  });
}

// ─── context menu ─────────────────────────────────────────────────────────────

type MenuPos = { x: number; y: number };

function ContextMenu({
  pos,
  node,
  clipboard,
  onClose,
  onCopy,
  onCut,
  onPaste,
  onCopyPath,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
}: {
  pos: MenuPos;
  node: FsNode;
  clipboard: ClipboardEntry | null;
  onClose: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onCopyPath: () => void;
  onRename: () => void;
  onDelete: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const closeKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", close, true);
    document.addEventListener("keydown", closeKey, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("keydown", closeKey, true);
    };
  }, [onClose]);

  const [style, setStyle] = useState<React.CSSProperties>({ top: pos.y, left: pos.x, opacity: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const rect = el.getBoundingClientRect();
    setStyle({
      top: pos.y + rect.height > vh ? pos.y - rect.height : pos.y,
      left: pos.x + rect.width > vw ? pos.x - rect.width : pos.x,
      opacity: 1,
    });
  }, [pos]);

  const item = (
    icon: React.ReactNode,
    label: string,
    hint: string,
    action: () => void,
    disabled = false,
    danger = false,
  ) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => { if (!disabled) { action(); onClose(); } }}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
        disabled
          ? "cursor-default opacity-40"
          : cn("hover:bg-accent cursor-pointer", danger && "text-destructive hover:text-destructive"),
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      <span className="ml-4 shrink-0 text-[10px] text-muted-foreground">{hint}</span>
    </button>
  );

  const sep = () => <div className="my-1 border-t" />;

  return (
    <div
      ref={ref}
      style={{ position: "fixed", zIndex: 9999, ...style }}
      className="min-w-[200px] rounded-md border bg-popover py-1 shadow-md transition-opacity"
    >
      {node.isDir && (
        <>
          {item(<FilePlus className="size-3.5" />, "Новый файл", "", onNewFile)}
          {item(<FolderPlus className="size-3.5" />, "Новая папка", "", onNewFolder)}
          {sep()}
        </>
      )}
      {item(<Scissors className="size-3.5" />, "Вырезать", "Ctrl+X", onCut)}
      {item(<Copy className="size-3.5" />, "Копировать", "Ctrl+C", onCopy)}
      {item(
        <Clipboard className="size-3.5" />,
        "Вставить",
        "Ctrl+V",
        onPaste,
        !clipboard,
      )}
      {sep()}
      {item(<Link className="size-3.5" />, "Копировать путь", "Shift+Alt+C", onCopyPath)}
      {sep()}
      {item(<Pencil className="size-3.5" />, "Переименовать", "F2", onRename)}
      {item(<Trash2 className="size-3.5" />, "Удалить", "Del", onDelete, false, true)}
    </div>
  );
}

// ─── inline input ─────────────────────────────────────────────────────────────

function InlineInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const dot = initial.lastIndexOf(".");
    ref.current?.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);

  function handleKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); onCommit(value.trim()); }
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  }

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKey}
      onBlur={() => onCommit(value.trim())}
      onClick={(e) => e.stopPropagation()}
      className="h-5 min-w-0 flex-1 rounded border bg-background px-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
      spellCheck={false}
    />
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

// Git status letter → display config (VS Code style)
const GIT_STATUS_COLOR: Record<string, string> = {
  M: "text-[#e2c08d]",   // modified  — жёлтый
  A: "text-[#73c991]",   // added     — зелёный
  "?": "text-[#73c991]", // untracked — зелёный
  D: "text-[#f14c4c]",   // deleted   — красный
  R: "text-[#e2c08d]",   // renamed   — жёлтый
  C: "text-[#e2c08d]",   // copied    — жёлтый
  U: "text-[#e2c08d]",   // conflict  — жёлтый
};
const GIT_STATUS_LABEL: Record<string, string> = {
  M: "M", A: "A", "?": "U", D: "D", R: "R", C: "C", U: "U",
};

type GitStatusMap = Map<string, string>; // abs path → status letter

// Вес статуса для агрегации на ПАПКУ (как в VS Code: у декорации есть weight, на
// папку «всплывает» декорация ребёнка с наибольшим весом). Больше = важнее для
// показа на папке. Ключевое: Deleted имеет наименьший вес — один удалённый файл
// в живой папке НЕ красит её целиком красным «D», побеждают живые изменения.
const GIT_STATUS_WEIGHT: Record<string, number> = {
  U: 10, // conflict
  M: 9,  // modified
  R: 8,  // renamed
  C: 8,  // copied
  "?": 7, // untracked
  A: 6,  // added
  D: 5,  // deleted — наименьший приоритет на папке
};

type RowExtra = {
  renamingId: string | null;
  cutId: string | null;
  onRenameCommit: (node: FsNode, newName: string) => void;
  onRenameCancel: () => void;
  onContextMenu: (e: React.MouseEvent, node: FsNode) => void;
  gitStatus: GitStatusMap;
  root: string;
  isWorkspace: boolean;
  onRemoveRoot?: (root: string) => void;
};

// Нормализуем путь: все \ → /, убираем trailing slash
function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

function getNodeGitStatus(nodeId: string, isDir: boolean, gitStatus: GitStatusMap, root: string): string | null {
  const normRoot = normPath(root);
  const normNode = normPath(nodeId);

  if (isDir) {
    const prefix = normNode + "/";
    // Папка агрегирует статусы детей по ВЕСУ (модель VS Code), а не берёт первый
    // попавшийся. Раньше возвращался статус первого совпавшего ребёнка (порядок
    // Map недетерминирован по смыслу) — папка с одним удалённым файлом среди
    // живых красилась целиком красным «D», хотя на диске она есть и полна
    // изменений. Теперь всплывает статус ребёнка с наибольшим весом: живые
    // изменения (M/A/?/…) важнее одиночного удаления «D».
    let best: string | null = null;
    let bestW = -1;
    for (const [relOrAbs, s] of gitStatus) {
      const norm = normPath(relOrAbs);
      // git возвращает относительные пути от корня репо
      const absPath = norm.startsWith("/") || /^[A-Za-z]:/.test(norm)
        ? norm
        : normRoot + "/" + norm;
      if (!absPath.startsWith(prefix)) continue;
      const w = GIT_STATUS_WEIGHT[s] ?? 0;
      if (w > bestW) { bestW = w; best = s; }
    }
    return best;
  }

  // Файл: строим абсолютный путь из каждой записи и сравниваем
  for (const [relOrAbs, s] of gitStatus) {
    const norm = normPath(relOrAbs);
    const absPath = norm.startsWith("/") || /^[A-Za-z]:/.test(norm)
      ? norm
      : normRoot + "/" + norm;
    if (absPath === normNode) return s;
  }
  return null;
}

function Row({
  node,
  style,
  dragHandle,
  extra,
}: NodeRendererProps<FsNode> & { extra: RowExtra }) {
  const isDir = node.data.isDir;
  const isRenaming = extra.renamingId === node.data.id;
  const isCut = extra.cutId === node.data.id;
  // Корневая нода workspace — нода верхнего уровня при isWorkspace
  const isWorkspaceRoot = extra.isWorkspace && node.level === 0;
  const gitSt = getNodeGitStatus(node.data.id, isDir, extra.gitStatus, extra.root);
  const gitColor = gitSt ? (GIT_STATUS_COLOR[gitSt] ?? "text-[#e2c08d]") : null;
  const gitLabel = gitSt ? (GIT_STATUS_LABEL[gitSt] ?? gitSt) : null;

  if (isWorkspaceRoot) {
    // Секция workspace — стиль как в VS Code: uppercase, серый, коллапсируемый
    return (
      <div
        ref={dragHandle}
        style={style}
        onClick={() => node.toggle()}
        onContextMenu={(e) => { e.preventDefault(); extra.onContextMenu(e, node.data); }}
        className="group flex h-full cursor-pointer items-center gap-1 px-1"
      >
        <ChevronRight className={cn(
          "size-3 shrink-0 text-muted-foreground transition-transform",
          node.isOpen ? "rotate-90" : "",
        )} />
        <span className={cn(
          "flex-1 truncate text-[11px] font-semibold uppercase tracking-wide",
          gitColor ?? "text-foreground/80",
        )}>
          {node.data.name}
        </span>
        {gitLabel && (
          <span className={cn("shrink-0 text-[10px] font-medium", gitColor ?? "")}>
            {gitLabel}
          </span>
        )}
        {extra.onRemoveRoot && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); extra.onRemoveRoot!(node.data.id); }}
            className="ml-0.5 shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-destructive"
            title="Убрать из workspace"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
    );
  }

  const Icon = isDir ? folderIcon(node.isOpen) : fileIcon(node.data.name);

  return (
    <div
      ref={dragHandle}
      style={style}
      onClick={() => !isRenaming && (isDir ? node.toggle() : node.activate())}
      onContextMenu={(e) => { e.preventDefault(); extra.onContextMenu(e, node.data); }}
      className={cn(
        "flex h-full cursor-pointer items-center gap-1 rounded px-1 text-sm",
        "hover:bg-accent/60",
        node.isSelected && "bg-accent text-accent-foreground",
        isCut && "opacity-50",
      )}
    >
      <ChevronRight
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground transition-transform",
          isDir ? (node.isOpen ? "rotate-90" : "") : "opacity-0",
        )}
      />
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      {isRenaming ? (
        <InlineInput
          initial={node.data.name}
          onCommit={(name) => extra.onRenameCommit(node.data, name)}
          onCancel={extra.onRenameCancel}
        />
      ) : (
        <>
          <span className={cn("flex-1 truncate", gitColor ?? "")}>{node.data.name}</span>
          {gitLabel && (
            <span className={cn("ml-1 shrink-0 text-[10px] font-medium leading-none", gitColor ?? "")}>
              {gitLabel}
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ─── FileTree ─────────────────────────────────────────────────────────────────

export const FileTree = forwardRef<
  FileTreeHandle,
  {
    roots: string[];
    onOpenFile: (path: string) => void;
    onMutation?: (path: string) => void;
    onRemoveRoot?: (root: string) => void;
  }
>(function FileTree({ roots, onOpenFile, onMutation, onRemoveRoot }, ref) {
  // workspace mode: несколько корневых папок в одном дереве
  const isWorkspace = roots.length > 1;
  // для совместимости с одиночным режимом
  const root = roots[0] ?? "";

  const [data, setData] = useState<FsNode[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const [menu, setMenu] = useState<{ pos: MenuPos; node: FsNode } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardEntry | null>(null);
  const [pendingCreate, setPendingCreate] = useState<{ parentId: string; kind: "file" | "dir" } | null>(null);
  const lastMenuNode = useRef<FsNode | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusMap>(new Map());

  const dataRef = useRef<FsNode[]>(data);
  useEffect(() => { dataRef.current = data; }, [data]);

  // Текущий набор roots для повторной регистрации джейла хоста при outside_root
  // (стабильная ссылка для колбэков loadDir/reloadDir/handleToggle).
  const rootsRef = useRef<string[]>(roots);
  useEffect(() => { rootsRef.current = roots; }, [roots]);

  // Императивный API react-arborist — читаем из него, какие папки СЕЙЧАС раскрыты
  // (это единственный источник правды об open-состоянии: Tree держит его внутри).
  const treeRef = useRef<TreeApi<FsNode> | null>(null);

  const clipboardRef = useRef(clipboard);
  useEffect(() => { clipboardRef.current = clipboard; }, [clipboard]);

  const selectedIdRef = useRef(selectedId);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  // ── git status ────────────────────────────────────────────────────────────

  const refreshGitStatus = useCallback(async () => {
    const desktop = window.avyDesktop;
    if (!desktop?.gitStatus) return;
    const maps = await Promise.all(roots.map(r => desktop.gitStatus!(r)));
    const merged = new Map<string, string>();
    for (const res of maps) {
      if (!("error" in res)) for (const [k, v] of Object.entries(res.entries)) merged.set(k, v);
    }
    setGitStatus(merged);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots.join("|")]);

  // ── load ──────────────────────────────────────────────────────────────────

  const reload = useCallback(async () => {
    setLoading(true);
    if (isWorkspace) {
      // Workspace: каждый root — коллапсируемая нода верхнего уровня
      const rootNodes: FsNode[] = await Promise.all(roots.map(async (r) => {
        const kids = await loadDir(r, roots);
        return {
          id: r,
          name: r.split(/[\\/]/).pop() || r,
          isDir: true,
          children: kids,
        };
      }));
      setData(rootNodes);
    } else {
      const top = await loadDir(root, roots);
      setData(top);
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots.join("|"), isWorkspace]);

  useEffect(() => { void reload(); void refreshGitStatus(); }, [reload, refreshGitStatus]);

  const reloadDir = useCallback(async (dirPath: string) => {
    const kids = await loadDir(dirPath, rootsRef.current);
    setData((prev) => {
      // Одиночный режим (1 root): корень — НЕ узел дерева, data = его дети.
      // patchChildren по id корня ничего не находит и молча возвращает дерево
      // как было — из-за этого новый файл В КОРНЕ проекта не появлялся до
      // ручного Refresh (события из подпапок при этом применялись нормально).
      // Корень здесь = замена всего top-level.
      const rs = rootsRef.current;
      if (rs.length <= 1 && dirPath === (rs[0] ?? "")) return kids;
      return patchChildren(prev, dirPath, kids);
    });
  }, []);

  // Подписка на нативный вотчер avy-host: мгновенное обновление дерева и
  // git-статуса при изменении файлов (агент, пользователь, внешний процесс).
  // Хост шлёт КОНКРЕТНЫЕ пути — обновляем точечно: перечитываем только те
  // директории, что реально затронуты и сейчас загружены в дереве, вместо
  // полного reload всего workspace. Это и делает отклик мгновенным. Git-статус
  // дешёвый и общий — его обновляем разом (с дебаунсом на всплеск событий).
  useEffect(() => {
    const desktop = window.avyDesktop;
    if (!desktop?.onFileChanged) return;
    let gitTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = desktop.onFileChanged((paths) => {
      // Родительские директории затронутых путей (dedup).
      const dirs = new Set<string>();
      for (const p of paths) {
        const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
        if (idx > 0) dirs.add(p.slice(0, idx));
      }
      // Перечитываем только те директории, что уже загружены в текущем дереве
      // (видимы/раскрыты). Незагруженные подтянутся сами при раскрытии.
      // roots.includes: корень в одиночном режиме — не узел дерева, findNode
      // его не видит; без явной проверки изменение в корне терялось, если в том
      // же батче было изменение и в подпапке (fallback ниже тогда не срабатывал).
      for (const dir of dirs) {
        if (findNode(dataRef.current, dir) || rootsRef.current.includes(dir)) void reloadDir(dir);
      }
      // Если ни одна директория не совпала (напр. изменение в корне) — точечно
      // перечитать корни как fallback, чтобы не пропустить событие.
      if (dirs.size === 0 || ![...dirs].some((d) => findNode(dataRef.current, d))) {
        for (const r of roots) if (findNode(dataRef.current, r) || r === root) void reloadDir(r);
      }
      // Git-статус — разом, с дебаунсом (гасим всплеск при batch-операциях).
      if (gitTimer) clearTimeout(gitTimer);
      gitTimer = setTimeout(() => { void refreshGitStatus(); }, 250);
    });
    return () => {
      if (gitTimer) clearTimeout(gitTimer);
      unsub();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, reloadDir, refreshGitStatus, roots.join("|")]);

  // Heartbeat git-статуса для «слепых» ФС (диск D из WSL, сетевые шары). Там
  // fs.watch не даёт событий, а точечный polling видимых папок ловит изменения
  // ТОЛЬКО в раскрытых директориях — правка глубоко в свёрнутом поддереве не
  // всплывёт декорацией на корневую папку без явного refresh. Это и есть кейс
  // «в старой (свёрнутой) сессии git не обновляется». git status --porcelain
  // дёшев (один процесс, читает индекс) — гоняем раз в 3с. На ext4/нативной ФС
  // heartbeat не запускаем: там события приходят сами. Пауза при скрытом окне.
  useEffect(() => {
    const platform = window.avyDesktop?.platform as string | undefined;
    const blind = roots.some((r) => isBlindWatchFs(r, platform));
    if (!blind || !window.avyDesktop?.gitStatus) return;
    const HEARTBEAT_MS = 3000;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return; // окно скрыто — не жжём
      void refreshGitStatus();
    };
    timer = setInterval(tick, HEARTBEAT_MS);
    // Мгновенный refresh при возврате фокуса на окно (не ждать целый интервал).
    const onVisible = () => { if (!document.hidden) void refreshGitStatus(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots.join("|"), refreshGitStatus]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Собрать раскрытые директории из TreeApi и отдать нативному вотчеру — он их
  // точечно поллит (страховка на ФС, где fs.watch слеп: 9p/сеть/overlay, т.е.
  // Windows-диски из WSL, сетевые шары, overlay в докере). Роуты вотчер поллит
  // всегда сам; сюда шлём именно раскрытые поддиректории. Дебаунс гасит всплеск
  // при «развернуть всё». Вызываем после каждого toggle и после reload/reloadDir.
  const visibleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushVisibleDirs = useCallback(() => {
    const desktop = window.avyDesktop;
    if (!desktop?.setVisibleDirs) return;
    if (visibleTimer.current) clearTimeout(visibleTimer.current);
    visibleTimer.current = setTimeout(() => {
      const api = treeRef.current;
      const dirs: string[] = [];
      if (api) {
        // visibleNodes — только реально видимые строки (родитель раскрыт).
        // Берём из них папки: их содержимое пользователь видит прямо сейчас.
        for (const n of api.visibleNodes) {
          if (n.data.isDir) dirs.push(n.data.id);
        }
        // КРИТИЧНО: корневые папки workspace тоже должны поллиться, даже если
        // они не в visibleNodes (level 0 может фильтроваться). Если корень
        // раскрыт (isOpen), добавляем его явно.
        // api.get, НЕ api.getNode: такого метода в TreeApi react-arborist нет —
        // вызов кидал TypeError, и watcher вообще не получал видимые папки в
        // workspace-режиме (несколько корней).
        if (isWorkspace) {
          for (const r of roots) {
            const rootNode = api.get(r);
            if (rootNode && rootNode.isOpen && !dirs.includes(r)) {
              dirs.push(r);
            }
          }
        } else if (roots.length === 1) {
          // Одиночный режим: корень всегда поллим
          const rootId = roots[0];
          if (rootId && !dirs.includes(rootId)) {
            dirs.push(rootId);
          }
        }
      }
      desktop.setVisibleDirs!(dirs);
    }, 100); // Уменьшили с 150ms до 100ms для более быстрой реакции
  }, [roots, isWorkspace]);

  // Держим вотчер в курсе набора раскрытых папок при любой перерисовке данных
  // (reload/reloadDir/patchChildren) — не только на ручной toggle.
  useEffect(() => { pushVisibleDirs(); }, [data, pushVisibleDirs]);
  useEffect(() => () => { if (visibleTimer.current) clearTimeout(visibleTimer.current); }, []);

  const handleToggle = useCallback(async (id: string) => {
    const node = findNode(dataRef.current, id);
    // Раскрыли/свернули — пересчитать видимые папки для вотчера в любом случае.
    pushVisibleDirs();
    if (!node || !node.isDir || node.children !== undefined) return;
    const kids = await loadDir(id, rootsRef.current);
    setData((prev) => patchChildren(prev, id, kids));
  }, [pushVisibleDirs]);

  useImperativeHandle(ref, () => ({
    refreshParent(filePath: string) {
      const dir = parentPath(filePath);
      if (!dir) return;
      void reloadDir(dir);
    },
  }), [reloadDir]);

  // ── clipboard ops ─────────────────────────────────────────────────────────

  const handleCopy = useCallback((node: FsNode) => {
    setClipboard({ path: node.id, mode: "copy" });
  }, []);

  const handleCut = useCallback((node: FsNode) => {
    setClipboard({ path: node.id, mode: "cut" });
  }, []);

  const handlePaste = useCallback(async (targetNode: FsNode) => {
    const cb = clipboardRef.current;
    if (!cb) return;
    const desktop = window.avyDesktop;
    if (!desktop) return;

    // Вставляем в папку: если target — файл, берём его родителя
    const destDir = targetNode.isDir ? targetNode.id : parentPath(targetNode.id);
    const name = baseName(cb.path);
    const destPath = joinPath(destDir, name);

    // МГНОВЕННОЕ обновление дерева для paste-операции
    const srcNode = findNode(dataRef.current, cb.path);
    
    if (cb.mode === "copy") {
      // Создаём копию узла с новым путём
      const newNode: FsNode = srcNode
        ? { ...srcNode, id: destPath, name, children: srcNode.children ? [] : null }
        : { id: destPath, name, isDir: false, children: null };
      
      setData((prev) => {
        const parent = findNode(prev, destDir);
        if (!parent) return prev;
        const existingChildren = parent.children ?? [];
        const newChildren = [...existingChildren, newNode].sort((a, b) => {
          if (a.isDir === b.isDir) return a.name.localeCompare(b.name);
          return a.isDir ? -1 : 1;
        });
        return patchChildren(prev, destDir, newChildren);
      });

      const res = await desktop.copyPath?.(cb.path, destPath);
      if (res && "error" in res) {
        console.error("copy failed:", res.error);
        // Откат
        setData((prev) => {
          const parent = findNode(prev, destDir);
          if (!parent) return prev;
          const newChildren = (parent.children ?? []).filter((c) => c.id !== destPath);
          return patchChildren(prev, destDir, newChildren);
        });
        return;
      }
    } else {
      // cut = rename/move: удаляем из старого места, добавляем в новое
      const oldDir = parentPath(cb.path);
      
      setData((prev) => {
        let updated = prev;
        // Удаляем из старой директории
        const oldParent = findNode(updated, oldDir);
        if (oldParent) {
          const oldChildren = (oldParent.children ?? []).filter((c) => c.id !== cb.path);
          updated = patchChildren(updated, oldDir, oldChildren);
        }
        // Добавляем в новую директорию
        const newNode: FsNode = srcNode
          ? { ...srcNode, id: destPath, name }
          : { id: destPath, name, isDir: false, children: null };
        const newParent = findNode(updated, destDir);
        if (newParent) {
          const existingChildren = newParent.children ?? [];
          const newChildren = [...existingChildren, newNode].sort((a, b) => {
            if (a.isDir === b.isDir) return a.name.localeCompare(b.name);
            return a.isDir ? -1 : 1;
          });
          updated = patchChildren(updated, destDir, newChildren);
        }
        return updated;
      });

      const res = await desktop.renamePath?.(cb.path, destPath);
      if (res && "error" in res) {
        console.error("move failed:", res.error);
        // Откат: возвращаем на старое место
        void reloadDir(oldDir);
        void reloadDir(destDir);
        setClipboard(null);
        return;
      }
      setClipboard(null);
    }
    onMutation?.(destPath);
  }, [onMutation]);

  const handleCopyPath = useCallback((node: FsNode) => {
    // navigator.clipboard недоступен в Electron без HTTPS — используем IPC
    if (window.avyDesktop?.writeClipboardText) {
      void window.avyDesktop.writeClipboardText(node.id);
    } else {
      void navigator.clipboard?.writeText(node.id);
    }
  }, []);

  // ── rename ────────────────────────────────────────────────────────────────

  const handleRenameCommit = useCallback(async (node: FsNode, newName: string) => {
    setRenamingId(null);
    if (!newName || newName === node.name) return;
    const desktop = window.avyDesktop;
    if (!desktop?.renamePath) return;
    const dir = parentPath(node.id);
    const newId = joinPath(dir, newName);

    // МГНОВЕННОЕ обновление: меняем имя и ID узла в локальном состоянии
    setData((prev) => {
      const updateNode = (nodes: FsNode[]): FsNode[] => {
        return nodes.map((n) => {
          if (n.id === node.id) {
            // Нашли целевой узел — обновляем его
            const updated: FsNode = {
              ...n,
              id: newId,
              name: newName,
            };
            return updated;
          }
          if (n.children) {
            return { ...n, children: updateNode(n.children) };
          }
          return n;
        });
      };
      return updateNode(prev);
    });

    const res = await desktop.renamePath(node.id, newId);
    if ("error" in res) {
      console.error("rename failed:", res.error);
      // Откат: возвращаем старое имя
      setData((prev) => {
        const updateNode = (nodes: FsNode[]): FsNode[] => {
          return nodes.map((n) => {
            if (n.id === newId) {
              return { ...n, id: node.id, name: node.name };
            }
            if (n.children) {
              return { ...n, children: updateNode(n.children) };
            }
            return n;
          });
        };
        return updateNode(prev);
      });
      return;
    }
    onMutation?.(newId);
  }, [onMutation]);

  // ── delete ────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async (node: FsNode) => {
    const desktop = window.avyDesktop;
    if (!desktop?.deletePath) return;
    
    // МГНОВЕННОЕ удаление из локального состояния
    const dir = parentPath(node.id);
    setData((prev) => {
      const removeNode = (nodes: FsNode[]): FsNode[] => {
        return nodes.filter((n) => n.id !== node.id).map((n) => {
          if (n.children) {
            return { ...n, children: removeNode(n.children) };
          }
          return n;
        });
      };
      return removeNode(prev);
    });

    const res = await desktop.deletePath(node.id);
    // Пользователь отменил в нативном диалоге подтверждения — откатываем удаление
    if ("canceled" in res) {
      // Восстанавливаем узел (перезагружаем директорию)
      void reloadDir(dir);
      return;
    }
    if ("error" in res) {
      console.error("delete failed:", res.error);
      // Откат: восстанавливаем удалённый узел
      void reloadDir(dir);
      return;
    }
    onMutation?.(node.id);
  }, [onMutation]);

  // ── create ────────────────────────────────────────────────────────────────

  const handleNewFile = useCallback((node: FsNode) => {
    const dir = node.isDir ? node.id : parentPath(node.id);
    void reloadDir(dir).then(() => setPendingCreate({ parentId: dir, kind: "file" }));
  }, [reloadDir]);

  const handleNewFolder = useCallback((node: FsNode) => {
    const dir = node.isDir ? node.id : parentPath(node.id);
    void reloadDir(dir).then(() => setPendingCreate({ parentId: dir, kind: "dir" }));
  }, [reloadDir]);

  const handleCreateCommit = useCallback(async (name: string) => {
    const pc = pendingCreate;
    setPendingCreate(null);
    if (!name || !pc) return;
    const desktop = window.avyDesktop;
    if (!desktop) return;
    const newPath = joinPath(pc.parentId, name);

    // МГНОВЕННОЕ обновление дерева: добавляем новый узел в локальное состояние
    // СРАЗУ, не дожидаясь вотчера. Это делает поведение нативным (как в VS Code) —
    // файл появляется в дереве моментально после создания. Вотчер подстрахует на
    // случай рассинхронизации (если файл реально не создался).
    const newNode: FsNode = {
      id: newPath,
      name,
      isDir: pc.kind === "dir",
      children: pc.kind === "dir" ? [] : null,
    };
    setData((prev) => {
      // Если родитель уже загружен в дереве — добавляем ребёнка
      const parent = findNode(prev, pc.parentId);
      if (!parent) return prev;
      const existingChildren = parent.children ?? [];
      // Сортируем: папки первыми, затем файлы, внутри групп по алфавиту
      const newChildren = [...existingChildren, newNode].sort((a, b) => {
        if (a.isDir === b.isDir) return a.name.localeCompare(b.name);
        return a.isDir ? -1 : 1;
      });
      return patchChildren(prev, pc.parentId, newChildren);
    });

    if (pc.kind === "file") {
      const res = desktop.createFile
        ? await desktop.createFile(newPath)
        : await desktop.writeFile(newPath, "");
      if ("error" in res) {
        console.error("create file failed:", res.error);
        // Откат: убираем узел из дерева, если создание не удалось
        setData((prev) => {
          const parent = findNode(prev, pc.parentId);
          if (!parent) return prev;
          const newChildren = (parent.children ?? []).filter((c) => c.id !== newPath);
          return patchChildren(prev, pc.parentId, newChildren);
        });
        return;
      }
    } else {
      if (!desktop.createDir) {
        console.warn("createDir not available — update Electron (copy main.js/preload.js)");
        // Откат
        setData((prev) => {
          const parent = findNode(prev, pc.parentId);
          if (!parent) return prev;
          const newChildren = (parent.children ?? []).filter((c) => c.id !== newPath);
          return patchChildren(prev, pc.parentId, newChildren);
        });
        return;
      }
      const res = await desktop.createDir(newPath);
      if ("error" in res) {
        console.error("create dir failed:", res.error);
        // Откат
        setData((prev) => {
          const parent = findNode(prev, pc.parentId);
          if (!parent) return prev;
          const newChildren = (parent.children ?? []).filter((c) => c.id !== newPath);
          return patchChildren(prev, pc.parentId, newChildren);
        });
        return;
      }
    }

    // Вотчер всё равно получит событие и синхронизирует дерево (на случай
    // внешних изменений), но пользователь уже видит файл моментально.
    if (pc.kind === "file") onOpenFile(newPath);
    onMutation?.(newPath);
  }, [pendingCreate, onOpenFile, onMutation]);

  // ── context menu ──────────────────────────────────────────────────────────

  const handleContextMenu = useCallback((e: React.MouseEvent, node: FsNode) => {
    lastMenuNode.current = node;
    setSelectedId(node.id);
    setMenu({ pos: { x: e.clientX, y: e.clientY }, node });
  }, []);

  // ── global hotkeys ────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      // КРИТИЧНО: этот обработчик висит на window (глобально). Раньше он реагировал
      // на Delete/Ctrl+V/F2 всегда, если в дереве осталась выбранная нода — даже
      // когда пользователь печатал в чате/редакторе. Из-за этого обычный Delete
      // (удаление символа) СНОСИЛ выбранную папку с диска (fs.rm recursive), а
      // Ctrl+V вставлял в дерево. Теперь срабатываем ТОЛЬКО когда фокус реально
      // внутри панели дерева — если фокус в поле ввода/редакторе/где-то ещё,
      // деструктивные хоткеи дерева игнорируются.
      const active = document.activeElement;
      const treeEl = containerRef.current;
      const inTree = !!treeEl && !!active && treeEl.contains(active);
      // Инлайн-инпут дерева (rename/create) сам обрабатывает клавиши и
      // stopPropagation'ит — но подстрахуемся: если фокус в любом поле ввода,
      // хоткеи дерева не трогаем.
      const isEditable =
        active instanceof HTMLElement &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable);
      if (!inTree || isEditable) return;

      const sel = selectedIdRef.current;
      if (!sel) return;
      const node = findNode(dataRef.current, sel);
      if (!node) return;

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === "c" && !e.shiftKey) {
        e.preventDefault();
        handleCopy(node);
        return;
      }
      if (ctrl && e.key === "x") {
        e.preventDefault();
        handleCut(node);
        return;
      }
      if (ctrl && e.key === "v") {
        e.preventDefault();
        void handlePaste(node);
        return;
      }
      // Shift+Alt+C — копировать путь
      if (e.shiftKey && e.altKey && e.key === "C") {
        e.preventDefault();
        handleCopyPath(node);
        return;
      }
      if (e.key === "F2") {
        e.preventDefault();
        setRenamingId(node.id);
        return;
      }
      if (e.key === "Delete" && !ctrl) {
        e.preventDefault();
        void handleDelete(node);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleCopy, handleCut, handlePaste, handleCopyPath, handleDelete]);

  // ── row renderer ──────────────────────────────────────────────────────────

  const extra: RowExtra = {
    renamingId,
    cutId: clipboard?.mode === "cut" ? clipboard.path : null,
    onRenameCommit: (node, name) => void handleRenameCommit(node, name),
    onRenameCancel: () => setRenamingId(null),
    onContextMenu: handleContextMenu,
    gitStatus,
    root,
    isWorkspace,
    onRemoveRoot,
  };

  const RowWithExtra = useCallback(
    (props: NodeRendererProps<FsNode>) => <Row {...props} extra={extra} />,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [renamingId, clipboard, handleRenameCommit, handleContextMenu, gitStatus],
  );

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header — только в одиночном режиме */}
      {!isWorkspace && (
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="truncate font-mono text-[11px] text-muted-foreground" title={root}>
            {root.split(/[\\/]/).pop() || root}
          </span>
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={() => setPendingCreate({ parentId: root, kind: "file" })}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground" title="Новый файл">
              <FilePlus className="size-3.5" />
            </button>
            <button type="button" onClick={() => setPendingCreate({ parentId: root, kind: "dir" })}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground" title="Новая папка">
              <FolderPlus className="size-3.5" />
            </button>
            <button type="button" onClick={() => void reload()}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground" title="Обновить">
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </button>
            {onRemoveRoot && root && (
              <button type="button" onClick={() => onRemoveRoot(root)}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive" title="Убрать папку из workspace">
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Pending create at root */}
      {pendingCreate && pendingCreate.parentId === root && (
        <div className="px-2 pb-1">
          <InlineInput
            initial={pendingCreate.kind === "file" ? "new-file.txt" : "new-folder"}
            onCommit={(name) => void handleCreateCommit(name)}
            onCancel={() => setPendingCreate(null)}
          />
        </div>
      )}

      <div ref={containerRef} className="scroll-hover-visible min-h-0 flex-1">
        {size.h > 0 && (
          <Tree<FsNode>
            ref={treeRef}
            data={data}
            childrenAccessor={childrenAccessor}
            openByDefault={false}
            width={size.w}
            height={size.h}
            indent={14}
            rowHeight={26}
            onToggle={(id) => void handleToggle(id)}
            onActivate={(node) => {
              setSelectedId(node.data.id);
              if (!node.data.isDir) onOpenFile(node.data.id);
            }}
            onSelect={(nodes) => {
              if (nodes.length > 0) setSelectedId(nodes[0].data.id);
            }}
          >
            {RowWithExtra}
          </Tree>
        )}
      </div>

      {/* Context menu */}
      {menu && (
        <ContextMenu
          pos={menu.pos}
          node={menu.node}
          clipboard={clipboard}
          onClose={() => setMenu(null)}
          onCopy={() => handleCopy(menu.node)}
          onCut={() => handleCut(menu.node)}
          onPaste={() => void handlePaste(menu.node)}
          onCopyPath={() => handleCopyPath(menu.node)}
          onRename={() => setRenamingId(menu.node.id)}
          onDelete={() => void handleDelete(menu.node)}
          onNewFile={() => handleNewFile(menu.node)}
          onNewFolder={() => handleNewFolder(menu.node)}
        />
      )}
    </div>
  );
});
