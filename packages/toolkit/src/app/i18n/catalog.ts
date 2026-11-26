import arSA from "./catalogs/ar-SA.js";
import deDE from "./catalogs/de-DE.js";
import enUS from "./catalogs/en-US.js";
import esES from "./catalogs/es-ES.js";
import frFR from "./catalogs/fr-FR.js";
import hiIN from "./catalogs/hi-IN.js";
import jaJP from "./catalogs/ja-JP.js";
import koKR from "./catalogs/ko-KR.js";
import ptBR from "./catalogs/pt-BR.js";
import zhCN from "./catalogs/zh-CN.js";
import zhTW from "./catalogs/zh-TW.js";
import { nestAgentChatMessages, type ToolkitLocaleMessages } from "./nest.js";
import type { ToolkitAgentChatTranslation } from "./types.js";

export const TOOLKIT_LOCALES = [
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
] as const;

type ToolkitLocale = (typeof TOOLKIT_LOCALES)[number];

const messagesByLocale: Record<ToolkitLocale, ToolkitAgentChatTranslation> = {
  "en-US": enUS,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  "es-ES": esES,
  "fr-FR": frFR,
  "de-DE": deDE,
  "ja-JP": jaJP,
  "ko-KR": koKR,
  "pt-BR": ptBR,
  "hi-IN": hiIN,
  "ar-SA": arSA,
};

export function toolkitMessagesForLocale(
  locale: string,
): ToolkitLocaleMessages {
  return nestAgentChatMessages(
    messagesByLocale[
      TOOLKIT_LOCALES.includes(locale as ToolkitLocale)
        ? (locale as ToolkitLocale)
        : "en-US"
    ],
  );
}
