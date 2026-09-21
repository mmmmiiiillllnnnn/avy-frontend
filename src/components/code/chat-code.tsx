"use client";

// Контейнер вкладки Avy Code: лента диалога + permission-карточка + code-инпут.
// Вынесено из общего chat.tsx — code-режим больше не делит контейнер с чатом
// (chat.tsx остаётся чисто чатовым, без staticLayout-ветвлений → чистые мерджи).
//
// Рендер сообщений через CodeMessageRow (изолирован от chat.tsx). Здесь — только
// code-компоновка: статичная (инпут зафиксирован), лента на всю ширину,
// code-инпут с permission/model дропдаунами.

import { useEffect, useRef } from "react";
import { Code2 } from "lucide-react";
import { useT } from "@/i18n/i18n-context";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { CodeMessageRow } from "@/components/code/code-message-row";
import { PermissionCard } from "@/components/code/permission-card";
import { QuestionCard } from "@/components/code/question-card";
import { ChatCodeInput } from "@/components/code/chat-code-input";
import type { EffortLevel } from "@/components/ui/ai-chat-input";
import type { PermissionMode, ModelId } from "@/components/code/chat-code-input";
import type { ChatMessage, PendingPermission, PendingQuestions } from "@/lib/code/code-chat-streams";
import type { AskUserAnswer } from "@/lib/api";

type ChatCodeProps = {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  onSend: (text: string, files: File[]) => void;
  onStop: () => void;
  contextUsage?: { used_tokens: number; max_tokens: number } | null;
  compacting?: boolean;
  onCompact?: () => void;
  onCancelCompact?: () => void;
  threadId: string;
  effort: EffortLevel;
  onEffortChange?: (effort: EffortLevel) => void;
  permissionMode?: PermissionMode;
  onPermissionModeChange?: (m: PermissionMode) => void;
  model?: ModelId;
  onModelChange?: (m: ModelId) => void;
  pendingPermission?: PendingPermission | null;
  onPermissionDecision?: (d: "approve" | "reject", comment?: string) => void;
  permissionBusy?: boolean;
  pendingQueueSize?: number;
  pendingQuestions?: PendingQuestions | null;
  onQuestionsSubmit?: (answers: AskUserAnswer[]) => void;
  onQuestionsDismiss?: () => void;
  questionsBusy?: boolean;
  onOpenFile?: (path: string, searchText?: string, highlightLines?: { start: number; end?: number }) => void;
  /** Открыть файл проектной памяти (плашка remember). Отдельно от onOpenFile:
   *  память лежит вне workspace и читается своим каналом (readMemoryFile). */
  onOpenMemory?: (path: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
};

/**
 * Лента Avy Code + инпут. Контролируемый компонент (состояние приходит сверху из
 * ChatWorkspace). В отличие от обычного чата компоновка статична: пустого
 * «приветственного» состояния нет (вкладка сразу рабочая), инпут зафиксирован
 * внизу плавающим слоем, лента — на всю ширину панели.
 */
export function ChatCode({
  messages,
  isStreaming,
  error,
  onSend,
  onStop,
  contextUsage,
  compacting,
  onCompact,
  onCancelCompact,
  threadId,
  effort,
  onEffortChange,
  permissionMode,
  onPermissionModeChange,
  model,
  onModelChange,
  pendingPermission,
  onPermissionDecision,
  permissionBusy,
  pendingQueueSize,
  pendingQuestions,
  onQuestionsSubmit,
  onQuestionsDismiss,
  questionsBusy,
  onOpenFile,
  onOpenMemory,
  onLoadMore,
  hasMore = false,
}: ChatCodeProps) {
  // Sentinel для подгрузки предыдущих сообщений (scroll вверх).
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isLoadingMore = useRef(false);

  useEffect(() => {
    if (!sentinelRef.current || !hasMore || !onLoadMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isLoadingMore.current) {
          isLoadingMore.current = true;
          onLoadMore();
          setTimeout(() => { isLoadingMore.current = false; }, 200);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  return (
    <div
      id="chat-area"
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden text-[13px]"
    >
      {/* Пустой экран: пока диалога нет — заманивающее интро про Avy Code.
          Показываем только когда лента пуста и ничего не стримится. */}
      {messages.length === 0 && !isStreaming ? (
        <CodeEmptyState />
      ) : (
        <Conversation key={threadId} className="min-h-0 flex-1">
          <ConversationContent className="mx-auto w-full max-w-full px-4">
            {hasMore && <div ref={sentinelRef} className="h-px" />}
            {messages.map((m, idx) => (
              <CodeMessageRow
                key={m.id}
                m={m}
                running={isStreaming && idx === messages.length - 1}
                threadId={threadId}
                onOpenFile={onOpenFile}
                onOpenMemory={onOpenMemory}
              />
            ))}
            {/* Safe area: запас под плавающим инпутом, чтобы последнее сообщение
                проскроллилось выше его края (инпут прозрачный, накладывается). */}
            <div aria-hidden className="h-36 shrink-0" />
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      {/* Инпут плавает над лентой: прижат к низу, сверху градиент-фейд из фона. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background via-background/80 to-transparent px-4 pb-4 pt-8">
        {pendingPermission && onPermissionDecision && (
          <div className="pointer-events-auto mx-auto w-full max-w-none">
            <PermissionCard
              pending={pendingPermission}
              onDecision={onPermissionDecision}
              busy={permissionBusy}
              queueSize={pendingQueueSize}
            />
          </div>
        )}
        {pendingQuestions && onQuestionsSubmit && (
          <div className="pointer-events-auto mx-auto w-full max-w-none">
            <QuestionCard
              pending={pendingQuestions}
              onSubmit={onQuestionsSubmit}
              onDismiss={onQuestionsDismiss}
              busy={questionsBusy}
            />
          </div>
        )}
        <div className="pointer-events-auto mx-auto w-full max-w-none">
          <ChatCodeInput
            onSend={onSend}
            streaming={isStreaming}
            onStop={onStop}
            escStopBlocked={!!pendingPermission || !!pendingQuestions}
            contextUsage={contextUsage}
            compacting={compacting}
            onCompact={onCompact}
            onCancelCompact={onCancelCompact}
            effort={effort}
            onEffortChange={onEffortChange}
            hideDeepSearch
            permissionMode={permissionMode}
            onPermissionModeChange={onPermissionModeChange}
            model={model}
            onModelChange={onModelChange}
            codeMode
          />
          {error && <p className="mt-2 px-2 text-sm text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * Пустой экран Avy Code — минимальное интро, пока диалога нет: иконка-логотип,
 * «Avy Code» и приглашение. Занимает область ленты (инпут плавает поверх снизу).
 */
function CodeEmptyState() {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6">
      <div className="mx-auto flex w-full max-w-md flex-col items-center pb-40 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <Code2 className="size-7" />
        </div>
        <h2 className="mt-5 text-lg font-semibold tracking-tight text-foreground">
          {t.code.emptyTitle}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.code.emptyTagline}
        </p>
      </div>
    </div>
  );
}
