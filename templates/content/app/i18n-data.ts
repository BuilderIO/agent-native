import type { LocaleCode } from "@agent-native/core/client";

const enUS = {
  root: {
    commandContent: "Content",
    commandSearchDocuments: "Search documents",
    commandAppearance: "Appearance",
    toggleTheme: "Toggle theme",
  },
  theme: {
    system: "System theme",
    light: "Light theme",
    dark: "Dark theme",
  },
  navigation: {
    openSidebar: "Open sidebar",
    settings: "Settings",
  },
  team: {
    metaTitle: "Workspace access - Content",
    pageTitle: "Workspace access",
    heading: "Shared document workspace",
    description:
      "Workspaces are the shared spaces where collaborators can access the same Content documents.",
    peopleTitle: "People and access",
    createOrgDescription:
      "Create a shared workspace for Content documents. You can invite collaborators after setup.",
  },
  settings: {
    title: "Settings",
    description: "Language and workspace preferences for Content.",
    languageTitle: "Language",
    languageDescription:
      "Choose the interface language. This preference is saved for your account.",
    languageLabel: "Interface language",
    workspaceTitle: "Workspace",
    workspaceDescription: "Manage collaborators and shared document access.",
    openTeamSettings: "Open workspace access",
    agentTitle: "Agent settings",
    agentDescription:
      "Open the agent sidebar settings for model, API keys, automations, voice, and other agent controls.",
    openAgentSettings: "Open agent settings",
  },
  chat: {
    publicEmptyState: "Ask me anything about this document",
    publicSuggestionSummary: "Summarize this document",
    publicSuggestionTakeaways: "What are the key takeaways?",
    publicSuggestionActionPlan: "Turn this into an action plan",
    emptyState: "Ask me anything about your documents",
    suggestionPrd: "Draft a PRD for a new feature",
    suggestionSummary: "Summarize this page in 5 bullets",
    suggestionNotion: "Pull this page from Notion",
  },
  empty: {
    noPageTitle: "No page selected",
    noPageDescription:
      "Select a page from the sidebar or create a new one to get started.",
    newPage: "New page",
    createFailed: "Failed to create page",
    genericError: "Something went wrong",
  },
};

type Messages = typeof enUS;
type PartialMessages = { [K in keyof Messages]?: Partial<Messages[K]> };

function mergeMessages(overrides: PartialMessages): Messages {
  return {
    root: { ...enUS.root, ...overrides.root },
    theme: { ...enUS.theme, ...overrides.theme },
    navigation: { ...enUS.navigation, ...overrides.navigation },
    team: { ...enUS.team, ...overrides.team },
    settings: { ...enUS.settings, ...overrides.settings },
    chat: { ...enUS.chat, ...overrides.chat },
    empty: { ...enUS.empty, ...overrides.empty },
  };
}

export const messagesByLocale = {
  "en-US": enUS,
  "zh-CN": mergeMessages({
    root: {
      commandContent: "内容",
      commandSearchDocuments: "搜索文档",
      commandAppearance: "外观",
      toggleTheme: "切换主题",
    },
    theme: { system: "系统主题", light: "浅色主题", dark: "深色主题" },
    navigation: { openSidebar: "打开侧边栏", settings: "设置" },
    team: {
      metaTitle: "工作区访问 - Content",
      pageTitle: "工作区访问",
      heading: "共享文档工作区",
      description: "工作区是协作者访问同一组 Content 文档的共享空间。",
      peopleTitle: "人员和访问权限",
      createOrgDescription:
        "为 Content 文档创建共享工作区。设置完成后即可邀请协作者。",
    },
    settings: {
      title: "设置",
      description: "Content 的语言和工作区偏好设置。",
      languageTitle: "语言",
      languageDescription: "选择界面语言。此偏好会保存到你的账户。",
      languageLabel: "界面语言",
      workspaceTitle: "工作区",
      workspaceDescription: "管理协作者和共享文档访问权限。",
      openTeamSettings: "打开工作区访问设置",
      agentTitle: "代理设置",
      agentDescription:
        "打开代理侧边栏设置，管理模型、API 密钥、自动化、语音和其他代理控制项。",
      openAgentSettings: "打开代理设置",
    },
    chat: {
      publicEmptyState: "向我询问有关此文档的任何问题",
      publicSuggestionSummary: "总结此文档",
      publicSuggestionTakeaways: "关键要点是什么？",
      publicSuggestionActionPlan: "把它变成行动计划",
      emptyState: "向我询问有关文档的任何问题",
      suggestionPrd: "为新功能起草 PRD",
      suggestionSummary: "用 5 个要点总结此页面",
      suggestionNotion: "从 Notion 拉取此页面",
    },
    empty: {
      noPageTitle: "未选择页面",
      noPageDescription: "从侧边栏选择页面，或创建新页面开始。",
      newPage: "新页面",
      createFailed: "创建页面失败",
      genericError: "出了点问题",
    },
  }),
  "es-ES": mergeMessages({
    root: {
      commandContent: "Contenido",
      commandSearchDocuments: "Buscar documentos",
      commandAppearance: "Apariencia",
      toggleTheme: "Cambiar tema",
    },
    theme: {
      system: "Tema del sistema",
      light: "Tema claro",
      dark: "Tema oscuro",
    },
    navigation: { openSidebar: "Abrir barra lateral", settings: "Ajustes" },
    team: {
      metaTitle: "Acceso al espacio de trabajo - Content",
      pageTitle: "Acceso al espacio de trabajo",
      heading: "Espacio de documentos compartidos",
      description:
        "Los espacios de trabajo son lugares compartidos donde los colaboradores pueden acceder a los mismos documentos de Content.",
      peopleTitle: "Personas y acceso",
      createOrgDescription:
        "Crea un espacio compartido para documentos de Content. Puedes invitar colaboradores después de configurarlo.",
    },
    settings: {
      title: "Ajustes",
      description: "Preferencias de idioma y espacio de trabajo para Content.",
      languageTitle: "Idioma",
      languageDescription:
        "Elige el idioma de la interfaz. Esta preferencia se guarda en tu cuenta.",
      languageLabel: "Idioma de la interfaz",
      workspaceTitle: "Espacio de trabajo",
      workspaceDescription:
        "Gestiona colaboradores y acceso a documentos compartidos.",
      openTeamSettings: "Abrir acceso al espacio de trabajo",
      agentTitle: "Ajustes del agente",
      agentDescription:
        "Abre los ajustes del agente en la barra lateral para modelos, claves API, automatizaciones, voz y otros controles.",
      openAgentSettings: "Abrir ajustes del agente",
    },
    chat: {
      publicEmptyState: "Pregúntame cualquier cosa sobre este documento",
      publicSuggestionSummary: "Resume este documento",
      publicSuggestionTakeaways: "¿Cuáles son las ideas clave?",
      publicSuggestionActionPlan: "Convierte esto en un plan de acción",
      emptyState: "Pregúntame cualquier cosa sobre tus documentos",
      suggestionPrd: "Redacta un PRD para una nueva función",
      suggestionSummary: "Resume esta página en 5 viñetas",
      suggestionNotion: "Trae esta página desde Notion",
    },
    empty: {
      noPageTitle: "Ninguna página seleccionada",
      noPageDescription:
        "Selecciona una página en la barra lateral o crea una nueva para empezar.",
      newPage: "Nueva página",
      createFailed: "No se pudo crear la página",
      genericError: "Algo salió mal",
    },
  }),
  "fr-FR": mergeMessages({
    root: {
      commandContent: "Contenu",
      commandSearchDocuments: "Rechercher des documents",
      commandAppearance: "Apparence",
      toggleTheme: "Changer de thème",
    },
    theme: {
      system: "Thème système",
      light: "Thème clair",
      dark: "Thème sombre",
    },
    navigation: {
      openSidebar: "Ouvrir la barre latérale",
      settings: "Paramètres",
    },
    team: {
      metaTitle: "Accès à l’espace de travail - Content",
      pageTitle: "Accès à l’espace de travail",
      heading: "Espace documentaire partagé",
      description:
        "Les espaces de travail sont des espaces partagés où les collaborateurs peuvent accéder aux mêmes documents Content.",
      peopleTitle: "Personnes et accès",
      createOrgDescription:
        "Créez un espace partagé pour les documents Content. Vous pourrez inviter des collaborateurs après la configuration.",
    },
    settings: {
      title: "Paramètres",
      description: "Préférences de langue et d’espace de travail pour Content.",
      languageTitle: "Langue",
      languageDescription:
        "Choisissez la langue de l’interface. Cette préférence est enregistrée dans votre compte.",
      languageLabel: "Langue de l’interface",
      workspaceTitle: "Espace de travail",
      workspaceDescription:
        "Gérez les collaborateurs et l’accès aux documents partagés.",
      openTeamSettings: "Ouvrir l’accès à l’espace de travail",
      agentTitle: "Paramètres de l’agent",
      agentDescription:
        "Ouvrez les paramètres de l’agent dans la barre latérale pour les modèles, clés API, automatisations, voix et autres contrôles.",
      openAgentSettings: "Ouvrir les paramètres de l’agent",
    },
    chat: {
      publicEmptyState: "Posez-moi une question sur ce document",
      publicSuggestionSummary: "Résume ce document",
      publicSuggestionTakeaways: "Quels sont les points clés ?",
      publicSuggestionActionPlan: "Transforme ceci en plan d'action",
      emptyState: "Posez-moi une question sur vos documents",
      suggestionPrd: "Rédige un PRD pour une nouvelle fonctionnalité",
      suggestionSummary: "Résume cette page en 5 puces",
      suggestionNotion: "Importe cette page depuis Notion",
    },
    empty: {
      noPageTitle: "Aucune page sélectionnée",
      noPageDescription:
        "Sélectionnez une page dans la barre latérale ou créez-en une.",
      newPage: "Nouvelle page",
      createFailed: "Échec de la création de la page",
      genericError: "Une erreur est survenue",
    },
  }),
  "de-DE": mergeMessages({
    root: {
      commandContent: "Inhalt",
      commandSearchDocuments: "Dokumente suchen",
      commandAppearance: "Darstellung",
      toggleTheme: "Theme wechseln",
    },
    theme: {
      system: "Systemtheme",
      light: "Helles Theme",
      dark: "Dunkles Theme",
    },
    navigation: {
      openSidebar: "Seitenleiste öffnen",
      settings: "Einstellungen",
    },
    team: {
      metaTitle: "Arbeitsbereichszugriff - Content",
      pageTitle: "Arbeitsbereichszugriff",
      heading: "Gemeinsamer Dokumentenarbeitsbereich",
      description:
        "Arbeitsbereiche sind gemeinsame Räume, in denen Mitwirkende auf dieselben Content-Dokumente zugreifen können.",
      peopleTitle: "Personen und Zugriff",
      createOrgDescription:
        "Erstelle einen gemeinsamen Arbeitsbereich für Content-Dokumente. Nach der Einrichtung kannst du Mitwirkende einladen.",
    },
    settings: {
      title: "Einstellungen",
      description: "Sprach- und Arbeitsbereichseinstellungen für Content.",
      languageTitle: "Sprache",
      languageDescription:
        "Wähle die Sprache der Oberfläche. Diese Einstellung wird in deinem Konto gespeichert.",
      languageLabel: "Oberflächensprache",
      workspaceTitle: "Arbeitsbereich",
      workspaceDescription:
        "Verwalte Mitwirkende und gemeinsamen Dokumentzugriff.",
      openTeamSettings: "Arbeitsbereichszugriff öffnen",
      agentTitle: "Agent-Einstellungen",
      agentDescription:
        "Öffne die Agent-Einstellungen in der Seitenleiste für Modell, API-Schlüssel, Automatisierungen, Sprache und weitere Steuerungen.",
      openAgentSettings: "Agent-Einstellungen öffnen",
    },
    chat: {
      publicEmptyState: "Frag mich alles zu diesem Dokument",
      publicSuggestionSummary: "Fasse dieses Dokument zusammen",
      publicSuggestionTakeaways: "Was sind die wichtigsten Erkenntnisse?",
      publicSuggestionActionPlan: "Mach daraus einen Aktionsplan",
      emptyState: "Frag mich alles zu deinen Dokumenten",
      suggestionPrd: "Entwirf ein PRD für ein neues Feature",
      suggestionSummary: "Fasse diese Seite in 5 Stichpunkten zusammen",
      suggestionNotion: "Hole diese Seite aus Notion",
    },
    empty: {
      noPageTitle: "Keine Seite ausgewählt",
      noPageDescription:
        "Wähle eine Seite in der Seitenleiste oder erstelle eine neue.",
      newPage: "Neue Seite",
      createFailed: "Seite konnte nicht erstellt werden",
      genericError: "Etwas ist schiefgelaufen",
    },
  }),
  "ja-JP": mergeMessages({
    root: {
      commandContent: "コンテンツ",
      commandSearchDocuments: "ドキュメントを検索",
      commandAppearance: "外観",
      toggleTheme: "テーマを切り替え",
    },
    theme: {
      system: "システムテーマ",
      light: "ライトテーマ",
      dark: "ダークテーマ",
    },
    navigation: { openSidebar: "サイドバーを開く", settings: "設定" },
    team: {
      metaTitle: "ワークスペースアクセス - Content",
      pageTitle: "ワークスペースアクセス",
      heading: "共有ドキュメントワークスペース",
      description:
        "ワークスペースは、共同編集者が同じ Content ドキュメントにアクセスできる共有スペースです。",
      peopleTitle: "メンバーとアクセス",
      createOrgDescription:
        "Content ドキュメント用の共有ワークスペースを作成します。設定後に共同編集者を招待できます。",
    },
    settings: {
      title: "設定",
      description: "Content の言語とワークスペース設定。",
      languageTitle: "言語",
      languageDescription:
        "インターフェース言語を選択します。この設定はアカウントに保存されます。",
      languageLabel: "インターフェース言語",
      workspaceTitle: "ワークスペース",
      workspaceDescription:
        "共同編集者と共有ドキュメントのアクセスを管理します。",
      openTeamSettings: "ワークスペースアクセスを開く",
      agentTitle: "エージェント設定",
      agentDescription:
        "右サイドバーのエージェント設定を開き、モデル、API キー、自動化、音声などを管理します。",
      openAgentSettings: "エージェント設定を開く",
    },
    chat: {
      publicEmptyState: "このドキュメントについて何でも聞いてください",
      publicSuggestionSummary: "このドキュメントを要約",
      publicSuggestionTakeaways: "重要なポイントは？",
      publicSuggestionActionPlan: "これをアクションプランにする",
      emptyState: "ドキュメントについて何でも聞いてください",
      suggestionPrd: "新機能の PRD を作成",
      suggestionSummary: "このページを 5 つの箇条書きで要約",
      suggestionNotion: "Notion からこのページを取得",
    },
    empty: {
      noPageTitle: "ページが選択されていません",
      noPageDescription:
        "サイドバーからページを選ぶか、新しいページを作成してください。",
      newPage: "新しいページ",
      createFailed: "ページを作成できませんでした",
      genericError: "問題が発生しました",
    },
  }),
  "ko-KR": mergeMessages({
    root: {
      commandContent: "콘텐츠",
      commandSearchDocuments: "문서 검색",
      commandAppearance: "모양",
      toggleTheme: "테마 전환",
    },
    theme: { system: "시스템 테마", light: "라이트 테마", dark: "다크 테마" },
    navigation: { openSidebar: "사이드바 열기", settings: "설정" },
    team: {
      metaTitle: "워크스페이스 접근 - Content",
      pageTitle: "워크스페이스 접근",
      heading: "공유 문서 워크스페이스",
      description:
        "워크스페이스는 공동 작업자가 같은 Content 문서에 접근할 수 있는 공유 공간입니다.",
      peopleTitle: "사람 및 접근 권한",
      createOrgDescription:
        "Content 문서를 위한 공유 워크스페이스를 만드세요. 설정 후 공동 작업자를 초대할 수 있습니다.",
    },
    settings: {
      title: "설정",
      description: "Content의 언어 및 워크스페이스 환경설정입니다.",
      languageTitle: "언어",
      languageDescription:
        "인터페이스 언어를 선택하세요. 이 기본 설정은 계정에 저장됩니다.",
      languageLabel: "인터페이스 언어",
      workspaceTitle: "워크스페이스",
      workspaceDescription: "공동 작업자와 공유 문서 접근 권한을 관리합니다.",
      openTeamSettings: "워크스페이스 접근 열기",
      agentTitle: "에이전트 설정",
      agentDescription:
        "오른쪽 사이드바의 에이전트 설정을 열어 모델, API 키, 자동화, 음성 및 기타 제어를 관리합니다.",
      openAgentSettings: "에이전트 설정 열기",
    },
    chat: {
      publicEmptyState: "이 문서에 대해 무엇이든 물어보세요",
      publicSuggestionSummary: "이 문서 요약",
      publicSuggestionTakeaways: "핵심 요점은 무엇인가요?",
      publicSuggestionActionPlan: "이것을 실행 계획으로 바꿔줘",
      emptyState: "문서에 대해 무엇이든 물어보세요",
      suggestionPrd: "새 기능 PRD 작성",
      suggestionSummary: "이 페이지를 5개 bullet로 요약",
      suggestionNotion: "Notion에서 이 페이지 가져오기",
    },
    empty: {
      noPageTitle: "선택된 페이지 없음",
      noPageDescription: "사이드바에서 페이지를 선택하거나 새로 만드세요.",
      newPage: "새 페이지",
      createFailed: "페이지를 만들지 못했습니다",
      genericError: "문제가 발생했습니다",
    },
  }),
  "pt-BR": mergeMessages({
    root: {
      commandContent: "Conteúdo",
      commandSearchDocuments: "Buscar documentos",
      commandAppearance: "Aparência",
      toggleTheme: "Alternar tema",
    },
    theme: {
      system: "Tema do sistema",
      light: "Tema claro",
      dark: "Tema escuro",
    },
    navigation: {
      openSidebar: "Abrir barra lateral",
      settings: "Configurações",
    },
    team: {
      metaTitle: "Acesso ao workspace - Content",
      pageTitle: "Acesso ao workspace",
      heading: "Workspace de documentos compartilhados",
      description:
        "Workspaces são espaços compartilhados onde colaboradores acessam os mesmos documentos do Content.",
      peopleTitle: "Pessoas e acesso",
      createOrgDescription:
        "Crie um workspace compartilhado para documentos do Content. Você pode convidar colaboradores depois da configuração.",
    },
    settings: {
      title: "Configurações",
      description: "Preferências de idioma e espaço de trabalho do Content.",
      languageTitle: "Idioma",
      languageDescription:
        "Escolha o idioma da interface. Essa preferência é salva na sua conta.",
      languageLabel: "Idioma da interface",
      workspaceTitle: "Espaço de trabalho",
      workspaceDescription:
        "Gerencie colaboradores e acesso a documentos compartilhados.",
      openTeamSettings: "Abrir acesso ao espaço de trabalho",
      agentTitle: "Configurações do agente",
      agentDescription:
        "Abra as configurações do agente na barra lateral para modelos, chaves de API, automações, voz e outros controles.",
      openAgentSettings: "Abrir configurações do agente",
    },
    chat: {
      publicEmptyState: "Pergunte qualquer coisa sobre este documento",
      publicSuggestionSummary: "Resuma este documento",
      publicSuggestionTakeaways: "Quais são os principais pontos?",
      publicSuggestionActionPlan: "Transforme isso em um plano de ação",
      emptyState: "Pergunte qualquer coisa sobre seus documentos",
      suggestionPrd: "Rascunhe um PRD para uma nova funcionalidade",
      suggestionSummary: "Resuma esta página em 5 tópicos",
      suggestionNotion: "Puxe esta página do Notion",
    },
    empty: {
      noPageTitle: "Nenhuma página selecionada",
      noPageDescription:
        "Selecione uma página na barra lateral ou crie uma nova.",
      newPage: "Nova página",
      createFailed: "Falha ao criar página",
      genericError: "Algo deu errado",
    },
  }),
  "hi-IN": mergeMessages({
    root: {
      commandContent: "कॉन्टेंट",
      commandSearchDocuments: "दस्तावेज़ खोजें",
      commandAppearance: "रूप",
      toggleTheme: "थीम बदलें",
    },
    theme: { system: "सिस्टम थीम", light: "लाइट थीम", dark: "डार्क थीम" },
    navigation: { openSidebar: "साइडबार खोलें", settings: "सेटिंग्स" },
    team: {
      metaTitle: "कार्यस्थान पहुंच - Content",
      pageTitle: "कार्यस्थान पहुंच",
      heading: "साझा दस्तावेज़ कार्यस्थान",
      description:
        "कार्यस्थान वे साझा जगहें हैं जहां सहयोगी समान Content दस्तावेज़ों तक पहुंच सकते हैं।",
      peopleTitle: "लोग और पहुंच",
      createOrgDescription:
        "Content दस्तावेज़ों के लिए साझा कार्यस्थान बनाएं। सेटअप के बाद आप सहयोगियों को आमंत्रित कर सकते हैं।",
    },
    settings: {
      title: "सेटिंग्स",
      description: "Content के लिए भाषा और कार्यस्थान प्राथमिकताएं।",
      languageTitle: "भाषा",
      languageDescription: "इंटरफ़ेस भाषा चुनें। यह पसंद आपके खाते में सहेजी जाती है।",
      languageLabel: "इंटरफ़ेस भाषा",
      workspaceTitle: "कार्यस्थान",
      workspaceDescription: "सहयोगियों और साझा दस्तावेज़ पहुंच को प्रबंधित करें।",
      openTeamSettings: "कार्यस्थान पहुंच खोलें",
      agentTitle: "एजेंट सेटिंग्स",
      agentDescription:
        "मॉडल, API कुंजियों, ऑटोमेशन, आवाज़ और अन्य एजेंट नियंत्रणों के लिए साइडबार सेटिंग्स खोलें।",
      openAgentSettings: "एजेंट सेटिंग्स खोलें",
    },
    chat: {
      publicEmptyState: "इस document के बारे में कुछ भी पूछें",
      publicSuggestionSummary: "इस document का सारांश दें",
      publicSuggestionTakeaways: "मुख्य बातें क्या हैं?",
      publicSuggestionActionPlan: "इसे action plan में बदलें",
      emptyState: "अपने documents के बारे में कुछ भी पूछें",
      suggestionPrd: "नई feature के लिए PRD draft करें",
      suggestionSummary: "इस page को 5 bullets में summarize करें",
      suggestionNotion: "इस page को Notion से खींचें",
    },
    empty: {
      noPageTitle: "कोई page selected नहीं",
      noPageDescription: "sidebar से page चुनें या नया बनाएं।",
      newPage: "नया page",
      createFailed: "page create नहीं हो सका",
      genericError: "कुछ गलत हुआ",
    },
  }),
  "ar-SA": mergeMessages({
    root: {
      commandContent: "المحتوى",
      commandSearchDocuments: "بحث في المستندات",
      commandAppearance: "المظهر",
      toggleTheme: "تبديل السمة",
    },
    theme: {
      system: "سمة النظام",
      light: "السمة الفاتحة",
      dark: "السمة الداكنة",
    },
    navigation: { openSidebar: "فتح الشريط الجانبي", settings: "الإعدادات" },
    team: {
      metaTitle: "الوصول إلى مساحة العمل - Content",
      pageTitle: "الوصول إلى مساحة العمل",
      heading: "مساحة مستندات مشتركة",
      description:
        "مساحات العمل هي الأماكن المشتركة التي يستطيع المتعاونون الوصول فيها إلى مستندات Content نفسها.",
      peopleTitle: "الأشخاص والوصول",
      createOrgDescription:
        "أنشئ مساحة عمل مشتركة لمستندات Content. يمكنك دعوة المتعاونين بعد الإعداد.",
    },
    settings: {
      title: "الإعدادات",
      description: "تفضيلات اللغة ومساحة العمل في Content.",
      languageTitle: "اللغة",
      languageDescription: "اختر لغة الواجهة. يتم حفظ هذا التفضيل في حسابك.",
      languageLabel: "لغة الواجهة",
      workspaceTitle: "مساحة العمل",
      workspaceDescription: "إدارة المتعاونين ووصول المستندات المشتركة.",
      openTeamSettings: "فتح وصول مساحة العمل",
      agentTitle: "إعدادات الوكيل",
      agentDescription:
        "افتح إعدادات الوكيل في الشريط الجانبي لإدارة النموذج ومفاتيح API والأتمتة والصوت وعناصر التحكم الأخرى.",
      openAgentSettings: "فتح إعدادات الوكيل",
    },
    chat: {
      publicEmptyState: "اسألني أي شيء عن هذا المستند",
      publicSuggestionSummary: "لخص هذا المستند",
      publicSuggestionTakeaways: "ما أهم الخلاصات؟",
      publicSuggestionActionPlan: "حوّل هذا إلى خطة عمل",
      emptyState: "اسألني أي شيء عن مستنداتك",
      suggestionPrd: "اكتب مسودة PRD لميزة جديدة",
      suggestionSummary: "لخص هذه الصفحة في 5 نقاط",
      suggestionNotion: "اسحب هذه الصفحة من Notion",
    },
    empty: {
      noPageTitle: "لم يتم تحديد صفحة",
      noPageDescription: "اختر صفحة من الشريط الجانبي أو أنشئ واحدة جديدة.",
      newPage: "صفحة جديدة",
      createFailed: "فشل إنشاء الصفحة",
      genericError: "حدث خطأ ما",
    },
  }),
} satisfies Record<LocaleCode, Messages>;
