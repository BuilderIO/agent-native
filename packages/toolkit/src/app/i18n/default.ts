import {
  createAgentNativeI18nCatalog,
  SUPPORTED_LOCALES,
  type AgentNativeI18nLocaleLoader,
  type LocaleCode,
} from "@agent-native/core/client/i18n";

import { toolkitMessagesForLocale } from "./catalog.js";
import type {
  ToolkitCreateI18nCatalogArgs,
  ToolkitI18nCatalog,
} from "./factory-types.js";
import { mergeMessages, normalizeMessages } from "./merge.js";

/**
 * Default-compatible factory: the synchronous aggregate supplies every
 * locale's Toolkit messages, exactly as before the lazy opt-in existed.
 */
export function createDefaultToolkitI18nCatalog(
  args: ToolkitCreateI18nCatalogArgs,
): ToolkitI18nCatalog {
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
