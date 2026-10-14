import { agentResourcePackMessagesForLocale } from "./agent-resources-messages.js";
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

export function normalizeCoreMessageOverrides(
  messages: CoreLocaleMessages,
): CoreLocaleMessages {
  const normalized = structuredClone(messages);
  const aliases = [
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

  function get(path: string): unknown {
    let value: unknown = normalized;
    for (const part of path.split(".")) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
      }
      value = (value as Record<string, unknown>)[part];
    }
    return value;
  }

  function set(path: string, value: unknown) {
    const parts = path.split(".");
    let cursor = normalized;
    for (const part of parts.slice(0, -1)) {
      const nested = cursor[part];
      if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts.at(-1)!] = value;
  }

  function merge(legacy: unknown, modern: unknown): unknown {
    if (modern === undefined) return legacy;
    if (
      legacy &&
      modern &&
      typeof legacy === "object" &&
      typeof modern === "object" &&
      !Array.isArray(legacy) &&
      !Array.isArray(modern)
    ) {
      const result = { ...(legacy as Record<string, unknown>) };
      for (const [key, value] of Object.entries(modern)) {
        result[key] = merge(result[key], value);
      }
      return result;
    }
    return modern;
  }

  for (const [legacyPath, chatPath] of aliases) {
    const value = get(legacyPath);
    if (value !== undefined) {
      set(`agentChat.${chatPath}`, merge(value, get(`agentChat.${chatPath}`)));
    }
  }
  return normalized;
}

export async function loadCoreMessagesForLocale(
  locale: LocaleCode,
): Promise<CoreLocaleMessages> {
  const supplementalLoader = isLocaleCode(locale)
    ? supplementalCoreMessageLoaders[locale]
    : supplementalCoreMessageLoaders[DEFAULT_LOCALE];
  const supplementalMessages = await supplementalLoader();
  return {
    agentResources: agentResourcePackMessagesForLocale(locale),
    environmentBadge: environmentBadgeMessagesForLocale(locale),
    iconPicker: iconPickerMessagesForLocale(locale),
    settings: {
      ...supplementalMessages.mcpSettingsMessages,
      ...supplementalMessages.privacySettingsMessages,
    },
  };
}

const englishCoreMessages = {
  agentResources: agentResourcePackMessagesForLocale(DEFAULT_LOCALE),
  environmentBadge: englishSupplementalMessages.environmentBadgeMessages,
  iconPicker: iconPickerMessagesForLocale(DEFAULT_LOCALE),
  settings: {
    ...englishSupplementalMessages.mcpSettingsMessages,
    ...englishSupplementalMessages.privacySettingsMessages,
  },
};

export function coreMessagesForLocale(locale: LocaleCode): CoreLocaleMessages {
  if (locale === DEFAULT_LOCALE || !isLocaleCode(locale)) {
    return englishCoreMessages;
  }
  return {
    environmentBadge: environmentBadgeMessagesForLocale(locale),
  };
}
