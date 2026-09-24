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

export type BuiltinLocaleCode = (typeof SUPPORTED_LOCALES)[number];
/** A canonical BCP-47 locale, including app-registered locale codes. */
export type LocaleCode = string & {};
export type LocalePreference = "system" | LocaleCode;

export interface LocaleMetadata {
  code: LocaleCode;
  englishName: string;
  nativeName: string;
  dir: "ltr" | "rtl";
}

export type LocaleMetadataMap = Readonly<Record<string, LocaleMetadata>>;

export interface LocalizationPreference {
  locale: LocalePreference;
  /**
   * IANA zone used for the user's scheduled work. 'system' defers to the
   * requesting browser, which is unavailable to headless callers (cron,
   * chat integrations), so pinning a zone here is what makes a schedule
   * mean the same thing no matter what created it.
   *
   * Optional because a record written before this field existed, or by a
   * caller that only cares about language, is still a valid preference.
   * Read it through normalizeLocalizationPreference to get a concrete value.
   */
  timezone?: TimezonePreference;
}

/** A preference that has been through normalization: both fields resolved. */
export type ResolvedLocalizationPreference = Required<LocalizationPreference>;

export type TimezonePreference = "system" | (string & {});

export const DEFAULT_LOCALE: BuiltinLocaleCode = "en-US";
export const LOCALIZATION_SETTING_KEY = "localization";
export const LOCALE_STORAGE_KEY = "agent-native:locale-preference";
export const LOCALE_HYDRATION_GLOBAL = "__AGENT_NATIVE_LOCALE__";

export const LOCALE_METADATA: Record<BuiltinLocaleCode, LocaleMetadata> = {
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

export function localeMetadataFor(
  locale: LocaleCode,
  metadata: LocaleMetadataMap = LOCALE_METADATA,
): LocaleMetadata {
  return (
    metadata[locale] ??
    LOCALE_METADATA[locale as BuiltinLocaleCode] ?? {
      code: locale,
      englishName: locale,
      nativeName: locale,
      dir: "ltr",
    }
  );
}

/** Return the short native language name used in compact locale pickers. */
export function localeDisplayName(
  locale: LocaleCode,
  metadata: LocaleMetadataMap = LOCALE_METADATA,
): string {
  const nativeName = localeMetadataFor(locale, metadata).nativeName;
  return nativeName.split("(", 1)[0]?.trim() || nativeName;
}

const SUPPORTED_LOCALE_SET = new Set<string>(SUPPORTED_LOCALES);

const CHINESE_LOCALE_ALIASES: Record<string, BuiltinLocaleCode> = {
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

function normalizeChineseLocaleAlias(
  canonical: string,
): BuiltinLocaleCode | null {
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

export function isLocaleCode(value: unknown): value is BuiltinLocaleCode {
  return typeof value === "string" && SUPPORTED_LOCALE_SET.has(value);
}

function canonicalizeLocaleCode(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    return Intl.getCanonicalLocales(value.trim())[0] ?? null;
  } catch {
    return null;
  }
}

export function isValidLocaleCode(value: unknown): value is LocaleCode {
  return canonicalizeLocaleCode(value) !== null;
}

/**
 * Resolve a locale against an app's registered list. The default list keeps
 * existing callers restricted to the framework's built-in locales.
 */
export function normalizeLocaleCode(
  value: unknown,
  supportedLocales: readonly LocaleCode[] = SUPPORTED_LOCALES,
): LocaleCode | null {
  const canonical = canonicalizeLocaleCode(value);
  if (!canonical) return null;

  const canonicalSupported = supportedLocales
    .map((locale) => canonicalizeLocaleCode(locale))
    .filter((locale): locale is string => locale !== null);
  const exact = canonicalSupported.find((locale) => locale === canonical);
  if (exact) return exact;

  const alias = normalizeChineseLocaleAlias(canonical);
  if (alias && canonicalSupported.includes(alias)) return alias;

  const language = canonical.split("-")[0]?.toLowerCase();
  const match = canonicalSupported.find(
    (locale) => locale.split("-")[0]?.toLowerCase() === language,
  );
  return match ?? null;
}

export function normalizeLocalePreference(
  value: unknown,
  supportedLocales?: readonly LocaleCode[],
): LocalePreference | null {
  if (value === "system") return "system";
  const canonical = canonicalizeLocaleCode(value);
  if (!canonical) return null;
  return (
    normalizeLocaleCode(canonical, supportedLocales ?? SUPPORTED_LOCALES) ??
    (supportedLocales ? null : canonical)
  );
}

export function normalizeTimezonePreference(
  value: unknown,
): TimezonePreference {
  if (typeof value !== "string") return "system";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "system") return "system";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
  } catch {
    return "system";
  }
  return trimmed;
}

export function normalizeLocalizationPreference(
  value: unknown,
  supportedLocales?: readonly LocaleCode[],
): ResolvedLocalizationPreference {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as { locale?: unknown; timezone?: unknown };
    // The two fields are independent: setting a timezone must not require
    // also picking a language, which is the usual case.
    return {
      locale:
        normalizeLocalePreference(record.locale, supportedLocales) ?? "system",
      timezone: normalizeTimezonePreference(record.timezone),
    };
  }
  const locale = normalizeLocalePreference(value, supportedLocales);
  return { locale: locale ?? "system", timezone: "system" };
}

export function localeDirection(
  locale: LocaleCode,
  metadata: LocaleMetadataMap = LOCALE_METADATA,
): "ltr" | "rtl" {
  return localeMetadataFor(locale, metadata).dir;
}

export function resolveLocaleFromCandidates(
  candidates: Iterable<unknown>,
  supportedLocales: readonly LocaleCode[] = SUPPORTED_LOCALES,
): LocaleCode {
  for (const candidate of candidates) {
    const normalized = normalizeLocaleCode(candidate, supportedLocales);
    if (normalized) return normalized;
  }
  return (
    normalizeLocaleCode(supportedLocales[0], supportedLocales) ?? DEFAULT_LOCALE
  );
}

export function resolveLocaleFromPreference(
  preference: unknown,
  systemCandidates: Iterable<unknown> = [],
  supportedLocales: readonly LocaleCode[] = SUPPORTED_LOCALES,
): LocaleCode {
  const normalized =
    typeof preference === "string"
      ? normalizeLocalePreference(preference, supportedLocales)
      : normalizeLocalizationPreference(preference, supportedLocales).locale;
  if (normalized && normalized !== "system") {
    return (
      normalizeLocaleCode(normalized, supportedLocales) ??
      resolveLocaleFromCandidates(systemCandidates, supportedLocales)
    );
  }
  return resolveLocaleFromCandidates(systemCandidates, supportedLocales);
}
