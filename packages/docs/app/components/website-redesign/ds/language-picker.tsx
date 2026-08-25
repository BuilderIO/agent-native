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

function preferenceLabel(preference: string) {
  if (preference in DOCS_LOCALE_METADATA) {
    return docsLocaleOptionLabel(preference as DocsLocale);
  }
  return preference;
}

// Same locale-switching logic as ../../DocsLanguagePicker, restyled against
// the `--b-*` redesign tokens instead of the main site's shadcn Popover so it
// matches the rest of this header rather than looking like a foreign control.
export function LanguagePicker() {
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
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="border-[var(--b-action-secondary-border)] hover:bg-[var(--b-action-secondary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--b-text-primary)]"
        style={{
          width: 40,
          height: 40,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          borderWidth: 1,
          borderStyle: "solid",
          borderRadius: "var(--b-radius)",
          background: "transparent",
          color: "var(--b-text-primary)",
          cursor: "pointer",
          outline: "none",
          transition: "background 0.15s, border-color 0.15s",
        }}
      >
        <IconLanguage size={18} stroke={1.5} />
        <span className="sr-only">{label}</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          id={listId}
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 208,
            maxHeight: 320,
            overflowY: "auto",
            margin: 0,
            padding: 4,
            background: "var(--b-bg-prominent)",
            border: "1px solid var(--b-border-default)",
            borderRadius: "var(--b-radius)",
            zIndex: 60,
          }}
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
                className={
                  "flex items-center gap-2 no-underline transition-[background,color] duration-100 hover:bg-white/8 hover:no-underline focus-visible:bg-white/8 focus-visible:outline-none " +
                  (selected ? "bg-[var(--b-bg-raised)]" : "bg-transparent")
                }
                style={{
                  padding: "8px 10px",
                  borderRadius: "var(--b-radius-sm)",
                  fontFamily: "var(--b-font-sans)",
                  fontSize: "var(--b-t-paragraph-2)",
                  color: selected
                    ? "var(--b-text-primary)"
                    : "var(--b-text-secondary)",
                }}
              >
                <IconCheck
                  size={14}
                  stroke={2}
                  style={{ opacity: selected ? 1 : 0, flexShrink: 0 }}
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
