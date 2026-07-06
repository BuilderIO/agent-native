import type { AgentNativeI18nCatalog } from "@agent-native/core/client";

import enUS from "./en-US";

// English is the bundled source catalog. Additional locale catalogs can be
// added later as sibling `<locale>.ts` files and wired into loadMessages;
// until then every locale falls back to English.
export const i18nCatalog = {
  sourceLocale: "en-US",
  messages: enUS,
  loadMessages: async () => null,
} satisfies AgentNativeI18nCatalog;
