import type { LocaleCode } from "@agent-native/core/client";

const enUS = {
  root: {
    commandActions: "Actions",
    commandSearch: "Search",
    commandAppearance: "Appearance",
    toggleTheme: "Toggle theme",
  },
  settings: {
    title: "Settings",
    description: "Language, workspace, resource, and agent preferences.",
    languageTitle: "Language",
    languageDescription:
      "Choose the interface language. This preference is saved for your account.",
    languageLabel: "Interface language",
    workspaceTitle: "Workspace",
    workspaceDescription:
      "Manage team access and shared workspace resources for Dispatch.",
    openTeamSettings: "Open team settings",
    openResourceSettings: "Open resource settings",
    agentTitle: "Agent settings",
    agentDescription:
      "Open the agent sidebar settings for model, API keys, automations, voice, and other agent controls.",
    openAgentSettings: "Open agent settings",
  },
};

type Messages = typeof enUS;
type PartialMessages = { [K in keyof Messages]?: Partial<Messages[K]> };

function mergeMessages(overrides: PartialMessages): Messages {
  return {
    root: { ...enUS.root, ...overrides.root },
    settings: { ...enUS.settings, ...overrides.settings },
  };
}

export const messagesByLocale = {
  "en-US": enUS,
  "zh-CN": mergeMessages({
    root: {
      commandActions: "操作",
      commandSearch: "搜索",
      commandAppearance: "外观",
      toggleTheme: "切换主题",
    },
    settings: {
      title: "设置",
      description: "语言、工作区、资源和代理偏好设置。",
      languageTitle: "语言",
      languageDescription: "选择界面语言。此偏好会保存到你的账户。",
      languageLabel: "界面语言",
      workspaceTitle: "工作区",
      workspaceDescription: "管理 Dispatch 的团队访问权限和共享工作区资源。",
      openTeamSettings: "打开团队设置",
      openResourceSettings: "打开资源设置",
      agentTitle: "代理设置",
      agentDescription:
        "打开代理侧边栏设置，管理模型、API 密钥、自动化、语音和其他代理控制项。",
      openAgentSettings: "打开代理设置",
    },
  }),
  "es-ES": mergeMessages({
    root: {
      commandActions: "Acciones",
      commandSearch: "Buscar",
      commandAppearance: "Apariencia",
      toggleTheme: "Cambiar tema",
    },
    settings: {
      title: "Ajustes",
      description:
        "Preferencias de idioma, espacio de trabajo, recursos y agente.",
      languageTitle: "Idioma",
      languageDescription:
        "Elige el idioma de la interfaz. Esta preferencia se guarda en tu cuenta.",
      languageLabel: "Idioma de la interfaz",
      workspaceTitle: "Espacio de trabajo",
      workspaceDescription:
        "Gestiona el acceso del equipo y los recursos compartidos de Dispatch.",
      openTeamSettings: "Abrir ajustes del equipo",
      openResourceSettings: "Abrir ajustes de recursos",
      agentTitle: "Ajustes del agente",
      agentDescription:
        "Abre los ajustes del agente en la barra lateral para modelos, claves API, automatizaciones, voz y otros controles.",
      openAgentSettings: "Abrir ajustes del agente",
    },
  }),
  "fr-FR": mergeMessages({
    root: {
      commandActions: "Actions",
      commandSearch: "Rechercher",
      commandAppearance: "Apparence",
      toggleTheme: "Changer de thème",
    },
    settings: {
      title: "Paramètres",
      description:
        "Préférences de langue, d’espace de travail, de ressources et d’agent.",
      languageTitle: "Langue",
      languageDescription:
        "Choisissez la langue de l’interface. Cette préférence est enregistrée dans votre compte.",
      languageLabel: "Langue de l’interface",
      workspaceTitle: "Espace de travail",
      workspaceDescription:
        "Gérez l’accès de l’équipe et les ressources partagées de Dispatch.",
      openTeamSettings: "Ouvrir les paramètres d’équipe",
      openResourceSettings: "Ouvrir les paramètres des ressources",
      agentTitle: "Paramètres de l’agent",
      agentDescription:
        "Ouvrez les paramètres de l’agent dans la barre latérale pour les modèles, clés API, automatisations, voix et autres contrôles.",
      openAgentSettings: "Ouvrir les paramètres de l’agent",
    },
  }),
  "de-DE": mergeMessages({
    root: {
      commandActions: "Aktionen",
      commandSearch: "Suchen",
      commandAppearance: "Darstellung",
      toggleTheme: "Theme wechseln",
    },
    settings: {
      title: "Einstellungen",
      description:
        "Sprach-, Arbeitsbereichs-, Ressourcen- und Agent-Einstellungen.",
      languageTitle: "Sprache",
      languageDescription:
        "Wähle die Sprache der Oberfläche. Diese Einstellung wird in deinem Konto gespeichert.",
      languageLabel: "Oberflächensprache",
      workspaceTitle: "Arbeitsbereich",
      workspaceDescription:
        "Verwalte Teamzugriff und gemeinsam genutzte Dispatch-Ressourcen.",
      openTeamSettings: "Teameinstellungen öffnen",
      openResourceSettings: "Ressourceneinstellungen öffnen",
      agentTitle: "Agent-Einstellungen",
      agentDescription:
        "Öffne die Agent-Einstellungen in der Seitenleiste für Modell, API-Schlüssel, Automatisierungen, Sprache und weitere Steuerungen.",
      openAgentSettings: "Agent-Einstellungen öffnen",
    },
  }),
  "ja-JP": mergeMessages({
    root: {
      commandActions: "操作",
      commandSearch: "検索",
      commandAppearance: "外観",
      toggleTheme: "テーマを切り替え",
    },
    settings: {
      title: "設定",
      description: "言語、ワークスペース、リソース、エージェント設定。",
      languageTitle: "言語",
      languageDescription:
        "インターフェース言語を選択します。この設定はアカウントに保存されます。",
      languageLabel: "インターフェース言語",
      workspaceTitle: "ワークスペース",
      workspaceDescription:
        "Dispatch のチームアクセスと共有ワークスペースリソースを管理します。",
      openTeamSettings: "チーム設定を開く",
      openResourceSettings: "リソース設定を開く",
      agentTitle: "エージェント設定",
      agentDescription:
        "右サイドバーのエージェント設定を開き、モデル、API キー、自動化、音声などを管理します。",
      openAgentSettings: "エージェント設定を開く",
    },
  }),
  "ko-KR": mergeMessages({
    root: {
      commandActions: "작업",
      commandSearch: "검색",
      commandAppearance: "모양",
      toggleTheme: "테마 전환",
    },
    settings: {
      title: "설정",
      description: "언어, 워크스페이스, 리소스 및 에이전트 환경설정입니다.",
      languageTitle: "언어",
      languageDescription:
        "인터페이스 언어를 선택하세요. 이 기본 설정은 계정에 저장됩니다.",
      languageLabel: "인터페이스 언어",
      workspaceTitle: "워크스페이스",
      workspaceDescription:
        "Dispatch의 팀 접근 권한과 공유 워크스페이스 리소스를 관리합니다.",
      openTeamSettings: "팀 설정 열기",
      openResourceSettings: "리소스 설정 열기",
      agentTitle: "에이전트 설정",
      agentDescription:
        "오른쪽 사이드바의 에이전트 설정을 열어 모델, API 키, 자동화, 음성 및 기타 제어를 관리합니다.",
      openAgentSettings: "에이전트 설정 열기",
    },
  }),
  "pt-BR": mergeMessages({
    root: {
      commandActions: "Ações",
      commandSearch: "Buscar",
      commandAppearance: "Aparência",
      toggleTheme: "Alternar tema",
    },
    settings: {
      title: "Configurações",
      description:
        "Preferências de idioma, espaço de trabalho, recursos e agente.",
      languageTitle: "Idioma",
      languageDescription:
        "Escolha o idioma da interface. Essa preferência é salva na sua conta.",
      languageLabel: "Idioma da interface",
      workspaceTitle: "Espaço de trabalho",
      workspaceDescription:
        "Gerencie acesso da equipe e recursos compartilhados do Dispatch.",
      openTeamSettings: "Abrir configurações da equipe",
      openResourceSettings: "Abrir configurações de recursos",
      agentTitle: "Configurações do agente",
      agentDescription:
        "Abra as configurações do agente na barra lateral para modelos, chaves de API, automações, voz e outros controles.",
      openAgentSettings: "Abrir configurações do agente",
    },
  }),
  "hi-IN": mergeMessages({
    root: {
      commandActions: "क्रियाएं",
      commandSearch: "खोजें",
      commandAppearance: "रूप",
      toggleTheme: "थीम बदलें",
    },
    settings: {
      title: "सेटिंग्स",
      description: "भाषा, कार्यस्थान, संसाधन और एजेंट प्राथमिकताएं।",
      languageTitle: "भाषा",
      languageDescription: "इंटरफ़ेस भाषा चुनें। यह पसंद आपके खाते में सहेजी जाती है।",
      languageLabel: "इंटरफ़ेस भाषा",
      workspaceTitle: "कार्यस्थान",
      workspaceDescription:
        "Dispatch के लिए टीम पहुंच और साझा कार्यस्थान संसाधनों को प्रबंधित करें।",
      openTeamSettings: "टीम सेटिंग्स खोलें",
      openResourceSettings: "संसाधन सेटिंग्स खोलें",
      agentTitle: "एजेंट सेटिंग्स",
      agentDescription:
        "मॉडल, API कुंजियों, ऑटोमेशन, आवाज़ और अन्य एजेंट नियंत्रणों के लिए साइडबार सेटिंग्स खोलें।",
      openAgentSettings: "एजेंट सेटिंग्स खोलें",
    },
  }),
  "ar-SA": mergeMessages({
    root: {
      commandActions: "الإجراءات",
      commandSearch: "بحث",
      commandAppearance: "المظهر",
      toggleTheme: "تبديل السمة",
    },
    settings: {
      title: "الإعدادات",
      description: "تفضيلات اللغة ومساحة العمل والموارد والوكيل.",
      languageTitle: "اللغة",
      languageDescription: "اختر لغة الواجهة. يتم حفظ هذا التفضيل في حسابك.",
      languageLabel: "لغة الواجهة",
      workspaceTitle: "مساحة العمل",
      workspaceDescription:
        "إدارة وصول الفريق وموارد مساحة العمل المشتركة في Dispatch.",
      openTeamSettings: "فتح إعدادات الفريق",
      openResourceSettings: "فتح إعدادات الموارد",
      agentTitle: "إعدادات الوكيل",
      agentDescription:
        "افتح إعدادات الوكيل في الشريط الجانبي لإدارة النموذج ومفاتيح API والأتمتة والصوت وعناصر التحكم الأخرى.",
      openAgentSettings: "فتح إعدادات الوكيل",
    },
  }),
} satisfies Record<LocaleCode, Messages>;
