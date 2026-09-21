"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  uploadSessionFile,
  deleteSessionFiles,
  type UploadedFile,
} from "@/lib/api";

/** Метаданные уже загруженного вложения — уходят в send (пути + имя/mime для
 *  чипов в бабле сообщения). */
export type UploadedAttachment = {
  path: string;
  name: string;
  mime: string;
  thumbUrl?: string;
};

/** Статус загрузки вложения в песочницу (грузим сразу при прикреплении). */
export type AttachmentStatus = "uploading" | "done" | "error";

/** Одно вложение композера. Файл грузится в /uploads сразу при добавлении;
 *  чип показывает кольцо прогресса, отправка ждёт, пока все не `done`. */
export type Attachment = {
  /** Стабильный id (ключ списка + идентификатор при обновлении прогресса). */
  id: string;
  file: File;
  /** objectURL мини-превью (только у картинок). */
  url?: string;
  status: AttachmentStatus;
  /** Прогресс загрузки 0..1 (для кольца на чипе). */
  progress: number;
  /** Метаданные загруженного файла (после `done`) — уходят на отправке. */
  uploaded?: UploadedAttachment;
  /** Текст ошибки загрузки (status === "error"). */
  error?: string;
};

/** Лимит размера одного файла на клиенте (сервер дублирует проверку). 25 МБ. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type AttachmentsApi = {
  attachments: Attachment[];
  /** Сколько файлов отклонено по размеру (для плашки в композере). */
  rejected: number;
  /** Все вложения загружены (нет uploading/error) — можно отправлять. */
  allReady: boolean;
  /** Добавить файлы (выбор/drop/paste): крупные отсекаются, остальные СРАЗУ
   *  начинают грузиться в песочницу. */
  addFiles: (incoming: FileList | File[]) => void;
  /** Убрать вложение: прерывает незавершённую загрузку либо удаляет уже
   *  загруженный файл с сервера; освобождает objectURL. */
  removeFile: (target: Attachment) => void;
  /** Забрать МЕТАДАННЫЕ загруженных файлов для отправки и очистить композер
   *  (файлы уже в песочнице — повторно не грузим; objectURL освобождаем). */
  takeUploaded: () => UploadedAttachment[];
  /** Сбросить счётчик отклонённых (после показа плашки). */
  clearRejected: () => void;
};

let _seq = 0;
const nextId = () => `att-${++_seq}`;

/**
 * Состояние вложений композера. Владелец — чат (drag&drop по всей области). НО
 * теперь файлы грузятся в песочницу СРАЗУ при прикреплении (не на отправке):
 * чип показывает реальный прогресс, а Send заблокирован, пока не все `done`.
 * Если вложение убрали до отправки — незавершённая загрузка прерывается, а уже
 * загруженный файл удаляется с сервера (не копится «брошенным»).
 *
 * Только обычный чат: `mode === "avy-code"` (upload там = инжект в сообщение, не
 * запись в ФС) грузим по-старому НА ОТПРАВКЕ — тогда хук работает как раньше
 * (см. useChat), сюда такой режим не передаётся.
 */
export function useAttachments(threadId: string, mode?: string | null): AttachmentsApi {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [rejected, setRejected] = useState(0);
  // abort-хендлы незавершённых загрузок по id (для отмены при снятии чипа).
  const aborts = useRef<Map<string, () => void>>(new Map());
  // id вложений, снятых ВО ВРЕМЯ загрузки: abort рвёт запрос, но сервер мог
  // успеть сохранить файл до разрыва. Если загрузка всё же завершилась успехом —
  // добиваем файл DELETE-ом (не оставляем «брошенным» в песочнице).
  const removedDuringUpload = useRef<Set<string>>(new Set());

  // Плашка «файл слишком большой» — временная: сама гаснет через несколько
  // секунд (как тост), а не висит до отправки. Новое отклонение перезапускает
  // таймер (эффект пересоздаётся по значению rejected).
  useEffect(() => {
    if (rejected === 0) return;
    const id = setTimeout(() => setRejected(0), 4000);
    return () => clearTimeout(id);
  }, [rejected]);

  const patch = useCallback((id: string, upd: Partial<Attachment>) => {
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, ...upd } : a)));
  }, []);

  const addFiles = useCallback(
    (incoming: FileList | File[]) => {
      const list = Array.from(incoming);
      const ok = list.filter((f) => f.size <= MAX_FILE_BYTES);
      const tooBig = list.length - ok.length;
      if (tooBig > 0) setRejected((n) => n + tooBig);
      for (const file of ok) {
        const id = nextId();
        const att: Attachment = {
          id,
          file,
          url: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
          status: "uploading",
          progress: 0,
        };
        setAttachments((prev) => [...prev, att]);
        // Стартуем загрузку немедленно; прогресс/итог пишем по id.
        const { promise, abort } = uploadSessionFile(
          threadId,
          file,
          (frac) => patch(id, { progress: frac }),
          mode,
        );
        aborts.current.set(id, abort);
        promise
          .then((uploaded: UploadedFile) => {
            aborts.current.delete(id);
            // Чип сняли, пока грузилось, но файл всё же долетел (гонка с abort) —
            // добиваем его с сервера и НЕ помечаем как done (чипа уже нет).
            if (removedDuringUpload.current.delete(id)) {
              void deleteSessionFiles(threadId, [uploaded.path], "work").catch(
                () => {},
              );
              return;
            }
            patch(id, {
              status: "done",
              progress: 1,
              uploaded: {
                path: uploaded.path,
                name: uploaded.name,
                mime: uploaded.mime,
                thumbUrl: uploaded.thumbUrl,
              },
            });
          })
          .catch((err: unknown) => {
            aborts.current.delete(id);
            // Прерывание (снятие чипа) — не ошибка: чип уже удалён из списка.
            if (err instanceof DOMException && err.name === "AbortError") return;
            patch(id, {
              status: "error",
              error: err instanceof Error ? err.message : "upload_failed",
            });
          });
      }
    },
    [threadId, mode, patch],
  );

  const removeFile = useCallback(
    (target: Attachment) => {
      if (target.url) URL.revokeObjectURL(target.url);
      // Незавершённая загрузка — прерываем; уже загруженный файл — удаляем с
      // сервера (не оставляем «брошенным» в песочнице).
      const abort = aborts.current.get(target.id);
      if (abort) {
        // Помечаем как «снятый во время загрузки»: если файл всё же долетел до
        // сервера (гонка с abort), промис-успех добьёт его DELETE-ом (см. addFiles).
        removedDuringUpload.current.add(target.id);
        abort();
        aborts.current.delete(target.id);
      } else if (target.status === "done" && target.uploaded) {
        void deleteSessionFiles(threadId, [target.uploaded.path], "work").catch(
          () => {},
        );
      }
      setAttachments((prev) => prev.filter((a) => a.id !== target.id));
    },
    [threadId],
  );

  // Актуальный список в ref — чтобы cleanup при анмаунте освободил objectURL'ы.
  const ref = useRef<Attachment[]>(attachments);
  useEffect(() => {
    ref.current = attachments;
  }, [attachments]);
  useEffect(() => {
    return () => {
      for (const a of ref.current) if (a.url) URL.revokeObjectURL(a.url);
    };
  }, []);

  const takeUploaded = useCallback(() => {
    // Файлы уже в песочнице — отдаём метаданные и очищаем композер. НЕ удаляем с
    // сервера (они отправляются агенту). objectURL освобождаем.
    const out = ref.current
      .filter((a) => a.status === "done" && a.uploaded)
      .map((a) => a.uploaded as UploadedAttachment);
    for (const a of ref.current) if (a.url) URL.revokeObjectURL(a.url);
    aborts.current.clear();
    setAttachments([]);
    setRejected(0);
    return out;
  }, []);

  const clearRejected = useCallback(() => setRejected(0), []);

  const allReady =
    attachments.length === 0 || attachments.every((a) => a.status === "done");

  return {
    attachments,
    rejected,
    allReady,
    addFiles,
    removeFile,
    takeUploaded,
    clearRejected,
  };
}
