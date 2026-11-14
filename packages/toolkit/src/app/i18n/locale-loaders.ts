import type { LocaleCode } from "@agent-native/core/client/i18n";

import { nestAgentChatMessages } from "./nest.js";
import { sourceToolkitMessages, TOOLKIT_SOURCE_LOCALE } from "./source.js";
import type { ToolkitAgentChatTranslation } from "./types.js";

type ToolkitLocaleLoader = () => Promise<ToolkitAgentChatTranslation>;

/**
 * Dynamic per-locale Toolkit catalog imports. The en-US source is imported
 * statically by `source.ts`, so it is intentionally absent here.
 */
export const toolkitLocaleLoaders: Partial<
  Record<LocaleCode, ToolkitLocaleLoader>
> = {
  "zh-CN": async () => (await import("./catalogs/zh-CN.js")).default,
  "zh-TW": async () => (await import("./catalogs/zh-TW.js")).default,
  "es-ES": async () => (await import("./catalogs/es-ES.js")).default,
  "fr-FR": async () => (await import("./catalogs/fr-FR.js")).default,
  "de-DE": async () => (await import("./catalogs/de-DE.js")).default,
  "ja-JP": async () => (await import("./catalogs/ja-JP.js")).default,
  "ko-KR": async () => (await import("./catalogs/ko-KR.js")).default,
  "pt-BR": async () => (await import("./catalogs/pt-BR.js")).default,
  "hi-IN": async () => (await import("./catalogs/hi-IN.js")).default,
  "ar-SA": async () => (await import("./catalogs/ar-SA.js")).default,
};

/** Preserve the synchronous catalog's English fallback for future Core locales. */
export async function loadToolkitLocaleMessages(locale: LocaleCode) {
  const loader = toolkitLocaleLoaders[locale];
  return loader
    ? nestAgentChatMessages(await loader())
    : sourceToolkitMessages(TOOLKIT_SOURCE_LOCALE);
}
