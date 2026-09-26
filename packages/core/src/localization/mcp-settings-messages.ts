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

export interface McpConnectMessages {
  pageTitle: string;
  authorizeLabel: string;
  terminalTitle: string;
  assistantTitle: string;
  signedInAs: string;
  deviceCode: string;
  guidesLabel: string;
  advancedOptions: string;
  labelOptional: string;
  labelPlaceholder: string;
  expiresInDays: string;
  terminalAlternative: string;
  existingConnections: string;
  checkingConnections: string;
  unavailable: string;
  couldNotLoadConnections: string;
  emptyConnections: string;
  unlabeled: string;
  lastUsed: string;
  revoked: string;
  created: string;
  revoke: string;
  couldNotRevoke: string;
  authorizeDevice: string;
  fullCatalogRequested: string;
  createToken: string;
  authorizingDevice: string;
  creatingToken: string;
  couldNotAuthorize: string;
  unknownDeviceCode: string;
  expiredDeviceCode: string;
  alreadyUsedDeviceCode: string;
  finishingConnection: string;
  deviceAuthorized: string;
  connected: string;
  connectedDescription: string;
  couldNotCreate: string;
  networkError: string;
  urlTitle: string;
}

export const MCP_CONNECT_MESSAGES: Record<
  BuiltinLocaleCode,
  McpConnectMessages
> = {
  "en-US": enUS.mcpConnectMessages,
  "es-ES": esES.mcpConnectMessages,
  "fr-FR": frFR.mcpConnectMessages,
  "de-DE": deDE.mcpConnectMessages,
  "pt-BR": ptBR.mcpConnectMessages,
  "zh-CN": zhCN.mcpConnectMessages,
  "zh-TW": zhTW.mcpConnectMessages,
  "ja-JP": jaJP.mcpConnectMessages,
  "ko-KR": koKR.mcpConnectMessages,
  "hi-IN": hiIN.mcpConnectMessages,
  "ar-SA": arSA.mcpConnectMessages,
};

export interface McpSettingsMessages {
  mcpTitle: string;
  mcpDescription: string;
  mcpUrlLabel: string;
  mcpUrlHint: string;
  mcpOpenDocs: string;
  a2aAgentCard: string;
  a2aOpenDocs: string;
  mcpClientSetup: string;
  mcpClientSetupDescription: string;
  mcpChooseAssistant: string;
  mcpCommand: string;
  mcpConfig: string;
  mcpCopy: string;
  mcpCopied: string;
  mcpStaticTokenDescription: string;
  mcpOpenConnectPage: string;
  mcpConnect: McpConnectMessages;
}

export const MCP_SETTINGS_MESSAGES: Record<
  BuiltinLocaleCode,
  McpSettingsMessages
> = {
  "en-US": enUS.mcpSettingsMessages,
  "es-ES": esES.mcpSettingsMessages,
  "fr-FR": frFR.mcpSettingsMessages,
  "de-DE": deDE.mcpSettingsMessages,
  "pt-BR": ptBR.mcpSettingsMessages,
  "zh-CN": zhCN.mcpSettingsMessages,
  "zh-TW": zhTW.mcpSettingsMessages,
  "ja-JP": jaJP.mcpSettingsMessages,
  "ko-KR": koKR.mcpSettingsMessages,
  "hi-IN": hiIN.mcpSettingsMessages,
  "ar-SA": arSA.mcpSettingsMessages,
};

export function mcpSettingsMessagesForLocale(
  locale: LocaleCode,
): McpSettingsMessages {
  return (
    MCP_SETTINGS_MESSAGES[locale as BuiltinLocaleCode] ??
    MCP_SETTINGS_MESSAGES[DEFAULT_LOCALE]
  );
}
