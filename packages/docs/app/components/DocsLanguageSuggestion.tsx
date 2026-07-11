import {
  LOCALE_STORAGE_KEY,
  normalizeLocalizationPreference,
  useT,
  type LocalePreference,
} from "@agent-native/core/client";
import { IconLanguage } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";

import {
  DOCS_LOCALE_METADATA,
  DEFAULT_DOCS_LOCALE,
  browserDocsLocale,
  docsLocaleOptionLabel,
  routeLocaleFromPathname,
  sitePathForLocale,
  type DocsLocale,
} from "./docs-locale";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";

export const DOCS_LANGUAGE_SUGGESTION_DISMISSED_KEY =
  "agent-native:docs-locale-suggestion-dismissed";

interface SuggestionState {
  targetLocale: DocsLocale;
}

export function shouldSuggestDocsLocale({
  routeLocale,
  browserLocale,
  storedPreference,
  dismissedTarget,
}: {
  routeLocale: DocsLocale;
  browserLocale: DocsLocale;
  storedPreference: LocalePreference | null;
  dismissedTarget: string | null;
}) {
  if (routeLocale !== DEFAULT_DOCS_LOCALE) return false;
  if (browserLocale === DEFAULT_DOCS_LOCALE) return false;
  if (storedPreference && storedPreference !== "system") return false;
  if (dismissedTarget === browserLocale) return false;
  return true;
}

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // URL routing still works when storage is blocked.
  }
}

function removeStorage(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Best-effort cleanup only.
  }
}

function readStoredPreference(): LocalePreference | null {
  const stored = readStorage(LOCALE_STORAGE_KEY);
  return stored ? normalizeLocalizationPreference(stored).locale : null;
}

export default function DocsLanguageSuggestion() {
  const t = useT();
  const location = useLocation();
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const routeLocale =
      routeLocaleFromPathname(location.pathname) ?? DEFAULT_DOCS_LOCALE;
    const browserLocale = browserDocsLocale();
    const nextSuggestion = shouldSuggestDocsLocale({
      routeLocale,
      browserLocale,
      storedPreference: readStoredPreference(),
      dismissedTarget: readStorage(DOCS_LANGUAGE_SUGGESTION_DISMISSED_KEY),
    })
      ? { targetLocale: browserLocale }
      : null;

    setSuggestion(nextSuggestion);
    setOpen(Boolean(nextSuggestion));
  }, [location.pathname]);

  const href = useMemo(() => {
    if (!suggestion) return "";
    const path = sitePathForLocale(location.pathname, suggestion.targetLocale);
    return `${path}${location.search}${location.hash}`;
  }, [location.hash, location.pathname, location.search, suggestion]);

  if (!suggestion) return null;

  const targetLocale = suggestion.targetLocale;
  const targetNativeName = DOCS_LOCALE_METADATA[targetLocale].nativeName;
  const targetLabel = docsLocaleOptionLabel(targetLocale);
  const titleId = "docs-language-suggestion-title";

  function acceptSuggestion() {
    writeStorage(LOCALE_STORAGE_KEY, targetLocale);
    removeStorage(DOCS_LANGUAGE_SUGGESTION_DISMISSED_KEY);
    setOpen(false);
  }

  function dismissSuggestion() {
    writeStorage(DOCS_LANGUAGE_SUGGESTION_DISMISSED_KEY, targetLocale);
    setOpen(false);
    setSuggestion(null);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span aria-hidden className="block h-0 w-0 shrink-0" />
      </PopoverAnchor>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        aria-labelledby={titleId}
        className="flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 p-3 text-sm"
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--docs-border)] text-[var(--fg-secondary)]">
            <IconLanguage size={16} stroke={1.5} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p id={titleId} className="m-0 text-sm font-medium leading-5">
              {t("language.suggestionTitle", {
                language: targetNativeName,
              })}
            </p>
            <p className="m-0 mt-1 text-xs leading-5 text-[var(--fg-secondary)]">
              {t("language.suggestionDescription", {
                language: targetLabel,
              })}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            to={href}
            data-an-prefetch="render"
            onClick={acceptSuggestion}
            className="inline-flex min-h-8 flex-1 items-center justify-center rounded-md bg-[var(--fg)] px-3 py-1.5 text-center text-xs font-medium text-[var(--bg)] no-underline transition hover:opacity-85 hover:no-underline"
          >
            {t("language.suggestionSwitch", {
              language: targetNativeName,
            })}
          </Link>
          <button
            type="button"
            onClick={dismissSuggestion}
            className="inline-flex min-h-8 flex-1 items-center justify-center rounded-md border border-[var(--docs-border)] px-3 py-1.5 text-xs font-medium text-[var(--fg-secondary)] transition hover:border-[var(--fg-secondary)] hover:text-[var(--fg)]"
          >
            {t("language.suggestionKeepEnglish")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
