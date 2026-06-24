import type { LocaleCode } from "@agent-native/core/client";

const enUS = {
  root: {
    commandActions: "Actions",
    commandSearch: "Search",
    commandAppearance: "Appearance",
    toggleTheme: "Toggle theme",
  },
  navigation: {
    brand: "Design",
    designs: "Designs",
    templates: "Templates",
    designSystems: "Design Systems",
    setupDesignSystem: "Set up design system",
    settings: "Settings",
    openNavigation: "Open navigation",
    expandSidebar: "Expand sidebar",
    collapseSidebar: "Collapse sidebar",
  },
  settings: {
    agentTitle: "Agent settings",
    agentDescription:
      "Open the agent sidebar settings for model, API keys, automations, voice, and other agent controls.",
    openAgentSettings: "Open agent settings",
    languageTitle: "Language",
    languageDescription: "Choose the interface language for Design.",
    languageLabel: "Interface language",
  },
  pages: {
    presentEmpty: "No content to present",
    presentBackToEditor: "Back to editor",
    teamCreateOrgDescription:
      "Set up a team to share designs with your colleagues.",
  },
  chat: {
    emptyState: "Describe a design to create",
    suggestionLandingPage: "Design a landing page for my startup",
    suggestionBrandMatch: "Make this match our brand",
    suggestionMobile: "Add a mobile version of this",
  },
};

type Messages = typeof enUS;
type PartialMessages = { [K in keyof Messages]?: Partial<Messages[K]> };

function mergeMessages(overrides: PartialMessages): Messages {
  return {
    root: { ...enUS.root, ...overrides.root },
    navigation: { ...enUS.navigation, ...overrides.navigation },
    settings: { ...enUS.settings, ...overrides.settings },
    pages: { ...enUS.pages, ...overrides.pages },
    chat: { ...enUS.chat, ...overrides.chat },
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
    navigation: {
      brand: "Design",
      designs: "设计",
      templates: "模板",
      designSystems: "设计系统",
      setupDesignSystem: "设置设计系统",
      settings: "设置",
      openNavigation: "打开导航",
      expandSidebar: "展开侧边栏",
      collapseSidebar: "收起侧边栏",
    },
    settings: {
      agentTitle: "代理设置",
      agentDescription:
        "打开代理侧边栏设置，管理模型、API 密钥、自动化、语音和其他代理控制项。",
      openAgentSettings: "打开代理设置",
      languageTitle: "语言",
      languageDescription: "选择 Design 的界面语言。",
      languageLabel: "界面语言",
    },
    pages: {
      presentEmpty: "没有可演示的内容",
      presentBackToEditor: "返回编辑器",
      teamCreateOrgDescription: "设置团队，与同事共享设计。",
    },
    chat: {
      emptyState: "描述要创建的设计",
      suggestionLandingPage: "为我的初创公司设计落地页",
      suggestionBrandMatch: "让它匹配我们的品牌",
      suggestionMobile: "添加移动端版本",
    },
  }),
  "es-ES": mergeMessages({
    root: {
      commandActions: "Acciones",
      commandSearch: "Buscar",
      commandAppearance: "Apariencia",
      toggleTheme: "Cambiar tema",
    },
    navigation: {
      designs: "Diseños",
      templates: "Plantillas",
      designSystems: "Sistemas de diseño",
      setupDesignSystem: "Configurar sistema de diseño",
      settings: "Ajustes",
      openNavigation: "Abrir navegación",
      expandSidebar: "Expandir barra lateral",
      collapseSidebar: "Contraer barra lateral",
    },
    settings: {
      agentTitle: "Ajustes del agente",
      agentDescription:
        "Abre los ajustes del agente en la barra lateral para modelos, claves API, automatizaciones, voz y otros controles.",
      openAgentSettings: "Abrir ajustes del agente",
      languageTitle: "Idioma",
      languageDescription: "Elige el idioma de la interfaz de Design.",
      languageLabel: "Idioma de la interfaz",
    },
    pages: {
      presentEmpty: "No hay contenido para presentar",
      presentBackToEditor: "Volver al editor",
      teamCreateOrgDescription:
        "Configura un equipo para compartir diseños con tus compañeros.",
    },
    chat: {
      emptyState: "Describe el diseño que quieres crear",
      suggestionLandingPage: "Diseña una landing page para mi startup",
      suggestionBrandMatch: "Haz que coincida con nuestra marca",
      suggestionMobile: "Añade una versión móvil",
    },
  }),
  "fr-FR": mergeMessages({
    root: {
      commandActions: "Actions",
      commandSearch: "Rechercher",
      commandAppearance: "Apparence",
      toggleTheme: "Changer de thème",
    },
    navigation: {
      designs: "Designs",
      templates: "Modèles",
      designSystems: "Systèmes de design",
      setupDesignSystem: "Configurer le système de design",
      settings: "Paramètres",
      openNavigation: "Ouvrir la navigation",
      expandSidebar: "Développer la barre latérale",
      collapseSidebar: "Réduire la barre latérale",
    },
    settings: {
      agentTitle: "Paramètres de l’agent",
      agentDescription:
        "Ouvrez les paramètres de l’agent dans la barre latérale pour les modèles, clés API, automatisations, voix et autres contrôles.",
      openAgentSettings: "Ouvrir les paramètres de l’agent",
      languageTitle: "Langue",
      languageDescription: "Choisissez la langue de l'interface de Design.",
      languageLabel: "Langue de l'interface",
    },
    pages: {
      presentEmpty: "Aucun contenu à présenter",
      presentBackToEditor: "Retour à l’éditeur",
      teamCreateOrgDescription:
        "Configurez une équipe pour partager des designs avec vos collègues.",
    },
    chat: {
      emptyState: "Décrivez un design à créer",
      suggestionLandingPage: "Conçois une landing page pour ma startup",
      suggestionBrandMatch: "Adapte ceci à notre marque",
      suggestionMobile: "Ajoute une version mobile",
    },
  }),
  "de-DE": mergeMessages({
    root: {
      commandActions: "Aktionen",
      commandSearch: "Suchen",
      commandAppearance: "Darstellung",
      toggleTheme: "Theme wechseln",
    },
    navigation: {
      designs: "Designs",
      templates: "Vorlagen",
      designSystems: "Designsysteme",
      setupDesignSystem: "Designsystem einrichten",
      settings: "Einstellungen",
      openNavigation: "Navigation öffnen",
      expandSidebar: "Seitenleiste erweitern",
      collapseSidebar: "Seitenleiste einklappen",
    },
    settings: {
      agentTitle: "Agent-Einstellungen",
      agentDescription:
        "Öffne die Agent-Einstellungen in der Seitenleiste für Modell, API-Schlüssel, Automatisierungen, Sprache und weitere Steuerungen.",
      openAgentSettings: "Agent-Einstellungen öffnen",
      languageTitle: "Sprache",
      languageDescription: "Wähle die Oberflächensprache für Design.",
      languageLabel: "Oberflächensprache",
    },
    pages: {
      presentEmpty: "Keine Inhalte zum Präsentieren",
      presentBackToEditor: "Zurück zum Editor",
      teamCreateOrgDescription:
        "Richte ein Team ein, um Designs mit deinen Kollegen zu teilen.",
    },
    chat: {
      emptyState: "Beschreibe ein Design, das erstellt werden soll",
      suggestionLandingPage: "Entwirf eine Landingpage für mein Startup",
      suggestionBrandMatch: "Passe dies an unsere Marke an",
      suggestionMobile: "Füge eine mobile Version hinzu",
    },
  }),
  "ja-JP": mergeMessages({
    root: {
      commandActions: "操作",
      commandSearch: "検索",
      commandAppearance: "外観",
      toggleTheme: "テーマを切り替え",
    },
    navigation: {
      designs: "デザイン",
      templates: "テンプレート",
      designSystems: "デザインシステム",
      setupDesignSystem: "デザインシステムを設定",
      settings: "設定",
      openNavigation: "ナビゲーションを開く",
      expandSidebar: "サイドバーを展開",
      collapseSidebar: "サイドバーを折りたたむ",
    },
    settings: {
      agentTitle: "エージェント設定",
      agentDescription:
        "右サイドバーのエージェント設定を開き、モデル、API キー、自動化、音声などを管理します。",
      openAgentSettings: "エージェント設定を開く",
      languageTitle: "言語",
      languageDescription: "Design のインターフェース言語を選択します。",
      languageLabel: "インターフェース言語",
    },
    pages: {
      presentEmpty: "プレゼンするコンテンツがありません",
      presentBackToEditor: "エディターに戻る",
      teamCreateOrgDescription:
        "同僚とデザインを共有するためのチームを設定します。",
    },
    chat: {
      emptyState: "作成したいデザインを説明してください",
      suggestionLandingPage: "スタートアップ向けのランディングページをデザイン",
      suggestionBrandMatch: "これをブランドに合わせる",
      suggestionMobile: "モバイル版を追加",
    },
  }),
  "ko-KR": mergeMessages({
    root: {
      commandActions: "작업",
      commandSearch: "검색",
      commandAppearance: "모양",
      toggleTheme: "테마 전환",
    },
    navigation: {
      designs: "디자인",
      templates: "템플릿",
      designSystems: "디자인 시스템",
      setupDesignSystem: "디자인 시스템 설정",
      settings: "설정",
      openNavigation: "탐색 열기",
      expandSidebar: "사이드바 펼치기",
      collapseSidebar: "사이드바 접기",
    },
    settings: {
      agentTitle: "에이전트 설정",
      agentDescription:
        "오른쪽 사이드바의 에이전트 설정을 열어 모델, API 키, 자동화, 음성 및 기타 제어를 관리합니다.",
      openAgentSettings: "에이전트 설정 열기",
      languageTitle: "언어",
      languageDescription: "Design의 인터페이스 언어를 선택하세요.",
      languageLabel: "인터페이스 언어",
    },
    pages: {
      presentEmpty: "발표할 콘텐츠가 없습니다",
      presentBackToEditor: "편집기로 돌아가기",
      teamCreateOrgDescription: "동료와 디자인을 공유할 팀을 설정하세요.",
    },
    chat: {
      emptyState: "만들 디자인을 설명하세요",
      suggestionLandingPage: "내 스타트업 랜딩 페이지 디자인",
      suggestionBrandMatch: "우리 브랜드에 맞게 만들기",
      suggestionMobile: "모바일 버전 추가",
    },
  }),
  "pt-BR": mergeMessages({
    root: {
      commandActions: "Ações",
      commandSearch: "Buscar",
      commandAppearance: "Aparência",
      toggleTheme: "Alternar tema",
    },
    navigation: {
      designs: "Designs",
      templates: "Modelos",
      designSystems: "Sistemas de design",
      setupDesignSystem: "Configurar sistema de design",
      settings: "Configurações",
      openNavigation: "Abrir navegação",
      expandSidebar: "Expandir barra lateral",
      collapseSidebar: "Recolher barra lateral",
    },
    settings: {
      agentTitle: "Configurações do agente",
      agentDescription:
        "Abra as configurações do agente na barra lateral para modelos, chaves de API, automações, voz e outros controles.",
      openAgentSettings: "Abrir configurações do agente",
      languageTitle: "Idioma",
      languageDescription: "Escolha o idioma da interface do Design.",
      languageLabel: "Idioma da interface",
    },
    pages: {
      presentEmpty: "Nenhum conteúdo para apresentar",
      presentBackToEditor: "Voltar ao editor",
      teamCreateOrgDescription:
        "Configure uma equipe para compartilhar designs com seus colegas.",
    },
    chat: {
      emptyState: "Descreva um design para criar",
      suggestionLandingPage: "Crie uma landing page para minha startup",
      suggestionBrandMatch: "Faça isto combinar com nossa marca",
      suggestionMobile: "Adicione uma versão mobile",
    },
  }),
  "hi-IN": mergeMessages({
    root: {
      commandActions: "क्रियाएं",
      commandSearch: "खोजें",
      commandAppearance: "रूप",
      toggleTheme: "थीम बदलें",
    },
    navigation: {
      designs: "डिज़ाइन",
      templates: "टेम्पलेट",
      designSystems: "डिज़ाइन सिस्टम",
      setupDesignSystem: "डिज़ाइन सिस्टम सेट करें",
      settings: "सेटिंग्स",
      openNavigation: "नेविगेशन खोलें",
      expandSidebar: "साइडबार फैलाएं",
      collapseSidebar: "साइडबार समेटें",
    },
    settings: {
      agentTitle: "एजेंट सेटिंग्स",
      agentDescription:
        "मॉडल, API कुंजियों, ऑटोमेशन, आवाज़ और अन्य एजेंट नियंत्रणों के लिए साइडबार सेटिंग्स खोलें।",
      openAgentSettings: "एजेंट सेटिंग्स खोलें",
      languageTitle: "भाषा",
      languageDescription: "Design की interface भाषा चुनें।",
      languageLabel: "इंटरफ़ेस भाषा",
    },
    pages: {
      presentEmpty: "प्रस्तुत करने के लिए कोई सामग्री नहीं",
      presentBackToEditor: "संपादक पर वापस जाएं",
      teamCreateOrgDescription:
        "डिज़ाइन को अपने सहयोगियों के साथ साझा करने के लिए टीम सेट करें।",
    },
    chat: {
      emptyState: "बनाने के लिए design का वर्णन करें",
      suggestionLandingPage: "मेरे startup के लिए landing page design करें",
      suggestionBrandMatch: "इसे हमारे brand से match करें",
      suggestionMobile: "इसका mobile version जोड़ें",
    },
  }),
  "ar-SA": mergeMessages({
    root: {
      commandActions: "الإجراءات",
      commandSearch: "بحث",
      commandAppearance: "المظهر",
      toggleTheme: "تبديل السمة",
    },
    navigation: {
      designs: "التصاميم",
      templates: "القوالب",
      designSystems: "أنظمة التصميم",
      setupDesignSystem: "إعداد نظام التصميم",
      settings: "الإعدادات",
      openNavigation: "فتح التنقل",
      expandSidebar: "توسيع الشريط الجانبي",
      collapseSidebar: "طي الشريط الجانبي",
    },
    settings: {
      agentTitle: "إعدادات الوكيل",
      agentDescription:
        "افتح إعدادات الوكيل في الشريط الجانبي لإدارة النموذج ومفاتيح API والأتمتة والصوت وعناصر التحكم الأخرى.",
      openAgentSettings: "فتح إعدادات الوكيل",
      languageTitle: "اللغة",
      languageDescription: "اختر لغة واجهة Design.",
      languageLabel: "لغة الواجهة",
    },
    pages: {
      presentEmpty: "لا يوجد محتوى للعرض",
      presentBackToEditor: "العودة إلى المحرر",
      teamCreateOrgDescription: "أعد فريقا لمشاركة التصاميم مع زملائك.",
    },
    chat: {
      emptyState: "صف تصميمًا لإنشائه",
      suggestionLandingPage: "صمم صفحة هبوط لشركتي الناشئة",
      suggestionBrandMatch: "اجعل هذا مطابقًا لعلامتنا",
      suggestionMobile: "أضف نسخة للجوال",
    },
  }),
} satisfies Record<LocaleCode, Messages>;
