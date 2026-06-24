import type { LocaleCode } from "@agent-native/core/client";

const enUS = {
  navigation: {
    brand: "Analytics",
    overview: "Overview",
    dataSources: "Data Sources",
    dataDictionary: "Data Dictionary",
    templateCatalog: "Template Catalog",
    analyses: "Analyses",
    explorer: "Explorer",
    team: "Team",
    settings: "Settings",
    navigation: "Navigation",
    openNavigation: "Open navigation",
  },
  settings: {
    account: "Account",
    signedInAs: "Signed in as",
    credentials: "Data Source Credentials",
    credentialsDescription:
      "API keys and credentials are managed on the Data Sources page.",
    manageDataSources: "Manage Data Sources",
    languageTitle: "Language",
    languageLabel: "Interface language",
    about: "About",
    aboutDescription:
      "Analytics is a tool for connecting data sources and building custom dashboards. Connect Google Analytics, BigQuery, Stripe, and more, then ask the agent to create dashboards.",
    aboutUsage:
      "Use the Data Sources page to manage connections. Use the Query Explorer for ad-hoc BigQuery SQL.",
  },
  chat: {
    emptyState:
      "Ask me to analyze a dashboard, compare trends, or dig into data...",
    suggestionArrGrowth: "What's driving ARR growth this quarter?",
    suggestionChurn: "Show me churn trends over the last 6 months",
    suggestionAnomalies: "Analyze the HubSpot Sales dashboard for anomalies",
    suggestionMrr: "Compare MRR between enterprise and SMB",
  },
};

type Messages = typeof enUS;
type Section = keyof Messages;

function mergeMessages(overrides: {
  [K in Section]?: Partial<Messages[K]>;
}): Messages {
  return {
    navigation: { ...enUS.navigation, ...overrides.navigation },
    settings: { ...enUS.settings, ...overrides.settings },
    chat: { ...enUS.chat, ...overrides.chat },
  };
}

export const messagesByLocale = {
  "en-US": enUS,
  "zh-CN": mergeMessages({
    navigation: {
      brand: "Analytics",
      overview: "概览",
      dataSources: "数据源",
      dataDictionary: "数据字典",
      templateCatalog: "模板目录",
      analyses: "分析",
      explorer: "探索器",
      team: "团队",
      settings: "设置",
      navigation: "导航",
      openNavigation: "打开导航",
    },
    settings: {
      account: "账户",
      signedInAs: "登录身份",
      credentials: "数据源凭据",
      credentialsDescription: "API 密钥和凭据在数据源页面管理。",
      manageDataSources: "管理数据源",
      languageTitle: "语言",
      languageLabel: "界面语言",
      about: "关于",
      aboutDescription:
        "Analytics 用于连接数据源并构建自定义仪表板。连接 Google Analytics、BigQuery、Stripe 等，然后让代理创建仪表板。",
      aboutUsage: "在数据源页面管理连接。使用查询探索器运行临时 BigQuery SQL。",
    },
    chat: {
      emptyState: "让我分析仪表板、比较趋势或深入查看数据...",
      suggestionArrGrowth: "本季度 ARR 增长的驱动因素是什么？",
      suggestionChurn: "显示过去 6 个月的流失趋势",
      suggestionAnomalies: "分析 HubSpot 销售仪表板的异常",
      suggestionMrr: "比较企业客户和 SMB 的 MRR",
    },
  }),
  "es-ES": mergeMessages({
    navigation: {
      overview: "Resumen",
      dataSources: "Fuentes de datos",
      dataDictionary: "Diccionario de datos",
      templateCatalog: "Catálogo de plantillas",
      analyses: "Análisis",
      explorer: "Explorador",
      team: "Equipo",
      settings: "Ajustes",
      navigation: "Navegación",
      openNavigation: "Abrir navegación",
    },
    settings: {
      account: "Cuenta",
      signedInAs: "Sesión iniciada como",
      credentials: "Credenciales de fuentes de datos",
      credentialsDescription:
        "Las claves API y credenciales se gestionan en la página Fuentes de datos.",
      manageDataSources: "Gestionar fuentes de datos",
      languageTitle: "Idioma",
      languageLabel: "Idioma de la interfaz",
      about: "Acerca de",
      aboutDescription:
        "Analytics conecta fuentes de datos y crea paneles personalizados. Conecta Google Analytics, BigQuery, Stripe y más, y pide al agente que cree paneles.",
      aboutUsage:
        "Usa Fuentes de datos para gestionar conexiones. Usa el Explorador de consultas para SQL ad hoc de BigQuery.",
    },
    chat: {
      emptyState:
        "Pídeme que analice un panel, compare tendencias o investigue datos...",
      suggestionArrGrowth: "¿Qué impulsa el crecimiento de ARR este trimestre?",
      suggestionChurn: "Muéstrame la tendencia de bajas de los últimos 6 meses",
      suggestionAnomalies: "Analiza anomalías en el panel de ventas de HubSpot",
      suggestionMrr: "Compara el MRR entre enterprise y SMB",
    },
  }),
  "fr-FR": mergeMessages({
    navigation: {
      overview: "Vue d'ensemble",
      dataSources: "Sources de données",
      dataDictionary: "Dictionnaire de données",
      templateCatalog: "Catalogue de modèles",
      analyses: "Analyses",
      explorer: "Explorateur",
      team: "Équipe",
      settings: "Paramètres",
      navigation: "Navigation",
      openNavigation: "Ouvrir la navigation",
    },
    settings: {
      account: "Compte",
      signedInAs: "Connecté en tant que",
      credentials: "Identifiants des sources de données",
      credentialsDescription:
        "Les clés API et identifiants sont gérés sur la page Sources de données.",
      manageDataSources: "Gérer les sources de données",
      languageTitle: "Langue",
      languageLabel: "Langue de l'interface",
      about: "À propos",
      aboutDescription:
        "Analytics connecte des sources de données et crée des tableaux de bord personnalisés. Connectez Google Analytics, BigQuery, Stripe et plus encore, puis demandez à l'agent de créer des tableaux de bord.",
      aboutUsage:
        "Utilisez Sources de données pour gérer les connexions. Utilisez l'explorateur de requêtes pour le SQL BigQuery ad hoc.",
    },
    chat: {
      emptyState:
        "Demandez-moi d'analyser un tableau de bord, de comparer des tendances ou d'explorer les données...",
      suggestionArrGrowth:
        "Qu'est-ce qui stimule la croissance de l'ARR ce trimestre ?",
      suggestionChurn: "Montre-moi les tendances de churn des 6 derniers mois",
      suggestionAnomalies:
        "Analyse les anomalies du tableau de bord HubSpot Sales",
      suggestionMrr: "Compare le MRR entre enterprise et SMB",
    },
  }),
  "de-DE": mergeMessages({
    navigation: {
      overview: "Übersicht",
      dataSources: "Datenquellen",
      dataDictionary: "Datenlexikon",
      templateCatalog: "Vorlagenkatalog",
      analyses: "Analysen",
      explorer: "Explorer",
      team: "Team",
      settings: "Einstellungen",
      navigation: "Navigation",
      openNavigation: "Navigation öffnen",
    },
    settings: {
      account: "Konto",
      signedInAs: "Angemeldet als",
      credentials: "Datenquellen-Anmeldedaten",
      credentialsDescription:
        "API-Schlüssel und Anmeldedaten werden auf der Seite Datenquellen verwaltet.",
      manageDataSources: "Datenquellen verwalten",
      languageTitle: "Sprache",
      languageLabel: "Oberflächensprache",
      about: "Info",
      aboutDescription:
        "Analytics verbindet Datenquellen und erstellt benutzerdefinierte Dashboards. Verbinde Google Analytics, BigQuery, Stripe und mehr und bitte den Agenten, Dashboards zu erstellen.",
      aboutUsage:
        "Verwalte Verbindungen auf der Seite Datenquellen. Nutze den Query Explorer für Ad-hoc-BigQuery-SQL.",
    },
    chat: {
      emptyState:
        "Bitte mich, ein Dashboard zu analysieren, Trends zu vergleichen oder Daten zu untersuchen...",
      suggestionArrGrowth: "Was treibt das ARR-Wachstum in diesem Quartal?",
      suggestionChurn: "Zeige mir Churn-Trends der letzten 6 Monate",
      suggestionAnomalies: "Analysiere Anomalien im HubSpot-Sales-Dashboard",
      suggestionMrr: "Vergleiche MRR zwischen Enterprise und SMB",
    },
  }),
  "ja-JP": mergeMessages({
    navigation: {
      overview: "概要",
      dataSources: "データソース",
      dataDictionary: "データ辞書",
      templateCatalog: "テンプレートカタログ",
      analyses: "分析",
      explorer: "エクスプローラー",
      team: "チーム",
      settings: "設定",
      navigation: "ナビゲーション",
      openNavigation: "ナビゲーションを開く",
    },
    settings: {
      account: "アカウント",
      signedInAs: "サインイン中",
      credentials: "データソース認証情報",
      credentialsDescription:
        "API キーと認証情報はデータソースページで管理します。",
      manageDataSources: "データソースを管理",
      languageTitle: "言語",
      languageLabel: "インターフェース言語",
      about: "概要",
      aboutDescription:
        "Analytics はデータソースを接続し、カスタムダッシュボードを作成するツールです。Google Analytics、BigQuery、Stripe などを接続し、エージェントにダッシュボード作成を依頼できます。",
      aboutUsage:
        "接続はデータソースページで管理します。アドホックな BigQuery SQL にはクエリエクスプローラーを使います。",
    },
    chat: {
      emptyState:
        "ダッシュボード分析、トレンド比較、データ調査を依頼できます...",
      suggestionArrGrowth: "今四半期の ARR 成長要因は？",
      suggestionChurn: "過去 6 か月の解約傾向を表示",
      suggestionAnomalies: "HubSpot Sales ダッシュボードの異常を分析",
      suggestionMrr: "Enterprise と SMB の MRR を比較",
    },
  }),
  "ko-KR": mergeMessages({
    navigation: {
      overview: "개요",
      dataSources: "데이터 소스",
      dataDictionary: "데이터 사전",
      templateCatalog: "템플릿 카탈로그",
      analyses: "분석",
      explorer: "탐색기",
      team: "팀",
      settings: "설정",
      navigation: "탐색",
      openNavigation: "탐색 열기",
    },
    settings: {
      account: "계정",
      signedInAs: "로그인 계정",
      credentials: "데이터 소스 자격 증명",
      credentialsDescription:
        "API 키와 자격 증명은 데이터 소스 페이지에서 관리합니다.",
      manageDataSources: "데이터 소스 관리",
      languageTitle: "언어",
      languageLabel: "인터페이스 언어",
      about: "정보",
      aboutDescription:
        "Analytics는 데이터 소스를 연결하고 사용자 지정 대시보드를 만드는 도구입니다. Google Analytics, BigQuery, Stripe 등을 연결한 뒤 에이전트에게 대시보드를 만들게 하세요.",
      aboutUsage:
        "데이터 소스 페이지에서 연결을 관리합니다. 임시 BigQuery SQL은 쿼리 탐색기를 사용하세요.",
    },
    chat: {
      emptyState:
        "대시보드를 분석하거나 추세를 비교하거나 데이터를 파고들어 달라고 요청하세요...",
      suggestionArrGrowth: "이번 분기 ARR 성장을 이끄는 요인은?",
      suggestionChurn: "지난 6개월의 이탈 추세를 보여줘",
      suggestionAnomalies: "HubSpot Sales 대시보드의 이상 징후를 분석해줘",
      suggestionMrr: "엔터프라이즈와 SMB의 MRR 비교",
    },
  }),
  "pt-BR": mergeMessages({
    navigation: {
      overview: "Visão geral",
      dataSources: "Fontes de dados",
      dataDictionary: "Dicionário de dados",
      templateCatalog: "Catálogo de modelos",
      analyses: "Análises",
      explorer: "Explorador",
      team: "Equipe",
      settings: "Configurações",
      navigation: "Navegação",
      openNavigation: "Abrir navegação",
    },
    settings: {
      account: "Conta",
      signedInAs: "Conectado como",
      credentials: "Credenciais de fontes de dados",
      credentialsDescription:
        "Chaves de API e credenciais são gerenciadas na página Fontes de dados.",
      manageDataSources: "Gerenciar fontes de dados",
      languageTitle: "Idioma",
      languageLabel: "Idioma da interface",
      about: "Sobre",
      aboutDescription:
        "Analytics conecta fontes de dados e cria dashboards personalizados. Conecte Google Analytics, BigQuery, Stripe e outros, depois peça ao agente para criar dashboards.",
      aboutUsage:
        "Use Fontes de dados para gerenciar conexões. Use o Explorador de consultas para SQL ad hoc do BigQuery.",
    },
    chat: {
      emptyState:
        "Peça para eu analisar um dashboard, comparar tendências ou investigar dados...",
      suggestionArrGrowth:
        "O que impulsiona o crescimento de ARR neste trimestre?",
      suggestionChurn: "Mostre tendências de churn dos últimos 6 meses",
      suggestionAnomalies:
        "Analise anomalias no dashboard de vendas do HubSpot",
      suggestionMrr: "Compare MRR entre enterprise e SMB",
    },
  }),
  "hi-IN": mergeMessages({
    navigation: {
      overview: "अवलोकन",
      dataSources: "डेटा स्रोत",
      dataDictionary: "डेटा शब्दकोश",
      templateCatalog: "टेम्पलेट कैटलॉग",
      analyses: "विश्लेषण",
      explorer: "एक्सप्लोरर",
      team: "टीम",
      settings: "सेटिंग्स",
      navigation: "नेविगेशन",
      openNavigation: "नेविगेशन खोलें",
    },
    settings: {
      account: "खाता",
      signedInAs: "इस रूप में साइन इन",
      credentials: "डेटा स्रोत क्रेडेंशियल",
      credentialsDescription:
        "API कुंजियां और क्रेडेंशियल डेटा स्रोत पेज पर प्रबंधित होते हैं।",
      manageDataSources: "डेटा स्रोत प्रबंधित करें",
      languageTitle: "भाषा",
      languageLabel: "इंटरफ़ेस भाषा",
      about: "परिचय",
      aboutDescription:
        "Analytics डेटा स्रोतों को जोड़ने और कस्टम डैशबोर्ड बनाने का टूल है। Google Analytics, BigQuery, Stripe आदि जोड़ें, फिर एजेंट से डैशबोर्ड बनवाएं।",
      aboutUsage:
        "कनेक्शन प्रबंधित करने के लिए डेटा स्रोत पेज का उपयोग करें। ad-hoc BigQuery SQL के लिए Query Explorer उपयोग करें।",
    },
    chat: {
      emptyState:
        "मुझसे डैशबोर्ड का विश्लेषण, ट्रेंड की तुलना या डेटा में गहराई से देखने को कहें...",
      suggestionArrGrowth: "इस तिमाही ARR वृद्धि को क्या चला रहा है?",
      suggestionChurn: "पिछले 6 महीनों के churn ट्रेंड दिखाएं",
      suggestionAnomalies:
        "HubSpot Sales डैशबोर्ड में anomalies का विश्लेषण करें",
      suggestionMrr: "enterprise और SMB के बीच MRR की तुलना करें",
    },
  }),
  "ar-SA": mergeMessages({
    navigation: {
      overview: "نظرة عامة",
      dataSources: "مصادر البيانات",
      dataDictionary: "قاموس البيانات",
      templateCatalog: "كتالوج القوالب",
      analyses: "التحليلات",
      explorer: "المستكشف",
      team: "الفريق",
      settings: "الإعدادات",
      navigation: "التنقل",
      openNavigation: "فتح التنقل",
    },
    settings: {
      account: "الحساب",
      signedInAs: "تم تسجيل الدخول باسم",
      credentials: "بيانات اعتماد مصادر البيانات",
      credentialsDescription:
        "تتم إدارة مفاتيح API وبيانات الاعتماد من صفحة مصادر البيانات.",
      manageDataSources: "إدارة مصادر البيانات",
      languageTitle: "اللغة",
      languageLabel: "لغة الواجهة",
      about: "حول",
      aboutDescription:
        "Analytics أداة لربط مصادر البيانات وبناء لوحات معلومات مخصصة. اربط Google Analytics وBigQuery وStripe وغيرها، ثم اطلب من الوكيل إنشاء اللوحات.",
      aboutUsage:
        "استخدم صفحة مصادر البيانات لإدارة الاتصالات. استخدم مستكشف الاستعلامات لاستعلامات BigQuery SQL المخصصة.",
    },
    chat: {
      emptyState:
        "اطلب مني تحليل لوحة معلومات أو مقارنة الاتجاهات أو التعمق في البيانات...",
      suggestionArrGrowth: "ما الذي يدفع نمو ARR هذا الربع؟",
      suggestionChurn: "اعرض اتجاهات فقدان العملاء خلال آخر 6 أشهر",
      suggestionAnomalies: "حلل الشذوذ في لوحة مبيعات HubSpot",
      suggestionMrr: "قارن MRR بين enterprise وSMB",
    },
  }),
} satisfies Record<LocaleCode, Messages>;
