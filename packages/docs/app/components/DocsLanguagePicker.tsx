import { IconLanguage } from "@tabler/icons-react";
import {
  normalizeLocalizationPreference,
  useLocale,
  useT,
} from "@agent-native/core/client";
import { useLocation, useNavigate } from "react-router";
import {
  DEFAULT_DOCS_LOCALE,
  DOCS_LOCALE_METADATA,
  DOCS_LOCALES,
  browserDocsLocale,
  docsPathForSlug,
  docsSlugFromPathname,
  type DocsLocale,
} from "./docs-locale";
import { hasLocalizedDoc } from "./docs-content";

function localeOptionLabel(locale: DocsLocale) {
  const metadata = DOCS_LOCALE_METADATA[locale];
  return `${metadata.nativeName} (${locale})`;
}

function preferenceLabel(preference: string) {
  if (preference === "system") return "System";
  if (preference in DOCS_LOCALE_METADATA) {
    return localeOptionLabel(preference as DocsLocale);
  }
  return preference;
}

export default function DocsLanguagePicker() {
  const { preference, setPreference } = useLocale();
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();

  async function handleChange(value: string) {
    const nextPreference = normalizeLocalizationPreference(value).locale;
    await setPreference(nextPreference);
    const nextLocale =
      nextPreference === "system" ? browserDocsLocale() : nextPreference;
    const slug = docsSlugFromPathname(location.pathname);
    if (!slug) return;
    const targetLocale = hasLocalizedDoc(nextLocale, slug)
      ? nextLocale
      : DEFAULT_DOCS_LOCALE;
    const path = docsPathForSlug(slug, targetLocale);
    navigate(`${path}${location.search}${location.hash}`);
  }

  const label = `${t("language.label")}: ${
    preference === "system" ? t("language.system") : preferenceLabel(preference)
  }`;

  return (
    <label
      className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--docs-border)] text-[var(--fg-secondary)] transition hover:border-[var(--fg-secondary)] hover:text-[var(--fg)]"
      title={label}
    >
      <IconLanguage size={16} stroke={1.5} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <select
        value={preference}
        onChange={(event) => void handleChange(event.target.value)}
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-md border-0 bg-transparent p-0 text-transparent opacity-0 outline-none"
      >
        <option value="system" title={t("language.systemDescription")}>
          {t("language.system")}
        </option>
        {DOCS_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {localeOptionLabel(locale)}
          </option>
        ))}
      </select>
      <span
        className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-[10px]"
        aria-hidden="true"
      >
        ▾
      </span>
    </label>
  );
}
