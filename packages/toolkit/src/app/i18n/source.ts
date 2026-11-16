import type { LocaleCode } from "@agent-native/core/client/i18n";

import enUS from "./catalogs/en-US.js";
import { nestAgentChatMessages, type ToolkitLocaleMessages } from "./nest.js";

/**
 * The compile-time source locale for the lazy Toolkit catalogs. Only this
 * catalog is imported statically; every other locale is a dynamic chunk.
 */
export const TOOLKIT_SOURCE_LOCALE = "en-US";

export function sourceToolkitMessages(
  locale: LocaleCode,
): ToolkitLocaleMessages {
  if (locale !== TOOLKIT_SOURCE_LOCALE) {
    throw new Error(
      `Lazy Toolkit locales require sourceLocale "${TOOLKIT_SOURCE_LOCALE}" (received "${locale}"). ` +
        `Pass sourceLocale "${TOOLKIT_SOURCE_LOCALE}" or disable the lazy Toolkit locale build flag.`,
    );
  }
  return nestAgentChatMessages(enUS);
}
