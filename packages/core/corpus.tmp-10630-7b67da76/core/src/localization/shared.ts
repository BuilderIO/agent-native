export const SUPPORTED_LOCALES = [
  "en-US",
  "es-ES",
  "fr-FR",
  "de-DE",
  "pt-BR",
  "zh-CN",
  "zh-TW",
  "ja-JP",
  "ko-KR",
  "hi-IN",
  "ar-SA",
] as const;

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number];
export type LocalePreference = "system" | LocaleCode;

export interface LocaleMetadata {
  code: LocaleCode;
  englishName: string;
  nativeName: string;
  dir: "ltr" | "rtl";
}

export interface LocalizationPreference {
  locale: LocalePreference;
}

export const DEFAULT_LOCALE: LocaleCode = "en-US";
export const LOCALIZATION_SETTING_KEY = "localization";
export const LOCALE_STORAGE_KEY = "agent-native:locale-preference";
export const LOCALE_HYDRATION_GLOBAL = "__AGENT_NATIVE_LOCALE__";

export const LOCALE_METADATA: Record<LocaleCode, LocaleMetadata> = {
  "en-US": {
    code: "en-US",
    englishName: "English",
    nativeName: "English",
    dir: "ltr",
  },
  "zh-CN": {
    code: "zh-CN",
    englishName: "Chinese (Simplified)",
    nativeName: "简体中文",
    dir: "ltr",
  },
  "zh-TW": {
    code: "zh-TW",
    englishName: "Chinese (Traditional, Taiwan)",
    nativeName: "繁體中文",
    dir: "ltr",
  },
  "es-ES": {
    code: "es-ES",
    englishName: "Spanish",
    nativeName: "Español",
    dir: "ltr",
  },
  "fr-FR": {
    code: "fr-FR",
    englishName: "French",
    nativeName: "Français",
    dir: "ltr",
  },
  "de-DE": {
    code: "de-DE",
    englishName: "German",
    nativeName: "Deutsch",
    dir: "ltr",
  },
  "ja-JP": {
    code: "ja-JP",
    englishName: "Japanese",
    nativeName: "日本語",
    dir: "ltr",
  },
  "ko-KR": {
    code: "ko-KR",
    englishName: "Korean",
    nativeName: "한국어",
    dir: "ltr",
  },
  "pt-BR": {
    code: "pt-BR",
    englishName: "Portuguese (Brazil)",
    nativeName: "Português (Brasil)",
    dir: "ltr",
  },
  "hi-IN": {
    code: "hi-IN",
    englishName: "Hindi",
    nativeName: "हिन्दी",
    dir: "ltr",
  },
  "ar-SA": {
    code: "ar-SA",
    englishName: "Arabic",
    nativeName: "العربية",
    dir: "rtl",
  },
};

const SUPPORTED_LOCALE_SET = new Set<string>(SUPPORTED_LOCALES);

const CHINESE_LOCALE_ALIASES: Record<string, LocaleCode> = {
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-hans-cn": "zh-CN",
  "zh-hans-sg": "zh-CN",
  "zh-hant": "zh-TW",
  "zh-hant-hk": "zh-TW",
  "zh-hant-mo": "zh-TW",
  "zh-hant-tw": "zh-TW",
  "zh-hk": "zh-TW",
  "zh-mo": "zh-TW",
  "zh-sg": "zh-CN",
  "zh-tw": "zh-TW",
};

function normalizeChineseLocaleAlias(canonical: string): LocaleCode | null {
  const normalized = canonical.toLowerCase();
  const alias = CHINESE_LOCALE_ALIASES[normalized];
  if (alias) return alias;

  const parts = normalized.split("-");
  if (parts[0] !== "zh") return null;
  if (
    parts.includes("hant") ||
    parts.includes("tw") ||
    parts.includes("hk") ||
    parts.includes("mo")
  ) {
    return "zh-TW";
  }
  if (parts.includes("hans") || parts.includes("cn") || parts.includes("sg")) {
    return "zh-CN";
  }
  return null;
}

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === "string" && SUPPORTED_LOCALE_SET.has(value);
}

export function normalizeLocaleCode(value: unknown): LocaleCode | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    for (const canonical of Intl.getCanonicalLocales(value.trim())) {
      if (isLocaleCode(canonical)) return canonical;
      const alias = normalizeChineseLocaleAlias(canonical);
      if (alias) return alias;
      const language = canonical.split("-")[0]?.toLowerCase();
      const match = SUPPORTED_LOCALES.find(
        (locale) => locale.split("-")[0]?.toLowerCase() === language,
      );
      if (match) return match;
    }
  } catch {
    return null;
  }
  return null;
}

export function normalizeLocalePreference(
  value: unknown,
): LocalePreference | null {
  if (value === "system") return "system";
  return normalizeLocaleCode(value);
}

export function normalizeLocalizationPreference(
  value: unknown,
): LocalizationPreference {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const locale = normalizeLocalePreference(
      (value as { locale?: unknown }).locale,
    );
    if (locale) return { locale };
  }
  const locale = normalizeLocalePreference(value);
  return { locale: locale ?? "system" };
}

export function localeDirection(locale: LocaleCode): "ltr" | "rtl" {
  return LOCALE_METADATA[locale]?.dir ?? "ltr";
}

export function resolveLocaleFromCandidates(
  candidates: Iterable<unknown>,
): LocaleCode {
  for (const candidate of candidates) {
    const normalized = normalizeLocaleCode(candidate);
    if (normalized) return normalized;
  }
  return DEFAULT_LOCALE;
}

export function resolveLocaleFromPreference(
  preference: LocalizationPreference | LocalePreference | unknown,
  systemCandidates: Iterable<unknown> = [],
): LocaleCode {
  const normalized =
    typeof preference === "string"
      ? normalizeLocalePreference(preference)
      : normalizeLocalizationPreference(preference).locale;
  if (normalized && normalized !== "system") return normalized;
  return resolveLocaleFromCandidates(systemCandidates);
}
