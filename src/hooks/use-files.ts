"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchSessionFiles,
  type FilesScope,
  type SessionFile,
} from "@/lib/api";

/**
 * Файлы активной сессии для панели «Файлы».
 *
 * Сервер читает файлы из живого контейнера (если сессия активна) или из
 * S3-снапшота (если потушена) — без пробуждения песочницы, поэтому грузить
 * дёшево. Тянем при открытой панели (`enabled`): при смене сессии или открытии
 * список обновляется сам; при закрытой панели — сбрасываем (подтянется позже).
 *
 * @param enabled панель открыта (есть смысл грузить список).
 * @param scope какую область показывать ("outputs" по умолчанию, "work" — рабочая).
 */
export function useFiles(
  threadId: string,
  enabled: boolean,
  scope: FilesScope = "outputs",
) {
  // Список ХРАНИМ вместе с threadId, которому он принадлежит. Это ядро фикса:
  // при смене сессии React сначала РЕНДЕРИТ с новым threadId и ещё СТАРЫМ
  // списком (эффект-сброс отрабатывает уже ПОСЛЕ коммита), и панель на один кадр
  // рисует чужие пути с новым threadId → превью (PdfThumb/PdfViewer) ловит 404.
  // Поэтому наружу отдаём список ТОЛЬКО если его тег совпадает с текущим
  // threadId — иначе пустой. Совпадение считаем на РЕНДЕРЕ, не в эффекте.
  const [loaded, setLoaded] = useState<{ threadId: string; files: SessionFile[] }>({
    threadId: "",
    files: [],
  });
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!threadId) {
      setLoaded({ threadId: "", files: [] });
      return;
    }
    setLoading(true);
    try {
      const result = await fetchSessionFiles(threadId, scope);
      // Тегируем результат его сессией — отставший ответ старой сессии не
      // «прикинется» новым: наружу он всё равно не пройдёт (тег не совпадёт).
      setLoaded({ threadId, files: result });
    } finally {
      setLoading(false);
    }
  }, [threadId, scope]);

  // Смена сессии / области / открытие панели: открыта -> грузим новый список,
  // закрыта -> сбрасываем.
  useEffect(() => {
    if (enabled) {
      refresh();
    } else {
      setLoaded({ threadId: "", files: [] });
    }
  }, [threadId, enabled, refresh]);

  // Отдаём файлы только для ТЕКУЩЕЙ сессии. Пока новый список не пришёл (или
  // пришёл ответ другой сессии) — пусто, а не чужие пути.
  const files = loaded.threadId === threadId ? loaded.files : [];

  return { files, loading, refresh };
}
