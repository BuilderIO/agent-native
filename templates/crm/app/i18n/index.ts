import { type AgentNativeI18nCatalog } from "@agent-native/core/client/i18n";

import enUS from "./en-US";

export const i18nCatalog = {
  sourceLocale: "en-US",
  messages: enUS,
  loadMessages: async (locale) => {
    switch (locale) {
      case "ar-SA":
        return (await import("./ar-SA")).default;
      case "de-DE":
        return (await import("./de-DE")).default;
      case "es-ES":
        return (await import("./es-ES")).default;
      case "fr-FR":
        return (await import("./fr-FR")).default;
      case "hi-IN":
        return (await import("./hi-IN")).default;
      case "ja-JP":
        return (await import("./ja-JP")).default;
      case "ko-KR":
        return (await import("./ko-KR")).default;
      case "pt-BR":
        return (await import("./pt-BR")).default;
      case "zh-CN":
        return (await import("./zh-CN")).default;
      case "zh-TW":
        return (await import("./zh-TW")).default;
      default:
        return null;
    }
  },
} satisfies AgentNativeI18nCatalog;
