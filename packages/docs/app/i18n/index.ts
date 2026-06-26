import type {
  AgentNativeI18nCatalog,
  LocaleCode,
} from "@agent-native/core/client";

import enUS from "./en-US";

const localeLoaders: Partial<
  Record<LocaleCode, () => Promise<Record<string, unknown>>>
> = {
  "zh-CN": async () => (await import("./zh-CN")).default,
  "zh-TW": async () => (await import("./zh-TW")).default,
  "es-ES": async () => (await import("./es-ES")).default,
  "fr-FR": async () => (await import("./fr-FR")).default,
  "de-DE": async () => (await import("./de-DE")).default,
  "ja-JP": async () => (await import("./ja-JP")).default,
  "ko-KR": async () => (await import("./ko-KR")).default,
  "pt-BR": async () => (await import("./pt-BR")).default,
  "hi-IN": async () => (await import("./hi-IN")).default,
  "ar-SA": async () => (await import("./ar-SA")).default,
};

export const docsI18nCatalog = {
  namespace: "docs",
  sourceLocale: "en-US",
  messages: enUS,
  loadMessages: async (locale) => localeLoaders[locale]?.() ?? null,
} satisfies AgentNativeI18nCatalog;

export async function loadDocsMessages(locale: LocaleCode) {
  if (locale === docsI18nCatalog.sourceLocale) return docsI18nCatalog.messages;
  return localeLoaders[locale]?.() ?? null;
}
