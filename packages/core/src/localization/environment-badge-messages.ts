import * as arSA from "./core-messages/supplemental/ar-SA.js";
import * as deDE from "./core-messages/supplemental/de-DE.js";
import * as enUS from "./core-messages/supplemental/en-US.js";
import * as esES from "./core-messages/supplemental/es-ES.js";
import * as frFR from "./core-messages/supplemental/fr-FR.js";
import * as hiIN from "./core-messages/supplemental/hi-IN.js";
import * as jaJP from "./core-messages/supplemental/ja-JP.js";
import * as koKR from "./core-messages/supplemental/ko-KR.js";
import * as ptBR from "./core-messages/supplemental/pt-BR.js";
import * as zhCN from "./core-messages/supplemental/zh-CN.js";
import * as zhTW from "./core-messages/supplemental/zh-TW.js";
import {
  DEFAULT_LOCALE,
  isLocaleCode,
  type BuiltinLocaleCode,
  type LocaleCode,
} from "./shared.js";

export interface EnvironmentBadgeMessages {
  betaLabel: string;
  betaTitle: string;
  productionTitle: string;
  activeDevelopment: string;
  feedbackPrompt: string;
  continuePrompt: string;
  switchToProduction: string;
  goToBeta: string;
  hideBadge: string;
  openSwitcher: string;
  localDevelopment: string;
  development: string;
}

export const ENVIRONMENT_BADGE_MESSAGES: Record<
  BuiltinLocaleCode,
  EnvironmentBadgeMessages
> = {
  "en-US": enUS.environmentBadgeMessages,
  "es-ES": esES.environmentBadgeMessages,
  "fr-FR": frFR.environmentBadgeMessages,
  "de-DE": deDE.environmentBadgeMessages,
  "pt-BR": ptBR.environmentBadgeMessages,
  "zh-CN": zhCN.environmentBadgeMessages,
  "zh-TW": zhTW.environmentBadgeMessages,
  "ja-JP": jaJP.environmentBadgeMessages,
  "ko-KR": koKR.environmentBadgeMessages,
  "hi-IN": hiIN.environmentBadgeMessages,
  "ar-SA": arSA.environmentBadgeMessages,
};

export function environmentBadgeMessagesForLocale(
  locale: LocaleCode,
): EnvironmentBadgeMessages {
  return ENVIRONMENT_BADGE_MESSAGES[
    isLocaleCode(locale) ? locale : DEFAULT_LOCALE
  ];
}
