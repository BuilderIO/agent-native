import {
  createAgentNativeI18nCatalog,
  SUPPORTED_LOCALES,
  type AgentNativeI18nCatalog,
  type AgentNativeI18nLocaleLoader,
  type LocaleCode,
  type LocaleMessages,
} from "@agent-native/core/client/i18n";

import { toolkitMessagesForLocale } from "./i18n/catalog.js";

export { toolkitMessagesForLocale } from "./i18n/catalog.js";

function mergeMessages(
  base: LocaleMessages,
  overrides: LocaleMessages,
): LocaleMessages {
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const current = merged[key];
    if (
      current &&
      value &&
      typeof current === "object" &&
      typeof value === "object" &&
      !Array.isArray(current) &&
      !Array.isArray(value)
    ) {
      merged[key] = mergeMessages(
        current as LocaleMessages,
        value as LocaleMessages,
      );
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function normalizeMessages(value: unknown): LocaleMessages {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  if (Object.prototype.toString.call(value) === "[object Module]") {
    return normalizeMessages((value as { default?: unknown }).default);
  }
  return value as LocaleMessages;
}

export function createToolkitI18nCatalog(
  args: Omit<
    AgentNativeI18nCatalog,
    "messages" | "loadMessages" | "sourceLocale"
  > & {
    messages: LocaleMessages;
    sourceLocale?: LocaleCode;
    loadMessages?: AgentNativeI18nCatalog["loadMessages"];
    localeLoaders?: Partial<Record<LocaleCode, AgentNativeI18nLocaleLoader>>;
  },
): AgentNativeI18nCatalog & {
  messages: LocaleMessages;
  sourceLocale: LocaleCode;
  loadMessages: (locale: LocaleCode) => Promise<LocaleMessages | null>;
} {
  const {
    loadMessages: customLoadMessages,
    localeLoaders: appLoaders,
    ...catalogArgs
  } = args;
  const localeLoaders: Partial<
    Record<LocaleCode, AgentNativeI18nLocaleLoader>
  > = {};
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === (args.sourceLocale ?? "en-US")) continue;
    const appLoader = appLoaders?.[locale];
    localeLoaders[locale] = async () =>
      mergeMessages(
        toolkitMessagesForLocale(locale),
        normalizeMessages(
          appLoader
            ? await appLoader()
            : customLoadMessages
              ? await customLoadMessages(locale)
              : null,
        ),
      );
  }

  return createAgentNativeI18nCatalog({
    ...catalogArgs,
    messages: mergeMessages(
      toolkitMessagesForLocale(args.sourceLocale ?? "en-US"),
      args.messages,
    ),
    localeLoaders,
  });
}
