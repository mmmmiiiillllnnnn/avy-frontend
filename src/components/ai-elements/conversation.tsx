"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UIMessage } from "ai";
import { ArrowDownIcon, DownloadIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useRef } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-hidden scroll-hover-visible", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("flex flex-col gap-8 p-4 overflow-x-hidden", className)}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
      <Button
        className={cn(
          "absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full dark:bg-background dark:hover:bg-muted",
          className
        )}
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};

/**
 * При отправке НОВОГО сообщения пользователя подскроллить ленту так, чтобы это
 * сообщение встало к ВЕРХУ видимой области (как в ChatGPT/Claude) — освобождая
 * место под ответ, который будет стримиться ниже. Без этого StickToBottom держит
 * низ, и свежий вопрос остаётся прижатым к инпуту.
 *
 * Триггер — рост числа сообщений пользователя (а не ассистента): срабатывает
 * ровно на отправку, не на каждый стрим-кадр ответа. Скроллим scrollRef
 * (контейнер, которым управляет StickToBottom) к offsetTop узла, помеченного
 * [data-last-user]. Рендерится ВНУТРИ Conversation — иначе нет доступа к контексту.
 */
export const ConversationScrollOnSend = ({
  userMessageCount,
}: {
  userMessageCount: number;
}) => {
  const { scrollRef, contentRef } = useStickToBottomContext();
  const prev = useRef(userMessageCount);

  useEffect(() => {
    if (userMessageCount <= prev.current) {
      prev.current = userMessageCount;
      return;
    }
    prev.current = userMessageCount;

    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;

    // Ставим последнее сообщение пользователя к ВЕРХУ вьюпорта, освобождая
    // место под ответ ниже. Скроллим в НЕСКОЛЬКО кадров: StickToBottom при
    // первом кадре стрима ответа норовит вернуть низ — повторяем установку
    // (rAF + два setTimeout), пока он не устаканится.
    let cancelled = false;
    const place = () => {
      if (cancelled) return;
      const node = content.querySelector<HTMLElement>("[data-last-user]");
      if (!node) return;
      const delta =
        node.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const top = scroller.scrollTop + delta - 12; // лёгкий отступ сверху
      scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    };
    // Несколько попыток: сразу после монтирования ряда и пару раз спустя —
    // перебивая возможный «возврат к низу» от StickToBottom на старте ответа.
    const t0 = requestAnimationFrame(() => requestAnimationFrame(place));
    const t1 = setTimeout(place, 120);
    const t2 = setTimeout(place, 320);
    return () => {
      cancelled = true;
      cancelAnimationFrame(t0);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [userMessageCount, scrollRef, contentRef]);

  return null;
};

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

export type ConversationDownloadProps = Omit<
  ComponentProps<typeof Button>,
  "onClick"
> & {
  messages: UIMessage[];
  filename?: string;
  formatMessage?: (message: UIMessage, index: number) => string;
};

const defaultFormatMessage = (message: UIMessage): string => {
  const roleLabel =
    message.role.charAt(0).toUpperCase() + message.role.slice(1);
  return `**${roleLabel}:** ${getMessageText(message)}`;
};

export const messagesToMarkdown = (
  messages: UIMessage[],
  formatMessage: (
    message: UIMessage,
    index: number
  ) => string = defaultFormatMessage
): string => messages.map((msg, i) => formatMessage(msg, i)).join("\n\n");

export const ConversationDownload = ({
  messages,
  filename = "conversation.md",
  formatMessage = defaultFormatMessage,
  className,
  children,
  ...props
}: ConversationDownloadProps) => {
  const handleDownload = useCallback(() => {
    const markdown = messagesToMarkdown(messages, formatMessage);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [messages, filename, formatMessage]);

  return (
    <Button
      className={cn(
        "absolute top-4 right-4 rounded-full dark:bg-background dark:hover:bg-muted",
        className
      )}
      onClick={handleDownload}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      {children ?? <DownloadIcon className="size-4" />}
    </Button>
  );
};
