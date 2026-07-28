import { useLocale, useT } from "@agent-native/core/client";
import { IconCheck, IconSearch } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  ALL_COUNTRY_CODES,
  POPULAR_CODES,
  countryFlag,
  countryName,
} from "../../../shared/countries";

/**
 * Inclusive country selector: popular one-tap shortcuts plus a search over
 * every ISO country, localized to the viewer's language. Never a dead end —
 * any country on Earth is pickable.
 */
export function CountryPicker({
  selected,
  onToggle,
  multi = false,
  subtitleFor,
  autoFocus = false,
}: {
  /** Selected alpha-2 codes (single-select passes 0-1 codes). */
  selected: string[];
  onToggle: (code: string) => void;
  multi?: boolean;
  /** Optional per-country subtitle (e.g. the rule preset it would arm). */
  subtitleFor?: (code: string) => string | null;
  autoFocus?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [query, setQuery] = useState("");

  const entries = useMemo(
    () =>
      ALL_COUNTRY_CODES.map((code) => ({
        code,
        name: countryName(code, locale),
      })).sort((a, b) => a.name.localeCompare(b.name, locale)),
    [locale],
  );

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    return entries
      .filter(
        (e) => e.name.toLowerCase().includes(q) || e.code.toLowerCase() === q,
      )
      .slice(0, 12);
  }, [entries, q]);

  const shortcuts = useMemo(() => {
    const picked = new Set(selected.map((c) => c.toUpperCase()));
    // Keep selected countries visible even after the search that found them.
    const codes = [
      ...selected.map((c) => c.toUpperCase()),
      ...POPULAR_CODES.filter((c) => !picked.has(c)),
    ];
    return codes.map((code) => ({ code, name: countryName(code, locale) }));
  }, [selected, locale]);

  const isSelected = (code: string) =>
    selected.some((c) => c.toUpperCase() === code);

  return (
    <div>
      <div className="relative mb-3">
        <IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("nomad.picker.searchPlaceholder")}
          className="pl-9"
          autoFocus={autoFocus}
        />
      </div>

      {results ? (
        results.length > 0 ? (
          <div className="grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
            {results.map((e) => (
              <CountryOption
                key={e.code}
                code={e.code}
                name={e.name}
                subtitle={subtitleFor?.(e.code) ?? null}
                selected={isSelected(e.code)}
                onClick={() => {
                  onToggle(e.code);
                  if (!multi) setQuery("");
                }}
              />
            ))}
          </div>
        ) : (
          <div className="py-4 text-sm text-muted-foreground">
            {t("nomad.picker.noResults", { query })}
          </div>
        )
      ) : (
        <>
          <div className="mb-2 text-xs text-muted-foreground">
            {t("nomad.picker.popular")}
          </div>
          <div className="flex flex-wrap gap-2">
            {shortcuts.map((e) => {
              const active = isSelected(e.code);
              return (
                <button
                  key={e.code}
                  type="button"
                  onClick={() => onToggle(e.code)}
                  className={cn(
                    "nomad-chip flex cursor-pointer items-center gap-2 px-3 py-2 text-sm transition-colors",
                    active
                      ? "border-primary text-foreground"
                      : "hover:border-ring",
                  )}
                  style={
                    active
                      ? { background: "hsl(var(--primary) / 0.12)" }
                      : undefined
                  }
                >
                  <span>{countryFlag(e.code)}</span>
                  <span>{e.name}</span>
                  {active && <IconCheck className="size-3.5 text-primary" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function CountryOption({
  code,
  name,
  subtitle,
  selected,
  onClick,
}: {
  code: string;
  name: string;
  subtitle: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-xl border bg-popover p-3 text-left transition-all",
        selected
          ? "border-primary shadow-[inset_0_0_0_1px_hsl(var(--primary))]"
          : "border-border hover:border-ring",
      )}
    >
      <span className="text-xl">{countryFlag(code)}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{name}</span>
        {subtitle && (
          <span className="block truncate text-xs text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
      {selected && (
        <IconCheck className="ml-auto size-4 shrink-0 text-primary" />
      )}
    </button>
  );
}
