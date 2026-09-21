"use client";

import { memo, useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Mic, Search, Paperclip, Send, CircleStop, Upload, Loader2, Brain, ChevronDown, Check, ShieldCheck, Bot } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { AttachmentChip } from "@/components/chat/attachment-chip";
import { ContextMeter } from "@/components/chat/context-meter";
import {
  PASTED_TEXT_MARKER,
  PASTED_TEXT_MARKER_END,
  pastePreview,
} from "@/lib/code/code-chat-streams";
import { useT } from "@/i18n/i18n-context";

// Лимит размера одного файла на клиенте (сервер дублирует проверку). 25 МБ.
const MAX_FILE_BYTES = 25 * 1024 * 1024;

// Порог вставки: текст длиннее — превращаем в чип-вложение (как ChatGPT), чтобы
// не забивать инпут портянкой. Модель всё равно получит его как обычный текст.
const PASTE_AS_ATTACHMENT_CHARS = 1500;

// Выбранный (ещё не отправленный) файл + objectURL мини-превью для картинок.
// url создаётся при добавлении файла и освобождается при удалении/отправке.
type Attachment = { file: File; url?: string };

const PLACEHOLDERS = [
  "Создай PDF-документ",
  "Проанализируй данные",
  "Напиши и запусти скрипт",
  "Сделай отчёт по таблице",
  "Сгенерируй спецификацию",
];

export type EffortLevel = "low" | "medium" | "high" | "max";

const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
};

const EFFORT_ORDER: EffortLevel[] = ["low", "medium", "high", "max"];

// Режим подтверждений Avy Code (как Ask / Auto-accept / Plan у Claude Code).
export type PermissionMode = "ask" | "accept-edits" | "plan";

const PERMISSION_LABELS: Record<PermissionMode, string> = {
  ask: "Спрашивать",
  "accept-edits": "Авто-правки",
  plan: "План",
};

const PERMISSION_HINTS: Record<PermissionMode, string> = {
  ask: "Подтверждать каждое изменение файлов и команды",
  "accept-edits": "Править файлы без спроса, команды подтверждать",
  plan: "Только исследование — все изменения отклоняются",
};

const PERMISSION_ORDER: PermissionMode[] = ["ask", "accept-edits", "plan"];

// Модели для кодингового режима. Показываем РЕАЛЬНЫЕ имена моделей, а не
// продуктовые псевдонимы: в кодере важно видеть, чем именно идёт ход —
// модели различаются ценой и глубиной thinking, и выбор осознанный.
//
// qwen3.8-max, а не 3.7: тяжёлая модель выровнена с основным чатом
// (ai-chat-input.tsx) — держать в двух режимах разные поколения одной и той
// же роли незачем.
export type ModelId =
  | "kimi-k3"
  | "kimi-k2.7-code"
  | "qwen3.7-plus"
  | "qwen3.8-max"
  | "qwen3.5-397b-a17b";

const MODEL_LABELS: Record<ModelId, string> = {
  "kimi-k3": "Kimi K3",
  "kimi-k2.7-code": "Kimi K2.7 Code",
  "qwen3.7-plus": "Qwen3.7 Plus",
  "qwen3.8-max": "Qwen3.8 Max",
  "qwen3.5-397b-a17b": "Qwen3.5 397B",
};

// Kimi K2.7 Code остаётся дефолтом (заточена под кодинг), K3 — рядом первой
// в списке как более сильная универсальная.
const MODEL_ORDER: ModelId[] = [
  "kimi-k3",
  "kimi-k2.7-code",
  "qwen3.7-plus",
  "qwen3.8-max",
  "qwen3.5-397b-a17b",
];

function ModelDropdown({
  model,
  onModelChange,
}: {
  model: ModelId;
  onModelChange?: (m: ModelId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.top - 4, left: r.left });
    setOpen((v) => !v);
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onMouseDown={handleOpen}
        className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
      >
        <Bot size={14} className="shrink-0" />
        {MODEL_LABELS[model]}
        <ChevronDown size={12} className={`shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateY(-100%)" }}
          className="z-[9999] min-w-[180px] rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          {MODEL_ORDER.map((m) => (
            <button
              key={m}
              type="button"
              onMouseDown={(e) => {
                e.stopPropagation();
                onModelChange?.(m);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm transition hover:bg-accent hover:text-accent-foreground ${
                model === m ? "text-foreground font-medium" : "text-muted-foreground"
              }`}
            >
              {MODEL_LABELS[m]}
              {model === m && <Check size={13} className="shrink-0 text-primary" />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

function EffortDropdown({
  effort,
  onEffortChange,
}: {
  effort: EffortLevel;
  onEffortChange?: (e: EffortLevel) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.top - 4, left: r.left });
    setOpen((v) => !v);
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onMouseDown={handleOpen}
        className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
      >
        <Brain size={14} className="shrink-0" />
        {EFFORT_LABELS[effort]}
        <ChevronDown size={12} className={`shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateY(-100%)" }}
          className="z-[9999] min-w-[130px] rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          {EFFORT_ORDER.map((level) => (
            <button
              key={level}
              type="button"
              onMouseDown={(e) => {
                e.stopPropagation();
                onEffortChange?.(level);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm transition hover:bg-accent hover:text-accent-foreground ${
                effort === level ? "text-foreground font-medium" : "text-muted-foreground"
              }`}
            >
              {EFFORT_LABELS[level]}
              {effort === level && <Check size={13} className="shrink-0 text-primary" />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

/** Выбор режима подтверждений Avy Code (Спрашивать / Авто-правки / План). */
function PermissionDropdown({
  mode,
  onModeChange,
}: {
  mode: PermissionMode;
  onModeChange?: (m: PermissionMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current && !btnRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.top - 4, left: r.left });
    setOpen((v) => !v);
  };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onMouseDown={handleOpen}
        className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
      >
        <ShieldCheck size={14} className="shrink-0" />
        {PERMISSION_LABELS[mode]}
        <ChevronDown size={12} className={`shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateY(-100%)" }}
          className="z-[9999] min-w-[240px] rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          {PERMISSION_ORDER.map((m) => (
            <button
              key={m}
              type="button"
              onMouseDown={(e) => {
                e.stopPropagation();
                onModeChange?.(m);
                setOpen(false);
              }}
              className={`flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-1.5 text-left transition hover:bg-accent hover:text-accent-foreground ${
                mode === m ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <span className="flex w-full items-center justify-between text-sm">
                <span className={mode === m ? "font-medium" : ""}>{PERMISSION_LABELS[m]}</span>
                {mode === m && <Check size={13} className="shrink-0 text-primary" />}
              </span>
              <span className="text-xs text-muted-foreground/80">{PERMISSION_HINTS[m]}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

type AIChatInputProps = {
  /** Вызывается при отправке (Enter/Send): текст + прикреплённые файлы. */
  onSend?: (message: string, files: File[]) => void;
  /** Идёт ответ агента: кнопка Send заменяется на Stop, поле блокируется. */
  streaming?: boolean;
  /** Остановить идущий ход (кнопка Stop / Esc). */
  onStop?: () => void;
  /** Заблокировать Esc→стоп: когда открыта approval/ask_user-карточка, Esc должен
   *  ОТКЛОНИТЬ карточку (её обработчик), а не остановить ход оркестратора. Иначе
   *  карточка сабагента, всплывшая во время хода оркестратора, стопнула бы его. */
  escStopBlocked?: boolean;
  /** Заполненность окна контекста (для индикатора в капсуле). null — нет данных. */
  contextUsage?: { used_tokens: number; max_tokens: number } | null;
  /** Идёт ручное сжатие контекста. */
  compacting?: boolean;
  /** Сжать контекст сейчас (клик по индикатору). */
  onCompact?: () => void;
  /** Отменить идущее сжатие контекста (Esc). */
  onCancelCompact?: () => void;
  /** Уровень рассуждения модели (low/medium/high/max). Обязателен: значение по
   *  умолчанию задаётся в одном месте — стейте ChatWorkspace, а не дублируется
   *  фолбэком пропа здесь. */
  effort: EffortLevel;
  /** Смена уровня рассуждения. */
  onEffortChange?: (effort: EffortLevel) => void;
  /** Режим глубокого исследования включён. */
  deepSearch?: boolean;
  /** Переключить режим глубокого исследования. */
  onDeepSearchChange?: (active: boolean) => void;
  /** Скрыть тумблер «глубокое исследование» (в Avy Code этого инструмента нет). */
  hideDeepSearch?: boolean;
  /** Avy Code: текущий режим подтверждений. Если задан — показываем дропдаун. */
  permissionMode?: PermissionMode;
  /** Avy Code: смена режима подтверждений. */
  onPermissionModeChange?: (m: PermissionMode) => void;
  /** Avy Code: выбранная модель. Если задана — показываем дропдаун выбора модели. */
  model?: ModelId;
  /** Avy Code: смена модели. */
  onModelChange?: (m: ModelId) => void;
  /** Avy Code: компактная компоновка — капсула без своего фона (сливается с
   *  прозрачной зоной), острее углы и развёрнута по умолчанию. В обычном чате
   *  капсула плавает над лентой и должна иметь свой фон/скруглён. */
  codeMode?: boolean;
  disabled?: boolean;
  className?: string;
};

const ChatCodeInput = ({
  onSend,
  streaming = false,
  onStop,
  escStopBlocked = false,
  contextUsage,
  compacting = false,
  onCompact,
  onCancelCompact,
  effort,
  onEffortChange,
  deepSearch = false,
  onDeepSearchChange,
  hideDeepSearch = false,
  permissionMode,
  onPermissionModeChange,
  model,
  onModelChange,
  codeMode = false,
  disabled = false,
  className = "",
}: AIChatInputProps) => {
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [showPlaceholder, setShowPlaceholder] = useState(true);
  // В Avy Code капсула развёрнута по умолчанию: панель узкая, инпут не должен
  // схлопываться в одну строку — пользователю сразу нужно поле побольше + ряд
  // настроек под ним.
  const t = useT();
  const [isActive, setIsActive] = useState(codeMode);
  // Фокус самого поля ввода (курсор в textarea). В code-режиме isActive
  // «залипает» в true (капсула не схлопывается), поэтому для плейсхолдера,
  // который должен исчезать при постановке курсора, опираемся на этот флаг.
  const [isFocused, setIsFocused] = useState(false);
  const deepSearchActive = deepSearch;
  const [inputValue, setInputValue] = useState("");
  // Вложение храним вместе с objectURL мини-превью: URL создаётся ОДИН РАЗ при
  // добавлении файла (в обработчике, не в рендере), поэтому в JSX не нужно
  // трогать ref/создавать ресурсы во время рендера (react-hooks/refs) и нет
  // утечки objectURL при перерисовках. url есть только у картинок.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Вставленные большие куски текста — показываем чипами, на отправке вклеиваем
  // в текст сообщения (модель получает обычный текст, не файл).
  const [pastedTexts, setPastedTexts] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [rejected, setRejected] = useState(0); // сколько файлов отклонено по размеру
  // Капсула (для drop-зоны и пр.) и весь корень композера. «Клик вне» считаем по
  // КОРНЮ: превью-чипы вставок/файлов лежат НАД капсулой, вне wrapperRef, и клик
  // по их крестику иначе ловится как «вне» → инпут сворачивается раньше удаления.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  // Добавить файлы (из выбора или drop), отсекая слишком крупные. objectURL для
  // превью картинок создаём здесь же (в обработчике события).
  const addFiles = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    const ok = list.filter((f) => f.size <= MAX_FILE_BYTES);
    const tooBig = list.length - ok.length;
    if (tooBig > 0) setRejected((n) => n + tooBig);
    if (ok.length) {
      const next: Attachment[] = ok.map((file) => ({
        file,
        url: file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined,
      }));
      setAttachments((prev) => [...prev, ...next]);
    }
  }, []);

  const removeFile = useCallback((target: Attachment) => {
    if (target.url) URL.revokeObjectURL(target.url);
    setAttachments((prev) => prev.filter((a) => a !== target));
  }, []);

  // Чистим objectURL'ы при анмаунте. Держим актуальный список в ref, обновляя
  // его В ЭФФЕКТЕ (не во время рендера — иначе react-hooks/refs); cleanup
  // последнего прогона при анмаунте освобождает всё, что осталось выбранным.
  const attachmentsRef = useRef<Attachment[]>(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(() => {
    return () => {
      for (const a of attachmentsRef.current) {
        if (a.url) URL.revokeObjectURL(a.url);
      }
    };
  }, []);

  // Cycle placeholder text when input is inactive
  useEffect(() => {
    if (isActive || inputValue) return;

    const interval = setInterval(() => {
      setShowPlaceholder(false);
      setTimeout(() => {
        setPlaceholderIndex((prev) => (prev + 1) % PLACEHOLDERS.length);
        setShowPlaceholder(true);
      }, 400);
    }, 3000);

    return () => clearInterval(interval);
  }, [isActive, inputValue]);

  // Close input when clicking outside. В Avy Code капсула остаётся развёрнутой
  // всегда (codeMode) — там это основная рабочая область, схлопывать незачем.
  useEffect(() => {
    if (codeMode) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target as Node)
      ) {
        if (!inputValue) setIsActive(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [inputValue, codeMode]);

  // Esc во время ответа агента — остановить ход (наравне с кнопкой Stop).
  // Esc прерывает текущую длительную операцию: идущий ход агента (стрим) → onStop,
  // ручное сжатие контекста → onCancelCompact. Вешаем обработчик, пока активно
  // хоть что-то из двух.
  useEffect(() => {
    if (!streaming && !compacting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Открыта карточка approval/ask_user — Esc отдаём ей (отклонить), ход не стопим.
      if (streaming) { if (escStopBlocked) return; onStop?.(); }
      else if (compacting) onCancelCompact?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [streaming, compacting, onStop, onCancelCompact, escStopBlocked]);

  // Чат занят: идёт ответ агента ИЛИ сжатие контекста. Влияет только на
  // ОТПРАВКУ — пока агент работает, новый ход начать нельзя (наложился бы на
  // тот же thread). Но ПЕЧАТАТЬ при этом разрешаем всегда: пользователь может
  // набирать следующий вопрос заранее — он уйдёт, как только операция завершится.
  const busy = streaming || compacting;
  // Поле ввода НЕ блокируем никогда (ни в стрим, ни в сжатии) — печатать можно
  // всегда. Блокируется только кнопка отправки (через busy).
  const inputLocked = false;

  const handleActivate = () => {
    if (inputLocked) return;
    setIsActive(true);
  };

  // Сброс высоты textarea при очистке поля (после отправки)
  useEffect(() => {
    if (!inputValue && textInputRef.current) {
      textInputRef.current.style.height = "auto";
    }
  }, [inputValue]);

  const handleSend = () => {
    const text = inputValue.trim();
    if (
      busy ||
      disabled ||
      (!text && attachments.length === 0 && pastedTexts.length === 0)
    )
      return;
    // Вставленные тексты вклеиваем в сообщение блоками — модель получает обычный
    // текст. Каждый блок обрамляем маркером, чтобы бабл показал его чипом, а не
    // портянкой (как делается для прикреплённых файлов).
    const pastedBlocks = pastedTexts
      .map((t) => `${PASTED_TEXT_MARKER}\n${t}\n${PASTED_TEXT_MARKER_END}`)
      .join("\n\n");
    const fullText = [text, pastedBlocks].filter(Boolean).join("\n\n");
    onSend?.(fullText, attachments.map((a) => a.file));
    // Файлы отправлены — освобождаем objectURL'ы их превью и чистим список.
    for (const a of attachments) {
      if (a.url) URL.revokeObjectURL(a.url);
    }
    setInputValue("");
    setAttachments([]);
    setPastedTexts([]);
    setRejected(0);
    // Схлопываем капсулу обратно: снимаем активность и фокус, иначе условие
    // `isActive || inputValue` держит её развёрнутой даже после очистки текста.
    // В Avy Code капсула остаётся развёрнутой — там это рабочая область.
    if (!codeMode) {
      setIsActive(false);
      textInputRef.current?.blur();
    }
  };

  const containerVariants = {
    collapsed: {
      height: 68,
      boxShadow: "0 2px 8px 0 rgba(0,0,0,0.20)",
      transition: { type: "spring" as const, stiffness: 120, damping: 18 },
    },
    expanded: {
      // height: "auto" + minHeight: капсула не короче 128, но РАСТЁТ под
      // содержимое (textarea переносит строки) — блок растёт, а не режется.
      height: "auto" as const,
      minHeight: 128,
      boxShadow: "0 8px 32px 0 rgba(0,0,0,0.32)",
      transition: { type: "spring" as const, stiffness: 120, damping: 18 },
    },
    // Avy Code: всегда развёрнут, но компактнее и БЕЗ тени-«плиты» — капсула не
    // должна выглядеть массивным фоном поверх ленты. Высота растёт под текст.
    code: {
      height: "auto" as const,
      minHeight: 96,
      boxShadow: "none",
      transition: { type: "spring" as const, stiffness: 120, damping: 18 },
    },
  };

  const placeholderContainerVariants = {
    initial: {},
    animate: { transition: { staggerChildren: 0.025 } },
    exit: { transition: { staggerChildren: 0.015, staggerDirection: -1 } },
  };

  const letterVariants = {
    initial: { opacity: 0, filter: "blur(12px)", y: 10 },
    animate: {
      opacity: 1,
      filter: "blur(0px)",
      y: 0,
      transition: {
        opacity: { duration: 0.25 },
        filter: { duration: 0.4 },
        y: { type: "spring" as const, stiffness: 80, damping: 20 },
      },
    },
    exit: {
      opacity: 0,
      filter: "blur(12px)",
      y: -10,
      transition: {
        opacity: { duration: 0.2 },
        filter: { duration: 0.3 },
        y: { type: "spring" as const, stiffness: 80, damping: 20 },
      },
    },
  };

  // Реагируем на перетаскивание ТОЛЬКО файлов из ОС (не на внутренние
  // pointer-драги вроде ресайза панели).
  const isFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types || []).includes("Files");

  return (
    <div className={`w-full flex justify-center ${className}`}>
      <div
        ref={rootRef}
        className={`relative w-full ${codeMode ? "max-w-2xl" : "max-w-3xl"}`}
        onDragEnter={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          // Уходим из зоны только когда курсор реально покинул контейнер.
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragOver(false);
        }}
        onDrop={(e) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
      >
        {/* Превью прикреплённых файлов и вставленных текстов — над капсулой. */}
        {(attachments.length > 0 || pastedTexts.length > 0 || rejected > 0) && (
          <div className="mb-2 px-1">
            {(attachments.length > 0 || pastedTexts.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {pastedTexts.map((t, i) => (
                  <AttachmentChip
                    key={`pasted-${i}`}
                    name={`Вставленный текст ${pastedTexts.length > 1 ? i + 1 : ""}`.trim()}
                    mime="text/plain"
                    preview={pastePreview(t)}
                    onRemove={() =>
                      setPastedTexts((prev) => prev.filter((_, j) => j !== i))
                    }
                  />
                ))}
                {attachments.map((a, i) => (
                  <AttachmentChip
                    key={`${a.file.name}-${i}`}
                    name={a.file.name}
                    mime={a.file.type || "application/octet-stream"}
                    size={a.file.size}
                    thumbUrl={a.url}
                    onRemove={() => removeFile(a)}
                  />
                ))}
              </div>
            )}
            {rejected > 0 && (
              <p className="mt-1 px-1 text-xs text-destructive">
                {rejected === 1
                  ? "Файл слишком большой (макс. 25 МБ) и не прикреплён."
                  : `Файлов слишком больших (макс. 25 МБ): ${rejected} — не прикреплены.`}
              </p>
            )}
          </div>
        )}

        {/* Оверлей зоны drop. */}
        <AnimatePresence>
          {dragOver && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center gap-2 border-2 border-dashed border-primary bg-background/80 text-sm font-medium text-primary backdrop-blur-sm ${
                codeMode ? "rounded-xl" : "rounded-[32px]"
              }`}
            >
              <Upload size={18} />
              Отпустите файлы, чтобы прикрепить
            </motion.div>
          )}
        </AnimatePresence>

      <motion.div
        ref={wrapperRef}
        className={`w-full border text-card-foreground ${
          codeMode
            // Avy Code: САМА капсула непрозрачная (свой фон — текст в ней
            // читается), прозрачна только зона вокруг (градиент в chat.tsx).
            // Тонкая рамка, углы острее. Всегда развёрнута.
            ? "border-border/60 bg-card"
            : "border-border bg-card"
        }`}
        variants={containerVariants}
        animate={codeMode ? "code" : isActive || inputValue ? "expanded" : "collapsed"}
        initial={codeMode ? "code" : "collapsed"}
        style={{ overflow: "hidden", borderRadius: codeMode ? 14 : 32 }}
        onClick={handleActivate}
      >
        <div className="flex flex-col items-stretch w-full">
          {/* Input Row. items-start: кнопки прижаты к верхней строке текста
              (как в эталоне), а не центрируются по растущей textarea. */}
          <div className="flex items-start gap-2 p-3 rounded-full max-w-3xl w-full">
            <button
              className="p-3 rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground transition disabled:opacity-40 disabled:hover:bg-transparent"
              title="Прикрепить файл"
              type="button"
              disabled={inputLocked}
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              <Paperclip size={20} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = ""; // повторный выбор того же файла
              }}
            />

            {/* Text Input & Placeholder */}
            <div className="relative flex-1 min-w-0">
              <textarea
                ref={textInputRef}
                rows={1}
                value={inputValue}
                disabled={inputLocked}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  // Авто-рост высоты (замена field-sizing-content)
                  const el = e.target;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 160) + "px";
                }}
                onKeyDown={(e) => {
                  // Enter — отправка; Shift+Enter — перенос строки.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                onPaste={(e) => {
                  // Вставка файлов из буфера (скриншот по Ctrl+V, копированный
                  // файл) — прикрепляем как вложение, минуя текстовое поле.
                  const pastedFiles = Array.from(e.clipboardData.files || []);
                  if (pastedFiles.length) {
                    e.preventDefault();
                    addFiles(pastedFiles);
                    handleActivate();
                    return;
                  }
                  // Большую вставку текста превращаем в чип-вложение, а не льём в поле.
                  const pasted = e.clipboardData.getData("text");
                  if (pasted.length > PASTE_AS_ATTACHMENT_CHARS) {
                    e.preventDefault();
                    setPastedTexts((prev) => [...prev, pasted]);
                    handleActivate();
                  }
                }}
                className="flex-1 border-0 outline-0 rounded-none py-2 text-base bg-transparent w-full resize-none field-sizing-content max-h-40 font-normal text-foreground disabled:opacity-60"
                style={{ position: "relative", zIndex: 1 }}
                onFocus={() => {
                  setIsFocused(true);
                  handleActivate();
                }}
                onBlur={() => setIsFocused(false)}
              />
              {/* Индикатор сжатия контекста показываем НЕ здесь, а прямо на
                  кнопке-кольце ContextMeter (там, куда пользователь нажал) —
                  спиннер + «Сжимаю…». Отдельный оверлей над полем убрали: он
                  всплывал в стороне от клика и сбивал с толку. */}
              <div className="absolute left-0 top-0 w-full h-full pointer-events-none flex items-center px-3 py-2">
                {/* Avy Code: еле заметная статичная подсказка про клавиши.
                    Исчезает, как только курсор в поле (isFocused). Без анимации
                    и без бейджей — просто тусклый текст. В чат-режиме ниже —
                    прежний анимированный цикл PLACEHOLDERS. */}
                {codeMode && !isFocused && !inputValue && !inputLocked && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 whitespace-nowrap text-sm text-muted-foreground/40 select-none pointer-events-none">
                    {t.code.inputHint}
                  </span>
                )}
                <AnimatePresence mode="wait">
                  {!codeMode && showPlaceholder && !isActive && !inputValue && !inputLocked && (
                    <motion.span
                      key={placeholderIndex}
                      className="absolute left-0 top-[10px] text-muted-foreground select-none pointer-events-none"
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        zIndex: 0,
                      }}
                      variants={placeholderContainerVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                    >
                      {PLACEHOLDERS[placeholderIndex].split("").map((char, i) => (
                        <motion.span
                          key={i}
                          variants={letterVariants}
                          style={{ display: "inline-block", whiteSpace: "pre" }}
                        >
                          {char === " " ? " " : char}
                        </motion.span>
                      ))}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <button
              className="p-3 rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground transition disabled:opacity-40 disabled:hover:bg-transparent"
              title="Голосовой ввод"
              type="button"
              tabIndex={-1}
              disabled={inputLocked}
            >
              <Mic size={20} />
            </button>
            {streaming ? (
              <button
                className="flex items-center gap-1 bg-primary hover:bg-primary/90 text-primary-foreground p-3 rounded-full font-medium justify-center"
                title="Остановить (Esc)"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onStop?.();
                }}
              >
                <CircleStop size={18} />
              </button>
            ) : (
              <button
                className="flex items-center gap-1 bg-primary hover:bg-primary/90 text-primary-foreground p-3 rounded-full font-medium justify-center disabled:opacity-50"
                title={compacting ? "Сжимаю контекст…" : "Отправить"}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSend();
                }}
                disabled={busy || disabled || !inputValue.trim()}
              >
                {compacting ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Send size={18} />
                )}
              </button>
            )}
          </div>

          {/* Expanded Controls */}
          {/* pl-3 (12px): выравниваем левый край нижнего ряда так, чтобы иконка
              первого дропдауна (Brain у EffortDropdown, +12px внутр. padding =
              24px) совпадала по левому краю с иконкой «прикрепить» в input-row
              (p-3 контейнер 12 + p-3 кнопка 12 = те же 24px). px-4 (16px) сдвигал
              нижний ряд правее. Правый отступ оставляем 16px (pr-4). */}
          <motion.div
            className="w-full flex justify-start pl-3 pr-4 pb-3 items-center text-sm"
            variants={{
              hidden: {
                opacity: 0,
                y: 20,
                pointerEvents: "none" as const,
                transition: { duration: 0.25 },
              },
              visible: {
                opacity: 1,
                y: 0,
                pointerEvents: "auto" as const,
                transition: { duration: 0.35, delay: 0.08 },
              },
            }}
            initial={codeMode ? "visible" : "hidden"}
            animate={codeMode || isActive || inputValue ? "visible" : "hidden"}
            style={{ marginTop: 8 }}
          >
            <div className="flex gap-3 items-center">
              {/* Глубокое исследование — отдельный инструмент, в Avy Code не нужен. */}
              {!hideDeepSearch && (
                <motion.button
                  className={`flex items-center px-4 gap-1 py-2 rounded-full transition font-medium whitespace-nowrap overflow-hidden justify-start ${
                    deepSearchActive
                      ? "bg-accent text-accent-foreground outline outline-ring/60"
                      : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                  title="Глубокое исследование"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeepSearchChange?.(!deepSearchActive);
                  }}
                  initial={false}
                  animate={{
                    width: deepSearchActive ? 210 : 36,
                    paddingLeft: deepSearchActive ? 8 : 9,
                  }}
                >
                  <div className="flex-1">
                    <Search size={18} />
                  </div>
                  <motion.span
                    className="pb-[2px]"
                    initial={false}
                    animate={{ opacity: deepSearchActive ? 1 : 0 }}
                  >
                    Глубокое исследование
                  </motion.span>
                </motion.button>
              )}

              {/* Уровень рассуждения */}
              <EffortDropdown effort={effort} onEffortChange={onEffortChange} />

              {/* Выбор модели (только Avy Code — задаётся model). */}
              {model && (
                <ModelDropdown
                  model={model}
                  onModelChange={onModelChange}
                />
              )}

              {/* Режим подтверждений (только Avy Code — задаётся permissionMode). */}
              {permissionMode && (
                <PermissionDropdown
                  mode={permissionMode}
                  onModeChange={onPermissionModeChange}
                />
              )}
            </div>

            {/* Индикатор заполненности контекста + ручное сжатие. Прижат вправо;
                показываем только когда есть данные (активная сессия с историей). */}
            {contextUsage && (
              <div className="ml-auto">
                <ContextMeter
                  usedTokens={contextUsage.used_tokens}
                  maxTokens={contextUsage.max_tokens}
                  compacting={compacting}
                  onCompact={onCompact}
                />
              </div>
            )}
          </motion.div>
        </div>
      </motion.div>
      </div>
    </div>
  );
};

// memo: во время стрима родитель (ChatCode) перерисовывается на каждый флаш
// дельт (~12/сек); пропсы инпута при этом стабильны (колбэки — useCallback/
// setState сверху, остальное примитивы) — без memo тяжёлый инпут с дропдаунами
// и motion-обвязкой рендерился бы вхолостую на каждый тик стрима.
const ChatCodeInputMemo = memo(ChatCodeInput);

export { ChatCodeInputMemo as ChatCodeInput };
