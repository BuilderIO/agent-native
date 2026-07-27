import { type AgentNativeI18nCatalog } from "@agent-native/core/client/i18n";

import { messagesByLocale } from "../i18n-data";

export const i18nCatalog = {
  sourceLocale: "en-US",
  messages: messagesByLocale["en-US"],
  loadMessages: async (locale) => {
    return messagesByLocale[locale] ?? null;
  },
} satisfies AgentNativeI18nCatalog;
