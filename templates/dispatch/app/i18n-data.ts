import type { LocaleCode } from "@agent-native/core/client";

const enUS = {
  root: {
    commandActions: "Actions",
    commandSearch: "Search",
    commandAppearance: "Appearance",
    toggleTheme: "Toggle theme",
  },
};

type Messages = typeof enUS;

function mergeMessages(root: Partial<Messages["root"]>): Messages {
  return { root: { ...enUS.root, ...root } };
}

export const messagesByLocale = {
  "en-US": enUS,
  "zh-CN": mergeMessages({
    commandActions: "操作",
    commandSearch: "搜索",
    commandAppearance: "外观",
    toggleTheme: "切换主题",
  }),
  "es-ES": mergeMessages({
    commandActions: "Acciones",
    commandSearch: "Buscar",
    commandAppearance: "Apariencia",
    toggleTheme: "Cambiar tema",
  }),
  "fr-FR": mergeMessages({
    commandActions: "Actions",
    commandSearch: "Rechercher",
    commandAppearance: "Apparence",
    toggleTheme: "Changer de thème",
  }),
  "de-DE": mergeMessages({
    commandActions: "Aktionen",
    commandSearch: "Suchen",
    commandAppearance: "Darstellung",
    toggleTheme: "Theme wechseln",
  }),
  "ja-JP": mergeMessages({
    commandActions: "操作",
    commandSearch: "検索",
    commandAppearance: "外観",
    toggleTheme: "テーマを切り替え",
  }),
  "ko-KR": mergeMessages({
    commandActions: "작업",
    commandSearch: "검색",
    commandAppearance: "모양",
    toggleTheme: "테마 전환",
  }),
  "pt-BR": mergeMessages({
    commandActions: "Ações",
    commandSearch: "Buscar",
    commandAppearance: "Aparência",
    toggleTheme: "Alternar tema",
  }),
  "hi-IN": mergeMessages({
    commandActions: "क्रियाएं",
    commandSearch: "खोजें",
    commandAppearance: "रूप",
    toggleTheme: "थीम बदलें",
  }),
  "ar-SA": mergeMessages({
    commandActions: "الإجراءات",
    commandSearch: "بحث",
    commandAppearance: "المظهر",
    toggleTheme: "تبديل السمة",
  }),
} satisfies Record<LocaleCode, Messages>;
