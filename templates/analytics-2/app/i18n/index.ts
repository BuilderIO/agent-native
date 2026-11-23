import { createToolkitI18nCatalog } from "@agent-native/toolkit/app/i18n";

import enUS from "./en-US";

// This app ships one locale. The eleven locale chunks that arrived with the
// rebuild were never wired to a language switcher and only made the catalog
// advertise languages it cannot show.
export const i18nCatalog = createToolkitI18nCatalog({
  messages: enUS,
  supportedLocales: ["en-US"],
});
