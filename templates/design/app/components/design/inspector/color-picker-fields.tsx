import {
  alphaToOpacity,
  isWideGamutNotation,
  normalizeCssColor,
  parseCssColor,
  parseCssColorExtended,
  rgbaToCss,
  withCssColorOpacity,
} from "@shared/color-utils";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import {
  expandHexShorthand,
  hasHexAlpha,
  toDisplayHex,
} from "./color-picker-utils";

/**
 * A borderless text field that sits inside a larger field: the color's hex or
 * notation, or its opacity. Enter commits, Escape puts the shown value back,
 * and a draft that does not parse is dropped, never written.
 */
export function InlinePaintField({
  ariaLabel,
  value,
  disabled,
  className,
  uppercase = true,
  autoFocus = false,
  onEnd,
  parse,
  onCommit,
}: {
  ariaLabel: string;
  value: string;
  disabled: boolean;
  className?: string;
  /** Shows and compares the value in capitals: right for hex, wrong for `oklch()`. */
  uppercase?: boolean;
  /** Takes the caret, with the text selected, when it mounts. */
  autoFocus?: boolean;
  /** The edit is over, committed or not: the field lost focus. */
  onEnd?: () => void;
  parse: (draft: string) => string | null;
  onCommit: (value: string) => void;
}) {
  const normalize = (text: string) => (uppercase ? text.toUpperCase() : text);
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);
  const skipBlurCommitRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  const commit = () => {
    const next = parse(draft);
    if (next === null || normalize(next) === normalize(value)) {
      setDraft(value);
      return;
    }
    setDraft(normalize(next));
    onCommit(next);
  };
  return (
    <input
      ref={inputRef}
      type="text"
      aria-label={ariaLabel}
      value={draft}
      disabled={disabled}
      spellCheck={false}
      autoComplete="off"
      className={cn(
        "h-full min-w-0 bg-transparent p-0 tabular-nums !text-[11px] outline-none",
        className,
      )}
      onFocus={(event) => {
        focusedRef.current = true;
        event.currentTarget.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          skipBlurCommitRef.current = true;
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setDraft(value);
          skipBlurCommitRef.current = true;
          event.currentTarget.blur();
        }
      }}
      onBlur={() => {
        focusedRef.current = false;
        if (skipBlurCommitRef.current) {
          skipBlurCommitRef.current = false;
        } else {
          commit();
        }
        onEnd?.();
      }}
    />
  );
}

/**
 * What a color field shows for a color: a wide-gamut color as written, any
 * other as hex without the `#`. Only hex is uppercased.
 */
export function colorFieldText(css: string): string {
  if (isWideGamutNotation(css)) return normalizeCssColor(css) ?? css;
  const parsed = parseCssColorExtended(css);
  return parsed ? toDisplayHex(parsed) : css;
}

/**
 * Reads what was typed into a color field, in the notation the field shows.
 * A wide-gamut field takes any color the editor can read, as written; a hex
 * field takes hex digits. null when the draft is not a color.
 */
export function parseColorFieldDraft(
  draft: string,
  wide: boolean,
): string | null {
  if (wide) return normalizeCssColor(draft);
  const hex = expandHexShorthand(draft.trim());
  return parseCssColor(`#${hex.replace(/^#/, "")}`) ? hex : null;
}

/**
 * The color a committed field draft stands for. Hex digits keep the color's
 * opacity unless they carry their own; a wide-gamut draft is written as typed.
 */
export function colorFromFieldDraft(
  committed: string,
  wide: boolean,
  currentCss: string,
): string | null {
  if (wide) return committed;
  const parsed = parseCssColor(`#${committed.replace(/^#/, "")}`);
  if (!parsed) return null;
  if (hasHexAlpha(committed)) return rgbaToCss(parsed);
  const current = parseCssColorExtended(currentCss);
  return rgbaToCss({ ...parsed, a: current?.a ?? 1 });
}

/** A color's own notation in an editable field: `171717`, `oklch(72.4% 0.181 153)`. */
export function ColorValueField({
  css,
  ariaLabel,
  disabled,
  className,
  onCommit,
}: {
  css: string;
  ariaLabel: string;
  disabled: boolean;
  className?: string;
  onCommit: (css: string) => void;
}) {
  const wide = isWideGamutNotation(css);
  return (
    <InlinePaintField
      ariaLabel={ariaLabel}
      value={colorFieldText(css)}
      disabled={disabled}
      uppercase={!wide}
      className={cn(!wide && "uppercase", className)}
      parse={(draft) => parseColorFieldDraft(draft, wide)}
      onCommit={(committed) => {
        const next = colorFromFieldDraft(committed, wide, css);
        if (next) onCommit(next);
      }}
    />
  );
}

/** A color's opacity, 0 to 100, as a number you can type over. */
export function OpacityValueField({
  css,
  ariaLabel,
  disabled,
  className,
  onCommit,
}: {
  css: string;
  ariaLabel: string;
  disabled: boolean;
  className?: string;
  onCommit: (css: string) => void;
}) {
  const alpha = parseCssColorExtended(css)?.a ?? 1;
  return (
    <InlinePaintField
      ariaLabel={ariaLabel}
      value={String(alphaToOpacity(alpha))}
      disabled={disabled}
      className={className}
      parse={(draft) => {
        const next = Number.parseFloat(draft.replace(/%$/, ""));
        return Number.isFinite(next)
          ? String(Math.round(Math.min(100, Math.max(0, next))))
          : null;
      }}
      onCommit={(committed) => {
        const next = withCssColorOpacity(css, Number(committed));
        if (next) onCommit(next);
      }}
    />
  );
}
