/**
 * Копирование ответа с форматированием.
 *
 * Кнопка «Скопировать» клала в буфер только текст — сырой markdown. Почта,
 * Заметки, Pages, Word его не рендерят: человек получал `**звёздочки**` и
 * `| таблицы | палками |`. Выделение мышью при этом вставлялось нормально,
 * потому что браузер кладёт в буфер ДВА формата — HTML и текст.
 *
 * Делаем то же: `text/html` — ответ, переведённый из markdown в разметку,
 * `text/plain` — прежний markdown. Приёмник сам берёт своё: редактор с
 * форматированием — HTML, терминал и редактор кода — текст, как раньше.
 *
 * HTML строим из markdown, а не снимаем с экрана: в DOM ленты лежат кнопки
 * блоков кода, подсветка по токенам, плашки файлов и двойная разметка формул —
 * при вставке всё это превращается в мусор.
 */

import type { Element, ElementContent, Parent, Root } from "hast";
import { toHtml } from "hast-util-to-html";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

const MONO = "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

/** Стили прямо в тегах: классы при вставке теряются, а без рамок таблица в
 *  письме или документе выглядит как рассыпанные слова. Цвета фона и текста не
 *  задаём — приёмник сам подставит свои, в том числе в тёмной теме. */
const STYLES: Record<string, string> = {
  table: "border-collapse:collapse",
  th: "border:1px solid #b4b4b4;padding:4px 8px;text-align:left",
  td: "border:1px solid #b4b4b4;padding:4px 8px",
  pre: `${MONO};white-space:pre-wrap`,
  code: MONO,
  blockquote: "border-left:3px solid #b4b4b4;margin-left:0;padding-left:12px",
};

/** Адрес, который откроется вне чата: со схемой сети или почты. */
const isExternal = (url: string): boolean => /^(https?:|mailto:|tel:)/i.test(url);

/**
 * Правка дерева под вставку в чужое приложение:
 *  - стили в теги (см. STYLES);
 *  - ссылка на файл сессии (`file:…`, относительный путь) вне чата никуда не
 *    ведёт — оставляем её текст без ссылки;
 *  - картинка с относительным адресом там же не загрузится — оставляем подпись.
 */
function forPaste(node: Parent): void {
  node.children = node.children.flatMap((child): ElementContent[] => {
    if (child.type !== "element") return [child as ElementContent];
    const el = child as Element;
    forPaste(el);
    const props = el.properties ?? {};
    if (el.tagName === "a" && !isExternal(String(props.href ?? ""))) return el.children;
    if (el.tagName === "img" && !isExternal(String(props.src ?? ""))) {
      const alt = String(props.alt ?? "");
      return alt ? [{ type: "text", value: alt }] : [];
    }
    const style = STYLES[el.tagName];
    if (style) el.properties = { ...props, style };
    return [el];
  }) as Parent["children"];
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);

/** Markdown ответа → HTML для буфера обмена. Сырой HTML из ответа сюда не
 *  попадает: remark-rehype без allowDangerousHtml его отбрасывает. */
export function markdownToClipboardHtml(markdown: string): string {
  const tree = processor.runSync(processor.parse(markdown)) as Root;
  forPaste(tree);
  return toHtml(tree);
}

/**
 * Положить ответ в буфер в двух форматах. Где `ClipboardItem` нет или запись
 * HTML отклонена — кладём только текст, как было. Бросает, если буфер
 * недоступен вовсе (нет https или разрешения).
 */
export async function copyRich(markdown: string): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      const html = markdownToClipboardHtml(markdown);
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([markdown], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      /* падаем на текст ниже */
    }
  }
  await navigator.clipboard.writeText(markdown);
}
