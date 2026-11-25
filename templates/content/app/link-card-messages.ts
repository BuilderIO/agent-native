import type { BuiltinLocaleCode } from "@agent-native/core/client/i18n";

const en = {
  untitled: "Untitled",
  openIn: "Open in {{app}}",
} as const;

type LinkCardMessages = Record<keyof typeof en, string>;

const translations: Record<
  Exclude<BuiltinLocaleCode, "en-US">,
  LinkCardMessages
> = {
  "es-ES": { untitled: "Sin título", openIn: "Abrir en {{app}}" },
  "fr-FR": { untitled: "Sans titre", openIn: "Ouvrir dans {{app}}" },
  "de-DE": { untitled: "Ohne Titel", openIn: "In {{app}} öffnen" },
  "pt-BR": { untitled: "Sem título", openIn: "Abrir no {{app}}" },
  "zh-CN": { untitled: "无标题", openIn: "在 {{app}} 中打开" },
  "zh-TW": { untitled: "未命名", openIn: "在 {{app}} 中開啟" },
  "ja-JP": { untitled: "無題", openIn: "{{app}} で開く" },
  "ko-KR": { untitled: "제목 없음", openIn: "{{app}}에서 열기" },
  "hi-IN": { untitled: "बिना शीर्षक", openIn: "{{app}} में खोलें" },
  "ar-SA": { untitled: "بلا عنوان", openIn: "فتح في {{app}}" },
};

export const linkCardMessagesByLocale: Record<
  BuiltinLocaleCode,
  LinkCardMessages
> = {
  "en-US": en,
  ...translations,
};
