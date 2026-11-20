import type {
  LocaleCode,
  LocaleMessages,
} from "@agent-native/core/client/i18n";
import { normalizeLocaleCode } from "@agent-native/core/client/i18n";
import { createToolkitI18nCatalog } from "@agent-native/toolkit/app/i18n";

import enUS from "./en-US";

const localeLoaders = {
  "zh-CN": () => import("./zh-CN"),
  "zh-TW": () => import("./zh-TW"),
  "es-ES": () => import("./es-ES"),
  "fr-FR": () => import("./fr-FR"),
  "de-DE": () => import("./de-DE"),
  "ja-JP": () => import("./ja-JP"),
  "ko-KR": () => import("./ko-KR"),
  "pt-BR": () => import("./pt-BR"),
  "hi-IN": () => import("./hi-IN"),
  "ar-SA": () => import("./ar-SA"),
};

export const i18nCatalog = createToolkitI18nCatalog({
  messages: enUS,
  localeLoaders,
});

/** The locales this build ships messages for. */
export const shippedLocaleCodes = Object.keys(localeLoaders) as LocaleCode[];

/**
 * The locale code for a language a caller names, whether it names the whole tag
 * ("de-DE") or only the language ("de", which is what the form settings store).
 * Null when this build ships no messages for it.
 */
export function resolveShippedLocale(code: string): LocaleCode | null {
  return normalizeLocaleCode(code, shippedLocaleCodes);
}

/**
 * The app's own messages for one locale, for a surface that must render in a language
 * other than the interface's (a published form carries its own). Null when this build
 * ships no such locale, and the caller keeps the source language.
 */
export async function loadLocaleMessages(
  code: string,
): Promise<LocaleMessages | null> {
  const locale = resolveShippedLocale(code);
  const loader = locale
    ? (localeLoaders as Record<string, undefined | (() => Promise<unknown>)>)[
        locale
      ]
    : undefined;
  if (!loader) return null;
  const loaded = (await loader()) as { default?: LocaleMessages };
  return loaded.default ?? null;
}
