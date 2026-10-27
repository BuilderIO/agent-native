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
type ToolkitLocaleMessages = Record<string, unknown>;

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

const legacyAliases = [
  ["onboarding.fileStorage", "onboarding.fileStorage"],
  ["agentPanel.addOwnKeys", "composer.addOwnKeys"],
  ["agentPanel.builderModelCredits", "composer.builderModelCredits"],
  ["agentPanel.builderOrOwnKeys", "setup.builderOrOwnKeys"],
  ["agentPanel.chat", "shell.chat"],
  ["agentPanel.closeTab", "tabs.closeTab"],
  ["agentPanel.configureProviderKeys", "composer.configureProviderKeys"],
  ["agentPanel.connectAi", "setup.connectAi"],
  ["agentPanel.connectBuilderIo", "composer.connectBuilder"],
  ["agentPanel.connectingBuilder", "composer.connectingBuilder"],
  ["agentPanel.loadingTerminal", "shell.loadingTerminal"],
  ["agentPanel.newChat", "tabs.newChat"],
  ["agentPanel.toggleAgent", "shell.toggleAgent"],
  ["agentPanel.voiceMode", "voiceMode"],
  ["contextXray", "contextXray"],
  ["mcpIntegrations", "mcpIntegrations"],
] as const;

function setNestedMessage(
  messages: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const parts = path.split(".");
  let cursor = messages;
  for (const part of parts.slice(0, -1)) {
    const nested = cursor[part];
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1)!] = value;
}

function getNestedMessage(messages: Record<string, unknown>, path: string) {
  let value: unknown = messages;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function nestAgentChatMessages(
  flatMessages: ToolkitAgentChatTranslation,
): ToolkitLocaleMessages {
  const agentChat: Record<string, unknown> = {};
  for (const [flatKey, message] of Object.entries(flatMessages)) {
    setNestedMessage(agentChat, flatKey, message);
  }

  const messages: ToolkitLocaleMessages = { agentChat };
  for (const [legacyPath, agentChatPath] of legacyAliases) {
    const value = getNestedMessage(agentChat, agentChatPath);
    if (value !== undefined) setNestedMessage(messages, legacyPath, value);
  }

  messages.observability = Object.fromEntries(
    [
      "summarizeWithAgent",
      "regenerateSummary",
      "summarizeWithAgentHelp",
      "regenerateSummaryHelp",
      "summarySending",
      "summaryQueued",
      "summaryFailed",
      "summaryExpired",
    ].map((key) => [
      key,
      flatMessages[`observability.${key}` as keyof ToolkitAgentChatTranslation],
    ]),
  );

  return messages;
}

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
