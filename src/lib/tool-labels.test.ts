/**
 * Подписи шагов в ленте хода для инструментов коннекторов: название сервиса и
 * действия из каталога (connectors/*.yaml), а не `mcp__telegram__send`.
 */
import { describe, expect, it } from "vitest";

import { primeConnectorLabels } from "@/lib/connector-registry";
import { describeTool } from "@/lib/tool-labels";

describe("шаги коннекторов", () => {
  it("до загрузки каталога — по техническому имени, но без префикса mcp__", () => {
    expect(describeTool("mcp__unknown-svc__send_message", {}, "ru").title).toBe("unknown-svc: send message");
  });

  it("с каталогом — сервис и действие на языке интерфейса", () => {
    primeConnectorLabels([
      {
        id: "telegram",
        title: "Telegram",
        titles: { ru: "Телеграм", en: "Telegram" },
        tool_labels: { send: { ru: "Отправить сообщение", en: "Send a message" } },
      },
    ]);
    expect(describeTool("mcp__telegram__send", {}, "ru").title).toBe("Телеграм: Отправить сообщение");
    expect(describeTool("mcp__telegram__send", {}, "en", "done").title).toBe("Telegram: Send a message");
    // Инструмента нет в каталоге — имя без подчёркиваний.
    expect(describeTool("mcp__telegram__new_tool", {}, "ru").title).toBe("Телеграм: new_tool");
  });

  it("цель шага — текстовый аргумент, а не [object Object]", () => {
    const { target } = describeTool(
      "mcp__telegram__send",
      { files: ["/outputs/a.png"], chat: "Новости", text: "Пост" },
      "ru",
    );
    expect(target).toBe("Новости");
    expect(describeTool("mcp__x__y", { items: [{ a: 1 }], limit: 5 }, "ru").target).toBe("5");
  });

  it("активация коннектора подписана по-человечески", () => {
    expect(describeTool("connector", { name: "telegram" }, "ru")).toEqual({
      title: "Подключаю сервис",
      target: "telegram",
    });
    expect(describeTool("connector", { name: "telegram" }, "ru", "done").title).toBe("Сервис подключён");
  });
});
