import englishMessages from "./core-messages/en-US.js";
import * as englishSupplementalMessages from "./core-messages/supplemental/en-US.js";
import { environmentBadgeMessagesForLocale } from "./environment-badge-messages.js";
import { iconPickerMessagesForLocale } from "./icon-picker-messages.js";
import {
  DEFAULT_LOCALE,
  isLocaleCode,
  type BuiltinLocaleCode,
  type LocaleCode,
} from "./shared.js";

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
  ["mcpIntegrations", "mcpIntegrations"],
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

function cloneMessages(messages: Record<string, unknown>): CoreLocaleMessages {
  const cloned: CoreLocaleMessages = {};
  for (const [key, value] of Object.entries(messages)) {
    cloned[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? cloneMessages(value as Record<string, unknown>)
        : value;
  }
  return cloned;
}

function mergeLegacyMessageValue(legacyValue: unknown, modernValue: unknown) {
  if (modernValue === undefined) return legacyValue;
  if (
    legacyValue &&
    modernValue &&
    typeof legacyValue === "object" &&
    typeof modernValue === "object" &&
    !Array.isArray(legacyValue) &&
    !Array.isArray(modernValue)
  ) {
    const merged = { ...(legacyValue as Record<string, unknown>) };
    for (const [key, value] of Object.entries(
      modernValue as Record<string, unknown>,
    )) {
      merged[key] = mergeLegacyMessageValue(merged[key], value);
    }
    return merged;
  }
  return modernValue;
}

export function normalizeCoreMessageOverrides(
  messages: CoreLocaleMessages,
): CoreLocaleMessages {
  const normalized = cloneMessages(messages);
  for (const [legacyPath, agentChatPath] of legacyAgentChatAliases) {
    const legacyValue = getNestedMessage(normalized, legacyPath);
    const modernPath = `agentChat.${agentChatPath}`;
    if (legacyValue !== undefined) {
      setNestedMessage(
        normalized,
        modernPath,
        mergeLegacyMessageValue(
          legacyValue,
          getNestedMessage(normalized, modernPath),
        ),
      );
    }
  }
  return normalized;
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
  BuiltinLocaleCode,
  () => Promise<{ default: AgentChatTranslation }>
>;

const supplementalCoreMessageLoaders = {
  "en-US": () => import("./core-messages/supplemental/en-US.js"),
  "zh-CN": () => import("./core-messages/supplemental/zh-CN.js"),
  "zh-TW": () => import("./core-messages/supplemental/zh-TW.js"),
  "es-ES": () => import("./core-messages/supplemental/es-ES.js"),
  "fr-FR": () => import("./core-messages/supplemental/fr-FR.js"),
  "de-DE": () => import("./core-messages/supplemental/de-DE.js"),
  "ja-JP": () => import("./core-messages/supplemental/ja-JP.js"),
  "ko-KR": () => import("./core-messages/supplemental/ko-KR.js"),
  "pt-BR": () => import("./core-messages/supplemental/pt-BR.js"),
  "hi-IN": () => import("./core-messages/supplemental/hi-IN.js"),
  "ar-SA": () => import("./core-messages/supplemental/ar-SA.js"),
} satisfies Record<
  BuiltinLocaleCode,
  () => Promise<typeof import("./core-messages/supplemental/en-US.js")>
>;

export async function loadAgentChatMessagesForLocale(
  locale: LocaleCode,
): Promise<AgentChatTranslation> {
  const loader = isLocaleCode(locale)
    ? coreMessageLoaders[locale]
    : coreMessageLoaders[DEFAULT_LOCALE];
  return (await loader()).default;
}

export async function loadCoreMessagesForLocale(
  locale: LocaleCode,
): Promise<CoreLocaleMessages> {
  const supplementalLoader = isLocaleCode(locale)
    ? supplementalCoreMessageLoaders[locale]
    : supplementalCoreMessageLoaders[DEFAULT_LOCALE];
  const [agentChatMessages, supplementalMessages] = await Promise.all([
    loadAgentChatMessagesForLocale(locale),
    supplementalLoader(),
  ]);
  return {
    ...nestAgentChatMessages(agentChatMessages),
    environmentBadge: supplementalMessages.environmentBadgeMessages,
    iconPicker: iconPickerMessagesForLocale(locale),
    settings: {
      ...supplementalMessages.mcpSettingsMessages,
      ...supplementalMessages.privacySettingsMessages,
    },
  };
}

const englishCoreMessages = {
  ...nestAgentChatMessages(englishAgentChatMessages),
  environmentBadge: englishSupplementalMessages.environmentBadgeMessages,
  iconPicker: iconPickerMessagesForLocale(DEFAULT_LOCALE),
  settings: {
    ...englishSupplementalMessages.mcpSettingsMessages,
    ...englishSupplementalMessages.privacySettingsMessages,
  },
};

// Non-English chat and settings catalogs load with the app locale.
export function coreMessagesForLocale(locale: LocaleCode): CoreLocaleMessages {
  if (locale === DEFAULT_LOCALE || !isLocaleCode(locale)) {
    return englishCoreMessages;
  }
  return {
    environmentBadge: environmentBadgeMessagesForLocale(locale),
  };
}
