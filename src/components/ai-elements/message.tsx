"use client";

import { Button } from "@/components/ui/button";
import {
  ButtonGroup,
  ButtonGroupText,
} from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
// KaTeX-стили: плагин @streamdown/math только генерит разметку (rehype-katex),
// но НЕ инжектит CSS — без него формулы рендерятся «голым» текстом без матшрифтов
// и раскладки. Импортируем стили один раз здесь (грузятся при первом ответе с
// формулой; модуль message.tsx и так нужен для рендера любого сообщения).
import "katex/dist/katex.min.css";
import type { UIMessage } from "ai";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type {
  ComponentProps,
  HTMLAttributes,
  ImgHTMLAttributes,
  ReactElement,
  ReactNode,
} from "react";
import {
  Children,
  createContext,
  isValidElement,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Streamdown } from "streamdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import type { PluggableList } from "unified";
import { rehypeSameOriginImages, responseSanitizeSchema } from "@/lib/response-html";
import { ChatImage } from "@/components/chat/chat-image";
import { FileChip, isImageFileName } from "@/components/chat/file-chip";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-[15px] leading-relaxed break-words",
      // Пользовательский пузырь — акцентным цветом темы (как прежний Bubble).
      // rounded-lg вместо rounded-2xl — под общий квадратный стиль (контролы
      // капсулы ввода тоже rounded-lg). Все углы РАВНЫЕ: смс-«хвостик»
      // (острый правый нижний) пробовали и убрали.
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-primary group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-primary-foreground",
      // Ответ ассистента занимает всю ширину колонки (а не w-fit по контенту):
      // иначе блоки внутри (chain-of-thought, окно аргументов тула) с w-full
      // растягивались лишь до ширины сжатого пузыря, а не области чата.
      "group-[.is-assistant]:w-full group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({
  className,
  children,
  ...props
}: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon-sm",
  ...props
}: MessageActionProps) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
};

interface MessageBranchContextType {
  currentBranch: number;
  totalBranches: number;
  goToPrevious: () => void;
  goToNext: () => void;
  branches: ReactElement[];
  setBranches: (branches: ReactElement[]) => void;
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(
  null
);

const useMessageBranch = () => {
  const context = useContext(MessageBranchContext);

  if (!context) {
    throw new Error(
      "MessageBranch components must be used within MessageBranch"
    );
  }

  return context;
};

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number;
  onBranchChange?: (branchIndex: number) => void;
};

export const MessageBranch = ({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps) => {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [branches, setBranches] = useState<ReactElement[]>([]);

  const handleBranchChange = useCallback(
    (newBranch: number) => {
      setCurrentBranch(newBranch);
      onBranchChange?.(newBranch);
    },
    [onBranchChange]
  );

  const goToPrevious = useCallback(() => {
    const newBranch =
      currentBranch > 0 ? currentBranch - 1 : branches.length - 1;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const goToNext = useCallback(() => {
    const newBranch =
      currentBranch < branches.length - 1 ? currentBranch + 1 : 0;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const contextValue = useMemo<MessageBranchContextType>(
    () => ({
      branches,
      currentBranch,
      goToNext,
      goToPrevious,
      setBranches,
      totalBranches: branches.length,
    }),
    [branches, currentBranch, goToNext, goToPrevious]
  );

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div
        className={cn("grid w-full gap-2 [&>div]:pb-0", className)}
        {...props}
      />
    </MessageBranchContext.Provider>
  );
};

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageBranchContent = ({
  children,
  ...props
}: MessageBranchContentProps) => {
  const { currentBranch, setBranches, branches } = useMessageBranch();
  const childrenArray = useMemo(
    () => (Array.isArray(children) ? children : [children]),
    [children]
  );

  // Use useEffect to update branches when they change
  useEffect(() => {
    if (branches.length !== childrenArray.length) {
      setBranches(childrenArray);
    }
  }, [childrenArray, branches, setBranches]);

  return childrenArray.map((branch, index) => (
    <div
      className={cn(
        "grid gap-2 overflow-hidden [&>div]:pb-0",
        index === currentBranch ? "block" : "hidden"
      )}
      key={branch.key}
      {...props}
    >
      {branch}
    </div>
  ));
};

export type MessageBranchSelectorProps = ComponentProps<typeof ButtonGroup>;

export const MessageBranchSelector = ({
  className,
  ...props
}: MessageBranchSelectorProps) => {
  const { totalBranches } = useMessageBranch();

  // Don't render if there's only one branch
  if (totalBranches <= 1) {
    return null;
  }

  return (
    <ButtonGroup
      className={cn(
        "[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md",
        className
      )}
      orientation="horizontal"
      {...props}
    />
  );
};

export type MessageBranchPreviousProps = ComponentProps<typeof Button>;

export const MessageBranchPrevious = ({
  children,
  ...props
}: MessageBranchPreviousProps) => {
  const { goToPrevious, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Previous branch"
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeftIcon size={14} />}
    </Button>
  );
};

export type MessageBranchNextProps = ComponentProps<typeof Button>;

export const MessageBranchNext = ({
  children,
  ...props
}: MessageBranchNextProps) => {
  const { goToNext, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Next branch"
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRightIcon size={14} />}
    </Button>
  );
};

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>;

export const MessageBranchPage = ({
  className,
  ...props
}: MessageBranchPageProps) => {
  const { currentBranch, totalBranches } = useMessageBranch();

  return (
    <ButtonGroupText
      className={cn(
        "border-none bg-transparent text-muted-foreground shadow-none",
        className
      )}
      {...props}
    >
      {currentBranch + 1} of {totalBranches}
    </ButtonGroupText>
  );
};

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

// singleDollarTextMath: false — НЕ трактовать одиночные `$...$` как инлайн-
// математику. Ассистент общего назначения постоянно пишет валюту и числа через
// доллар ("$206 тыс.", "$5"), и при true KaTeX хватал всё между двумя `$` за
// формулу: ломал кириллицу внутри \text{} (→ «206тысячтысяч», «говсяосянёщ») и
// съедал текст между долларами. Денег/долларов в чате кратно больше, чем
// настоящих инлайн-формул, поэтому доллары оставляем тексту. Блочная математика
// `$$...$$` и `\[...\]` продолжает рендериться KaTeX.
const math = createMathPlugin({ singleDollarTextMath: false });

const streamdownPlugins = { cjk, code, math, mermaid };

/**
 * Свой список rehype-плагинов — он ЗАМЕЩАЕТ дефолтный, а вместе с ним и
 * `rehype-harden`, который Streamdown подключает по умолчанию.
 *
 * Harden держит `file:` в жёстко зашитом чёрном списке (`blockedProtocols`) и
 * подменяет такую ссылку заглушкой «[blocked]». Настройками это не снимается:
 * ни `allowedProtocols`, ни `allowedLinkPrefixes` на него не влияют. А модель
 * пишет файлы песочницы именно так — `[отчёт](file:///outputs/report.pdf)`,
 * нахватавшись из скиллов pdf/pptx, — и вместо карточки файла в ленте моргала
 * заглушка: harden срабатывает РАНЬШЕ, чем react-markdown зовёт urlTransform.
 *
 * Без harden ссылка доходит до `urlTransform` в исходном виде, и схему снимаем
 * там — в одном месте, вместо правки текста до парсинга.
 *
 * Вместе с harden свой список выкидывал и `rehype-sanitize` — и с 30.09 по
 * 01.10 инлайновый HTML из ответов шёл в DOM без фильтра (iframe, form,
 * картинки с чужих хостов). Возвращаем очистку своей схемой (lib/response-html:
 * дефолт GitHub + `file:` в ссылках + классы формул) и свой шаг для картинок
 * вместо harden: чужие хосты становятся ссылками, не загрузками.
 *
 * `rehype-raw` оставляем — на нём держится инлайновый HTML в ответах. Порядок
 * важен: raw → sanitize → картинки; KaTeX и Mermaid Streamdown дописывает
 * ПОСЛЕ этого списка, их разметку очистка не трогает.
 */
const streamdownRehypePlugins: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, responseSanitizeSchema],
  rehypeSameOriginImages,
];

// Плавное появление приходящих токенов. Своя «печатная машинка» тут не нужна и
// была бы вредна: токены и так идут по одному живым потоком, а имитация набора
// добавила бы задержку поверх реальной скорости. Анимируем ПОЯВЛЕНИЕ слов —
// уже отрисованный текст не переанимируется (плагин помнит длину прошлого
// рендера). Пословно, а не посимвольно: на кириллице посимвольная анимация
// заметно дёргает строку при переносах.
const ANIMATE = {
  animation: "fadeIn" as const,
  sep: "word" as const,
  // duration — сколько проявляется ОДНО слово; stagger — сдвиг между соседними.
  //
  // stagger=0 намеренно. Сдвиг НАКАПЛИВАЕТСЯ по всей порции: при 45 мс и 60
  // новых словах хвост ждёт 2.7 с. Порции приходят чаще, чем досчитывается
  // очередь, поэтому конец предыдущей ещё проявлялся, когда начинала следующая
  // — текст «убегал вперёд» и вспыхивал кусками. Без сдвига каждая порция
  // проявляется целиком и ровно; плавность даёт duration, а очерёдность —
  // сам поток токенов.
  duration: 420,
  easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
  stagger: 0,
};

/**
 * Вставить пустую строку перед списком, который начинается сразу после абзаца.
 *
 * По CommonMark список обязан отделяться от предыдущего абзаца пустой строкой,
 * иначе `1. пункт` — это просто продолжение того же абзаца. Модель пишет
 * по-человечески:
 *
 *     **5 главных новостей:**
 *     1. Паспорт ОАЭ занял 2-е место
 *
 * и список разваливался: номер отдельно, содержимое отдельной строкой, отступы
 * не работали. Это не особенность Streamdown — так же сломается любой
 * CommonMark-парсер, поэтому чиним текст ДО парсинга, а не меняем библиотеку.
 *
 * Содержимое ``` fenced-блоков не трогаем: там `- ` и `1. ` — обычный текст.
 */
function normalizeLists(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inFence = false;
  const isItem = (s: string) => /^\s{0,3}(?:[-*+]\s|\d{1,9}[.)]\s)/.test(s);
  for (const line of lines) {
    if (/^\s{0,3}(?:```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence) {
      const prev = out[out.length - 1];
      if (isItem(line) && prev !== undefined && prev.trim() !== "" && !isItem(prev)) {
        out.push("");
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Does this markdown-paragraph child force the wrapping `<p>` to be dropped,
 * because it renders (or can render) a `<div>` — which is invalid inside `<p>`
 * and triggers a hydration error?
 *
 * Two cases:
 *  - IMAGES. Streamdown wraps images in a `<div data-streamdown="image-wrapper">`,
 *    invalid inside `<p>` when the model writes an image inline with text
 *    (`**Слайд 1** ![...](...)`). Detected via a native `<img>`/`<div>`, or
 *    Streamdown's image component (a non-string type carrying a `src` prop).
 *  - LINKS. Streamdown's link component mounts a "link safety" modal — a
 *    `<div className="fixed inset-…">` overlay — as a child of the `<a>` when the
 *    user clicks it. That `<div>` then sits inside the paragraph's `<p>` and
 *    crashes hydration. Detected via a native `<a>`, or a non-string component
 *    carrying an `href` prop.
 *
 * IMPORTANT: do NOT treat every non-string type as block. Streamdown renders
 * inline formatters (`**bold**`, `*em*`, `` `code` ``) as custom COMPONENTS too;
 * a previous version stripped the `<p>` from every such paragraph and collapsed
 * adjacent paragraphs into one run. Inline formatters carry neither `src` nor
 * `href`, so they stay inside the `<p>`.
 */
const isBlockChild = (child: ReactNode): boolean => {
  if (!isValidElement(child)) return false;
  if (child.type === "img" || child.type === "div" || child.type === "a") {
    return true;
  }
  const props = child.props as { src?: unknown; href?: unknown } | null;
  return (
    typeof child.type !== "string" &&
    (props?.src != null || props?.href != null)
  );
};

/**
 * Paragraph override: if a paragraph contains a child that renders (or can
 * render) a `<div>` — an image wrapper, or a link whose safety modal mounts a
 * fixed overlay — render its children WITHOUT the `<p>` so we never nest a
 * `<div>` inside a `<p>`. Plain text paragraphs keep their `<p>`.
 */
const ParagraphOrFragment = ({
  children,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) => {
  const hasBlock = Children.toArray(children).some(isBlockChild);
  // Есть блок-ребёнок (картинка/ссылка) → нельзя <p> (div внутри p ломает
  // гидрацию). Оборачиваем в <div>, а НЕ во Fragment: Fragment сливал текст
  // параграфа в inline-поток с соседями (заголовок после картинки прилипал к
  // предыдущему абзацу). <div> — блочный контейнер: картинка остаётся блоком,
  // текстовые куски держат свои строки.
  return hasBlock ? (
    <div {...props}>{children}</div>
  ) : (
    <p {...props}>{children}</p>
  );
};

/**
 * Ссылка на файл сессии (после urlTransform это `…/files/raw?path=<path>`)
 * рендерится плашкой FileChip с кнопками «Открыть/Скачать» вместо «голой» ссылки,
 * которую браузер пытался бы открыть (txt/json открывались как страница).
 * Возвращает {path, name} по такому href — или null, если это обычная ссылка.
 */
function sessionFileFromHref(href: string): { path: string; name: string } | null {
  if (!href || !href.includes("/files/raw?")) return null;
  try {
    const qs = href.slice(href.indexOf("?") + 1);
    const path = new URLSearchParams(qs).get("path");
    if (!path) return null;
    const name = path.split("/").pop() || path;
    return { path, name };
  } catch {
    return null;
  }
}

const LinkOrFile = ({
  href,
  children,
  ...props
}: HTMLAttributes<HTMLAnchorElement> & { href?: string }) => {
  const file = href ? sessionFileFromHref(href) : null;
  if (file) return <FileChip path={file.path} name={file.name} />;
  return (
    <a href={href} target="_blank" rel="noreferrer" {...props}>
      {children}
    </a>
  );
};

/**
 * `![…](/outputs/report.pdf)` — модель вставила НЕ картинку синтаксисом
 * картинки (промпт просит ссылку, но случается). `<img>` такое не покажет:
 * в ленте оставалась пустая рамка на высоту превью. Файл сессии с
 * не-картиночным расширением отдаём той же плашке, что и ссылка; настоящие
 * картинки — как прежде, ChatImage.
 */
const ImageOrFile = (props: ImgHTMLAttributes<HTMLImageElement>) => {
  const src = typeof props.src === "string" ? props.src : "";
  const file = src ? sessionFileFromHref(src) : null;
  if (file && !isImageFileName(file.name)) {
    return <FileChip path={file.path} name={file.name} />;
  }
  return <ChatImage {...props} />;
};

/** Рендерит ли этот ребёнок файловую плашку? (наш `a` с href на файл сессии). */
const isFileChipChild = (child: ReactNode): boolean => {
  if (!isValidElement(child)) return false;
  const props = child.props as { href?: string } | null;
  return typeof props?.href === "string" && sessionFileFromHref(props.href) != null;
};

/**
 * `<li>` с файловой плашкой — без маркера-буллита: агент пишет
 * `- [файл](/outputs/файл) — описание`, а рядом с крупной карточкой FileChip
 * кружок-буллит висит некрасиво и сбивает выравнивание. Обычные пункты списка
 * не трогаем.
 *
 * Проверяем «есть плашка», а не «пункт состоит только из неё»: описание в том
 * же пункте — обычный случай, и раньше такой пункт буллит сохранял.
 */
const ListItem = ({ children, ...props }: HTMLAttributes<HTMLLIElement>) => {
  const kids = Children.toArray(children).filter(
    (c) => typeof c !== "string" || c.trim() !== "",
  );
  const hasFileChip = kids.some(isFileChipChild);
  return (
    <li
      {...props}
      className={cn(
        props.className,
        hasFileChip && "list-none ml-0",
        // «Loose» список (пункты разделены пустой строкой — а так пишет модель)
        // оборачивает содержимое пункта в <p>. Блочный <p> уезжает НА СЛЕДУЮЩУЮ
        // СТРОКУ, и маркер висит один:
        //   •
        //   Яблоки
        // Схлопываем ПЕРВЫЙ параграф в инлайн — текст остаётся рядом с маркером.
        // Только первый: если в пункте несколько абзацев, остальные должны
        // остаться блоками, иначе слиплись бы в одну строку.
        "[&>p:first-child]:inline [&>p:first-child]:m-0",
      )}
    >
      {children}
    </li>
  );
};

// Картинки в ответе ассистента рендерим через ChatImage: компактное превью
// фиксированной высоты (место зарезервировано → нет «прыжков» при догрузке) +
// раскрытие в полноэкранный лайтбокс по клику + ленивая загрузка ради памяти.
// Ссылки — LinkOrFile: файловые превращаются в плашку FileChip. li — ListItem:
// пункт с одной файловой плашкой рендерится без буллита. img — ImageOrFile:
// не-картинка под синтаксисом картинки тоже уходит в плашку.
const streamdownComponents = {
  p: ParagraphOrFragment,
  img: ImageOrFile,
  a: LinkOrFile,
  li: ListItem,
};

/**
 * Схемы, разрешённые в ссылках по умолчанию. Всё прочее (`vbscript:`,
 * `data:` в href и т.п.) отсекаем: этим занимался `rehype-harden`, который мы
 * отключили — он же ломал ссылки на файлы песочницы. `javascript:` глушит и
 * сам React, но полагаться на одну защиту не стоит.
 *
 * Относительные пути и якоря не трогаем: у них схемы нет.
 */
const SAFE_SCHEME = /^(?:https?|mailto|tel|blob):/i;
/** Есть ли у ссылки вообще схема (`что-то:`). Пути и якоря — без неё. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Отсев схем для вызовов БЕЗ своего urlTransform (файловые панели, сводки). */
function defaultUrlTransform(url: string): string | null {
  if (!url) return url;
  if (!HAS_SCHEME.test(url)) return url; // относительный путь или #якорь
  return SAFE_SCHEME.test(url) ? url : null;
}

export const MessageResponse = memo(
  ({ className, children, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
      components={streamdownComponents}
      plugins={streamdownPlugins}
      rehypePlugins={streamdownRehypePlugins}
      urlTransform={defaultUrlTransform}
      animated={ANIMATE}
      {...props}
    >
      {typeof children === "string"
        ? normalizeLists(children)
        : children}
    </Streamdown>
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating
);

MessageResponse.displayName = "MessageResponse";

export type MessageToolbarProps = ComponentProps<"div">;

export const MessageToolbar = ({
  className,
  children,
  ...props
}: MessageToolbarProps) => (
  <div
    className={cn(
      "mt-4 flex w-full items-center justify-between gap-4",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
