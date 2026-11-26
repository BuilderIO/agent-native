// The reader's locale for browser date/number formatting — the shared boundary for one class.
//
// A bare `value.toLocaleString()` or `new Date(x).toLocaleDateString()` does not use the app's own
// locale setting: it uses whatever the operating system happens to be set to. A reader who picked a
// locale in the app then sees dates and numbers in a different locale on every surface that formats
// without an argument. This is one defect class, and it recurs across the templates and across the
// shared components a template mounts, so the fix lives here once:
//   - `useReaderLocale()` for components (no crash outside the i18n provider, never
//     `navigator.language`);
//   - `formatLocaleDate` / `formatLocaleDateTime` / `formatLocaleTime` / `formatLocaleNumber` for
//     modules that cannot call a hook and receive the locale as an argument.
// `packages/toolkit/scripts/check-hardcoded-locale.mjs` is the detector for the same class.
import { useOptionalLocale } from "@agent-native/core/client/i18n";
import { DEFAULT_LOCALE } from "@agent-native/core/localization";

/**
 * The catalog's default language, used when a surface renders outside AgentNativeI18nProvider
 * (isolated acceptance checks). It is never `navigator.language`: formatting in the operating
 * system's locale instead of the app's is exactly the defect this module exists to prevent.
 */
export const FALLBACK_READER_LOCALE: string = DEFAULT_LOCALE;

/** The reader's locale as a plain string, safe to call outside the i18n provider. */
export function useReaderLocale(): string {
  return useOptionalLocale()?.locale ?? FALLBACK_READER_LOCALE;
}

export function formatLocaleDate(
  value: string | number | Date,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Date(value).toLocaleDateString(locale, options);
}

export function formatLocaleDateTime(
  value: string | number | Date,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Date(value).toLocaleString(locale, options);
}

export function formatLocaleTime(
  value: string | number | Date,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Date(value).toLocaleTimeString(locale, options);
}

export function formatLocaleNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return value.toLocaleString(locale, options);
}
