import { defineAgentNativeConfig } from "@agent-native/core/config";

export default defineAgentNativeConfig({
  changelog: { enabled: true },
  translations: {
    locales: [
      "en-US",
      "zh-CN",
      "zh-TW",
      "es-ES",
      "fr-FR",
      "de-DE",
      "ja-JP",
      "ko-KR",
      "pt-BR",
      "hi-IN",
      "ar-SA",
    ],
  },
});
