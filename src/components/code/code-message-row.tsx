"use client";

// Рендер одного сообщения во вкладке Avy Code. Изолирован от chat.tsx, чтобы
// code-режим и обычный чат не делили файл рендера (чистые мерджи с pre-prod).
//
// User-сообщения: текст + вложения (chips). Assistant-сообщения: AssistantBubbleCode.

import { memo, useMemo } from "react";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { AttachmentChip } from "@/components/chat/attachment-chip";
import { AssistantBubbleCode } from "@/components/code/chat-code-bubble";
import { ContextSummary } from "@/components/code/context-summary";
import { sessionFileRawUrl } from "@/lib/api";
import type { ChatMessage } from "@/hooks/use-code-chat";
import {
  PASTED_TEXT_MARKER,
  PASTED_TEXT_MARKER_END,
  pastePreview,
} from "@/lib/code/code-chat-streams";

/** Извлечь вложения из user-сообщения (явное поле + парсинг текста). */
function extractUserAttachments(m: ChatMessage) {
  const attachments = m.attachments ?? [];
  let text = m.content;
  // История из чекпойнтера: блок "Прикреплённые файлы:" в тексте.
  const filesBlock = "\n\nПрикреплённые файлы:\n";
  const idx = text.indexOf(filesBlock);
  if (idx >= 0) {
    text = text.slice(0, idx);
  }
  return { text, attachments };
}

/** Вырезать вставленные текстовые блоки (PASTED_TEXT_MARKER). */
function extractPastedTexts(text: string) {
  const pasted: string[] = [];
  let cleaned = text;
  while (true) {
    const start = cleaned.indexOf(PASTED_TEXT_MARKER);
    if (start < 0) break;
    const end = cleaned.indexOf(PASTED_TEXT_MARKER_END, start);
    if (end < 0) break;
    pasted.push(
      cleaned.slice(start + PASTED_TEXT_MARKER.length, end).trim(),
    );
    cleaned = cleaned.slice(0, start) + cleaned.slice(end + PASTED_TEXT_MARKER_END.length);
  }
  return { text: cleaned.trim(), pasted };
}

function makeFileUrlTransform(threadId: string) {
  return (url: string): string | null => {
    if (!url) return url;
    if (/^(https?:|data:|blob:|mailto:|#)/i.test(url)) return url;
    // `file:///outputs/x` — та же ссылка на файл песочницы, только со схемой:
    // так их пишет модель, нахватавшись из скиллов pdf/pptx.
    const path = url.replace(/^file:\/\//i, "");
    if (threadId && path.startsWith("/") && !path.startsWith("//")) {
      return sessionFileRawUrl(threadId, path);
    }
    // Прочие схемы обрубаем: rehype-harden, который их резал, отключён в
    // MessageResponse (он же ломал ссылки на файлы), и отсев теперь здесь.
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
    return url;
  };
}

type CodeMessageRowProps = {
  m: ChatMessage;
  running: boolean;
  threadId: string;
  onOpenFile?: (
    path: string,
    searchText?: string,
    highlightLines?: { start: number; end?: number },
  ) => void;
  /** Открыть файл проектной памяти (плашка remember) — свой канал чтения. */
  onOpenMemory?: (path: string) => void;
};

function CodeMessageRowInner({
  m,
  running,
  threadId,
  onOpenFile,
  onOpenMemory,
}: CodeMessageRowProps) {
  const urlTransform = useMemo(
    () => makeFileUrlTransform(threadId),
    [threadId],
  );

  // Служебная строка сжатия контекста — свой свёрнутый блок, не реплика.
  if (m.role === "summary") {
    return <ContextSummary text={m.content} tokens={m.tokens} />;
  }

  if (m.role !== "assistant") {
    const raw = extractUserAttachments(m);
    const { text, pasted } = extractPastedTexts(raw.text);
    const attachments = raw.attachments;
    return (
      // Сюда доходит только реплика человека (summary разобран выше, report в
      // ленте кодера не бывает) — литерал, а не m.role: Role шире, чем `from`.
      <Message from="user">
        {(attachments.length > 0 || pasted.length > 0) && (
          <div className="flex flex-wrap justify-end gap-2">
            {pasted.map((t, i) => (
              <AttachmentChip
                key={`pasted-${i}`}
                name={`Вставленный текст ${pasted.length > 1 ? i + 1 : ""}`.trim()}
                mime="text/plain"
                preview={pastePreview(t)}
              />
            ))}
            {attachments.map((a, idx) => (
              <AttachmentChip
                key={`${a.path}-${idx}`}
                name={a.name}
                mime={a.mime}
                thumbUrl={a.thumbUrl ?? (a.mime.startsWith("image/") ? sessionFileRawUrl(threadId, a.path) : undefined)}
              />
            ))}
          </div>
        )}
        <MessageContent>{text}</MessageContent>
      </Message>
    );
  }

  return (
    <Message from={m.role}>
      <MessageContent>
        <AssistantBubbleCode
          parts={m.parts ?? []}
          running={running}
          threadId={threadId}
          urlTransform={urlTransform}
          onOpenFile={onOpenFile}
          onOpenMemory={onOpenMemory}
        />
      </MessageContent>
    </Message>
  );
}

/**
 * Мемоизация ряда — ключевое для отзывчивости ДЛИННОЙ сессии. Стор (chat-streams)
 * на каждый токен стрима отдаёт НОВЫЙ массив messages, но ссылку на КАЖДОЕ
 * неизменившееся сообщение сохраняет (map возвращает тот же объект для m.id !==
 * assistantId). Без memo React перерисовывал бы все сотни завершённых рядов
 * (с тяжёлым markdown-парсингом) на каждый тик стрима — отсюда лаги. С memo
 * ре-рендерится только текущий стримящийся ряд (у него меняется ссылка m и/или
 * running); остальные пропускаются по сравнению пропсов. onOpenFile стабилен
 * (useCallback выше по дереву) — включаем в сравнение на случай его смены.
 */
export const CodeMessageRow = memo(
  CodeMessageRowInner,
  (prev, next) =>
    prev.m === next.m &&
    prev.running === next.running &&
    prev.threadId === next.threadId &&
    prev.onOpenFile === next.onOpenFile &&
    prev.onOpenMemory === next.onOpenMemory,
);
