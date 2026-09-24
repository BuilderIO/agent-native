import { createAgentNativeI18nCatalog } from "@agent-native/core/client/i18n";

import enUS from "./en-US";

export const i18nCatalog = createAgentNativeI18nCatalog({
  messages: enUS,
  localeLoaders: {
    "zh-CN": () => import("./zh-CN"),
    "zh-TW": () => import("./zh-TW"),
    "es-ES": () => import("./es-ES"),
    "fr-FR": () => import("./fr-FR"),
    "de-DE": () => import("./de-DE"),
    "ja-JP": () => import("./ja-JP"),
    "ko-KR": () => import("./ko-KR"),
    "pt-BR": () => import("./pt-BR"),
    "hi-IN": () => import("./hi-IN"),
    "ar-SA": () => import("./ar-SA"),
  },
});
