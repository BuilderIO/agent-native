import type { AgentNativeI18nCatalog } from "@agent-native/core/client";

import { messagesByLocale } from "../i18n-data";

export const i18nCatalog = {
  sourceLocale: "en-US",
  messages: messagesByLocale["en-US"],
  loadMessages: async (locale) => {
    if (locale === "zh-TW") return (await import("./zh-TW")).default;
    return messagesByLocale[locale] ?? null;
  },
} satisfies AgentNativeI18nCatalog;
