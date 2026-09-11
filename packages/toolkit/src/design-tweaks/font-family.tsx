import type { ComponentPropsWithoutRef } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { cn } from "../utils.js";

export const FONT_FAMILY_OPTIONS = [
  { value: "inherit", key: "inherit" },
  { value: "sans-serif", key: "sansSerif" },
  { value: "serif", key: "serif" },
  { value: "monospace", key: "monospace" },
  { value: "'Inter', sans-serif", key: "inter" },
  { value: "'Poppins', sans-serif", key: "poppins" },
  { value: "'Playfair Display', serif", key: "playfairDisplay" },
  { value: "'JetBrains Mono', monospace", key: "jetBrainsMono" },
] as const;

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
}: VisualFontFamilyPickerProps) {
  const selectValue = mixed ? "__mixed_font_family__" : value;
  const unknown =
    !mixed && !options.some((option) => option.value === value)
      ? { value, label: displayFontFamilyName(value) }
      : null;
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
