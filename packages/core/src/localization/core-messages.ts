import englishMessages from "./core-messages/en-US.js";
import type { LocaleCode } from "./shared.js";

export type CoreLocaleMessages = Record<string, unknown>;

export const englishAgentChatMessages = englishMessages;

type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";
type RequiredAgentChatKey = Exclude<
  keyof typeof englishAgentChatMessages,
  `${string}_${PluralSuffix}`
>;

export type AgentChatTranslation = Record<string, string> & {
  [K in RequiredAgentChatKey]: string;
};

const legacyAgentChatAliases = [
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
] as const;

function getNestedMessage(
  messages: Record<string, unknown>,
  path: string,
): unknown {
  let value: unknown = messages;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

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

function nestAgentChatMessages(
  flatMessages: AgentChatTranslation,
): CoreLocaleMessages {
  const agentChat: Record<string, unknown> = {};
  for (const [flatKey, message] of Object.entries(flatMessages)) {
    const parts = flatKey.split(".");
    let cursor = agentChat;
    for (const part of parts.slice(0, -1)) {
      const nested = cursor[part];
      if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts.at(-1)!] = message;
  }
  const messages: CoreLocaleMessages = { agentChat };
  for (const [legacyPath, agentChatPath] of legacyAgentChatAliases) {
    const value = getNestedMessage(agentChat, agentChatPath);
    if (value !== undefined) setNestedMessage(messages, legacyPath, value);
  }
  return messages;
}

const coreMessageLoaders = {
  "en-US": async () => ({ default: englishAgentChatMessages }),
  "zh-CN": () => import("./core-messages/zh-CN.js"),
  "zh-TW": () => import("./core-messages/zh-TW.js"),
  "es-ES": () => import("./core-messages/es-ES.js"),
  "fr-FR": () => import("./core-messages/fr-FR.js"),
  "de-DE": () => import("./core-messages/de-DE.js"),
  "ja-JP": () => import("./core-messages/ja-JP.js"),
  "ko-KR": () => import("./core-messages/ko-KR.js"),
  "pt-BR": () => import("./core-messages/pt-BR.js"),
  "hi-IN": () => import("./core-messages/hi-IN.js"),
  "ar-SA": () => import("./core-messages/ar-SA.js"),
} satisfies Record<
  LocaleCode,
  () => Promise<{ default: AgentChatTranslation }>
>;

export async function loadAgentChatMessagesForLocale(
  locale: LocaleCode,
): Promise<AgentChatTranslation> {
  return (await coreMessageLoaders[locale]()).default;
}

export async function loadCoreMessagesForLocale(
  locale: LocaleCode,
): Promise<CoreLocaleMessages> {
  return nestAgentChatMessages(await loadAgentChatMessagesForLocale(locale));
}

const englishCoreMessages = nestAgentChatMessages(englishAgentChatMessages);

// Only English is eager. Non-English Core catalogs load with the app catalog.
export function coreMessagesForLocale(locale: LocaleCode): CoreLocaleMessages {
  return locale === "en-US" ? englishCoreMessages : {};
}
