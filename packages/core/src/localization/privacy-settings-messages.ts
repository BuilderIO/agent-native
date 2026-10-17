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
  type BuiltinLocaleCode,
  type LocaleCode,
} from "./shared.js";

export interface PrivacySettingsMessages {
  privacyTitle: string;
  privacyDescription: string;
  privacyManage: string;
  privacyRightsTitle: string;
  privacyRightsDescription: string;
  privacyRequestCopy: string;
  privacyRequestDeletion: string;
  privacyRequesting: string;
  privacyRequestRecorded: string;
  privacyRequestRecordedShort: string;
  privacyRequestError: string;
  privacyDeletionTitle: string;
  privacyDeletionDescription: string;
  privacyDocsLink: string;
}

export const PRIVACY_SETTINGS_MESSAGES: Record<
  BuiltinLocaleCode,
  PrivacySettingsMessages
> = {
  "en-US": enUS.privacySettingsMessages,
  "es-ES": esES.privacySettingsMessages,
  "fr-FR": frFR.privacySettingsMessages,
  "de-DE": deDE.privacySettingsMessages,
  "pt-BR": ptBR.privacySettingsMessages,
  "zh-CN": zhCN.privacySettingsMessages,
  "zh-TW": zhTW.privacySettingsMessages,
  "ja-JP": jaJP.privacySettingsMessages,
  "ko-KR": koKR.privacySettingsMessages,
  "hi-IN": hiIN.privacySettingsMessages,
  "ar-SA": arSA.privacySettingsMessages,
};

export function privacySettingsMessagesForLocale(
  locale: LocaleCode,
): PrivacySettingsMessages {
  return (
    PRIVACY_SETTINGS_MESSAGES[locale as BuiltinLocaleCode] ??
    PRIVACY_SETTINGS_MESSAGES[DEFAULT_LOCALE]
  );
}
