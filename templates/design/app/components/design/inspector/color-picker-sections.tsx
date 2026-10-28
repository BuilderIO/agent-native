import { useT } from "@agent-native/core/client/i18n";
import {
  isWideGamutNotation,
  normalizeCssColor,
  parseCssColorExtended,
  rgbaToHex,
} from "@shared/color-utils";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { swatchStyle, UNRESOLVED_SWATCH_CLASS } from "./color-picker-swatch";
import type { DesignColorMode } from "./color-picker-utils";

export type ColorPickerTab = "custom" | "libraries";

type ModeOption = { value: DesignColorMode; label: string };

const SRGB_COLOR_MODES: ModeOption[] = [
  { value: "hex", label: "Hex" }, // i18n-ignore color mode
  { value: "rgb", label: "RGB" }, // i18n-ignore color mode
  { value: "hsl", label: "HSL" }, // i18n-ignore color mode
  { value: "hsb", label: "HSB" }, // i18n-ignore color mode
];

// A divider sets the wide-gamut modes apart; there are no section labels.
const WIDE_COLOR_MODES: ModeOption[] = [
  { value: "p3", label: "Display P3" }, // i18n-ignore color mode
  { value: "oklch", label: "OKLCH" }, // i18n-ignore color mode
];

/** `Custom | Libraries`: the picker's two panes, one 40px row. */
export function ColorPickerHeader({
  tab,
  onTabChange,
}: {
  tab: ColorPickerTab;
  onTabChange: (tab: ColorPickerTab) => void;
}) {
  const t = useT();
  const tabs: Array<{ value: ColorPickerTab; label: string }> = [
    { value: "custom", label: t("editPanel.colorPicker.custom") },
    { value: "libraries", label: t("editPanel.colorPicker.libraries") },
  ];
  return (
    <div
      role="tablist"
      className="flex h-10 items-center gap-1 border-b border-border/70 px-2"
    >
      {tabs.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={tab === value}
          onClick={() => onTabChange(value)}
          className={cn(
            "h-6 cursor-pointer rounded-md px-2 !text-xs font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            tab === value
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The 40px swatch beside the sliders: New (the color the picker is editing) on
 * top and Previous (what it was when editing began) below. New's tooltip says
 * when the color is outside sRGB; clicking Previous puts that color back.
 */
export function ColorCompareSwatch({
  newCss,
  newUnresolved,
  previousCss,
  previousUnresolved,
  gamutNotes,
  onRestore,
  disabled,
  onTooltipEscape,
}: {
  newCss: string;
  /** The color is a token that cannot be shown; draw it unresolved, not as a color. */
  newUnresolved: boolean;
  previousCss: string;
  previousUnresolved: boolean;
  /** Lines under "New" in its tooltip, e.g. where the color falls back to. */
  gamutNotes: string[];
  onRestore: () => void;
  disabled: boolean;
  onTooltipEscape: () => void;
}) {
  const t = useT();
  const previousInert = disabled || previousUnresolved;
  return (
    <div className="row-span-2 grid size-10 grid-rows-2 overflow-hidden rounded-md shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.12)]">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            tabIndex={0}
            aria-label={t("editPanel.colorPicker.newColor")}
            className={cn(
              "block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              newUnresolved && UNRESOLVED_SWATCH_CLASS,
            )}
            style={newUnresolved ? undefined : swatchStyle(newCss)}
          />
        </TooltipTrigger>
        <TooltipContent side="top" onEscapeKeyDown={onTooltipEscape}>
          <div>{t("editPanel.colorPicker.newTooltip")}</div>
          {gamutNotes.map((note) => (
            <div key={note} className="opacity-70">
              {note}
            </div>
          ))}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("editPanel.colorPicker.restorePrevious")}
            disabled={previousInert}
            onClick={onRestore}
            className={cn(
              "block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              previousInert ? "cursor-default" : "cursor-pointer",
              previousUnresolved && UNRESOLVED_SWATCH_CLASS,
            )}
            style={previousUnresolved ? undefined : swatchStyle(previousCss)}
          />
        </TooltipTrigger>
        <TooltipContent side="bottom" onEscapeKeyDown={onTooltipEscape}>
          <div>{t("editPanel.colorPicker.previousTooltip")}</div>
          <div className="opacity-70">
            {previousUnresolved
              ? t("editPanel.colorPicker.previousUnavailable")
              : t("editPanel.colorPicker.previousRestoreHint")}
          </div>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function renderModeItem(mode: ModeOption) {
  return (
    <SelectItem key={mode.value} value={mode.value} className="!text-[11px]">
      {mode.label}
    </SelectItem>
  );
}

/** One select for the color mode; the value cells below it follow the choice. */
export function ColorModeSelect({
  value,
  disabled,
  wideGamut = true,
  onChange,
}: {
  value: DesignColorMode;
  disabled: boolean;
  /** Offers Display P3 and OKLCH; off for a color that must stay inside sRGB. */
  wideGamut?: boolean;
  onChange: (mode: DesignColorMode) => void;
}) {
  const t = useT();
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(next as DesignColorMode)}
    >
      <SelectTrigger
        aria-label={t("editPanel.colorPicker.colorModel")}
        className="h-6 min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SRGB_COLOR_MODES.map(renderModeItem)}
        {wideGamut && (
          <>
            <SelectSeparator />
            {WIDE_COLOR_MODES.map(renderModeItem)}
          </>
        )}
      </SelectContent>
    </Select>
  );
}

type CopyState = "idle" | "copied" | "failed";

/** Copies the color's CSS; the icon only confirms when the write succeeded. */
export function CopyValueButton({
  text,
  disabled,
  onTooltipEscape,
}: {
  text: string;
  disabled: boolean;
  onTooltipEscape: () => void;
}) {
  const t = useT();
  const [state, setState] = useState<CopyState>("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const copy = async () => {
    let next: CopyState = "copied";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      next = "failed";
    }
    setState(next);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setState("idle"), 1500);
  };

  const label =
    state === "copied"
      ? t("editPanel.colorPicker.copied")
      : state === "failed"
        ? t("editPanel.colorPicker.copyFailed")
        : t("editPanel.colorPicker.copyValue");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t("editPanel.colorPicker.copyValue")}
          disabled={disabled}
          onClick={() => void copy()}
          className={cn(
            "flex size-6 cursor-pointer items-center justify-center justify-self-center rounded-md text-muted-foreground transition-colors",
            "hover:bg-[var(--design-editor-control-bg)] hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            disabled && "pointer-events-none opacity-40",
          )}
        >
          {state === "copied" ? (
            <IconCheck className="size-4" />
          ) : (
            <IconCopy className="size-4" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent onEscapeKeyDown={onTooltipEscape}>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The colors already used in the design: 8 swatches per row on the 8pt grid.
 * A color outside sRGB is labelled and picked as written, never as its sRGB
 * fallback.
 */
export function DocumentColors({
  colors,
  currentCss,
  currentIsActive,
  disabled,
  onPick,
  onTooltipEscape,
}: {
  colors: string[];
  currentCss: string;
  currentIsActive: boolean;
  disabled: boolean;
  onPick: (css: string) => void;
  onTooltipEscape: () => void;
}) {
  const t = useT();
  const currentIsWide = isWideGamutNotation(currentCss);
  const currentParsed = parseCssColorExtended(currentCss);
  const currentHex = currentParsed ? rgbaToHex(currentParsed) : null;
  return (
    <div className="border-t border-border/70 p-3">
      <div className="mb-2 flex h-4 items-center !text-[11px] text-muted-foreground">
        {t("editPanel.colorPicker.documentColors")}
      </div>
      <div className="grid grid-cols-8 gap-2">
        {colors.map((docColor) => {
          const wide = isWideGamutNotation(docColor);
          const parsed = parseCssColorExtended(docColor);
          const label = wide
            ? (normalizeCssColor(docColor) ?? docColor)
            : parsed
              ? rgbaToHex(parsed)
              : docColor;
          const isActive =
            currentIsActive &&
            (wide
              ? currentIsWide && normalizeCssColor(currentCss) === label
              : !currentIsWide && currentHex !== null && currentHex === label);
          return (
            <Tooltip key={docColor}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={label}
                  aria-pressed={isActive}
                  className={cn(
                    "size-6 rounded-md border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "border-primary ring-1 ring-primary"
                      : "border-border/60",
                  )}
                  style={swatchStyle(docColor)}
                  onClick={() => onPick(docColor)}
                />
              </TooltipTrigger>
              <TooltipContent onEscapeKeyDown={onTooltipEscape}>
                {label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
