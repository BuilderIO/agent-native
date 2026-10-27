import { IconChevronDown } from "@tabler/icons-react";
import type { ComponentPropsWithoutRef } from "react";
import { useState } from "react";

import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command.js";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { cn } from "../utils.js";

export interface FontFamilyOption {
  value: string;
  key?: string;
  label?: string;
}

export const GOOGLE_FONT_FAMILIES = [
  ["Archivo", "ital,wght@0,100..900;1,100..900"],
  ["Asap", "ital,wght@0,100..900;1,100..900"],
  ["Catamaran", "ital,wght@0,100..900;1,100..900"],
  ["Chivo", "ital,wght@0,100..900;1,100..900"],
  ["DM Sans", "ital,wght@0,100..900;1,100..900"],
  ["Epilogue", "ital,wght@0,100..900;1,100..900"],
  ["Exo 2", "ital,wght@0,100..900;1,100..900"],
  ["Geist", "ital,wght@0,100..900;1,100..900"],
  ["Geist Mono", "ital,wght@0,100..900;1,100..900"],
  ["Heebo", "ital,wght@0,100..900;1,100..900"],
  ["Inter", "ital,wght@0,100..900;1,100..900"],
  ["Jost", "ital,wght@0,100..900;1,100..900"],
  ["League Spartan", "ital,wght@0,100..900;1,100..900"],
  ["Lexend", "ital,wght@0,100..900;1,100..900"],
  ["Libre Franklin", "ital,wght@0,100..900;1,100..900"],
  ["Montserrat", "ital,wght@0,100..900;1,100..900"],
  ["Noto Sans", "ital,wght@0,100..900;1,100..900"],
  ["Noto Serif", "ital,wght@0,100..900;1,100..900"],
  ["Onest", "ital,wght@0,100..900;1,100..900"],
  ["Outfit", "ital,wght@0,100..900;1,100..900"],
  ["Overpass", "ital,wght@0,100..900;1,100..900"],
  ["Public Sans", "ital,wght@0,100..900;1,100..900"],
  ["Raleway", "ital,wght@0,100..900;1,100..900"],
  ["Roboto", "ital,wght@0,100..900;1,100..900"],
  ["Roboto Condensed", "ital,wght@0,100..900;1,100..900"],
  ["Roboto Slab", "ital,wght@0,100..900;1,100..900"],
  ["Urbanist", "ital,wght@0,100..900;1,100..900"],
  ["Work Sans", "ital,wght@0,100..900;1,100..900"],
  ["Abril Fatface", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Anton", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Arimo", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Assistant", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Barlow", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Barlow Condensed", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Bebas Neue", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Bodoni Moda", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Bricolage Grotesque", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Cabin", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Caveat", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Cormorant Garamond", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Cousine", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Crimson Text", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Dancing Script", "ital,wght@0,400;0,700;1,400;1,700"],
  ["David Libre", "ital,wght@0,400;0,700;1,400;1,700"],
  ["EB Garamond", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Figtree", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Fira Sans", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Hind", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Homemade Apple", "ital,wght@0,400;0,700;1,400;1,700"],
  ["IBM Plex Sans", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Inconsolata", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Instrument Sans", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Josefin Sans", "ital,wght@0,400;0,700;1,400;1,700"],
  ["JetBrains Mono", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Kanit", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Karla", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Lato", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Libre Baskerville", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Lora", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Manrope", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Merriweather", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Mulish", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Nova Square", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Nunito", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Nunito Sans", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Open Sans", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Oswald", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Oxygen", "ital,wght@0,400;0,700;1,400;1,700"],
  ["PT Sans", "ital,wght@0,400;0,700;1,400;1,700"],
  ["PT Serif", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Pacifico", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Playfair Display", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Plus Jakarta Sans", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Poppins", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Prompt", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Quicksand", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Red Hat Display", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Roboto Mono", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Rubik", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Schibsted Grotesk", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Sora", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Source Sans 3", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Space Grotesk", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Syne", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Teko", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Tinos", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Titillium Web", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Ubuntu", "ital,wght@0,400;0,700;1,400;1,700"],
  ["Yanone Kaffeesatz", "ital,wght@0,400;0,700;1,400;1,700"],
] as const;

export const GOOGLE_FONT_QUERIES = Object.fromEntries(
  GOOGLE_FONT_FAMILIES.map(([family, axis]) => [
    family,
    `${family.replace(/ /g, "+")}:${axis}`,
  ]),
) as Record<string, string>;

const BUILTIN_FONT_FAMILY_OPTIONS = [
  { value: "inherit", key: "inherit" },
  { value: "sans-serif", key: "sansSerif" },
  { value: "serif", key: "serif" },
  { value: "monospace", key: "monospace" },
  { value: "'Inter', sans-serif", key: "inter" },
  { value: "'Poppins', sans-serif", key: "poppins" },
  { value: "'Playfair Display', serif", key: "playfairDisplay" },
  { value: "'JetBrains Mono', monospace", key: "jetBrainsMono" },
] as const satisfies readonly FontFamilyOption[];

const BUILTIN_FONT_FAMILY_NAMES = new Set(
  BUILTIN_FONT_FAMILY_OPTIONS.map((option) =>
    option.value.replace(/^['"]([^'"]+)['"].*$/, "$1"),
  ),
);

export const FONT_FAMILY_OPTIONS: readonly FontFamilyOption[] = [
  ...BUILTIN_FONT_FAMILY_OPTIONS,
  ...GOOGLE_FONT_FAMILIES.filter(
    ([family]) => !BUILTIN_FONT_FAMILY_NAMES.has(family),
  ).map(([family]) => ({
    value: `'${family}', sans-serif`,
    label: family,
  })),
];

function cleanFontFamilyName(value: string): string {
  const trimmed = value.trim();
  return (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

export function splitFontFamilyList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const families: string[] = [];
  let token = "";
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== "\\") {
      if (quote === char) quote = null;
      else if (!quote) quote = char;
    }
    if (char === "," && !quote) {
      const family = cleanFontFamilyName(token);
      if (family) families.push(family);
      token = "";
    } else token += char;
  }
  const family = cleanFontFamilyName(token);
  if (family) families.push(family);
  return families;
}

function normalizeFontFamilyName(value: string): string {
  return cleanFontFamilyName(value).replace(/\s+/g, " ").toLowerCase();
}

function normalizeFontFamilyStack(value: string): string {
  return splitFontFamilyList(value).map(normalizeFontFamilyName).join(",");
}

export function displayFontFamilyName(value: string | undefined): string {
  const first = splitFontFamilyList(value)[0];
  if (!first) return "Sans Serif"; // i18n-ignore shared generic font label
  const normalized = normalizeFontFamilyName(first);
  if (normalized === "sans-serif") {
    return "Sans Serif"; // i18n-ignore shared generic font label
  }
  if (normalized === "serif") return "Serif"; // i18n-ignore shared generic font label
  if (normalized === "monospace") {
    return "Monospace"; // i18n-ignore shared generic font label
  }
  if (normalized === "system-ui" || normalized === "-apple-system")
    return "System UI"; // i18n-ignore shared generic font label
  if (normalized === "blinkmacsystemfont") {
    return "Apple System"; // i18n-ignore shared generic font label
  }
  return first;
}

export function resolveFontFamilySelectValue(
  value: string | undefined,
): string {
  const raw = value?.trim();
  if (!raw) return "sans-serif";
  const normalizedStack = normalizeFontFamilyStack(raw);
  const exact = FONT_FAMILY_OPTIONS.find(
    (option) => normalizeFontFamilyStack(option.value) === normalizedStack,
  );
  if (exact) return exact.value;
  const first = normalizeFontFamilyName(splitFontFamilyList(raw)[0] ?? "");
  return (
    FONT_FAMILY_OPTIONS.find(
      (option) =>
        normalizeFontFamilyName(splitFontFamilyList(option.value)[0] ?? "") ===
        first,
    )?.value ?? raw
  );
}

export interface FontFamilySelectOption {
  value: string;
  label: string;
}

export function sortFontFamilyOptions<T extends FontFamilySelectOption>(
  options: readonly T[],
): T[] {
  return [...options].sort((a, b) => {
    if (a.value === "inherit") return -1;
    if (b.value === "inherit") return 1;
    return a.label.localeCompare(b.label);
  });
}

export interface VisualFontFamilyPickerProps {
  label: string;
  value: string;
  options: readonly FontFamilySelectOption[];
  onChange: (value: string) => void;
  className?: string;
  contentProps?: Omit<
    ComponentPropsWithoutRef<typeof SelectContent>,
    "children"
  > &
    Partial<Record<`data-${string}`, string | undefined>>;
  mixed?: boolean;
  mixedLabel: string;
  searchable?: boolean;
  searchPlaceholder?: string;
}

export function VisualFontFamilyPicker({
  label,
  value,
  options,
  onChange,
  className,
  contentProps,
  mixed = false,
  mixedLabel,
  searchable = false,
  searchPlaceholder = "Search",
}: VisualFontFamilyPickerProps) {
  const selectValue = mixed ? "__mixed_font_family__" : value;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const unknown =
    !mixed && !options.some((option) => option.value === value)
      ? { value, label: displayFontFamilyName(value) }
      : null;
  const selectedLabel = mixed
    ? mixedLabel
    : (options.find((option) => option.value === value)?.label ??
      unknown?.label ??
      displayFontFamilyName(value));
  if (searchable) {
    const {
      className: contentClassName,
      position: selectPosition,
      ...popoverContentProps
    } = contentProps ?? {};
    void selectPosition;
    const trimmedSearch = search.trim();
    const normalizedSearch = trimmedSearch.toLocaleLowerCase();
    const exactOptionExists = options.some(
      (option) => option.label.trim().toLocaleLowerCase() === normalizedSearch,
    );
    const customFontName = trimmedSearch
      .replace(/[\\\"\u0000-\u001f\u007f]/g, "")
      .trim();
    const customFontValue = customFontName
      ? '"' + customFontName + '", sans-serif'
      : "";
    const choose = (nextValue: string) => {
      onChange(nextValue);
      setSearch("");
      setOpen(false);
    };
    return (
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setSearch("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-expanded={open}
            data-font-family-picker
            className={cn(
              "flex h-6 w-full items-center justify-between gap-1 text-left",
              className,
            )}
          >
            <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
            <IconChevronDown className="size-3 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          {...(popoverContentProps as ComponentPropsWithoutRef<
            typeof PopoverContent
          >)}
          align={
            (
              popoverContentProps as ComponentPropsWithoutRef<
                typeof PopoverContent
              >
            ).align ?? "start"
          }
          className={cn(
            "w-[var(--radix-popover-trigger-width)] min-w-48 p-0",
            contentClassName,
          )}
        >
          <Command>
            <CommandInput
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              value={search}
              onValueChange={setSearch}
              className="h-8 py-1.5 text-xs"
            />
            <CommandList className="max-h-56">
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    onSelect={() => choose(option.value)}
                    className="cursor-pointer text-[11px]"
                  >
                    {option.label}
                  </CommandItem>
                ))}
                {customFontValue && !exactOptionExists ? (
                  <CommandItem
                    value={customFontName}
                    onSelect={() => choose(customFontValue)}
                    data-custom-font-option
                    className="cursor-pointer text-[11px]"
                  >
                    {customFontName}
                  </CommandItem>
                ) : null}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Select value={selectValue} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={cn("h-6 w-full px-1.5 text-[11px]", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent {...contentProps}>
        {mixed ? (
          <SelectItem
            value="__mixed_font_family__"
            disabled
            className="!text-[11px] text-muted-foreground"
          >
            {mixedLabel}
          </SelectItem>
        ) : null}
        {unknown ? (
          <SelectItem value={unknown.value} className="!text-[11px]">
            {unknown.label}
          </SelectItem>
        ) : null}
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="!text-[11px]"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
