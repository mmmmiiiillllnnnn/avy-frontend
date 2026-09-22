/**
 * Подпись подключения на карточке агента.
 *
 * ПОЧЕМУ ИМЕННО ЭТО. Подпись печатает значения, пришедшие с сервера, и отказ
 * здесь виден не глазом, а только когда уже поздно: попади в неё секретное
 * поле — пароль от корпоративной почты окажется напечатанным в интерфейсе.
 * Второй отказ тише: подпись, прибитая к имени поля, означала бы, что клиент
 * знает про Exchange, и следующий вид подключения (Jira, шара) остался бы без
 * подписи молча.
 */
import { describe, expect, it } from "vitest";

import { connectionForms, connectionSubtitle } from "@/lib/connection-card";
import type { AgentConnection } from "@/lib/api";

function conn(
  fields: Array<Partial<AgentConnection["fields"][number]> & { name: string }>,
  values: Record<string, string>,
): AgentConnection {
  return {
    kind: "any",
    title: "Подключение",
    description: "",
    fields: fields.map((f) => ({
      name: f.name,
      label: f.label ?? f.name,
      secret: f.secret ?? false,
      required: f.required ?? true,
      hint: "",
      placeholder: "",
    })),
    connected: true,
    values,
    updated_at: null,
  };
}

describe("подпись подключения", () => {
  it("секретное поле не попадает на экран даже если сервер его прислал", () => {
    // Сервер такого не отдаёт, но это ВТОРОЕ независимое условие на ту же
    // утечку: перестань фильтровать сервер — пароль всё равно не напечатается.
    const c = conn(
      [{ name: "password", secret: true }, { name: "login" }],
      { password: "s3cret", login: "ivanov" },
    );
    const text = connectionSubtitle(c);
    expect(text).toBe("ivanov");
    expect(text).not.toContain("s3cret");
  });

  it("порядок берётся из описания, а не из имён полей", () => {
    // Главное поле — то, что вид объявил первым. Знай клиент про «login», у
    // следующего вида подключения подписи не было бы вовсе.
    const c = conn([{ name: "base_url" }, { name: "user" }], {
      base_url: "https://jira.bank.local",
      user: "ivanov",
    });
    expect(connectionSubtitle(c)).toBe("https://jira.bank.local");
  });

  it("пустое значение пропускается, берётся следующее непустое", () => {
    // Необязательное поле человек мог не заполнить: подпись «» выглядела бы как
    // поломка подключения, хотя оно рабочее.
    const c = conn([{ name: "email", required: false }, { name: "login" }], {
      email: "",
      login: "ivanov",
    });
    expect(connectionSubtitle(c)).toBe("ivanov");
  });

  it("подписывать нечем — пустая строка, а не undefined", () => {
    // Вызывающий проверяет непустоту и показывает описание вида; undefined
    // напечатался бы словом «undefined».
    expect(connectionSubtitle(conn([{ name: "login" }], {}))).toBe("");
  });
});

describe("формы подключений из конфига агента", () => {
  it("агент без подключений — пусто, без запроса к серверу", () => {
    // Кнопка появляется по конфигу: у пользовательского агента и у агента без
    // `connections:` формы нет — и запроса быть не должно.
    expect(connectionForms({})).toEqual([]);
    expect(connectionForms(null)).toEqual([]);
    expect(connectionForms({ connection_forms: "мусор" })).toEqual([]);
  });

  it("формы берутся из записи агента как есть", () => {
    const form = { kind: "any", title: "Т", description: "", fields: [] };
    expect(connectionForms({ connection_forms: [form, { kind: 1 }] })).toEqual([form]);
  });
});
