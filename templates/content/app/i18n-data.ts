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
    navigation: { openSidebar: "打开侧边栏" },
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
    navigation: { openSidebar: "Abrir barra lateral" },
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
    navigation: { openSidebar: "Ouvrir la barre latérale" },
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
    navigation: { openSidebar: "Seitenleiste öffnen" },
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
    navigation: { openSidebar: "サイドバーを開く" },
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
    navigation: { openSidebar: "사이드바 열기" },
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
    navigation: { openSidebar: "Abrir barra lateral" },
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
    navigation: { openSidebar: "साइडबार खोलें" },
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
    navigation: { openSidebar: "فتح الشريط الجانبي" },
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
