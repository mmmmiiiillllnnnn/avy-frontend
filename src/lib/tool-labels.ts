import type { Locale } from "@/lib/locale";

/**
 * Человеческие названия инструментов «от лица агента» (ru/en).
 *
 * Шаг в цепочке размышлений показывает не техническое имя тула (`read_file`), а
 * действие глазами агента: «Читаю файл report.pdf». Заголовок — короткий глагол
 * действия, target (имя файла / команда / запрос) выносится отдельной строкой и
 * рендерится моноширинным, как раньше.
 */

/**
 * Стадия шага: идёт / успешно закончен / закончен с ошибкой. От неё зависит
 * время глагола в заголовке («Выполняю команду» → «Команда выполнена»).
 */
export type ToolStatus = "running" | "done" | "failed";

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
  // Для файла под /skills/ цель — путь ВНУТРИ навыка («pdf/creating.md»):
  // видно и какой навык, и какой именно его файл агент смотрит.
  const path = filePath(name, args);
  if (skillName(path)) return path.replace(/^\/skills\//, "");
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
    case "recurring_task":
      // Заголовок уже несёт action; отдельная строка-цель тут не нужна —
      // иначе под «Создаю задачу» висело бы сырое «create».
      return "";
    case "get_weather":
      // Цель — город. Без этой ветки default брал ПЕРВЫЙ аргумент, а это
      // action, и в превью цепочки висело сырое «show»/«search».
      return String(a.city ?? "");
    case "ask_user":
      // ПУСТО намеренно: в цепочке показываем только факт вопроса. Сам вопрос
      // человек читает в карточке над вводом, дублировать его здесь незачем, а
      // default выдал бы сырой массив questions ([object Object]).
      return "";
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

/**
 * Заголовок-действие тула на нужном языке. Незнакомый тул → его имя как есть.
 *
 * `status` меняет ВРЕМЯ глагола: пока шаг идёт — настоящее («Выполняю
 * команду»), когда закончен — прошедшее («Команда выполнена») или форма
 * ошибки. У незнакомых тулов словаря нет — там заголовок один на все статусы.
 */
function toolTitle(
  name: string,
  args: Record<string, unknown>,
  locale: Locale,
  status: ToolStatus = "running",
): string {
  const isSkill = Boolean(skillName(filePath(name, args)));

  // recurring_task: заголовок несёт action (create/run_now/...), а не имя тула.
  if (name === "recurring_task") {
    const t = recurringTitle(args, locale, status);
    if (t) return t;
  }

  // get_weather: то же самое — show и search это разные действия. Кроме
  // failed: форму ошибки берём ниже из TOOL_TITLES_DONE, иначе при отказе
  // («город не найден») висело бы бодрое «Погода получена».
  if (name === "get_weather" && status !== "failed") {
    const t = weatherTitle(args, locale, status);
    if (t) return t;
  }

  if (status === "done" || status === "failed") {
    if (isSkill && status === "done" && SKILL_TITLES_DONE[name]) {
      return SKILL_TITLES_DONE[name][locale];
    }
    const done = TOOL_TITLES_DONE[name];
    if (done) {
      if (status === "failed") {
        return locale === "ru" ? done.failRu : done.failEn;
      }
      return done[locale];
    }
  }

  // Файловый тул, работающий с навыком (/skills/...): «Читаю/Пишу навык».
  if (isSkill && SKILL_TITLES[name]) {
    return SKILL_TITLES[name][locale];
  }
  const dict = TOOL_TITLES[name];
  if (dict) return dict[locale];
  // Незнакомый инструмент (скилл и т.п.): человекочитаем имя — снимаем _,
  // делаем Title Case, чтобы не висел сырой snake_case.
  return name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * recurring_task — один тул с полем `action` (create/update/list/delete/
 * run_now). Заголовок зависит от action, а не от имени тула, поэтому у него
 * свой словарь: running-форма и done-форма (прошедшее время). Без него в
 * превью показывалось сырое «create»/«run_now».
 */
const RECURRING_TITLES: Record<
  string,
  { ru: string; en: string; doneRu: string; doneEn: string }
> = {
  create: {
    ru: "Создаю задачу",
    en: "Creating task",
    doneRu: "Задача создана",
    doneEn: "Task created",
  },
  update: {
    ru: "Обновляю задачу",
    en: "Updating task",
    doneRu: "Задача обновлена",
    doneEn: "Task updated",
  },
  list: {
    ru: "Смотрю задачи",
    en: "Listing tasks",
    doneRu: "Задачи получены",
    doneEn: "Tasks listed",
  },
  delete: {
    ru: "Удаляю задачу",
    en: "Deleting task",
    doneRu: "Задача удалена",
    doneEn: "Task deleted",
  },
  run_now: {
    ru: "Запускаю задачу",
    en: "Running task",
    doneRu: "Задача запущена",
    doneEn: "Task started",
  },
};

/** Заголовок recurring_task по action и статусу (или null для неизвестного). */
function recurringTitle(
  args: Record<string, unknown>,
  locale: Locale,
  status: ToolStatus,
): string | null {
  const action = String((args ?? {}).action ?? "");
  const t = RECURRING_TITLES[action];
  if (!t) return null;
  // failed отдельной формы не имеет — падение видно по красному узлу, а текст
  // остаётся понятным («Запускаю задачу»); дублировать 5×2 форм ошибки незачем.
  if (status === "done") return locale === "ru" ? t.doneRu : t.doneEn;
  return locale === "ru" ? t.ru : t.en;
}

/** Заголовки get_weather по action: «show» и «search» — разные действия, и в
 *  превью цепочки они не должны выглядеть одинаково. */
const WEATHER_TITLES: Record<
  string,
  { ru: string; en: string; doneRu: string; doneEn: string }
> = {
  show: {
    ru: "Смотрю погоду",
    en: "Checking the weather",
    doneRu: "Погода получена",
    doneEn: "Weather loaded",
  },
  search: {
    ru: "Уточняю место",
    en: "Looking up the place",
    doneRu: "Место уточнено",
    doneEn: "Place resolved",
  },
};

/** Заголовок get_weather по action и статусу (или null для неизвестного). */
function weatherTitle(
  args: Record<string, unknown>,
  locale: Locale,
  status: ToolStatus,
): string | null {
  // Дефолт — show: аргумент может ещё дозревать в стриме, а «Смотрю погоду»
  // верно для самого частого случая.
  const t = WEATHER_TITLES[String((args ?? {}).action ?? "show")];
  if (!t) return null;
  if (status === "done") return locale === "ru" ? t.doneRu : t.doneEn;
  return locale === "ru" ? t.ru : t.en;
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
  web_fetch: { ru: "Загружаю файл", en: "Downloading file" },
  // Виден только при action="search": показ погоды выносится из цепочки
  // отдельным виджетом (см. tool-steps.tsx).
  // Запасной вариант: обычно заголовок даёт weatherTitle по action, сюда
  // попадаем только при неизвестном/пустом action.
  get_weather: { ru: "Смотрю погоду", en: "Checking the weather" },
  ask_user: { ru: "Задаю вопрос", en: "Asking a question" },
  // Пока аргументы task стримятся, шаг живёт в цепочке рассуждений с этим
  // заголовком и бегущим брифом; карточкой он становится с готовыми аргументами.
  task: { ru: "Ставлю задачу агенту", en: "Briefing an agent" },
  // Запуск задачи теперь отдельной узкой тулой (задачи сами — файлы /tasks/).
  run_task: { ru: "Запускаю задачу", en: "Running task" },
};

/**
 * Заголовки ЗАВЕРШЁННОГО действия — прошедшее время вместо настоящего.
 *
 * «Выполняю команду» описывает то, что идёт прямо сейчас; когда шаг закончен,
 * в ленте он должен читаться как факт: «Команда выполнена». Ошибка — своей
 * формулировкой, чтобы неудачный шаг был виден без раскрытия.
 */
const TOOL_TITLES_DONE: Record<
  string,
  { ru: string; en: string; failRu: string; failEn: string }
> = {
  bash: {
    ru: "Команда выполнена",
    en: "Command finished",
    failRu: "Команда завершилась ошибкой",
    failEn: "Command failed",
  },
  read_file: {
    ru: "Файл прочитан",
    en: "File read",
    failRu: "Файл прочитать не удалось",
    failEn: "Couldn't read file",
  },
  write_file: {
    ru: "Файл записан",
    en: "File written",
    failRu: "Файл записать не удалось",
    failEn: "Couldn't write file",
  },
  edit_file: {
    ru: "Файл изменён",
    en: "File edited",
    failRu: "Изменить файл не удалось",
    failEn: "Couldn't edit file",
  },
  ls: {
    ru: "Папка просмотрена",
    en: "Folder listed",
    failRu: "Открыть папку не удалось",
    failEn: "Couldn't list folder",
  },
  glob: {
    ru: "Поиск файлов завершён",
    en: "File search finished",
    failRu: "Найти файлы не удалось",
    failEn: "File search failed",
  },
  grep: {
    ru: "Поиск по содержимому завершён",
    en: "Content search finished",
    failRu: "Поиск не удался",
    failEn: "Search failed",
  },
  web_search: {
    ru: "Поиск завершён",
    en: "Search finished",
    failRu: "Поиск не удался",
    failEn: "Search failed",
  },
  web_fetch: {
    ru: "Файл загружен",
    en: "File downloaded",
    failRu: "Не удалось загрузить",
    failEn: "Download failed",
  },
  get_weather: {
    // Успешные формы обычно даёт weatherTitle; здесь важны формы ОШИБКИ —
    // их он не покрывает.
    ru: "Погода получена",
    en: "Weather loaded",
    failRu: "Не удалось получить погоду",
    failEn: "Could not load weather",
  },
  ask_user: {
    // Факт, а не содержание: сами вопросы и выбранные ответы в цепочке не
    // показываем (их видно в карточке над вводом), здесь только «спросил».
    ru: "Вопрос задан",
    en: "Question asked",
    failRu: "Вопрос задать не удалось",
    failEn: "Couldn't ask the question",
  },
  task: {
    ru: "Агент закончил",
    en: "Agent finished",
    failRu: "Агент завершился ошибкой",
    failEn: "Agent failed",
  },
  run_task: {
    ru: "Задача запущена",
    en: "Task started",
    failRu: "Задачу запустить не удалось",
    failEn: "Couldn't start the task",
  },
};

/** Заголовки завершения для файловых тулов, когда путь ведёт в /skills/. */
const SKILL_TITLES_DONE: Record<string, { ru: string; en: string }> = {
  read_file: { ru: "Навык изучен", en: "Skill studied" },
  write_file: { ru: "Навык записан", en: "Skill written" },
  edit_file: { ru: "Навык изменён", en: "Skill edited" },
};

/**
 * Заголовок + цель для шага тула в UI. target пустой — не показываем строку.
 *
 * `status` по умолчанию "running" — так вызовы без него (история, окно
 * субагента) продолжают показывать привычный заголовок в настоящем времени.
 */
export function describeTool(
  name: string,
  args: Record<string, unknown>,
  locale: Locale,
  status: ToolStatus = "running",
): { title: string; target: string } {
  return {
    title: toolTitle(name, args, locale, status),
    target: toolTarget(name, args),
  };
}

/**
 * Аргументы, которые несут СОДЕРЖИМОЕ работы, — их показывает бегущий
 * предпросмотр (live-окно и раскрытая лента).
 *
 * Список белый, а не чёрный: у тулов полно служебных параметров (`topic`,
 * `time_range`, `subagent_type`, лимиты, флаги), и чёрный список протекал бы
 * на каждом новом. Сам путь/команда/запрос сюда НЕ входят: они уже показаны
 * как target.
 */
const CONTENT_ARG_KEYS = new Set(["content", "new_string", "prompt", "description"]);

/** Текст контентных аргументов для бегущего предпросмотра (ключи опущены). */
export function contentArgsText(args: Record<string, unknown>): string {
  return Object.entries(args ?? {})
    .filter(([k, v]) => CONTENT_ARG_KEYS.has(k) && typeof v === "string")
    .map(([, v]) => v as string)
    .filter(Boolean)
    .join("  ")
    .trim();
}
