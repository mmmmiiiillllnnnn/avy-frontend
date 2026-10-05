import { describe, expect, it } from "vitest";

import { markdownToClipboardHtml } from "./copy-rich";

describe("markdownToClipboardHtml", () => {
  it("переводит заголовки, выделение и списки в разметку", () => {
    const html = markdownToClipboardHtml("# План\n\n**Важно**: сделать *сегодня*\n\n- раз\n- два\n\n1. первый\n");
    expect(html).toContain("<h1>План</h1>");
    expect(html).toContain("<strong>Важно</strong>");
    expect(html).toContain("<em>сегодня</em>");
    expect(html).toMatch(/<ul>\s*<li>раз<\/li>/);
    expect(html).toMatch(/<ol>\s*<li>первый<\/li>/);
    expect(html).not.toContain("**");
  });

  it("таблица получает рамки прямо в тегах", () => {
    const html = markdownToClipboardHtml("| Имя | Счёт |\n| --- | --- |\n| Анна | 5 |\n");
    expect(html).toContain('<table style="border-collapse:collapse">');
    expect(html).toMatch(/<th style="border:1px solid [^"]+">Имя<\/th>/);
    expect(html).toMatch(/<td style="border:1px solid [^"]+">Анна<\/td>/);
  });

  it("блок кода остаётся кодом, угловые скобки экранируются", () => {
    const html = markdownToClipboardHtml("```html\n<b>x</b>\n```\n\nи `a<b` в строке");
    expect(html).toMatch(/<pre style="[^"]*monospace[^"]*"><code[^>]*>&#x3C;b>x&#x3C;\/b>\n<\/code><\/pre>/);
    expect(html).toMatch(/<code style="[^"]*monospace">a&#x3C;b<\/code>/);
  });

  it("сырой HTML из ответа в буфер не попадает", () => {
    const html = markdownToClipboardHtml('текст <img src="https://evil.example/?q=1"> и <script>alert(1)</script>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("evil.example");
  });

  it("внешняя ссылка остаётся ссылкой, ссылка на файл сессии — текстом", () => {
    const html = markdownToClipboardHtml("[сайт](https://example.com) и [отчёт.docx](file:outputs/отчёт.docx)");
    expect(html).toContain('<a href="https://example.com">сайт</a>');
    expect(html).toContain("отчёт.docx");
    expect(html).not.toContain("file:");
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("картинка сессии заменяется подписью, внешняя остаётся", () => {
    const html = markdownToClipboardHtml("![график](/outputs/chart.png)\n\n![лого](https://example.com/l.png)");
    expect(html).not.toContain("/outputs/chart.png");
    expect(html).toContain("график");
    expect(html).toContain('src="https://example.com/l.png"');
  });
});
