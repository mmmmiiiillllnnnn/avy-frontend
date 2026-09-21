import type { Locale } from "@/lib/locale";

/**
 * Человеческие названия инструментов «от лица агента» (ru/en).
 *
 * Шаг в цепочке размышлений показывает не техническое имя тула (`read_file`), а
 * действие глазами агента: «Читаю файл report.pdf». Заголовок — короткий глагол
 * действия, target (имя файла / команда / запрос) выносится отдельной строкой и
 * рендерится моноширинным, как раньше.
 */

/** Тулы, работающие с конкретным файлом по пути. */
const FILE_TOOLS = new Set(["read_file", "write_file", "edit_file"]);

/** Путь к файлу из аргументов файлового тула (или ""). */
function filePath(name: string, args: Record<string, unknown>): string {
  if (!FILE_TOOLS.has(name)) return "";
  const a = args ?? {};
  return String(a.file_path ?? a.path ?? "");
}

/** Навык, к которому относится путь /skills/<name>/... (или "", если не скилл). */
function skillName(path: string): string {
  const m = path.match(/^\/skills\/([^/]+)/);
  return m ? m[1] : "";
}

/** Достать «цель» действия из аргументов: имя файла, команда, запрос и т.п. */
function toolTarget(name: string, args: Record<string, unknown>): string {
  const a = args ?? {};
  // Для файла под /skills/ цель — имя навыка, а не конкретный файл (SKILL.md и
  // т.п.); для пользователя осмысленнее «какой навык», чем «какой его файл».
  const skill = skillName(filePath(name, args));
  if (skill) return skill;
  switch (name) {
    case "bash":
      return String(a.command ?? "");
    case "read_file":
    case "write_file":
    case "edit_file":
      return basename(String(a.file_path ?? a.path ?? ""));
    case "ls":
    case "glob":
      return String(a.path ?? a.pattern ?? "");
    case "grep":
      return String(a.pattern ?? a.query ?? "");
    case "web_search":
      return String(a.query ?? "");
    case "web_fetch":
      return String(a.url ?? "");
    case "task":
      // Цель — короткая подпись задачи (description, 3–5 слов). Полный бриф
      // (prompt) в чат НЕ показываем — он уходит сабагенту, а его ход виден в
      // панели фоновых задач.
      return String(a.description ?? "");
    case "ask_user": {
      // Цель шага — текст первого вопроса (в args.questions[0].question).
      const qs = a.questions;
      if (Array.isArray(qs) && qs.length) {
        const first = qs[0] as { question?: unknown };
        return String(first?.question ?? "");
      }
      return "";
    }
    default: {
      const keys = Object.keys(a);
      return keys.length ? String(a[keys[0]] ?? "") : "";
    }
  }
}

/** Последний сегмент пути (для файловых тулов), пустую строку оставляем как есть. */
function basename(p: string): string {
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

/** Заголовок-действие тула на нужном языке. Незнакомый тул → его имя как есть. */
function toolTitle(
  name: string,
  args: Record<string, unknown>,
  locale: Locale,
): string {
  // Файловый тул, работающий с навыком (/skills/...): «Читаю/Пишу навык».
  if (skillName(filePath(name, args)) && SKILL_TITLES[name]) {
    return SKILL_TITLES[name][locale];
  }
  const dict = TOOL_TITLES[name];
  if (dict) return dict[locale];
  // Незнакомый инструмент (скилл и т.п.): человекочитаем имя — снимаем _,
  // делаем Title Case, чтобы не висел сырой snake_case.
  return name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Заголовки для файловых тулов, когда путь ведёт в /skills/. */
const SKILL_TITLES: Record<string, { ru: string; en: string }> = {
  read_file: { ru: "Изучаю навык", en: "Studying skill" },
  write_file: { ru: "Пишу навык", en: "Writing skill" },
  edit_file: { ru: "Редактирую навык", en: "Editing skill" },
};

const TOOL_TITLES: Record<string, { ru: string; en: string }> = {
  bash: { ru: "Выполняю команду", en: "Running command" },
  read_file: { ru: "Читаю файл", en: "Reading file" },
  write_file: { ru: "Пишу файл", en: "Writing file" },
  edit_file: { ru: "Редактирую файл", en: "Editing file" },
  ls: { ru: "Смотрю содержимое папки", en: "Listing folder" },
  glob: { ru: "Ищу файлы", en: "Finding files" },
  grep: { ru: "Ищу по содержимому", en: "Searching contents" },
  web_search: { ru: "Ищу в интернете", en: "Searching the web" },
  web_fetch: { ru: "Скачиваю", en: "Downloading" },
  ask_user: { ru: "Вопрос от Avy", en: "Question from Avy" },
  task: { ru: "Задача", en: "Task" },
  // Запись в проектную память. Заголовок нейтральный: конкретика (что именно
  // сохранено/удалено) рисуется в code-tool-steps.tsx своим блоком.
  remember: { ru: "Запоминаю", en: "Remembering" },
};

/** Заголовок + цель для шага тула в UI. target пустой — не показываем строку. */
export function describeTool(
  name: string,
  args: Record<string, unknown>,
  locale: Locale,
): { title: string; target: string } {
  return {
    title: toolTitle(name, args, locale),
    target: toolTarget(name, args),
  };
}
