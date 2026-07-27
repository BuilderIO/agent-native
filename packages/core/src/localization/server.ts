import {
  DEFAULT_LOCALE,
  LOCALE_HYDRATION_GLOBAL,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  localeDirection,
  normalizeLocaleCode,
  normalizeLocalizationPreference,
  resolveLocaleFromPreference,
  type LocaleCode,
  type LocalePreference,
  type LocalizationPreference,
} from "./shared.js";

interface RequestLike {
  headers?: Headers | Record<string, string | string[] | undefined> | null;
}

type HeaderMap = Headers | Record<string, string | string[] | undefined>;

export interface ResolvedRequestLocale {
  locale: LocaleCode;
  preference: LocalizationPreference;
  dir: "ltr" | "rtl";
}

export interface ResolveLocaleFromRequestOptions {
  request?: Request | RequestLike | null;
  acceptLanguage?: string | null;
  preference?: LocalizationPreference | LocalePreference | null;
  fallback?: LocaleCode;
}

export interface LocaleInitScriptOptions {
  locale?: LocaleCode;
  preference?: LocalizationPreference | LocalePreference;
  messages?: Record<string, unknown> | null;
}

function readHeader(
  headers: HeaderMap | undefined | null,
  key: string,
): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(key);
  }
  const lowerKey = key.toLowerCase();
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== lowerKey) continue;
    if (Array.isArray(value)) return value.join(",");
    return value ?? null;
  }
  return null;
}

export function parseAcceptLanguage(header: string | null | undefined) {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q="));
      const weight = q ? Number.parseFloat(q.slice(2)) : 1;
      return {
        tag,
        weight: Number.isFinite(weight) ? weight : 0,
      };
    })
    .filter((entry) => entry.tag && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map((entry) => entry.tag);
}

export function resolveLocaleFromRequest(
  options: ResolveLocaleFromRequestOptions = {},
): ResolvedRequestLocale {
  const header =
    options.acceptLanguage ??
    readHeader(options.request?.headers, "accept-language");
  const candidates = parseAcceptLanguage(header);
  const preference = normalizeLocalizationPreference(
    options.preference ?? { locale: "system" },
  );
  const locale =
    preference.locale === "system"
      ? resolveLocaleFromPreference(preference, [
          ...candidates,
          options.fallback ?? DEFAULT_LOCALE,
        ])
      : (normalizeLocaleCode(preference.locale) ??
        options.fallback ??
        DEFAULT_LOCALE);
  return {
    locale,
    preference,
    dir: localeDirection(locale),
  };
}

export function getLocaleInitScript(options: LocaleInitScriptOptions = {}) {
  const safeLocale = normalizeLocaleCode(options.locale) ?? DEFAULT_LOCALE;
  const shouldStorePreference = options.preference !== undefined;
  const safePreference = normalizeLocalizationPreference(
    options.preference ?? { locale: "system" },
  );
  const payload = {
    locale: safeLocale,
    preference: safePreference,
    dir: localeDirection(safeLocale),
    messages: options.messages ?? undefined,
  };

  return `(function(){try{var supported=${JSON.stringify(
    SUPPORTED_LOCALES,
  )};var payload=${JSON.stringify(
    payload,
  )};var shouldStorePreference=${JSON.stringify(
    shouldStorePreference,
  )};function valid(x){return supported.indexOf(x)>=0}function canon(x){if(typeof x!=='string'||!x)return null;try{var c=Intl.getCanonicalLocales(x)[0];if(valid(c))return c;var lang=c&&c.split('-')[0].toLowerCase();for(var i=0;i<supported.length;i++){if(supported[i].split('-')[0].toLowerCase()===lang)return supported[i]}}catch(e){}return null}function storageGet(k){try{return window.localStorage.getItem(k)}catch(e){return null}}function storageSet(k,v){try{window.localStorage.setItem(k,v)}catch(e){}}var stored=storageGet(${JSON.stringify(
    LOCALE_STORAGE_KEY,
  )});var pref=payload.preference&&payload.preference.locale;var locale=payload.locale;if(!valid(locale)){locale=null}if(!locale&&stored&&stored!=='system'){locale=canon(stored)}if(!locale&&pref&&pref!=='system'){locale=canon(pref)}if(!locale){var langs=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];for(var j=0;j<langs.length&&!locale;j++){locale=canon(langs[j])}}if(!locale)locale=${JSON.stringify(
    DEFAULT_LOCALE,
  )};var root=document.documentElement;root.setAttribute('lang',locale);root.setAttribute('dir',locale==='ar-SA'?'rtl':'ltr');root.setAttribute('data-locale',locale);payload.locale=locale;payload.dir=locale==='ar-SA'?'rtl':'ltr';window[${JSON.stringify(
    LOCALE_HYDRATION_GLOBAL,
  )}]=payload;if(shouldStorePreference&&pref){storageSet(${JSON.stringify(
    LOCALE_STORAGE_KEY,
  )},pref)}}catch(e){}})();`;
}
