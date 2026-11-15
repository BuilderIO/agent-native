import {
  createAgentNativeI18nCatalog,
  SUPPORTED_LOCALES,
  type AgentNativeI18nLocaleLoader,
  type LocaleCode,
} from "@agent-native/core/client/i18n";

import type {
  ToolkitCreateI18nCatalogArgs,
  ToolkitI18nCatalog,
} from "./factory-types.js";
import { loadToolkitLocaleMessages } from "./locale-loaders.js";
import { mergeMessages, normalizeMessages } from "./merge.js";
import { sourceToolkitMessages, TOOLKIT_SOURCE_LOCALE } from "./source.js";

/**
 * Optimized factory: the en-US source is static, every other Toolkit catalog is
 * a dynamic chunk, and app loaders / custom loader precedence is unchanged.
 */
export function createLazyToolkitI18nCatalog(
  args: ToolkitCreateI18nCatalogArgs,
): ToolkitI18nCatalog {
  const sourceLocale = args.sourceLocale ?? TOOLKIT_SOURCE_LOCALE;
  if (sourceLocale !== TOOLKIT_SOURCE_LOCALE) {
    throw new Error(
      `Lazy Toolkit locales require sourceLocale "${TOOLKIT_SOURCE_LOCALE}" (received "${sourceLocale}"). ` +
        `Pass sourceLocale "${TOOLKIT_SOURCE_LOCALE}" or disable the lazy Toolkit locale build flag.`,
    );
  }
  const {
    loadMessages: customLoadMessages,
    localeLoaders: appLoaders,
    ...catalogArgs
  } = args;
  const localeLoaders: Partial<
    Record<LocaleCode, AgentNativeI18nLocaleLoader>
  > = {};
  for (const locale of SUPPORTED_LOCALES) {
    if (locale === sourceLocale) continue;
    const appLoader = appLoaders?.[locale];
    localeLoaders[locale] = async () =>
      mergeMessages(
        await loadToolkitLocaleMessages(locale),
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
    messages: mergeMessages(sourceToolkitMessages(sourceLocale), args.messages),
    localeLoaders,
  });
}
