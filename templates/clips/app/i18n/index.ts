import type {
  AgentNativeI18nCatalog,
  LocaleCode,
  LocaleMessages,
} from "@agent-native/core/client";

import enUS from "./en-US";

export async function loadI18nMessages(
  locale: LocaleCode,
): Promise<LocaleMessages | null> {
  switch (locale) {
    case "en-US":
      return enUS;
    case "zh-CN":
      return (await import("./zh-CN")).default;
    case "es-ES":
      return (await import("./es-ES")).default;
    case "fr-FR":
      return (await import("./fr-FR")).default;
    case "de-DE":
      return (await import("./de-DE")).default;
    case "ja-JP":
      return (await import("./ja-JP")).default;
    case "ko-KR":
      return (await import("./ko-KR")).default;
    case "pt-BR":
      return (await import("./pt-BR")).default;
    case "hi-IN":
      return (await import("./hi-IN")).default;
    case "ar-SA":
      return (await import("./ar-SA")).default;
    default:
      return null;
  }
}

export const i18nCatalog = {
  sourceLocale: "en-US",
  messages: enUS,
  loadMessages: loadI18nMessages,
} satisfies AgentNativeI18nCatalog;
