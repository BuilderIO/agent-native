import i18next from "i18next";
import { initReactI18next, setI18n } from "react-i18next";
import { beforeEach } from "vitest";

import { coreMessagesForLocale } from "../core/src/localization/core-messages.js";
import defaultEnglishMessages from "../core/src/localization/default-messages.js";
import { toolkitMessagesForLocale } from "./src/app/i18n/catalog.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Node 25+ ships its own global localStorage, and Vitest's DOM environments
// skip globals that already exist. Without --localstorage-file Node's getter
// returns undefined, so specs would see no DOM storage at all.
const domGlobal = globalThis as typeof globalThis & {
  jsdom?: { window: Pick<Window, "localStorage" | "sessionStorage"> };
};
for (const name of ["localStorage", "sessionStorage"] as const) {
  const current = (domGlobal as Partial<typeof domGlobal>)[name];
  if (typeof current?.clear === "function") continue;
  const storage =
    domGlobal.jsdom?.window[name] ??
    (typeof domGlobal.document !== "undefined" &&
    typeof domGlobal.Storage === "function"
      ? new domGlobal.Storage()
      : undefined);
  if (!storage) continue;
  Object.defineProperty(globalThis, name, {
    value: storage,
    configurable: true,
    writable: true,
  });
}

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
