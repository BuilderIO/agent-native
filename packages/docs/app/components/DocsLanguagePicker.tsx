import { IconLanguage } from "@tabler/icons-react";
import {
  normalizeLocalizationPreference,
  useLocale,
  useT,
} from "@agent-native/core/client";
import { useLocation, useNavigate } from "react-router";
import {
  DOCS_LOCALE_METADATA,
  DOCS_LOCALES,
  browserDocsLocale,
  docsPathForSlug,
  docsSlugFromPathname,
  isDocsPath,
  localizedDocsPath,
  type DocsLocale,
} from "./docs-locale";

function localeOptionLabel(locale: DocsLocale) {
  const metadata = DOCS_LOCALE_METADATA[locale];
  return `${metadata.nativeName} (${locale})`;
}

export default function DocsLanguagePicker() {
  const { preference, setPreference } = useLocale();
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();

  if (!isDocsPath(location.pathname)) return null;

  async function handleChange(value: string) {
    const nextPreference = normalizeLocalizationPreference(value).locale;
    await setPreference(nextPreference);
    const nextLocale =
      nextPreference === "system" ? browserDocsLocale() : nextPreference;
    const slug = docsSlugFromPathname(location.pathname);
    const path = slug
      ? docsPathForSlug(slug, nextLocale)
      : localizedDocsPath(location.pathname, nextLocale);
    navigate(`${path}${location.search}${location.hash}`);
  }

  return (
    <label className="relative flex h-8 shrink-0 items-center gap-1 rounded-md border border-[var(--docs-border)] bg-[var(--bg-secondary)] ps-2 text-[var(--fg-secondary)] transition hover:border-[var(--fg-secondary)] hover:text-[var(--fg)]">
      <IconLanguage size={15} stroke={1.6} aria-hidden="true" />
      <span className="sr-only">{t("language.label")}</span>
      <select
        value={preference}
        onChange={(event) => void handleChange(event.target.value)}
        aria-label={t("language.label")}
        className="h-full max-w-[8.5rem] appearance-none bg-transparent pe-7 ps-1 text-xs font-medium outline-none"
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
