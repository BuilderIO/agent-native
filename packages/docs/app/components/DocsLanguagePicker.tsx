import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { IconCheck, IconLanguage } from "@tabler/icons-react";
import {
  LOCALE_STORAGE_KEY,
  normalizeLocalizationPreference,
  useLocale,
  useT,
} from "@agent-native/core/client";
import { useLocation } from "react-router";
import {
  DOCS_LOCALE_METADATA,
  DOCS_LOCALES,
  browserDocsLocale,
  sitePathForLocale,
  type DocsLocale,
} from "./docs-locale";

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
  const { preference } = useLocale();
  const t = useT();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  function handleChange(value: string) {
    const nextPreference = normalizeLocalizationPreference(value).locale;
    const nextLocale =
      nextPreference === "system" ? browserDocsLocale() : nextPreference;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextPreference);
    } catch {
      // Locale selection still works through the URL when storage is blocked.
    }
    const path = sitePathForLocale(location.pathname, nextLocale);
    window.location.assign(`${path}${location.search}${location.hash}`);
  }

  const label = `${t("language.label")}: ${
    preference === "system" ? t("language.system") : preferenceLabel(preference)
  }`;

  const options: Array<{ value: string; label: string; description?: string }> =
    [
      {
        value: "system",
        label: t("language.system"),
        description: t("language.systemDescription"),
      },
      ...DOCS_LOCALES.map((locale) => ({
        value: locale,
        label: localeOptionLabel(locale),
      })),
    ];

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--docs-border)] text-[var(--fg-secondary)] transition hover:border-[var(--fg-secondary)] hover:text-[var(--fg)] data-[state=open]:border-[var(--fg-secondary)] data-[state=open]:text-[var(--fg)]"
        >
          <IconLanguage size={16} stroke={1.5} aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          className="z-[60] max-h-[min(20rem,var(--radix-popover-content-available-height))] min-w-52 overflow-y-auto rounded-lg border border-[var(--docs-border)] bg-[var(--header-bg)] p-1 shadow-lg backdrop-blur-lg"
        >
          {options.map((option) => {
            const selected = option.value === preference;
            return (
              <PopoverPrimitive.Close asChild key={option.value}>
                <button
                  type="button"
                  onClick={() => void handleChange(option.value)}
                  title={option.description}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm transition-colors hover:bg-[var(--bg-secondary)] ${
                    selected ? "text-[var(--fg)]" : "text-[var(--fg-secondary)]"
                  }`}
                >
                  <IconCheck
                    size={14}
                    stroke={2}
                    className={selected ? "opacity-100" : "opacity-0"}
                    aria-hidden="true"
                  />
                  <span className="truncate">{option.label}</span>
                </button>
              </PopoverPrimitive.Close>
            );
          })}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
