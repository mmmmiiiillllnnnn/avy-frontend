"use client";

import * as React from "react";
import {
  Upload,
  FolderUp,
  Folder,
  Trash2,
  Download,
  MoreVertical,
  ChevronRight,
  ChevronLeft,
  File as FileIcon,
  FileText,
  FileType,
  type LucideIcon,
} from "lucide-react";
import {
  uploadTaskInputs,
  listTaskFiles,
  deleteTaskFile,
  taskFileRawUrl,
  type SessionFile,
  type TaskUpload,
} from "@/lib/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/i18n-context";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { FileCard } from "@/components/chat/file-card";
import { FileViewer } from "@/components/chat/files-panel";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(mime: string): LucideIcon {
  if (mime === "application/pdf") return FileType;
  if (mime.startsWith("text/") || mime.includes("json") || mime.includes("xml"))
    return FileText;
  return FileIcon;
}

// Рекурсивный обход DataTransferItem (drag-drop папки) → [{file, relPath}].
async function readDataTransfer(dt: DataTransfer): Promise<TaskUpload[]> {
  const out: TaskUpload[] = [];
  const items = Array.from(dt.items || []);
  const entries = items
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean) as FileSystemEntry[];
  if (entries.length === 0) {
    for (const f of Array.from(dt.files)) out.push({ file: f, relPath: f.name });
    return out;
  }
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      const file: File = await new Promise((res, rej) => fileEntry.file(res, rej));
      out.push({ file, relPath: prefix + entry.name });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const children: FileSystemEntry[] = await new Promise((res) => {
        const acc: FileSystemEntry[] = [];
        const read = () =>
          reader.readEntries((batch) => {
            if (batch.length === 0) res(acc);
            else {
              acc.push(...batch);
              read();
            }
          }, () => res(acc));
        read();
      });
      for (const c of children) await walk(c, prefix + entry.name + "/");
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}

/** Файлы из <input type=file> (в т.ч. webkitdirectory) → [{file, relPath}]. */
function fromInput(fileList: FileList | null): TaskUpload[] {
  if (!fileList) return [];
  return Array.from(fileList).map((f) => ({
    file: f,
    relPath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
  }));
}

// --- дерево вложений (простое, без внешних либ) --------------------------------

// Узел дерева: папка (children) или файл (несёт SessionFile).
type TreeNode = {
  name: string;
  path: string; // полный путь узла (уникальный ключ + id раскрытия)
  isFolder: boolean;
  children: TreeNode[];
  file?: SessionFile;
};

/** Собрать вложенное дерево из плоского списка файлов. */
function buildTree(files: SessionFile[], root: string): TreeNode {
  const rootNode: TreeNode = { name: root, path: root, isFolder: true, children: [] };
  for (const f of files) {
    const rel = f.path.startsWith(root + "/")
      ? f.path.slice(root.length + 1)
      : f.path.replace(/^\//, "");
    const segs = rel.split("/").filter(Boolean);
    let cur = rootNode;
    let acc = root;
    segs.forEach((seg, i) => {
      acc = `${acc}/${seg}`;
      const isLast = i === segs.length - 1;
      let child = cur.children.find((c) => c.name === seg);
      if (!child) {
        child = {
          name: seg,
          path: acc,
          isFolder: !isLast,
          children: [],
          file: isLast ? f : undefined,
        };
        cur.children.push(child);
      }
      cur = child;
    });
  }
  // Папки сверху, потом файлы; по алфавиту. Рекурсивно.
  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) =>
      a.isFolder !== b.isFolder ? (a.isFolder ? -1 : 1) : a.name.localeCompare(b.name),
    );
    n.children.forEach(sortRec);
  };
  sortRec(rootNode);
  return rootNode;
}

/** Все пути файлов под узлом (для удаления папки целиком одним запросом). */
function collectPaths(node: TreeNode): string[] {
  if (node.file) return [node.file.path];
  return node.children.flatMap(collectPaths);
}

/** Меню действий строки дерева — та же выпадашка «⋮», что и на карточках файлов
 *  (Download/Delete). Для папки download не показываем (скачивать нечего). */
function RowMenu({
  onDownload,
  onDelete,
  isFolder,
  busy,
}: {
  onDownload?: () => void;
  onDelete: () => void;
  /** Папка → пункт «Удалить папку», файл → «Удалить файл». */
  isFolder?: boolean;
  busy: boolean;
}) {
  const t = useT();
  const deleteLabel = isFolder ? t.recurringTasks.deleteFolder : t.files.deleteFile;
  const [open, setOpen] = React.useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={t.files.moreActions}
        title={t.files.moreActions}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[opacity,color,background-color] hover:bg-sidebar-border hover:text-foreground group-hover:opacity-100 aria-expanded:opacity-100 aria-expanded:bg-sidebar-border aria-expanded:text-foreground focus-visible:opacity-100"
      >
        <MoreVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {onDownload && (
          <>
            <DropdownMenuItem
              className="gap-2"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDownload();
              }}
            >
              <Download className="size-4" />
              {t.files.download}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          variant="destructive"
          className="gap-2"
          disabled={busy}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="size-4" />
          {deleteLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Одна строка дерева (рекурсивно рендерит детей раскрытых папок). */
function TreeRow({
  node,
  depth,
  taskId,
  expanded,
  onToggle,
  onOpen,
  onDeleteFile,
  onDeleteFolder,
  deleting,
}: {
  node: TreeNode;
  depth: number;
  taskId: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpen: (f: SessionFile) => void;
  onDeleteFile: (path: string) => void;
  onDeleteFolder: (node: TreeNode) => void;
  deleting: Set<string>;
}) {
  const isOpen = expanded.has(node.path);
  const f = node.file;
  const Icon = f ? iconFor(f.mime) : FileIcon;
  // Папка «занята», если удаляется хоть один файл под ней.
  const folderBusy = node.isFolder && collectPaths(node).some((p) => deleting.has(p));
  const download = () => {
    if (!f) return;
    const a = document.createElement("a");
    a.href = taskFileRawUrl(taskId, f.path);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => (node.isFolder ? onToggle(node.path) : f && onOpen(f))}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            node.isFolder ? onToggle(node.path) : f && onOpen(f);
          }
        }}
        style={{ paddingLeft: depth * 16 + 4 }}
        className={cn(
          "group flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-1 text-sm transition-colors hover:bg-muted",
          f && deleting.has(f.path) && "pointer-events-none opacity-50",
          folderBusy && "pointer-events-none opacity-50",
        )}
      >
        {node.isFolder ? (
          <>
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                isOpen && "rotate-90",
              )}
            />
            <Folder className="size-4 shrink-0 text-primary" />
          </>
        ) : (
          <>
            <span className="w-3.5 shrink-0" />
            <Icon className="size-4 shrink-0 text-muted-foreground" />
          </>
        )}
        <span className="truncate">{node.name}</span>
        {f && (
          <span className="text-[10px] text-muted-foreground">{humanSize(f.size)}</span>
        )}
        {f ? (
          <RowMenu onDownload={download} onDelete={() => onDeleteFile(f.path)} busy={deleting.has(f.path)} />
        ) : (
          <RowMenu isFolder onDelete={() => onDeleteFolder(node)} busy={folderBusy} />
        )}
      </div>
      {node.isFolder &&
        isOpen &&
        node.children.map((c) => (
          <TreeRow
            key={c.path}
            node={c}
            depth={depth + 1}
            taskId={taskId}
            expanded={expanded}
            onToggle={onToggle}
            onOpen={onOpen}
            onDeleteFile={onDeleteFile}
            onDeleteFolder={onDeleteFolder}
            deleting={deleting}
          />
        ))}
    </>
  );
}

function InputsTree({
  files,
  taskId,
  onOpen,
  onDeleteFile,
  onDeleteFolder,
  deleting,
}: {
  files: SessionFile[];
  taskId: string;
  onOpen: (f: SessionFile) => void;
  onDeleteFile: (path: string) => void;
  onDeleteFolder: (node: TreeNode) => void;
  deleting: Set<string>;
}) {
  const root = React.useMemo(() => buildTree(files, "/inputs"), [files]);
  // Раскрытые папки. Верхний уровень виден всегда (рендерим детей root),
  // раскрываем/сворачиваем подпапки по клику.
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const toggle = React.useCallback(
    (path: string) =>
      setExpanded((s) => {
        const n = new Set(s);
        n.has(path) ? n.delete(path) : n.add(path);
        return n;
      }),
    [],
  );
  if (files.length === 0) return null;
  return (
    <div className="flex flex-col">
      {root.children.map((c) => (
        <TreeRow
          key={c.path}
          node={c}
          depth={0}
          taskId={taskId}
          expanded={expanded}
          onToggle={toggle}
          onOpen={onOpen}
          onDeleteFile={onDeleteFile}
          onDeleteFolder={onDeleteFolder}
          deleting={deleting}
        />
      ))}
    </div>
  );
}

// --- сетка артефактов ---------------------------------------------------------

const OUTPUTS_PER_PAGE = 8; // 2 ряда узких плиток; дальше — пагинация в заголовке

/** Пагинация в строке заголовка (справа) — как у «Прогонов». Так тело блока не
 *  расширяется под контролы и не прыгает по высоте при листании. */
function HeaderPager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (p: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => onPage(Math.max(0, page - 1))}
        disabled={page === 0}
        className="flex size-6 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span>{page + 1} / {pages}</span>
      <button
        type="button"
        onClick={() => onPage(Math.min(pages - 1, page + 1))}
        disabled={page >= pages - 1}
        className="flex size-6 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

/** Сетка артефактов из тех же карточек, что и в разделе «Файлы» (FileCard с меню
 *  Download/Delete). Страница управляется снаружи — пагинация живёт в заголовке
 *  блока (см. TaskFiles), поэтому здесь только сама сетка текущей страницы. */
function OutputsGrid({
  files,
  taskId,
  page,
  onOpen,
  onDelete,
  deleting,
}: {
  files: SessionFile[];
  taskId: string;
  page: number;
  onOpen: (f: SessionFile) => void;
  onDelete: (path: string) => void;
  deleting: Set<string>;
}) {
  const slice = files.slice(page * OUTPUTS_PER_PAGE, page * OUTPUTS_PER_PAGE + OUTPUTS_PER_PAGE);
  return (
    // 4 колонки на всю ширину блока (симметрично, без пустого хвоста справа).
    // Высоту держит dense-FileCard (превью фикс-высоты), поэтому карточки тянутся
    // в ширину, но не растут вверх — 2 ряда (8 плиток) влезают в высоту блока.
    <div className="grid grid-cols-4 gap-2">
      {slice.map((f) => (
        <FileCard
          key={f.path}
          file={f}
          href={taskFileRawUrl(taskId, f.path)}
          onOpen={() => onOpen(f)}
          onDelete={() => onDelete(f.path)}
          busy={deleting.has(f.path)}
          dense
        />
      ))}
    </div>
  );
}

// --- основной блок ------------------------------------------------------------

/**
 * Блок «Файлы» задачи, два блока рядом:
 *  - Вложения (/inputs) — вход пользователя: file tree с папками, добавить
 *    файлы/папки (drag-drop + выбор). Файл/папка → меню «⋮» (Download/Delete),
 *    удаление папки — с подтверждением. Клик по файлу → превью в попапе.
 *  - Артефакты (/outputs) — выход агента: карточки FileCard (как в «Файлах»),
 *    меню «⋮» (Download/Delete), клик → превью в попапе.
 * Превью переиспользует общий FileViewer (картинка/PDF/текст/word/markdown).
 */
export function TaskFiles({
  taskId,
  showOutputs = true,
}: {
  taskId: string;
  /** Показывать раздел «Артефакты». В форме СОЗДАНИЯ задачи его нет: артефакты —
   *  это результаты прогонов, у новой задачи их не существует. */
  showOutputs?: boolean;
}) {
  const t = useT();
  const rt = t.recurringTasks;
  const [inputs, setInputs] = React.useState<SessionFile[] | null>(null);
  const [outputs, setOutputs] = React.useState<SessionFile[] | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [deleting, setDeleting] = React.useState<Set<string>>(new Set());
  const [preview, setPreview] = React.useState<SessionFile | null>(null);
  // Папка, которую собираемся удалить (открыт попап подтверждения), либо null.
  const [folderToDelete, setFolderToDelete] = React.useState<TreeNode | null>(null);
  // Страница пагинации артефактов — держим здесь, чтобы контролы жили в строке
  // заголовка (как у «Прогонов»), а не в теле блока.
  const [outPage, setOutPage] = React.useState(0);
  const filesInputRef = React.useRef<HTMLInputElement>(null);
  const folderInputRef = React.useRef<HTMLInputElement>(null);

  // Число страниц артефактов + защита от «повисшей» страницы после удаления.
  const outPages = Math.max(1, Math.ceil((outputs?.length ?? 0) / OUTPUTS_PER_PAGE));
  React.useEffect(() => {
    if (outPage >= outPages) setOutPage(outPages - 1);
  }, [outPage, outPages]);

  const reload = React.useCallback(() => {
    listTaskFiles(taskId, "inputs").then(setInputs);
    listTaskFiles(taskId, "outputs").then(setOutputs);
  }, [taskId]);
  React.useEffect(reload, [reload]);

  const doUpload = React.useCallback(
    async (uploads: TaskUpload[]) => {
      if (uploads.length === 0) return;
      setUploading(true);
      try {
        await uploadTaskInputs(taskId, uploads);
        listTaskFiles(taskId, "inputs").then(setInputs);
      } catch {
        /* ошибка загрузки — список не меняем */
      } finally {
        setUploading(false);
      }
    },
    [taskId],
  );

  // Удаление файла(ов) задачи. scope определяем по пути (/outputs → артефакт),
  // чтобы оптимистично убрать из нужного списка и перечитать его при ошибке.
  const del = React.useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      const scope: "inputs" | "outputs" = paths[0].startsWith("/outputs")
        ? "outputs"
        : "inputs";
      const setList = scope === "outputs" ? setOutputs : setInputs;
      const gone = new Set(paths);
      setDeleting((s) => {
        const n = new Set(s);
        paths.forEach((p) => n.add(p));
        return n;
      });
      setList((prev) => (prev ? prev.filter((f) => !gone.has(f.path)) : prev));
      try {
        await deleteTaskFile(taskId, paths);
      } catch {
        listTaskFiles(taskId, scope).then(setList);
      } finally {
        setDeleting((s) => {
          const n = new Set(s);
          paths.forEach((p) => n.delete(p));
          return n;
        });
      }
    },
    [taskId],
  );

  const delOne = React.useCallback((path: string) => del([path]), [del]);
  const confirmDeleteFolder = React.useCallback(() => {
    if (folderToDelete) del(collectPaths(folderToDelete));
    setFolderToDelete(null);
  }, [folderToDelete, del]);

  return (
    // Две колонки — только когда рядом есть артефакты. Без них (форма создания)
    // вложения занимали бы половину ширины и пустовали.
    <div className={cn("grid grid-cols-1 gap-3", showOutputs && "md:grid-cols-2")}>
      {/* Вложения — заголовок СНАРУЖИ блока (как у Инструкции/Прогонов). */}
      <section className="flex flex-col gap-2">
        <div className="flex h-7 items-center gap-2">
          <h3 className="text-sm font-semibold">{rt.inputs}</h3>
          <div className="ml-auto mr-2.5 flex items-center gap-1 text-muted-foreground">
            <button
              type="button"
              onClick={() => filesInputRef.current?.click()}
              disabled={uploading}
              title={rt.addFiles}
              className="flex size-6 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <Upload className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              disabled={uploading}
              title={rt.addFolder}
              className="flex size-6 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <FolderUp className="size-4" />
            </button>
          </div>
        </div>

        <input
          ref={filesInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            doUpload(fromInput(e.target.files));
            e.target.value = "";
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          // @ts-expect-error нестандартные атрибуты выбора папки
          webkitdirectory=""
          directory=""
          className="hidden"
          onChange={(e) => {
            doUpload(fromInput(e.target.files));
            e.target.value = "";
          }}
        />

        {/* Тело блока (рамка + drag-drop). */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragOver(false);
            doUpload(await readDataTransfer(e.dataTransfer));
          }}
          className={cn(
            "h-[248px] overflow-y-auto rounded-xl border p-3 transition-colors",
            dragOver ? "border-primary/60 bg-primary/5" : "border-border",
          )}
        >
          {uploading ? (
            <div className="py-6 text-center text-xs text-muted-foreground">{rt.uploading}</div>
          ) : inputs === null ? (
            <div className="py-6 text-center text-xs text-muted-foreground">{t.files.loading}</div>
          ) : inputs.length === 0 ? (
            <EmptyState
              icon={<FolderUp />}
              title={rt.noInputs}
              description={rt.dropHere}
              action={
                <>
                  <button
                    type="button"
                    onClick={() => filesInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    <Upload className="size-3.5" /> {rt.addFiles}
                  </button>
                  <button
                    type="button"
                    onClick={() => folderInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    <FolderUp className="size-3.5" /> {rt.addFolder}
                  </button>
                </>
              }
            />
          ) : (
            <InputsTree
              files={inputs}
              taskId={taskId}
              onOpen={setPreview}
              onDeleteFile={delOne}
              onDeleteFolder={setFolderToDelete}
              deleting={deleting}
            />
          )}
        </div>
      </section>

      {/* Артефакты — заголовок СНАРУЖИ блока, пагинация справа в строке заголовка
          (как у «Прогонов»), чтобы тело не расширялось под контролы. */}
      {showOutputs && (
      <section className="flex flex-col gap-2">
        <div className="flex h-7 items-center gap-2">
          <h3 className="text-sm font-semibold">{rt.outputs}</h3>
          <HeaderPager page={outPage} pages={outPages} onPage={setOutPage} />
        </div>
        {/* Та же фикс-высота, что и у вложений — блоки не прыгают. */}
        <div className="h-[248px] overflow-y-auto rounded-xl border p-3">
          {outputs === null ? (
            <div className="py-6 text-center text-xs text-muted-foreground">{t.files.loading}</div>
          ) : outputs.length === 0 ? (
            <EmptyState
              icon={<FileText />}
              title={rt.noOutputs}
              description={rt.outputsHint}
            />
          ) : (
            <OutputsGrid
              files={outputs}
              taskId={taskId}
              page={outPage}
              onOpen={setPreview}
              onDelete={delOne}
              deleting={deleting}
            />
          )}
        </div>
      </section>
      )}

      {/* Превью файла в попапе. Свою шапку НЕ рисуем — заголовок и крестик даёт
          сам Modal; FileViewer несёт зум/переключатели. */}
      {preview && (
        <Modal
          open
          onClose={() => setPreview(null)}
          title={preview.name}
          className="max-w-3xl"
          headerActions={
            <a
              href={taskFileRawUrl(taskId, preview.path)}
              download={preview.name}
              title={t.files.download}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Download className="size-4" />
            </a>
          }
        >
          <div className="flex max-h-[72vh] min-h-[40vh] flex-col overflow-hidden">
            <FileViewer
              file={preview}
              threadId=""
              rawUrl={taskFileRawUrl(taskId, preview.path)}
            />
          </div>
        </Modal>
      )}

      {/* Подтверждение удаления папки целиком (в стиле приложения, не confirm). */}
      <Modal
        open={folderToDelete !== null}
        onClose={() => setFolderToDelete(null)}
        title={rt.deleteFolder}
      >
        <p className="text-sm text-muted-foreground">
          {folderToDelete
            ? rt.deleteFolderConfirm
                .replace("{name}", folderToDelete.name)
                .replace("{count}", String(collectPaths(folderToDelete).length))
            : ""}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setFolderToDelete(null)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {t.files.cancel}
          </button>
          <button
            type="button"
            onClick={confirmDeleteFolder}
            className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
          >
            {rt.deleteFolder}
          </button>
        </div>
      </Modal>
    </div>
  );
}
