/** Скачивание файла из чата — с обходом мёртвого `download` на iOS.
 *
 * Атрибут `<a download>` в WebKit на iOS не сохраняет файл, а НАВИГИРУЕТ по
 * ссылке в текущем окне. В браузере это ещё терпимо (есть «назад»), но в PWA
 * (`display: standalone`) ни вкладок, ни кнопки «назад» нет: документ
 * разворачивается на весь экран поверх приложения, и выйти можно только
 * перезагрузив PWA. Особенно жёстко с `Content-Disposition: attachment`
 * (docx/xlsx/zip) — WebKit показывает превью без единого элемента управления.
 *
 * Поэтому НА iOS/iPadOS качаем тело в память и отдаём системному листу
 * «Поделиться» (Web Share API level 2, iOS 15+): оттуда есть «Сохранить в
 * Файлы», AirDrop, отправка в мессенджер — а приложение остаётся на экране.
 *
 * Везде остальном — десктоп (в том числе Safari на macOS), Android — работает
 * прежний путь через `<a download>`. Ограничение по платформе ОБЯЗАТЕЛЬНО:
 * `canShare({files})` умеет и macOS Safari 16.4+, и без проверки лист
 * «Поделиться» выскакивал на маках и айпадах, где скачивание и так исправно.
 */

/** Совместимая с level 2 часть Web Share API (в lib.dom нет `canShare(files)`). */
type ShareCapableNavigator = Navigator & {
  canShare?: (data?: { files?: File[] }) => boolean;
  share?: (data: { files?: File[]; title?: string }) => Promise<void>;
};

/** Прежнее поведение: временная ссылка с `download`. Десктоп и Android. */
function anchorDownload(url: string, name: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** iOS/iPadOS — единственные, где `<a download>` не сохраняет файл.
 *
 *  Отдельная проверка нужна, потому что одного `canShare({files})` МАЛО: его
 *  умеет и Safari на macOS (16.4+), и там лист «Поделиться» только мешает — обычное
 *  скачивание работает как надо. Наступали на это: после первой версии фикса
 *  «Поделиться» выскакивал на маках и айпадах вместо сохранения.
 *
 *  iPadOS с 13-й версии представляется как «Macintosh», поэтому отличаем его по
 *  наличию тач-точек: у настоящего мака `maxTouchPoints === 0`.
 */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/** Нужно ли отдавать файл в системный лист «Поделиться» вместо `<a download>`.
 *
 *  Только на iOS/iPadOS и только если браузер умеет шарить файлы (Web Share API
 *  level 2, iOS 15+). Везде остальном — десктоп (включая Safari на macOS),
 *  Android — работает прежний путь через `<a download>`.
 *
 *  Пустой `File` — единственный способ спросить браузер о поддержке файлов, не
 *  имея на руках самого файла.
 */
export function canShareFiles(): boolean {
  if (typeof navigator === "undefined") return false;
  if (!isIOS()) return false;
  const nav = navigator as ShareCapableNavigator;
  if (typeof nav.canShare !== "function" || typeof nav.share !== "function") return false;
  try {
    return nav.canShare({ files: [new File([], "probe.txt", { type: "text/plain" })] });
  } catch {
    return false;
  }
}

/** Скачать файл сессии: системный «Поделиться» там, где он есть, иначе `<a download>`.
 *
 *  Бросает только если файл не удалось получить с сервера — вызывающий код сам
 *  решает, показывать ли это пользователю. Отмена системного листа (юзер нажал
 *  «Отмена») ошибкой НЕ считается: это штатный сценарий, а WebKit сообщает о
 *  нём через `AbortError`.
 */
export async function downloadFile(url: string, name: string, mime?: string): Promise<void> {
  if (!canShareFiles()) {
    anchorDownload(url, name);
    return;
  }

  let file: File;
  try {
    // credentials: cookie-сессия — raw-эндпоинт закрыт авторизацией.
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    file = new File([blob], name, { type: mime || blob.type || "application/octet-stream" });
  } catch {
    // Сеть или 404 — пробуем нативный путь: вдруг повезёт, и пользователь хотя
    // бы увидит ошибку сервера вместо молчания.
    anchorDownload(url, name);
    return;
  }

  const nav = navigator as ShareCapableNavigator;
  // Между probe и этим моментом файл стал настоящим: спрашиваем ещё раз, теперь
  // про него (WebKit отклоняет share по типу и размеру).
  if (!nav.canShare?.({ files: [file] })) {
    anchorDownload(url, name);
    return;
  }
  try {
    await nav.share!({ files: [file], title: name });
  } catch (e) {
    // Пользователь закрыл лист — это не ошибка, повторное скачивание не нужно.
    if ((e as Error)?.name === "AbortError") return;
    anchorDownload(url, name);
  }
}
