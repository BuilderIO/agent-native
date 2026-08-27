import {
  LOCALE_STORAGE_KEY,
  normalizeLocalizationPreference,
  useLocale,
} from "@agent-native/core/client/i18n";
import { IconCheck, IconLanguage } from "@tabler/icons-react";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router";

import {
  DEFAULT_DOCS_LOCALE,
  DOCS_LOCALE_METADATA,
  DOCS_LOCALES,
  browserDocsLocale,
  docsLocaleOptionLabel,
  sitePathForLocale,
  type DocsLocale,
} from "../../docs-locale";

interface LanguagePickerProps {
  openUpward?: boolean;
}

function preferenceLabel(preference: string) {
  if (preference in DOCS_LOCALE_METADATA) {
    return docsLocaleOptionLabel(preference as DocsLocale);
  }
  return preference;
}

// Same locale-switching logic as ../../DocsLanguagePicker, restyled against
// the `--b-*` redesign tokens instead of the main site's shadcn Popover so it
// matches the rest of this header rather than looking like a foreign control.
// The menu is absolutely positioned with no portal and no collision detection,
// so a footer instance has to be told to open upward or it lands below the
// fold, unreachable.
export function LanguagePicker(props: LanguagePickerProps) {
  const openUpward = props.openUpward === true;
  const { preference } = useLocale();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [systemLocale, setSystemLocale] =
    useState<DocsLocale>(DEFAULT_DOCS_LOCALE);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    setSystemLocale(browserDocsLocale());
  }, []);

  useEffect(() => {
    if (!open) return;

    function close(e: MouseEvent | TouchEvent) {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function localeForPreference(value: string) {
    const nextPreference = normalizeLocalizationPreference(value).locale;
    return nextPreference === "system" ? systemLocale : nextPreference;
  }

  function hrefForPreference(value: string) {
    const path = sitePathForLocale(
      location.pathname,
      localeForPreference(value),
    );
    return `${path}${location.search}${location.hash}`;
  }

  function handleOptionClick(value: string) {
    const nextPreference = normalizeLocalizationPreference(value).locale;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextPreference);
    } catch {
      // coercion-ok: Locale selection still works through the URL when storage is blocked
    }
    setOpen(false);
  }

  const label = `Language: ${preference === "system" ? "System" : preferenceLabel(preference)}`;

  const options: Array<{ value: string; label: string }> = [
    { value: "system", label: "System" },
    ...DOCS_LOCALES.map((locale) => ({
      value: locale,
      label: docsLocaleOptionLabel(locale),
    })),
  ];

  return (
    <div className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[var(--b-radius)] border border-solid bg-transparent text-[var(--b-text-primary)] outline-none transition-[background,border-color] duration-150 ease-[ease] border-[var(--b-action-secondary-border)] hover:bg-[var(--b-action-secondary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]"
      >
        <IconLanguage size={18} stroke={1.5} />
        <span className="sr-only">{label}</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          className={[
            "absolute right-0 z-[60] m-0 max-h-80 min-w-52 overflow-y-auto rounded-[var(--b-radius)] border border-solid border-[var(--b-border-default)] bg-[var(--b-bg-prominent)] p-1",
            openUpward ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
          ].join(" ")}
        >
          {options.map((option) => {
            const selected = option.value === preference;
            return (
              <Link
                key={option.value}
                to={hrefForPreference(option.value)}
                onClick={() => handleOptionClick(option.value)}
                data-an-prefetch="viewport"
                role="option"
                aria-selected={selected}
                className={[
                  "flex items-center gap-2 rounded-[var(--b-radius-sm)] px-[10px] py-2 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] no-underline transition-[background,color] duration-100 hover:bg-white/8 hover:no-underline focus-visible:bg-white/8 focus-visible:outline-none",
                  selected
                    ? "bg-[var(--b-bg-raised)] text-[var(--b-text-primary)]"
                    : "bg-transparent text-[var(--b-text-secondary)]",
                ].join(" ")}
              >
                <IconCheck
                  size={14}
                  stroke={2}
                  className={`shrink-0 ${selected ? "opacity-100" : "opacity-0"}`}
                />
                <span className="truncate">{option.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
