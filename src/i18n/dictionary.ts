import type { Locale } from "@/lib/locale";

/** Русское склонение по числу: plural(1,"день","дня","дней") -> "день". */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

// Юридические тексты — ШАБЛОН («рыба») для замены финальной редакцией/юристом.
// Рендерятся как простой текст с абзацами по \n\n (см. LegalLayout).
const PRIVACY_BODY_RU = `Это шаблон политики конфиденциальности Avy Chat и требует юридической вычитки перед публикацией.

1. Какие данные мы собираем. При регистрации — email и имя. В ходе работы сервиса — содержимое ваших диалогов с ассистентом, загруженные файлы и метаданные использования (объём запросов, расход кредитов).

2. Зачем мы их используем. Чтобы предоставлять сервис: обрабатывать ваши запросы, хранить историю диалогов, считать потребление и обеспечивать поддержку.

3. Хранение и удаление. Данные хранятся, пока активен ваш аккаунт. При удалении аккаунта он помечается на удаление и сохраняется 60 дней (для возможности восстановления), после чего данные удаляются безвозвратно. Обезличенные записи о потреблении могут сохраняться для биллинга и аналитики.

4. Передача третьим лицам. Для работы ассистента запросы обрабатываются провайдерами моделей. Мы не продаём ваши персональные данные.

5. Ваши права. Вы можете изменить имя и пароль, выйти со всех устройств и удалить аккаунт в разделе «Настройки».

6. Контакты. По вопросам обработки данных напишите нам.`;

const TERMS_BODY_RU = `Это шаблон условий использования Avy Chat и требует юридической вычитки перед публикацией.

1. Принятие условий. Регистрируясь и используя Avy Chat, вы соглашаетесь с этими условиями и Политикой конфиденциальности.

2. Доступ к сервису. Регистрация закрытая, по приглашению. Вы отвечаете за сохранность данных своего аккаунта.

3. Допустимое использование. Запрещено использовать сервис для незаконных действий, нарушения прав третьих лиц или попыток нарушить работу сервиса.

4. Контент. Вы сохраняете права на свой контент. Вы отвечаете за то, что загружаете и о чём спрашиваете ассистента.

5. Ограничение ответственности. Сервис предоставляется «как есть». Ответы ассистента могут содержать неточности — проверяйте важную информацию.

6. Изменения. Мы можем обновлять условия; продолжая пользоваться сервисом, вы принимаете обновлённую редакцию.`;

const PRIVACY_BODY_EN = `This is a template privacy policy for Avy Chat and requires legal review before publication.

1. Data we collect. At sign-up — your email and name. During use — the content of your conversations with the assistant, uploaded files, and usage metadata (request volume, credit consumption).

2. How we use it. To provide the service: process your requests, store conversation history, meter usage, and offer support.

3. Storage and deletion. Data is kept while your account is active. When you delete your account, it is marked for deletion and retained for 60 days (so you can restore it), after which the data is permanently erased. Anonymized usage records may be retained for billing and analytics.

4. Third parties. To run the assistant, requests are processed by model providers. We do not sell your personal data.

5. Your rights. You can change your name and password, sign out of all devices, and delete your account under Settings.

6. Contact. For data questions, get in touch with us.`;

const TERMS_BODY_EN = `This is a template terms of service for Avy Chat and requires legal review before publication.

1. Acceptance. By registering and using Avy Chat, you agree to these terms and the Privacy Policy.

2. Access. Registration is invite-only and closed. You are responsible for keeping your account credentials safe.

3. Acceptable use. You may not use the service for unlawful activity, to infringe others' rights, or to attempt to disrupt the service.

4. Content. You retain rights to your content. You are responsible for what you upload and ask the assistant.

5. Limitation of liability. The service is provided "as is". Assistant responses may be inaccurate — verify important information.

6. Changes. We may update these terms; by continuing to use the service you accept the updated version.`;

/**
 * Словари интерфейса чата (ru/en). Структура сгруппирована по областям UI.
 * Значения-функции — для строк с подстановкой (count, имя файла, проценты).
 *
 * Тулзовые подписи (названия инструментов «от лица агента») живут отдельно в
 * lib/tool-labels.ts — там своя структура per-tool; сюда не дублируются.
 */
export type Dictionary = {
  auth: {
    signupTitle: string;
    loginTitle: string;
    signupSubtitle: string;
    loginSubtitle: string;
    name: string;
    namePlaceholder: string;
    email: string;
    password: string;
    passwordPlaceholderSignup: string;
    passwordPlaceholderLogin: string;
    inviteCode: string;
    inviteCodePlaceholder: string;
    showPassword: string;
    hidePassword: string;
    submitSignup: string;
    submitLogin: string;
    haveAccount: string;
    noAccount: string;
    goLogin: string;
    goSignup: string;
    errInvalidCredentials: string;
    errInvalidInvite: string;
    errEmailTaken: string;
    errInvalidEmail: string;
    errLoginFailed: string;
    errSignupFailed: string;
    errServiceDown: string;
    errConsentRequired: string;
    consentPrefix: string;
    consentTerms: string;
    consentAnd: string;
    consentPrivacy: string;
    /** Приветствие выданной роли (показывается один раз при входе). */
    welcomeTitle: string;
    welcomeClose: string;
  };
  recover: {
    title: string;
    body: (days: number) => string;
    passwordPrompt: string;
    button: string;
    backToLogin: string;
    errWrongPassword: string;
    errNotDeleted: string;
    genericError: string;
  };
  legal: {
    privacyTitle: string;
    privacyBody: string;
    termsTitle: string;
    termsBody: string;
    back: string;
    lastUpdated: string;
  };
  sidebar: {
    projects: string;
    tasks: string;
    files: string;
    modeAssistant: string;
    modeCode: string;
    modeAssistantDesc: string;
    modeCodeDesc: string;
    /** Режим «Студия контента» — пока не сделан. */
    modeStudio: string;
    modeStudioDesc: string;
    /** Раздел «Мои агенты» — пока не сделан. */
    agents: string;
    /** Подпись у выключенного пункта/режима. */
    soon: string;
    /** Почему режим недоступен в браузере. */
    desktopOnly: string;
    settings: string;
    userFallback: string;
    darkTheme: string;
    theme: string;
    language: string;
    logout: string;
  };
  settings: {
    title: string;
    general: string;
    themeLight: string;
    themeDark: string;
    loading: string;
    close: string;
    save: string;
    saved: string;
    cancel: string;
    nameLabel: string;
    // --- сертификаты контура (только внутри приложения) ---
    certs: string;
    certsCert: string;
    certsKey: string;
    certsAdd: string;
    certsReplace: string;
    certsLoaded: string;
    certsReady: string;
    certsHint: string;
    certsReveal: string;
    // --- обновления (только внутри приложения) ---
    updates: string;
    updatesVersion: string;
    updatesRow: string;
    updatesCheck: string;
    updatesChecking: string;
    updatesLatest: string;
    updatesAvailable: (version: string) => string;
    updatesInstall: string;
    updatesInstallHint: string;
    updatesError: string;
    updatesNoToken: string;
    updatesUnauthorized: string;
    updatesBrowserHint: string;
    // --- память агентов ---
    memory: string;
    memoryEnabled: string;
    memoryScopeUser: string;
    memoryScopeSpace: (name: string) => string;
    memoryOffHint: string;
    memoryIntro: string;
    memoryEmpty: string;
    memoryEmptyHint: string;
    memoryAgentEmpty: string;
    memoryForget: string;
    memoryExpires: (date: string) => string;
    memoryNoExpiry: string;
    memoryThisChat: string;
    memoryLayersFootnote: string;
  };
  limit: {
    bannerExhausted: string;
    bannerExhaustedReset: (date: string) => string;
  };
  chat: {
    greeting: string;
    pastedText: string;
    newChat: string;
    sessionFiles: string;
    subagents: string;
    sessionSettings: string;
    /** Заголовок вынесенного наружу шага «task» — задача, поставленная агенту. */
    agentTask: string;
    /** Фоновые субагенты: статус на шаге task. */
    bg: {
      running: string;
      done: string;
      error: string;
      cancelled: string;
      interrupted: string;
      waiting: string;
      stop: string;
    };
    /** Карточка задачи субагенту (тикет) и панель субагентов. */
    task: {
      /** Статусы — общие для карточки и панели. */
      status: {
        running: string;
        waiting: string;
        answered: string;
        done: string;
        error: string;
        cancelled: string;
        interrupted: string;
      };
      /** Секции панели. */
      sectionRunning: string;
      sectionWaiting: string;
      sectionDone: string;
      /** Подписи блоков карточки. */
      question: string;
      permission: string;
      answer: string;
      result: string;
      brief: string;
      continuation: string;
      /** Заголовок карточки-продолжения (ответ на вопрос / дозадание):
       *  фразы по такому брифу не бывает. */
      continuationTitle: string;
      inBackground: string;
      details: string;
      /** Раскрываемая история беседы с агентом на карточке. */
      history: string;
      historyQuestion: string;
      historyAnswer: string;
      historyResult: string;
      /** Шаги: формы для 1 / 2–4 / 5+ (ru) или единственное/множественное (en). */
      steps: [string, string, string];
    };
    /** Шаг ask_user в раскрытой ленте: вопросы, варианты, ответ. */
    askUserStep: { multi: string; answer: string };
    /** Подпись под репликой, отправленной посреди хода: агент прочтёт её на
     *  следующем шаге (перед следующим вызовом модели). */
    interjectPending: string;
    /** Виджет погоды (get_weather), вынесен наружу как task. */
    weather: {
      feels: string;
      humidity: string;
      wind: string;
      kmh: string;
      forecast: string;
      today: string;
      precip: string;
      sunset: string;
      sunrise: string;
      source: string;
      noPrecip: string;
      /** Описание погоды по condition. Переводим ЗДЕСЬ, а не на бэкенде:
       *  оттуда приходит только машинный код состояния. */
      conditions: Record<string, string>;
    };
    sessions: string;
    sessionFilter: string;
    sessionFilterAll: string;
    sessionFilterChats: string;
    sessionFilterSpaces: string;
    sessionFilterTasks: string;
    openTask: string;
    openSpace: string;
    deleteSession: string;
    deleteSessionConfirm: (title: string) => string;
    renameSession: string;
    renamePlaceholder: string;
    pinSession: string;
    unpinSession: string;
    pinnedSection: string;
    addToProject: string;
    moreActions: string;
    removeAttachment: (name: string) => string;
    contextTitle: (pct: number) => string;
    contextAria: (pct: number) => string;
    errors: {
      limit_exceeded: string;
      gateway_unavailable: string;
      timeout: string;
      model_error: string;
      internal: string;
      session_busy: string;
    };
    actions: {
      copy: string;
      copied: string;
      retry: string;
      like: string;
      dislike: string;
      edit: string;
      save: string;
      cancel: string;
    };
  };
  input: {
    attachFile: string;
    voiceInput: string;
    voiceInputSoon: string;
    /** Подписи моделей в выпадающем списке — чем модель отличается. */
    modelHints: Record<string, string>;
    fileTooBig: string;
    filesTooBig: (names: string) => string;
    dropToAttach: string;
    compressingContext: string;
    uploadingFiles: string;
    disclaimer: string;
    stop: string;
    send: string;
    deepResearch: string;
    /** Капсула выбора агента из библиотеки. Для пользователя агенты в чате —
     *  «режимы» (как «Доступен как режим» в разделе агентов),
     *  поэтому подпись «Режим», хотя ключ исторически agentPick. */
    agentPick: string;
    /** Заголовки разделов в меню модели: список моделей и глубина рассуждения. */
    modelSection: string;
    effortSection: string;
    agentNone: string;
    spacesGroup: string;
    /** Статичная подсказка пустого поля ОСНОВНОГО чата. Массив placeholders
     *  остался только у кодера — чат от бегающей строки отказался. */
    placeholder: string;
    placeholders: string[];
    /** Подсказка поля, пока агент работает: сообщение уйдёт ему на ходу. */
    placeholderStreaming: string;
  };
  code: {
    /** Заголовок пустого экрана Avy Code (бренд-название режима). */
    emptyTitle: string;
    /** Приглашение под заголовком пустого экрана. */
    emptyTagline: string;
    /** Еле заметная подсказка про клавиши в инпуте code-режима. */
    inputHint: string;
  };
  files: {
    images: string;
    documents: string;
    other: string;
    downloads: string;
    backToList: string;
    download: string;
    open: string;
    sessionFiles: string;
    /** Формы слова «файл» для счётчика (ru: one/few/many; en: одна форма+s). */
    fileForms: { one: string; few: string; many: string };
    refresh: string;
    closePanel: string;
    loading: string;
    noResults: string;
    previewUnavailable: string;
    loadFailed: string;
    pdfRenderFailed: string;
    deleteFile: string;
    deleteAll: string;
    deleteAllConfirm: string;
    deleting: string;
    cancel: string;
    moreActions: string;
    viewRendered: string;
    viewPlain: string;
  };
  bgTasks: {
    title: string;
    closePanel: string;
    empty: string;
    running: string;
    finished: string;
    failed: string;
    stopped: string;
    stop: string;
    rerun: string;
    remove: string;
    subagent: string;
    noOutput: string;
    logUnavailable: string;
    desktopOnly: string;
  };
  zoom: {
    zoomOut: string;
    resetZoom: string;
    zoomIn: string;
    fitToWindow: string;
  };
  /** Раздел «Обратная связь»: обращения с перепиской и отзывы. */
  /** Приглашение установить приложение (PWA). */
  install: {
    title: string;
    body: string;
    action: string;
    later: string;
    iosBody: string;
    iosStep1: string;
    iosStep2: string;
  };
  agents: {
    create: string;
    createManual: string;
    createManualHint: string;
    createWithAssistant: string;
    createWithAssistantHint: string;
    /** Уходит в чат первым сообщением — его читает ассистент, не человек. */
    assistantOpener: string;
    empty: string;
    edit: string;
    delete: string;
    cancel: string;
    save: string;
    createTitle: string;
    editTitle: string;
    fieldName: string;
    fieldNamePlaceholder: string;
    fieldDescription: string;
    fieldDescriptionPlaceholder: string;
    fieldDescriptionHint: string;
    fieldPrompt: string;
    fieldPromptPlaceholder: string;
    fieldPromptHint: string;
    fieldModel: string;
    fieldEffort: string;
    fieldSkills: string;
    fieldSkillsHint: string;
    skillsDefaultHint: string;
    fieldTools: string;
    /** Подсказка под «i». Здесь же — про каркас: файлы, командная строка и
     *  навыки есть у агента всегда, но в списке их нет (выключить нельзя), и
     *  без этой строки человек не знает, что они вообще есть. */
    fieldToolsHint: string;
    /** Свёрнутый вид набора: кнопка открытия модалки и сводка состава. */
    toolsConfigure: string;
    toolsSummaryDefaults: string;
    toolsSummaryEmpty: string;
    /** Подписи и описания записей реестров — по имени из конфига. Имена
     *  (`web`, `memory`) технические, человеку их показывать нельзя. */
    toolNames: Record<string, { label: string; hint: string }>;
    useDefaults: string;
    enabledLabel: string;
    enabledHint: string;
    delegatableLabel: string;
    delegatableHint: string;
    deleteTitle: string;
    deleteConfirm: (name: string) => string;
    /** Вкладки раздела: агенты и навыки — разные сущности, но живут вместе. */
    tabAgents: string;
    tabSkills: string;
    tabConnectors: string;
    skillsEmpty: string;
    /** Поиск, фильтры и сортировка над списком. */
    searchPlaceholder: string;
    filterAll: string;
    filterMine: string;
    sortLabel: string;
    sortName: string;
    sortRecent: string;
    nothingFound: string;
    connectorsSoon: string;
    createSkill: string;
    /** Просмотр коробочного навыка: файл без текстового вида, копия в свой. */
    skillFileNotShown: string;
    skillFork: string;
    skillEdit: string;
    /** Заголовки групп в результатах общего поиска. */
    groupAgents: string;
    groupSkills: string;
    /** Заголовки двух групп в каталоге навыков. */
    groupSkillsMine: string;
    groupSkillsBuiltin: string;
    groupConnectors: string;
    /** Форма своего навыка. */
    /** Заготовка разговора для пути «с помощью ассистента» у навыка. */
    skillAssistantOpener: string;
    skillNewTitle: string;
    skillEditTitle: string;
    skillFieldName: string;
    skillFieldNamePlaceholder: string;
    skillFieldNameHint: string;
    skillFieldDescription: string;
    skillFieldDescriptionPlaceholder: string;
    /** Описание решает, возьмётся ли навык вообще — об этом и подсказка. */
    skillFieldDescriptionHint: string;
    skillFieldCategory: string;
    skillFieldCategoryHint: string;
    skillFieldBody: string;
    skillFieldBodyPlaceholder: string;
    skillFieldBodyHint: string;
    skillEnabledLabel: string;
    skillEnabledHint: string;
    skillAdd: string;
    skillRemove: string;
    /** Метка личного навыка в сетке выбора навыков агента. */
    skillMine: string;
    skillBuiltinBadge: string;
    skillDeleteConfirm: (name: string) => string;
    /** Файлы навыка: скрипты, шаблоны, requirements.txt. Их кладут в форме —
     *  раньше это мог только ассистент в разговоре. */
    skillFilesLabel: string;
    skillTabFields: string;
    agentTabMain: string;
    skillFilesHint: string;
    skillFilesEmpty: string;
    skillFilesAdd: string;
  };
  spaces: {
    empty: string;
    create: string;
    /** Имя пространства, созданного кнопкой «Вручную»: форму мы больше не
     *  показываем, а безымянная строка в списке выглядит как сбой. */
    createDefaultName: string;
    createManual: string;
    createManualHint: string;
    createWithAssistant: string;
    createWithAssistantHint: string;
    /** Уходит в чат первым сообщением — его читает ассистент, не человек. */
    assistantOpener: string;
    nameLabel: string;
    namePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    descriptionHint: string;
    instructionLabel: string;
    instructionHint: string;
    instructionPlaceholder: string;
    skillsLabel: string;
    skillsHint: string;
    addSkill: string;
    emptySkills: string;
    skillFromLibrary: string;
    skillNoDescription: string;
    skillNamePlaceholder: string;
    skillDescriptionLabel: string;
    skillDescriptionPlaceholder: string;
    skillDescriptionHint: string;
    skillBodyPlaceholder: string;
    attachSkillPick: string;
    emptyAttachableSkills: string;
    tabAgents: string;
    tabSkills: string;
    attachFromLibrary: string;
    newChatDefault: string;
    tabOverview: string;
    emptyTeam: string;
    emptyAttachableAgents: string;
    settingsDanger: string;
    save: string;
    edit: string;
    archive: string;
    unarchive: string;
    archivedBadge: string;
    delete: string;
    deleteConfirm: (name: string) => string;
    tabSettings: string;
    tabFiles: string;
    tabMemory: string;
    newChat: string;
    settingsChats: string;
    settingsAgents: string;
    settingsAgentsHint: string;
    settingsTasks: string;
    settingsTasksHint: string;
    attachTask: string;
    attachTaskPick: string;
    detach: string;
    emptyChats: string;
    emptyFiles: string;
    emptyMemory: string;
    emptySpaceAgents: string;
    emptySpaceTasks: string;
    emptyAttachable: string;
    forgetFact: string;
    chatsCount: (n: number) => string;
  };
  recurringTasks: {
    tabActive: string;
    tabArchive: string;
    empty: string;
    emptyArchive: string;
    create: string;
    createManual: string;
    createManualHint: string;
    createWithAssistant: string;
    createWithAssistantHint: string;
    /** Заготовка первого сообщения ассистенту — та же роль, что у пространств. */
    assistantOpener: string;
    edit: string;
    delete: string;
    deleteConfirm: string;
    runNow: string;
    running: string;
    enabled: string;
    disabled: string;
    enable: string;
    disable: string;
    nameLabel: string;
    namePlaceholder: string;
    scheduleLabel: string;
    scheduleDaily: string;
    scheduleWeekdays: string;
    scheduleWeekly: string;
    scheduleInterval: string;
    everyLabel: string;
    unitMinutes: string;
    unitHours: string;
    atTime: string;
    onDay: string;
    timezoneLabel: string;
    agentLabel: string;
    agentDefault: string;
    instructionLabel: string;
    instructionHint: string;
    instructionPlaceholder: string;
    save: string;
    cancel: string;
    secrets: string;
    secretsHint: string;
    /** Форма создания: секреты и вложения привязываются после сохранения. */
    pendingSaveHint: string;
    createdWithProblems: (problems: string) => string;
    saveFailed: string;
    onFailure: string;
    retryPrefix: string;
    retryTimes: (n: number) => string;
    retryPause: string;
    secondsShort: string;
    secretName: string;
    secretValue: string;
    secretNameHint: string;
    secretSaveFailed: string;
    addSecret: string;
    noSecrets: string;
    deleteSecret: string;
    runs: string;
    noRuns: string;
    openRun: string;
    deleteRun: string;
    files: string;
    inputs: string;
    inputsHint: string;
    outputs: string;
    outputsHint: string;
    addFiles: string;
    addFolder: string;
    dropHere: string;
    noInputs: string;
    noOutputs: string;
    uploading: string;
    deleteFolder: string;
    deleteFolderConfirm: string;
    runOk: string;
    runError: string;
    runRunning: string;
    attempt: string;
    tokens: string;
    lastRun: string;
    nextRun: string;
    never: string;
    backToList: string;
    backToTask: string;
    addToProject: string;
    projectsSoon: string;
    weekdayNames: string[];
    createFailed: string;
    alreadyRunning: string;
  };
};

const ru: Dictionary = {
  auth: {
    signupTitle: "Создать аккаунт",
    loginTitle: "С возвращением",
    signupSubtitle: "Зарегистрируйтесь, чтобы начать работу в Avy Chat.",
    loginSubtitle: "Войдите, чтобы продолжить работу в Avy Chat.",
    name: "Имя",
    namePlaceholder: "Как к вам обращаться",
    email: "Email",
    password: "Пароль",
    passwordPlaceholderSignup: "Минимум 8 символов",
    passwordPlaceholderLogin: "Ваш пароль",
    inviteCode: "Код приглашения",
    inviteCodePlaceholder: "Пригласительный код",
    showPassword: "Показать пароль",
    hidePassword: "Скрыть пароль",
    submitSignup: "Зарегистрироваться",
    submitLogin: "Войти",
    haveAccount: "Уже есть аккаунт?",
    noAccount: "Нет аккаунта?",
    goLogin: "Войти",
    goSignup: "Создать",
    errInvalidCredentials: "Неверный email или пароль.",
    errInvalidInvite: "Неверный код приглашения.",
    errEmailTaken: "Этот email уже зарегистрирован.",
    errInvalidEmail: "Некорректный email.",
    errLoginFailed: "Не удалось войти. Попробуйте ещё раз.",
    errSignupFailed: "Не удалось зарегистрироваться. Попробуйте ещё раз.",
    errServiceDown: "Сервис недоступен. Проверьте подключение.",
    errConsentRequired: "Подтвердите согласие с условиями, чтобы продолжить.",
    consentPrefix: "Я принимаю",
    consentTerms: "Условия использования",
    consentAnd: "и",
    consentPrivacy: "Политику конфиденциальности",
    welcomeTitle: "Добро пожаловать",
    welcomeClose: "Понятно",
  },
  recover: {
    title: "Аккаунт удалён",
    body: (days) =>
      `Этот аккаунт помечен на удаление. Восстановить его можно ещё ${days} ${plural(days, "день", "дня", "дней")}. После — данные удаляются безвозвратно.`,
    passwordPrompt: "Введите пароль для восстановления",
    button: "Восстановить аккаунт",
    backToLogin: "Вернуться ко входу",
    errWrongPassword: "Неверный email или пароль.",
    errNotDeleted: "Этот аккаунт не помечен на удаление.",
    genericError: "Не удалось восстановить аккаунт. Попробуйте ещё раз.",
  },
  legal: {
    privacyTitle: "Политика конфиденциальности",
    privacyBody: PRIVACY_BODY_RU,
    termsTitle: "Условия использования",
    termsBody: TERMS_BODY_RU,
    back: "Назад",
    lastUpdated: "Обновлено 1 июня 2026",
  },
  sidebar: {
    projects: "Пространства",
    tasks: "Регулярные задачи",
    files: "Файлы",
    modeAssistant: "Avy Chat",
    modeCode: "Avy Code",
    modeAssistantDesc: "Универсальный ассистент",
    modeCodeDesc: "Работа с кодом и файлами",
    modeStudio: "Студия контента",
    modeStudioDesc: "Тексты, картинки и видео",
    agents: "Мои агенты",
    soon: "скоро",
    desktopOnly: "только в приложении",
    settings: "Настройки",
    userFallback: "Пользователь",
    darkTheme: "Тёмная тема",
    theme: "Тема",
    language: "Язык",
    logout: "Выйти",
  },
  settings: {
    title: "Настройки",
    general: "Общие",
    themeLight: "Светлая",
    themeDark: "Тёмная",
    loading: "Загрузка…",
    close: "Закрыть",
    save: "Сохранить",
    saved: "Сохранено",
    cancel: "Отмена",
    nameLabel: "Имя",
    certs: "Подключение к модели",
    certsCert: "Сертификат",
    certsKey: "Приватный ключ",
    certsAdd: "Выбрать файл",
    certsReplace: "Заменить",
    certsLoaded: "загружен",
    certsReady: "Оба файла на месте — модель подключена.",
    certsHint:
      "Модель контура узнаёт приложение по сертификату. Приложите оба файла: без них агент не сможет отвечать.",
    certsReveal: "Показать папку",
    updates: "Обновления",
    updatesVersion: "Версия",
    updatesRow: "Новая версия",
    updatesCheck: "Проверить обновления",
    updatesChecking: "Проверяю…",
    updatesLatest: "У вас последняя версия.",
    updatesAvailable: (version) => `Доступна версия ${version}`,
    updatesInstall: "Скачать и установить",
    updatesInstallHint:
      "Приложение скачает обновление, остановит сервисы, поставит новые и запустит их снова. Это займёт несколько минут; открытые чаты сохранятся.",
    updatesError: "Не удалось связаться с сервером обновлений.",
    updatesNoToken:
      "В настройках установки нет токена обновлений (AVY_UPDATE_TOKEN в .env).",
    updatesUnauthorized:
      "Сервер обновлений не принял токен этой установки (AVY_UPDATE_TOKEN в .env).",
    updatesBrowserHint: "Обновления ставятся из приложения Avy.",
    memory: "Память",
    memoryEnabled: "Запоминать",
    memoryScopeUser: "О вас",
    memoryScopeSpace: (name: string) =>
      name ? `Пространство «${name}»` : "Пространство",
    memoryOffHint:
      "Новые записи не появляются, старые не используются в ответах. Всё, что уже записано, сохранено — включите, и оно снова заработает.",
    memoryIntro:
      "Что агенты запомнили из ваших разговоров. Эти записи попадают в каждый ответ — любую можно удалить.",
    memoryEmpty: "Пока агенты ничего не запомнили",
    memoryEmptyHint:
      "Записи появляются сами, когда в разговоре встречается что-то, что пригодится позже.",
    memoryAgentEmpty: "Ничего не запомнил",
    memoryForget: "Удалить",
    memoryExpires: (date) => `до ${date}`,
    memoryNoExpiry: "бессрочно",
    memoryThisChat: "в этом чате",
    memoryLayersFootnote:
      "Память пространства видят все агенты, работающие в нём. Личный слой — только вы.",
  },
  limit: {
    bannerExhausted: "Лимит кредитов исчерпан.",
    bannerExhaustedReset: (date) => `Лимит кредитов исчерпан — обновится ${date}.`,
  },
  chat: {
    greeting: "Чем могу помочь?",
    pastedText: "Вставленный текст",
    newChat: "Новый чат",
    sessionFiles: "Файлы сессии",
    subagents: "Субагенты",
    sessionSettings: "Настройки сессии",
    agentTask: "Задача для агента",
    bg: {
      running: "работает в фоне",
      done: "завершён",
      error: "ошибка",
      cancelled: "остановлен",
      interrupted: "прерван",
      waiting: "ждёт ответа",
      stop: "Остановить",
    },
    task: {
      status: {
        running: "работает",
        waiting: "ждёт ответа",
        answered: "продолжает",
        done: "готово",
        error: "ошибка",
        cancelled: "остановлен",
        interrupted: "прерван",
      },
      sectionRunning: "Работают",
      sectionWaiting: "Ждут ответа",
      sectionDone: "Готово",
      question: "Вопрос оркестратору",
      permission: "Просит разрешение",
      answer: "Ответ",
      result: "Итог",
      brief: "Задание",
      continuation: "продолжение",
      continuationTitle: "Ответ субагенту",
      inBackground: "в фоне",
      details: "Подробнее",
      history: "История",
      historyQuestion: "Запрос дополнительной информации",
      historyAnswer: "Предоставление информации",
      historyResult: "Результат",
      steps: ["шаг", "шага", "шагов"],
    },
    askUserStep: { multi: "можно несколько", answer: "Ответ" },
    interjectPending: "В очереди",
    weather: {
      feels: "ощущается",
      humidity: "влажность",
      wind: "ветер",
      kmh: "км/ч",
      forecast: "прогноз",
      today: "сегодня по часам",
      precip: "вероятность осадков",
      sunset: "закат",
      sunrise: "восход",
      source: "Данные",
      noPrecip: "без осадков",
      conditions: {
        clear: "ясно",
        "mostly-clear": "преимущественно ясно",
        "partly-cloudy": "переменная облачность",
        overcast: "пасмурно",
        fog: "туман",
        drizzle: "морось",
        rain: "дождь",
        "freezing-rain": "ледяной дождь",
        snow: "снег",
        thunderstorm: "гроза",
      },
    },
    sessions: "Сессии",
    sessionFilter: "Фильтр по типу",
    sessionFilterAll: "Все",
    sessionFilterChats: "Чаты",
    sessionFilterSpaces: "Пространства",
    sessionFilterTasks: "Задачи",
    openTask: "Перейти к задаче",
    openSpace: "Перейти в пространство",
    deleteSession: "Удалить сессию",
    deleteSessionConfirm: (title: string) =>
      `Удалить «${title}»? Переписка и файлы сессии пропадут без возможности восстановления.`,
    renameSession: "Переименовать",
    renamePlaceholder: "Название сессии",
    pinSession: "Закрепить",
    unpinSession: "Открепить",
    pinnedSection: "Закреплённые",
    addToProject: "Добавить в пространство",
    moreActions: "Действия",
    removeAttachment: (name) => `Убрать ${name}`,
    contextTitle: (pct) =>
      `Контекст заполнен на ${pct}% — нажмите, чтобы сжать сейчас`,
    contextAria: (pct) => `Контекст заполнен на ${pct}%, нажмите чтобы сжать`,
    errors: {
      limit_exceeded:
        "Лимит запросов исчерпан. Попробуйте позже или обратитесь к администратору.",
      gateway_unavailable:
        "Сервис ИИ временно недоступен. Попробуйте ещё раз через минуту.",
      timeout: "Модель слишком долго отвечает. Попробуйте ещё раз.",
      model_error:
        "Ошибка при обращении к модели. Попробуйте переформулировать запрос.",
      internal: "Что-то пошло не так. Попробуйте ещё раз.",
      session_busy:
        "Сессия была занята выгрузкой файлов, сообщение не дошло до агента. Отправьте его ещё раз.",
    },
    actions: {
      copy: "Копировать",
      copied: "Скопировано",
      retry: "Повторить",
      like: "Хороший ответ",
      dislike: "Плохой ответ",
      edit: "Редактировать",
      save: "Сохранить",
      cancel: "Отмена",
    },
  },
  input: {
    attachFile: "Прикрепить файл",
    voiceInput: "Голосовой ввод",
    voiceInputSoon: "Голосовой ввод — скоро",
    modelHints: {
      "qwen3.7-plus": "Быстрая, для повседневных задач",
      "qwen3.8-max": "Мощнее и дороже, для сложных задач",
    },
    fileTooBig: "Файл слишком большой (макс. 25 МБ) и не прикреплён.",
    filesTooBig: (names) =>
      `Файлов слишком больших (макс. 25 МБ): ${names} — не прикреплены.`,
    dropToAttach: "Отпустите файлы, чтобы прикрепить",
    compressingContext: "Сжимаю контекст…",
    uploadingFiles: "Загружаю вложения…",
    disclaimer: "Модель может ошибаться. Перепроверяйте факты.",
    stop: "Остановить (Esc)",
    send: "Отправить",
    deepResearch: "Глубокое исследование",
    agentPick: "Режим",
    modelSection: "Модель",
    effortSection: "Глубина рассуждения",
    agentNone: "По умолчанию",
    spacesGroup: "Пространства",
    placeholder: "Спросите о чём угодно",
    placeholderStreaming: "Дополнить или поправить на ходу…",
    placeholders: [
      "Создай PDF-документ",
      "Проанализируй данные",
      "Напиши и запусти скрипт",
      "Сделай отчёт по таблице",
      "Сгенерируй спецификацию",
    ],
  },
  code: {
    emptyTitle: "Avy Code",
    emptyTagline: "Давай создавать вместе!",
    inputHint: "Enter — отправить, Shift+Enter — новая строка",
  },
  files: {
    images: "Картинки",
    documents: "Документы",
    other: "Другое",
    downloads: "Загрузки",
    backToList: "Назад к списку",
    download: "Скачать",
    open: "Открыть",
    sessionFiles: "Файлы сессии",
    fileForms: { one: "файл", few: "файла", many: "файлов" },
    refresh: "Обновить",
    closePanel: "Закрыть панель",
    loading: "Загрузка…",
    noResults: "Файлов пока нет.",
    previewUnavailable: "Предпросмотр недоступен для этого типа файла.",
    loadFailed: "Не удалось загрузить файл.",
    pdfRenderFailed: "Не удалось отобразить PDF.",
    deleteFile: "Удалить файл",
    deleteAll: "Удалить все",
    deleteAllConfirm: "Удалить все файлы этой сессии? Действие необратимо.",
    deleting: "Удаление…",
    cancel: "Отмена",
    moreActions: "Действия",
    viewRendered: "Markdown",
    viewPlain: "Текст",
  },
  bgTasks: {
    title: "Фоновые задачи",
    closePanel: "Закрыть панель",
    empty: "Фоновых задач пока нет.",
    running: "идёт",
    finished: "готово",
    failed: "упал",
    stopped: "остановлен",
    stop: "Стоп",
    rerun: "Запустить снова",
    remove: "Удалить из истории",
    subagent: "субагент",
    noOutput: "(пока нет вывода)",
    logUnavailable: "Лог ещё не создан или недоступен.",
    desktopOnly: "Лог доступен только в десктоп-приложении.",
  },
  zoom: {
    zoomOut: "Уменьшить",
    resetZoom: "Сбросить масштаб",
    zoomIn: "Увеличить",
    fitToWindow: "По размеру окна",
  },
  install: {
    title: "Установить Avy",
    body: "Работает как приложение: свой значок и запуск без адресной строки.",
    action: "Установить",
    later: "Не сейчас",
    iosBody: "Добавьте Avy на экран «Домой» — откроется как приложение.",
    iosStep1: "Поделиться →",
    iosStep2: "На экран «Домой»",
  },
  agents: {
    create: "Создать агента",
    createManual: "Вручную",
    createManualHint: "Заполнить настройки самому",
    createWithAssistant: "С помощью ассистента",
    createWithAssistantHint: "Опишите задачу — он соберёт",
    assistantOpener:
      "Хочу агента под свою задачу. Сейчас опишу, какую работу он будет делать за меня.",
    empty: "Пока нет ни одного агента",
    edit: "Изменить",
    delete: "Удалить",
    cancel: "Отмена",
    save: "Сохранить",
    createTitle: "Новый агент",
    editTitle: "Настройка агента",
    fieldName: "Имя",
    fieldNamePlaceholder: "Например: Редактор текстов",
    fieldDescription: "Чем занимается",
    fieldDescriptionPlaceholder: "Краткое описание возможностей агента.",
    fieldDescriptionHint: "Короткая строка — её видите вы в списке и ассистент, когда решает, кому передать задачу.",
    fieldPrompt: "Инструкция",
    fieldPromptPlaceholder: "Опишите, как агент должен работать: что делает, чего избегает, в каком виде отвечает.",
    fieldPromptHint: "Главное поле. Пишите так, как объясняли бы человеку в первый рабочий день.",
    fieldModel: "Модель",
    fieldEffort: "Глубина рассуждения",
    fieldSkills: "Навыки",
    fieldSkillsHint:
      "Агент получит только отмеченные. Каждый навык занимает место в его инструкции, поэтому берите нужные для работы.",
    skillsDefaultHint:
      "Ничего не отмечено — агент получит набор по умолчанию, как в обычном чате.",
    fieldTools: "Инструменты",
    fieldToolsHint:
      "Файлы, командная строка и навыки есть у агента всегда — их в списке нет. Здесь то, что добавляется сверх: агент получит только отмеченное. Каждый инструмент описан в его инструкции, поэтому лишние занимают место впустую.",
    toolsConfigure: "Настроить",
    toolsSummaryDefaults: "По умолчанию",
    toolsSummaryEmpty: "Только файлы и команды",
    toolNames: {
      web: {
        label: "Поиск в интернете",
        hint: "Ищет и читает страницы, скачивает файлы себе в рабочую папку.",
      },
      weather: {
        label: "Погода",
        hint: "Прогноз и текущая погода, показывает карточку с погодой.",
      },
      tasks: {
        label: "Регулярные задачи",
        hint: "Заводит автоматизацию прямо в разговоре: повторять работу по расписанию.",
      },
      memory: {
        label: "Память",
        hint: "Помнит важное между разговорами и записывает новое сам.",
      },
      subagents: {
        label: "Субагенты",
        hint: "Передаёт часть работы другим агентам и собирает их результат.",
      },
      todos: {
        label: "План работы",
        hint: "Ведёт список шагов длинной задачи, чтобы не терять нить.",
      },
    },
    useDefaults: "По умолчанию",
    enabledLabel: "Доступен как режим",
    enabledHint:
      "Вы сможете запускать агента как отдельный чат через параметр «Режим» в поле ввода.",
    delegatableLabel: "Доступен как субагент",
    delegatableHint:
      "Ассистент в режиме по умолчанию будет видеть данного агента как инструмент и сможет ставить ему задачи как субагенту.",
    deleteTitle: "Удалить агента",
    deleteConfirm: (name) =>
      `Удалить «${name}»? Вместе с ним пропадёт всё, что он о вас запомнил. Отменить будет нельзя.`,
    tabAgents: "Агенты",
    tabSkills: "Навыки",
    tabConnectors: "Коннекторы",
    skillsEmpty: "Навыки не найдены",
    searchPlaceholder: "Поиск",
    filterAll: "Все",
    filterMine: "Мои",
    sortLabel: "Сортировка",
    sortName: "По названию",
    sortRecent: "Сначала новые",
    nothingFound: "Ничего не найдено",
    connectorsSoon: "Коннекторы скоро",
    createSkill: "Создать навык",
    skillFileNotShown: "Этот файл не показать текстом — картинка, архив или слишком большой.",
    skillFork: "Скопировать",
    skillEdit: "Редактировать",
    groupAgents: "Агенты",
    groupSkills: "Навыки",
    groupSkillsMine: "Мои навыки",
    groupSkillsBuiltin: "Встроенные",
    groupConnectors: "Коннекторы",
    skillAssistantOpener:
      "Хочу завести свой навык. Сейчас опишу работу, которую делаю регулярно, — надо, чтобы она всегда делалась одинаково.",
    skillNewTitle: "Новый навык",
    skillEditTitle: "Навык",
    skillFieldName: "Название",
    skillFieldNamePlaceholder: "Например: Недельный статус",
    skillFieldNameHint: "Как навык называется у вас в списке",
    skillFieldDescription: "Когда применять",
    skillFieldDescriptionPlaceholder:
      "Например: как оформить недельный статус для заказчика. Брать, когда просят статус, сводку или «что сделали за неделю».",
    skillFieldDescriptionHint:
      "Единственное, что видно до открытия навыка: по этому тексту решается, брать его или нет. Напишите, что он делает и по каким просьбам его звать.",
    skillFieldCategory: "Категория",
    skillFieldCategoryHint: "Группа в списке. Необязательно",
    skillFieldBody: "Инструкция",
    skillFieldBodyPlaceholder:
      "# Недельный статус\n\n## Шаг 1\nСобери, что сделано за неделю…",
    skillFieldBodyHint:
      "Сама процедура: шаги по порядку, что делать и чего не делать. Объясняйте почему — так правило переживает случай, который вы не предусмотрели.",
    skillAdd: "Добавить",
    skillRemove: "Убрать",
    skillMine: "свой",
    skillEnabledLabel: "Использовать навык",
    skillEnabledHint:
      "Выключенный навык остаётся здесь, но ассистент его не берёт. Навык не нужно выбирать — он применяется сам, когда задача подходит под описание.",
    skillBuiltinBadge: "из поставки",
    skillDeleteConfirm: (name) =>
      `Удалить «${name}»? Вместе с навыком пропадут его скрипты и шаблоны. Отменить будет нельзя.`,
    skillFilesLabel: "Файлы",
    skillTabFields: "Навык",
    agentTabMain: "Агент",
    skillFilesHint:
      "Скрипты, шаблоны и requirements.txt — всё, на что ссылается инструкция. Навык запускает их у себя в папке, поэтому имена должны совпадать с теми, что написаны в инструкции.",
    skillFilesEmpty: "Пока ничего не приложено",
    skillFilesAdd: "Добавить",
  },
  spaces: {
    empty: "Пока нет ни одного пространства. Создайте первое — чаты внутри него будут делить общие файлы.",
    create: "Новое пространство",
    createDefaultName: "Новое пространство",
    createManual: "Вручную",
    createManualHint: "Заполнить настройки самому",
    createWithAssistant: "С помощью ассистента",
    createWithAssistantHint: "Опишите работу — он соберёт",
    assistantOpener:
      "Хочу пространство под свою работу. Сейчас опишу, чем буду в нём заниматься.",
    nameLabel: "Название",
    namePlaceholder: "Например, «Работа» или «Маркетинг»",
    descriptionLabel: "Описание",
    descriptionPlaceholder: "Чем занято это пространство — одной фразой",
    descriptionHint: "Короткое описание: агент видит его в каждом чате пространства.",
    instructionLabel: "Инструкции",
    instructionHint: "Короткий текст, который агент видит в каждом чате пространства. Процедуры длиннее этой рамки заводите навыками.",
    instructionPlaceholder:
      "Например:\n\n" +
      "Это пространство отдела маркетинга: посты, рассылки, отчёты по кампаниям.\n\n" +
      "Пишем по-русски, на «вы». Тексты — в markdown.\n" +
      "Аудитория — разработчики: без маркетингового пафоса, по делу.\n" +
      "Цифры берём из /outputs/metrics.json, не по памяти; если данных нет — говорим об этом, а не оцениваем на глаз.\n" +
      "Черновики складываем в /drafts, готовое — в /outputs.\n\n" +
      "Перед отправкой наружу показываем текст мне.",
    skillsLabel: "Навыки пространства",
    skillsHint: "Агент видит их описания всегда и открывает нужный сам. Свои навыки живут только здесь.",
    addSkill: "Новый навык",
    emptySkills: "Навыков пока нет. Заведите свой или подключите из библиотеки.",
    skillFromLibrary: "из библиотеки",
    skillNoDescription: "Без описания — агент не поймёт, когда его брать",
    skillNamePlaceholder: "Название навыка",
    skillDescriptionLabel: "Когда применять",
    skillDescriptionPlaceholder: "Одной фразой: что делает и в каком случае браться",
    skillDescriptionHint: "Единственное, что модель видит до открытия навыка — по описанию она решает, взять его или нет.",
    skillBodyPlaceholder: "Инструкция: шаги, формат результата, на что обратить внимание…",
    attachSkillPick: "Выберите навык…",
    emptyAttachableSkills: "Свободных навыков нет — все уже подключены или библиотека пуста.",
    tabAgents: "Агенты",
    tabSkills: "Навыки",
    attachFromLibrary: "Добавить",
    newChatDefault: "По умолчанию",
    tabOverview: "Обзор",
    emptyTeam: "Агентов пока нет — подключите из библиотеки.",
    emptyAttachableAgents: "Свободных агентов нет — все уже подключены или библиотека пуста.",
    settingsDanger: "Архив и удаление",
    save: "Сохранить",
    edit: "Изменить",
    archive: "В архив",
    unarchive: "Вернуть из архива",
    archivedBadge: "В архиве",
    delete: "Удалить",
    deleteConfirm: (name: string) =>
      `Удалить «${name}»? Вместе с ним пропадут его чаты и общие файлы — безвозвратно. Регулярные задачи останутся: они просто открепятся.`,
    tabSettings: "Настройки",
    tabFiles: "Файлы",
    tabMemory: "Память",
    newChat: "Новый чат",
    settingsChats: "История сессий",
    settingsAgents: "Агенты пространства",
    settingsAgentsHint: "Подключённые агенты — команда пространства: они работают в его контексте.",
    settingsTasks: "Регулярные задачи",
    settingsTasksHint: "Прикреплённые задачи выполняются на общих файлах пространства.",
    attachTask: "Прикрепить",
    attachTaskPick: "Выберите задачу…",
    detach: "Открепить",
    emptyChats: "В пространстве ещё нет чатов.",
    emptyFiles: "Файлов пока нет — они появятся из чатов пространства.",
    emptyMemory: "Общая память пуста — агент наполнит её фактами из чатов пространства.",
    emptySpaceAgents: "В библиотеке нет агентов — создать их можно в разделе «Мои агенты».",
    emptySpaceTasks: "Прикреплённых задач нет.",
    emptyAttachable: "Свободных задач нет — все уже прикреплены или список пуст.",
    forgetFact: "Забыть",
    chatsCount: (n: number) => {
      const mod10 = n % 10;
      const mod100 = n % 100;
      if (mod10 === 1 && mod100 !== 11) return `${n} чат`;
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} чата`;
      return `${n} чатов`;
    },
  },
  recurringTasks: {
    tabActive: "Активные",
    tabArchive: "Архив",
    empty: "Пока нет ни одной задачи. Создайте первую.",
    emptyArchive: "Здесь появятся выключенные задачи.",
    create: "Новая задача",
    createManual: "Вручную",
    createManualHint: "Заполнить настройки самому",
    createWithAssistant: "С помощью ассистента",
    createWithAssistantHint: "Опишите задачу — он соберёт",
    assistantOpener:
      "Помоги завести регулярную задачу. Расспроси, что и как часто нужно " +
      "делать, и собери её.",
    edit: "Редактировать",
    delete: "Удалить",
    deleteConfirm: "Удалить задачу вместе со всеми прогонами и файлами? Это действие необратимо.",
    runNow: "Запустить сейчас",
    running: "Выполняется…",
    enabled: "Включена",
    disabled: "Выключена",
    enable: "Включить",
    disable: "Выключить",
    nameLabel: "Название",
    namePlaceholder: "Название задачи",
    scheduleLabel: "Когда запускать",
    scheduleDaily: "Каждый день",
    scheduleWeekdays: "По будням",
    scheduleWeekly: "Раз в неделю",
    scheduleInterval: "Через равные промежутки",
    everyLabel: "Каждые",
    unitMinutes: "мин.",
    unitHours: "ч.",
    atTime: "в",
    onDay: "по",
    timezoneLabel: "Часовой пояс",
    agentLabel: "Агент",
    agentDefault: "Ассистент (по умолчанию)",
    instructionLabel: "Инструкции",
    instructionHint: "Опишите словами, что нужно делать при каждом запуске — как задание человеку.",
    instructionPlaceholder: "Опишите, что должно происходить при каждом запуске…",
    save: "Сохранить",
    cancel: "Отмена",
    secrets: "Секреты",
    secretsHint: "Токены и ключи для доступа к внешним сервисам. Значения хранятся зашифрованно и никогда не показываются.",
    pendingSaveHint: "Сохранится вместе с задачей.",
    createdWithProblems: (problems) =>
      `Задача создана, но не всё прикрепилось: ${problems}. Добавьте это здесь ещё раз.`,
    saveFailed: "Не удалось сохранить задачу. Попробуйте ещё раз.",
    onFailure: "Если запуск не удался",
    retryPrefix: "повторить",
    retryTimes: (n: number) => plural(n, "раз", "раза", "раз"),
    retryPause: "с паузой",
    secondsShort: "сек.",
    secretName: "DEMO_TOKEN",
    secretValue: "sk-uy324-...",
    secretNameHint: "Имя: латиница в верхнем регистре, цифры и «_». Начинается с буквы.",
    secretSaveFailed: "Не удалось сохранить секрет",
    addSecret: "Добавить секрет",
    noSecrets: "Секретов пока нет.",
    deleteSecret: "Удалить секрет",
    runs: "Прогоны",
    noRuns: "Задача ещё ни разу не запускалась.",
    openRun: "Открыть прогон",
    deleteRun: "Удалить прогон",
    files: "Файлы",
    inputs: "Вложения",
    inputsHint: "Файлы и папки, которые вы прикладываете к задаче — агент читает их при каждом запуске.",
    outputs: "Артефакты",
    outputsHint: "Файлы, которые создаёт агент во время прогонов.",
    addFiles: "Добавить файлы",
    addFolder: "Добавить папку",
    dropHere: "Перетащите файлы или папки сюда",
    noInputs: "Пока нет вложений.",
    noOutputs: "Пока нет артефактов.",
    uploading: "Загрузка…",
    deleteFolder: "Удалить папку",
    deleteFolderConfirm: "Удалить папку «{name}» и все файлы внутри ({count})? Действие необратимо.",
    runOk: "Успешно",
    runError: "Ошибка",
    runRunning: "Выполняется",
    attempt: "попытка",
    tokens: "токенов",
    lastRun: "Последний запуск",
    nextRun: "Следующий запуск",
    never: "—",
    backToList: "К другим задачам",
    backToTask: "К задаче",
    addToProject: "Пространство",
    projectsSoon: "Пространства скоро — можно будет объединять задачи и файлы",
    weekdayNames: [
      "воскресеньям",
      "понедельникам",
      "вторникам",
      "средам",
      "четвергам",
      "пятницам",
      "субботам",
    ],
    createFailed: "Не удалось сохранить задачу",
    alreadyRunning: "Задача уже выполняется",
  },
};

const en: Dictionary = {
  auth: {
    signupTitle: "Create account",
    loginTitle: "Welcome back",
    signupSubtitle: "Sign up to start working in Avy Chat.",
    loginSubtitle: "Sign in to continue in Avy Chat.",
    name: "Name",
    namePlaceholder: "How should we address you",
    email: "Email",
    password: "Password",
    passwordPlaceholderSignup: "At least 8 characters",
    passwordPlaceholderLogin: "Your password",
    inviteCode: "Invite code",
    inviteCodePlaceholder: "Invitation code",
    showPassword: "Show password",
    hidePassword: "Hide password",
    submitSignup: "Sign up",
    submitLogin: "Sign in",
    haveAccount: "Already have an account?",
    noAccount: "No account?",
    goLogin: "Sign in",
    goSignup: "Create",
    errInvalidCredentials: "Invalid email or password.",
    errInvalidInvite: "Invalid invite code.",
    errEmailTaken: "This email is already registered.",
    errInvalidEmail: "Invalid email.",
    errLoginFailed: "Could not sign in. Please try again.",
    errSignupFailed: "Could not sign up. Please try again.",
    errServiceDown: "Service unavailable. Check your connection.",
    errConsentRequired: "Please accept the terms to continue.",
    consentPrefix: "I accept the",
    consentTerms: "Terms of Service",
    consentAnd: "and",
    consentPrivacy: "Privacy Policy",
    welcomeTitle: "Welcome",
    welcomeClose: "Got it",
  },
  recover: {
    title: "Account deleted",
    body: (days) =>
      `This account is marked for deletion. You can still restore it for ${days} ${days === 1 ? "day" : "days"}. After that, the data is permanently erased.`,
    passwordPrompt: "Enter your password to restore",
    button: "Restore account",
    backToLogin: "Back to sign in",
    errWrongPassword: "Invalid email or password.",
    errNotDeleted: "This account is not marked for deletion.",
    genericError: "Could not restore the account. Please try again.",
  },
  legal: {
    privacyTitle: "Privacy Policy",
    privacyBody: PRIVACY_BODY_EN,
    termsTitle: "Terms of Service",
    termsBody: TERMS_BODY_EN,
    back: "Back",
    lastUpdated: "Updated June 1, 2026",
  },
  sidebar: {
    projects: "Spaces",
    tasks: "Recurring tasks",
    files: "Files",
    modeAssistant: "Avy Chat",
    modeCode: "Avy Code",
    modeAssistantDesc: "General-purpose helper",
    modeCodeDesc: "Work with code and files",
    modeStudio: "Content Studio",
    modeStudioDesc: "Text, images and video",
    agents: "My agents",
    soon: "soon",
    desktopOnly: "desktop app only",
    settings: "Settings",
    userFallback: "User",
    darkTheme: "Dark theme",
    theme: "Theme",
    language: "Language",
    logout: "Log out",
  },
  settings: {
    title: "Settings",
    general: "General",
    themeLight: "Light",
    themeDark: "Dark",
    loading: "Loading…",
    close: "Close",
    save: "Save",
    saved: "Saved",
    cancel: "Cancel",
    nameLabel: "Name",
    certs: "Model connection",
    certsCert: "Certificate",
    certsKey: "Private key",
    certsAdd: "Choose file",
    certsReplace: "Replace",
    certsLoaded: "loaded",
    certsReady: "Both files are in place — the model is connected.",
    certsHint:
      "The model identifies this app by its certificate. Add both files: without them the agent cannot reply.",
    certsReveal: "Show folder",
    updates: "Updates",
    updatesVersion: "Version",
    updatesRow: "New version",
    updatesCheck: "Check for updates",
    updatesChecking: "Checking…",
    updatesLatest: "You're on the latest version.",
    updatesAvailable: (version) => `Version ${version} is available`,
    updatesInstall: "Download and install",
    updatesInstallHint:
      "The app will download the update, stop the services, install the new ones and start them again. It takes a few minutes; your chats are kept.",
    updatesError: "Couldn't reach the update server.",
    updatesNoToken: "This installation has no update token (AVY_UPDATE_TOKEN in .env).",
    updatesUnauthorized:
      "The update server rejected this installation's token (AVY_UPDATE_TOKEN in .env).",
    updatesBrowserHint: "Updates are installed from the Avy app.",
    memory: "Memory",
    memoryEnabled: "Remember",
    memoryScopeUser: "About you",
    memoryScopeSpace: (name: string) => (name ? `Space “${name}”` : "Space"),
    memoryOffHint:
      "Nothing new gets written, and existing notes stay out of replies. Everything already saved is kept — turn this back on and it works again.",
    memoryIntro:
      "What your agents have remembered from your conversations. These notes shape every reply — delete any of them.",
    memoryEmpty: "Nothing remembered yet",
    memoryEmptyHint:
      "Notes appear on their own when something in a conversation is worth keeping for later.",
    memoryAgentEmpty: "Nothing remembered",
    memoryForget: "Delete",
    memoryExpires: (date) => `until ${date}`,
    memoryNoExpiry: "no expiry",
    memoryThisChat: "in this chat",
    memoryLayersFootnote:
      "Space memory is visible to every agent working in it. The personal layer is yours alone.",
  },
  limit: {
    bannerExhausted: "Credit limit reached.",
    bannerExhaustedReset: (date) => `Credit limit reached — resets ${date}.`,
  },
  chat: {
    greeting: "How can I help?",
    pastedText: "Pasted text",
    newChat: "New chat",
    sessionFiles: "Session files",
    subagents: "Subagents",
    sessionSettings: "Session settings",
    agentTask: "Agent task",
    bg: {
      running: "running in the background",
      done: "finished",
      error: "failed",
      cancelled: "stopped",
      interrupted: "interrupted",
      waiting: "waiting for an answer",
      stop: "Stop",
    },
    task: {
      status: {
        running: "running",
        waiting: "waiting for an answer",
        answered: "continuing",
        done: "done",
        error: "failed",
        cancelled: "stopped",
        interrupted: "interrupted",
      },
      sectionRunning: "Running",
      sectionWaiting: "Waiting for an answer",
      sectionDone: "Done",
      question: "Question to the orchestrator",
      permission: "Asks permission",
      answer: "Answer",
      result: "Result",
      brief: "Brief",
      continuation: "continuation",
      continuationTitle: "Answer to the subagent",
      inBackground: "in the background",
      details: "Details",
      history: "History",
      historyQuestion: "Request for more information",
      historyAnswer: "Information provided",
      historyResult: "Result",
      steps: ["step", "steps", "steps"],
    },
    askUserStep: { multi: "several may apply", answer: "Answer" },
    interjectPending: "Queued",
    weather: {
      feels: "feels like",
      humidity: "humidity",
      wind: "wind",
      kmh: "km/h",
      forecast: "forecast",
      today: "today by the hour",
      precip: "chance of precipitation",
      sunset: "sunset",
      sunrise: "sunrise",
      source: "Data",
      noPrecip: "no precipitation",
      conditions: {
        clear: "clear",
        "mostly-clear": "mostly clear",
        "partly-cloudy": "partly cloudy",
        overcast: "overcast",
        fog: "fog",
        drizzle: "drizzle",
        rain: "rain",
        "freezing-rain": "freezing rain",
        snow: "snow",
        thunderstorm: "thunderstorm",
      },
    },
    sessions: "Sessions",
    sessionFilter: "Filter by type",
    sessionFilterAll: "All",
    sessionFilterChats: "Chats",
    sessionFilterSpaces: "Spaces",
    sessionFilterTasks: "Tasks",
    openTask: "Open task",
    openSpace: "Open space",
    deleteSession: "Delete session",
    deleteSessionConfirm: (title: string) =>
      `Delete “${title}”? The conversation and its files will be gone for good.`,
    renameSession: "Rename",
    renamePlaceholder: "Session title",
    pinSession: "Pin",
    unpinSession: "Unpin",
    pinnedSection: "Pinned",
    addToProject: "Add to space",
    moreActions: "Actions",
    removeAttachment: (name) => `Remove ${name}`,
    contextTitle: (pct) => `Context is ${pct}% full — click to compress now`,
    contextAria: (pct) => `Context is ${pct}% full, click to compress`,
    errors: {
      limit_exceeded:
        "Request limit reached. Try later or contact the administrator.",
      gateway_unavailable:
        "The AI service is temporarily unavailable. Try again in a minute.",
      timeout: "The model is taking too long to respond. Please try again.",
      model_error:
        "Error reaching the model. Try rephrasing your request.",
      internal: "Something went wrong. Please try again.",
      session_busy:
        "The session was busy syncing files and the message did not reach the agent. Please send it again.",
    },
    actions: {
      copy: "Copy",
      copied: "Copied",
      retry: "Retry",
      like: "Good response",
      dislike: "Bad response",
      edit: "Edit",
      save: "Save",
      cancel: "Cancel",
    },
  },
  input: {
    attachFile: "Attach file",
    voiceInput: "Voice input",
    voiceInputSoon: "Voice input — coming soon",
    modelHints: {
      "qwen3.7-plus": "Fast, for everyday tasks",
      "qwen3.8-max": "More capable and pricier, for complex tasks",
    },
    fileTooBig: "File is too large (max 25 MB) and was not attached.",
    filesTooBig: (names) =>
      `Files too large (max 25 MB): ${names} — not attached.`,
    dropToAttach: "Drop files to attach",
    compressingContext: "Compressing context…",
    uploadingFiles: "Uploading attachments…",
    disclaimer: "The model can make mistakes. Double-check the facts.",
    stop: "Stop (Esc)",
    send: "Send",
    deepResearch: "Deep research",
    agentPick: "Mode",
    modelSection: "Model",
    effortSection: "Reasoning depth",
    agentNone: "Default",
    spacesGroup: "Workspaces",
    placeholder: "Ask anything",
    placeholderStreaming: "Add to or steer the agent mid-turn…",
    placeholders: [
      "Create a PDF document",
      "Analyze data",
      "Write and run a script",
      "Make a report from a table",
      "Generate a specification",
    ],
  },
  code: {
    emptyTitle: "Avy Code",
    emptyTagline: "Let's create together!",
    inputHint: "Enter to send, Shift+Enter for a new line",
  },
  files: {
    images: "Images",
    documents: "Documents",
    other: "Other",
    downloads: "Downloads",
    backToList: "Back to list",
    download: "Download",
    open: "Open",
    sessionFiles: "Session files",
    fileForms: { one: "file", few: "files", many: "files" },
    refresh: "Refresh",
    closePanel: "Close panel",
    loading: "Loading…",
    noResults: "No files yet.",
    previewUnavailable: "Preview unavailable for this file type.",
    loadFailed: "Could not load the file.",
    pdfRenderFailed: "Could not render the PDF.",
    deleteFile: "Delete file",
    deleteAll: "Delete all",
    deleteAllConfirm: "Delete all files in this session? This cannot be undone.",
    deleting: "Deleting…",
    cancel: "Cancel",
    moreActions: "Actions",
    viewRendered: "Markdown",
    viewPlain: "Plain",
  },
  bgTasks: {
    title: "Background tasks",
    closePanel: "Close panel",
    empty: "No background tasks yet.",
    running: "running",
    finished: "done",
    failed: "failed",
    stopped: "stopped",
    stop: "Stop",
    rerun: "Run again",
    remove: "Remove from history",
    subagent: "subagent",
    noOutput: "(no output yet)",
    logUnavailable: "Log not created yet or unavailable.",
    desktopOnly: "Log is only available in the desktop app.",
  },
  zoom: {
    zoomOut: "Zoom out",
    resetZoom: "Reset zoom",
    zoomIn: "Zoom in",
    fitToWindow: "Fit to window",
  },
  install: {
    title: "Install Avy",
    body: "Runs like an app: its own icon and no address bar.",
    action: "Install",
    later: "Not now",
    iosBody: "Add Avy to your Home Screen — it opens like an app.",
    iosStep1: "Share →",
    iosStep2: "Add to Home Screen",
  },
  agents: {
    create: "Create agent",
    createManual: "Manually",
    createManualHint: "Fill in the settings yourself",
    createWithAssistant: "With the assistant",
    createWithAssistantHint: "Describe the job — it builds",
    assistantOpener:
      "I want an agent for a job of mine. Let me describe the work it will do for me.",
    empty: "No agents yet",
    edit: "Edit",
    delete: "Delete",
    cancel: "Cancel",
    save: "Save",
    createTitle: "New agent",
    editTitle: "Agent settings",
    fieldName: "Name",
    fieldNamePlaceholder: "For example: Copy editor",
    fieldDescription: "What it does",
    fieldDescriptionPlaceholder: "A short description of what the agent can do.",
    fieldDescriptionHint: "One short line — you see it in the list, and the assistant reads it when deciding what to hand off.",
    fieldPrompt: "Instructions",
    fieldPromptPlaceholder: "Describe how the agent should work: what it does, what it avoids, how it answers.",
    fieldPromptHint: "The field that matters. Write it the way you would brief a person on their first day.",
    fieldModel: "Model",
    fieldEffort: "Reasoning depth",
    fieldSkills: "Skills",
    fieldSkillsHint:
      "The agent gets only what you check. Every skill takes room in its instructions, so pick what the job needs.",
    skillsDefaultHint:
      "Nothing checked — the agent gets the default set, same as a regular chat.",
    fieldTools: "Tools",
    fieldToolsHint:
      "Files, the command line and skills are always available — they are not in this list. What follows is added on top: the agent gets only what you check. Every tool is described in its instructions, so extras take up room for nothing.",
    toolsConfigure: "Configure",
    toolsSummaryDefaults: "Defaults",
    toolsSummaryEmpty: "Files and commands only",
    toolNames: {
      web: {
        label: "Web search",
        hint: "Searches and reads pages, downloads files into its working folder.",
      },
      weather: {
        label: "Weather",
        hint: "Current conditions and forecast, shows a weather card.",
      },
      tasks: {
        label: "Recurring tasks",
        hint: "Sets up automation right in the conversation: repeat work on a schedule.",
      },
      memory: {
        label: "Memory",
        hint: "Remembers what matters between conversations and writes new things down itself.",
      },
      subagents: {
        label: "Subagents",
        hint: "Hands parts of the work to other agents and collects their results.",
      },
      todos: {
        label: "Work plan",
        hint: "Keeps a list of steps for a long task so it does not lose track.",
      },
    },
    useDefaults: "Defaults",
    enabledLabel: "Available as a mode",
    enabledHint:
      "You'll be able to run the agent as a separate chat via the Mode picker in the input.",
    delegatableLabel: "Available as a subagent",
    delegatableHint:
      "In the default mode, the assistant will see this agent as a tool and can hand it tasks as a subagent.",
    deleteTitle: "Delete agent",
    deleteConfirm: (name) =>
      `Delete "${name}"? Everything it remembered about you goes with it. This cannot be undone.`,
    tabAgents: "Agents",
    tabSkills: "Skills",
    tabConnectors: "Connectors",
    skillsEmpty: "No skills found",
    searchPlaceholder: "Search",
    filterAll: "All",
    filterMine: "Mine",
    sortLabel: "Sort",
    sortName: "By name",
    sortRecent: "Newest first",
    nothingFound: "Nothing found",
    connectorsSoon: "Connectors coming soon",
    createSkill: "Create skill",
    skillFileNotShown: "This file can't be shown as text — an image, an archive, or too large.",
    skillFork: "Copy",
    skillEdit: "Edit",
    groupAgents: "Agents",
    groupSkills: "Skills",
    groupSkillsMine: "My skills",
    groupSkillsBuiltin: "Built-in",
    groupConnectors: "Connectors",
    skillAssistantOpener:
      "I want a skill of my own. Let me describe the work I do regularly — I need it done the same way every time.",
    skillNewTitle: "New skill",
    skillEditTitle: "Skill",
    skillFieldName: "Name",
    skillFieldNamePlaceholder: "e.g. Weekly status",
    skillFieldNameHint: "What this skill is called in your list",
    skillFieldDescription: "When to use it",
    skillFieldDescriptionPlaceholder:
      "e.g. how to write the weekly client status. Use it when asked for a status, a summary, or \u201cwhat did we ship this week\u201d.",
    skillFieldDescriptionHint:
      "The only part visible before the skill is opened — it decides whether the skill gets picked at all. Say what it does and which requests should call for it.",
    skillFieldCategory: "Category",
    skillFieldCategoryHint: "Group in the list. Optional",
    skillFieldBody: "Instructions",
    skillFieldBodyPlaceholder:
      "# Weekly status\n\n## Step 1\nCollect what shipped this week\u2026",
    skillFieldBodyHint:
      "The procedure itself: steps in order, what to do and what not to. Explain why — a rule with a reason survives the case you didn’t foresee.",
    skillAdd: "Add",
    skillRemove: "Remove",
    skillMine: "mine",
    skillEnabledLabel: "Use this skill",
    skillEnabledHint:
      "A disabled skill stays here but the assistant won’t reach for it. You don’t pick a skill — it applies itself when the task matches its description.",
    skillBuiltinBadge: "built-in",
    skillDeleteConfirm: (name) =>
      `Delete “${name}”? Its scripts and templates go with it. This can’t be undone.`,
    skillFilesLabel: "Files",
    skillTabFields: "Skill",
    agentTabMain: "Agent",
    skillFilesHint:
      "Scripts, templates and requirements.txt — whatever the instructions refer to. The skill runs them from its own folder, so names must match the ones written in the instructions.",
    skillFilesEmpty: "Nothing attached yet",
    skillFilesAdd: "Add",
  },
  spaces: {
    empty: "No spaces yet. Create your first one — chats inside share a common file cloud.",
    create: "New space",
    createDefaultName: "New space",
    createManual: "Manually",
    createManualHint: "Fill in the settings yourself",
    createWithAssistant: "With the assistant",
    createWithAssistantHint: "Describe the work — it sets it up",
    assistantOpener:
      "I want a workspace for my work. Let me describe what I will be doing in it.",
    nameLabel: "Name",
    namePlaceholder: "E.g. “Work” or “Marketing”",
    descriptionLabel: "Description",
    descriptionPlaceholder: "What this space is about — one phrase",
    descriptionHint: "A short description: the agent sees it in every chat of this space.",
    instructionLabel: "Instructions",
    instructionHint: "A short text the agent sees in every chat of this space. Procedures longer than this frame belong in skills.",
    instructionPlaceholder:
      "For example:\n\n" +
      "This is the marketing workspace: posts, newsletters, campaign reports.\n\n" +
      "Write in English. Texts in markdown.\n" +
      "The audience is developers: no marketing gloss, straight to the point.\n" +
      "Take numbers from /outputs/metrics.json, never from memory; if the data is missing, say so instead of estimating.\n" +
      "Drafts go to /drafts, finished work to /outputs.\n\n" +
      "Show me the text before anything goes out.",
    skillsLabel: "Space skills",
    skillsHint: "The agent always sees their descriptions and opens what it needs. Own skills live only here.",
    addSkill: "New skill",
    emptySkills: "No skills yet. Create your own or attach one from the library.",
    skillFromLibrary: "from library",
    skillNoDescription: "No description — the agent won't know when to use it",
    skillNamePlaceholder: "Skill name",
    skillDescriptionLabel: "When to use",
    skillDescriptionPlaceholder: "One phrase: what it does and when to reach for it",
    skillDescriptionHint: "The only thing the model sees before opening the skill — it decides by this description.",
    skillBodyPlaceholder: "Instructions: steps, output format, things to watch out for…",
    attachSkillPick: "Pick a skill…",
    tabAgents: "Agents",
    tabSkills: "Skills",
    attachFromLibrary: "Add",
    newChatDefault: "Default",
    tabOverview: "Overview",
    emptyTeam: "No agents yet — attach one from the library.",
    emptyAttachableAgents: "No free agents — all attached or the library is empty.",
    emptyAttachableSkills: "No free skills — all are attached already, or the library is empty.",
    settingsDanger: "Archive and deletion",
    save: "Save",
    edit: "Edit",
    archive: "Archive",
    unarchive: "Restore from archive",
    archivedBadge: "Archived",
    delete: "Delete",
    deleteConfirm: (name: string) =>
      `Delete “${name}”? Its chats and shared files go with it, for good. Recurring tasks stay — they are simply detached.`,
    tabSettings: "Settings",
    tabFiles: "Files",
    tabMemory: "Memory",
    newChat: "New chat",
    settingsChats: "Session history",
    settingsAgents: "Space agents",
    settingsAgentsHint: "Connected agents are the space's team: they work within its context.",
    settingsTasks: "Recurring tasks",
    settingsTasksHint: "Attached tasks run on the space's shared files.",
    attachTask: "Attach",
    attachTaskPick: "Pick a task…",
    detach: "Detach",
    emptyChats: "No chats in this space yet.",
    emptyFiles: "No files yet — they will appear from the space's chats.",
    emptyMemory: "Shared memory is empty — the agent will fill it with facts from this space's chats.",
    emptySpaceAgents: "The library has no agents yet — create them in “My agents”.",
    emptySpaceTasks: "No attached tasks.",
    emptyAttachable: "No free tasks — all are attached already, or the list is empty.",
    forgetFact: "Forget",
    chatsCount: (n: number) => (n === 1 ? "1 chat" : `${n} chats`),
  },
  recurringTasks: {
    tabActive: "Active",
    tabArchive: "Archive",
    empty: "No tasks yet. Create your first one.",
    emptyArchive: "Disabled tasks will appear here.",
    create: "New task",
    createManual: "Manually",
    createManualHint: "Fill in the settings yourself",
    createWithAssistant: "With the assistant",
    createWithAssistantHint: "Describe the task — it builds",
    assistantOpener:
      "Help me set up a recurring task. Ask what needs doing and how often, " +
      "then build it.",
    edit: "Edit",
    delete: "Delete",
    deleteConfirm: "Delete this task with all its runs and files? This cannot be undone.",
    runNow: "Run now",
    running: "Running…",
    enabled: "Enabled",
    disabled: "Disabled",
    enable: "Enable",
    disable: "Disable",
    nameLabel: "Name",
    namePlaceholder: "Task name",
    scheduleLabel: "When to run",
    scheduleDaily: "Every day",
    scheduleWeekdays: "On weekdays",
    scheduleWeekly: "Once a week",
    scheduleInterval: "At regular intervals",
    everyLabel: "Every",
    unitMinutes: "min",
    unitHours: "h",
    atTime: "at",
    onDay: "on",
    timezoneLabel: "Time zone",
    agentLabel: "Agent",
    agentDefault: "Assistant (default)",
    instructionLabel: "Instructions",
    instructionHint: "Describe in words what should happen on each run — like a task for a person.",
    instructionPlaceholder: "Describe what should happen on each run…",
    save: "Save",
    cancel: "Cancel",
    secrets: "Secrets",
    secretsHint: "Tokens and keys for accessing external services. Values are stored encrypted and never shown.",
    pendingSaveHint: "Saved together with the task.",
    createdWithProblems: (problems) =>
      `The task was created, but some items didn't attach: ${problems}. Add them here again.`,
    saveFailed: "Couldn't save the task. Try again.",
    onFailure: "If a run fails",
    retryPrefix: "retry",
    retryTimes: (n: number) => (n === 1 ? "time" : "times"),
    retryPause: "with a pause of",
    secondsShort: "sec",
    secretName: "DEMO_TOKEN",
    secretValue: "sk-uy324-...",
    secretNameHint: "Name: uppercase letters, digits and “_”. Must start with a letter.",
    secretSaveFailed: "Could not save the secret",
    addSecret: "Add secret",
    noSecrets: "No secrets yet.",
    deleteSecret: "Delete secret",
    runs: "Runs",
    noRuns: "This task hasn't run yet.",
    openRun: "Open run",
    deleteRun: "Delete run",
    files: "Files",
    inputs: "Attachments",
    inputsHint: "Files and folders you attach to the task — the agent reads them on every run.",
    outputs: "Artifacts",
    outputsHint: "Files the agent produces during runs.",
    addFiles: "Add files",
    addFolder: "Add folder",
    dropHere: "Drop files or folders here",
    noInputs: "No attachments yet.",
    noOutputs: "No artifacts yet.",
    uploading: "Uploading…",
    deleteFolder: "Delete folder",
    deleteFolderConfirm: "Delete folder “{name}” and all files inside ({count})? This cannot be undone.",
    runOk: "Success",
    runError: "Error",
    runRunning: "Running",
    attempt: "attempt",
    tokens: "tokens",
    lastRun: "Last run",
    nextRun: "Next run",
    never: "—",
    backToList: "Other tasks",
    backToTask: "Back to task",
    addToProject: "Space",
    projectsSoon: "Spaces coming soon — you'll be able to group tasks and files",
    weekdayNames: [
      "Sundays",
      "Mondays",
      "Tuesdays",
      "Wednesdays",
      "Thursdays",
      "Fridays",
      "Saturdays",
    ],
    createFailed: "Failed to save the task",
    alreadyRunning: "The task is already running",
  },
};

export const DICTIONARIES: Record<Locale, Dictionary> = { ru, en };
