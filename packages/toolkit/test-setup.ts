import i18next from "i18next";
import { initReactI18next, setI18n } from "react-i18next";
import { beforeEach } from "vitest";

import { coreMessagesForLocale } from "../core/src/localization/core-messages.js";
import defaultEnglishMessages from "../core/src/localization/default-messages.js";
import { toolkitMessagesForLocale } from "./src/app/i18n/catalog.js";

await i18next.use(initReactI18next).init({
  resources: {
    "en-US": { translation: structuredClone(defaultEnglishMessages) },
  },
  lng: "en-US",
  fallbackLng: "en-US",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  returnNull: false,
  initAsync: false,
});
i18next.addResourceBundle(
  "en-US",
  "translation",
  coreMessagesForLocale("en-US"),
  true,
  true,
);
i18next.addResourceBundle(
  "en-US",
  "translation",
  toolkitMessagesForLocale("en-US"),
  true,
  true,
);

beforeEach(async () => {
  setI18n(i18next);
  await i18next.changeLanguage("en-US");
});
