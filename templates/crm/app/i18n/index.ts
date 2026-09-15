import { createAgentNativeI18nCatalog } from "@agent-native/core/client/i18n";

import enUS from "./en-US";

export const i18nCatalog = createAgentNativeI18nCatalog({
  messages: enUS,
  localeLoaders: {
    "ar-SA": () => import("./ar-SA"),
    "de-DE": () => import("./de-DE"),
    "es-ES": () => import("./es-ES"),
    "fr-FR": () => import("./fr-FR"),
    "hi-IN": () => import("./hi-IN"),
    "ja-JP": () => import("./ja-JP"),
    "ko-KR": () => import("./ko-KR"),
    "pt-BR": () => import("./pt-BR"),
    "zh-CN": () => import("./zh-CN"),
    "zh-TW": () => import("./zh-TW"),
  },
});
