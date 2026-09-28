import { useT } from "@agent-native/core/client/i18n";
import {
  IconDeviceDesktop,
  IconDeviceMobile,
  IconDeviceTablet,
  IconDots,
  IconPlus,
  IconViewportWide,
} from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { FRAME_SIZE_PRESET_CATEGORIES } from "./inspector/frame-size-presets";

export const FRAMER_BREAKPOINT_PRESETS: ReadonlyArray<{
  labelKey: "desktop" | "tablet" | "phone";
  widthPx: number;
}> = [
  { labelKey: "desktop", widthPx: 1200 },
  { labelKey: "tablet", widthPx: 810 },
  { labelKey: "phone", widthPx: 390 },
];

export function availableBreakpointPresets(
  existingWidths: readonly number[],
): Array<{ labelKey: "desktop" | "tablet" | "phone"; widthPx: number }> {
  return FRAMER_BREAKPOINT_PRESETS.filter(
    (preset) => !existingWidths.includes(preset.widthPx),
  );
}

export function extraBreakpointWidthPresets(
  existingWidths: readonly number[],
): Array<{ name: string; widthPx: number }> {
  const taken = new Set<number>(existingWidths);
  FRAMER_BREAKPOINT_PRESETS.forEach((preset) => taken.add(preset.widthPx));
  const seen = new Set<number>();
  const out: Array<{ name: string; widthPx: number }> = [];
  for (const category of FRAME_SIZE_PRESET_CATEGORIES) {
    for (const preset of category.presets) {
      if (taken.has(preset.width) || seen.has(preset.width)) continue;
      if (preset.width < 320 || preset.width > 3840) continue;
      seen.add(preset.width);
      out.push({ name: preset.name, widthPx: preset.width });
    }
  }
  return out.sort((a, b) => b.widthPx - a.widthPx);
}

export function breakpointLabelForWidth(widthPx: number): string {
  if (widthPx >= 1024) return "Desktop";
  if (widthPx >= 600) return "Tablet";
  return "Phone";
}

export function parseBreakpointWidthInput(
  raw: string,
  existingWidths: readonly number[],
): number | null {
  const widthPx = Number(raw);
  if (!Number.isInteger(widthPx) || widthPx < 320 || widthPx > 3840)
    return null;
  if (existingWidths.includes(widthPx)) return null;
  return widthPx;
}

function DeviceIcon({ widthPx }: { widthPx: number }) {
  if (widthPx >= 1024) return <IconDeviceDesktop className="size-3" />;
  if (widthPx >= 600) return <IconDeviceTablet className="size-3" />;
  return <IconDeviceMobile className="size-3" />;
}

export interface BreakpointBarBreakpoint {
  id: string;
  label: string;
  widthPx: number;
}

export interface BreakpointDeviceControlProps {
  breakpoints: BreakpointBarBreakpoint[];
  activeWidthPx?: number;
  baseWidthPx?: number | null;
  canEdit: boolean;
  mutationPending?: boolean;
  showAllFrames?: boolean;
  onShowAllFramesChange?: (value: boolean) => void;
  onSelect: (widthPx: number | undefined) => void;
  onAdd?: (widthPx: number, label: string) => void;
  onRemove?: (breakpointId: string) => void;
  onChangeWidth?: (breakpointId: string, widthPx: number) => void;
  className?: string;
}

export function BreakpointDeviceControl({
  breakpoints,
  activeWidthPx,
  baseWidthPx,
  canEdit,
  mutationPending = false,
  showAllFrames,
  onShowAllFramesChange,
  onSelect,
  onAdd,
  onRemove,
  onChangeWidth,
  className,
}: BreakpointDeviceControlProps) {
  const t = useT();
  const [addOpen, setAddOpen] = useState(false);
  const canMutateBreakpoints = canEdit && !mutationPending;
  const [customWidth, setCustomWidth] = useState("");
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [widthDraft, setWidthDraft] = useState("");

  const ordered = [...breakpoints].sort((a, b) => b.widthPx - a.widthPx);
  const existingWidths = ordered.map((bp) => bp.widthPx);
  const presets = availableBreakpointPresets(existingWidths);
  const devicePresets = extraBreakpointWidthPresets(existingWidths);
  const baseActive = activeWidthPx === undefined;

  const submitCustomWidth = () => {
    if (mutationPending) return;
    const widthPx = parseBreakpointWidthInput(customWidth, existingWidths);
    if (widthPx === null) return;
    setAddOpen(false);
    setCustomWidth("");
    onAdd?.(widthPx, breakpointLabelForWidth(widthPx));
  };

  const segmentClass = (active: boolean) =>
    cn(
      "flex h-6 cursor-pointer select-none items-center gap-1 rounded-[5px] px-1.5 font-medium !text-[11px] tabular-nums",
      active
        ? "bg-[var(--design-editor-panel-bg)] text-[var(--design-editor-accent-color)] shadow-[inset_0_0_0_1px_var(--design-editor-control-border)]"
        : "text-muted-foreground hover:bg-[var(--design-editor-panel-raised-bg)] hover:text-foreground",
    );

  return (
    <div
      data-breakpoint-device-control
      className={cn("flex shrink-0 items-center gap-1", className)}
    >
      {/* Only the selectable segments share the tinted, inset group. "+" adds a
          breakpoint rather than targeting one, so it must stay outside this
          surface — inside it, it reads as one more segment to select. */}
      <div className="flex items-center gap-0.5 rounded-md bg-[var(--design-editor-control-bg)] p-0.5">
        {/* Base segment — the primary/widest editing context. Icon-only with
          the label in the tooltip: the Screen settings row can grow with
          each breakpoint, so every segment stays as narrow as it can. */}
        <button
          type="button"
          className={segmentClass(baseActive)}
          aria-pressed={baseActive}
          aria-label={t("designEditor.breakpointBar.base")}
          onClick={() => onSelect(undefined)}
          title={
            baseWidthPx != null
              ? `${t("designEditor.breakpointBar.base")} · ${Math.round(baseWidthPx)}px`
              : t("designEditor.breakpointBar.base")
          }
        >
          <IconViewportWide className="size-3.5" />
        </button>

        {/* One segment per breakpoint, widest → narrowest. Clicking always
          SELECTS (never toggles off) — returning to Base is the Base
          segment, clicking the base frame/empty canvas, or Escape (the
          Framer click-to-target model). */}
        {ordered.map((breakpoint) => {
          const active = activeWidthPx === breakpoint.widthPx;
          const menuOpen = menuOpenFor === breakpoint.id;
          const showMenuAffordance = Boolean(
            canMutateBreakpoints &&
            (onRemove || onChangeWidth) &&
            (active || menuOpen),
          );
          return (
            <div key={breakpoint.id} className="relative flex items-center">
              <button
                type="button"
                className={segmentClass(active)}
                aria-pressed={active}
                onClick={() => onSelect(breakpoint.widthPx)}
                title={`${breakpoint.label} · ${breakpoint.widthPx}px`}
              >
                {/* ITEM 8a — device icon (by width bucket) + width number.
                  Kept compact (size-3, one notch smaller than Base's
                  size-3.5) so the Screen settings row can grow; the full
                  label stays in the tooltip. */}
                <DeviceIcon widthPx={breakpoint.widthPx} />
                <span>{breakpoint.widthPx}</span>
              </button>
              {/* "…" — per-breakpoint options (Change width / Remove). Shown
                for the ACTIVE segment (and while its menu is open) so idle
                segments stay clean; replaces the old hover-"X" that both
                shifted layout and, being buried in a floating bar, was easy
                to miss entirely. */}
              {showMenuAffordance ? (
                <DropdownMenu
                  open={menuOpen}
                  onOpenChange={(open) => {
                    setMenuOpenFor(open ? breakpoint.id : null);
                    setWidthDraft(open ? String(breakpoint.widthPx) : "");
                  }}
                >
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("designEditor.breakpointBar.options")}
                      className="flex h-6 w-4 shrink-0 cursor-pointer items-center justify-center rounded-[5px] text-muted-foreground hover:text-foreground"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <IconDots className="size-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="design-editor-app-menu-content w-52 rounded-lg bg-[var(--design-editor-panel-bg)] p-1"
                  >
                    {/* Change width — inline input row; Enter commits.
                      Key events stay local (stopPropagation) so the menu's
                      typeahead/arrow navigation doesn't steal keystrokes
                      from the input. */}
                    {onChangeWidth ? (
                      <div className="flex items-center gap-1.5 px-1.5 py-1">
                        <span className="shrink-0 !text-[11px] text-muted-foreground">
                          {t("designEditor.breakpointBar.changeWidth")}
                        </span>
                        <Input
                          type="number"
                          min={320}
                          max={3840}
                          value={widthDraft}
                          autoFocus
                          onChange={(event) =>
                            setWidthDraft(event.target.value)
                          }
                          onKeyDownCapture={(event) => {
                            event.stopPropagation();
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            const widthPx = parseBreakpointWidthInput(
                              widthDraft,
                              existingWidths.filter(
                                (width) => width !== breakpoint.widthPx,
                              ),
                            );
                            if (widthPx === null) return;
                            setMenuOpenFor(null);
                            if (widthPx !== breakpoint.widthPx) {
                              onChangeWidth(breakpoint.id, widthPx);
                            }
                          }}
                          aria-invalid={
                            parseBreakpointWidthInput(
                              widthDraft,
                              existingWidths.filter(
                                (width) => width !== breakpoint.widthPx,
                              ),
                            ) === null
                          }
                          className="h-6 px-1.5 !text-[11px] tabular-nums aria-invalid:border-destructive"
                          aria-label={t(
                            "designEditor.breakpointBar.changeWidth",
                          )}
                        />
                      </div>
                    ) : null}
                    {onChangeWidth && onRemove ? (
                      <DropdownMenuSeparator />
                    ) : null}
                    {onRemove ? (
                      <DropdownMenuItem
                        className="h-7 px-2 py-0 !text-[12px] text-destructive focus:text-destructive"
                        onSelect={() => {
                          setMenuOpenFor(null);
                          onRemove(breakpoint.id);
                        }}
                      >
                        {t("designEditor.breakpointBar.remove")}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* "+" — Framer default widths or a custom width. */}
      {canEdit && onAdd ? (
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 cursor-pointer rounded-md text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground"
              title={t("designEditor.breakpointBar.addBreakpoint")}
            >
              <IconPlus className="size-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-1">
            <div className="flex flex-col">
              {presets.map((preset) => (
                <button
                  key={preset.widthPx}
                  type="button"
                  className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left !text-[12px] hover:bg-muted"
                  disabled={mutationPending}
                  onClick={() => {
                    onAdd(
                      preset.widthPx,
                      t(`designEditor.breakpointBar.${preset.labelKey}`),
                    );
                    setAddOpen(false);
                  }}
                >
                  <span className="flex items-center gap-2">
                    <DeviceIcon widthPx={preset.widthPx} />
                    {t(`designEditor.breakpointBar.${preset.labelKey}`)}
                  </span>
                  <span className="tabular-nums text-muted-foreground/60">
                    {preset.widthPx}
                  </span>
                </button>
              ))}
              {devicePresets.length > 0 ? (
                <>
                  {presets.length > 0 ? (
                    <div className="my-1 h-px bg-border" />
                  ) : null}
                  <div className="max-h-48 overflow-y-auto overscroll-contain">
                    {devicePresets.map((preset) => (
                      <button
                        key={preset.widthPx}
                        type="button"
                        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left !text-[12px] hover:bg-muted"
                        disabled={mutationPending}
                        onClick={() => {
                          onAdd(
                            preset.widthPx,
                            breakpointLabelForWidth(preset.widthPx),
                          );
                          setAddOpen(false);
                        }}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <DeviceIcon widthPx={preset.widthPx} />
                          <span className="truncate">{preset.name}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground/60">
                          {preset.widthPx}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              {presets.length > 0 || devicePresets.length > 0 ? (
                <div className="my-1 h-px bg-border" />
              ) : null}
              <form
                className="flex items-center gap-1 px-1 py-0.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitCustomWidth();
                }}
              >
                <Input
                  type="number"
                  min={320}
                  max={3840}
                  value={customWidth}
                  onChange={(event) => setCustomWidth(event.target.value)}
                  placeholder={t("designEditor.breakpointBar.customWidth")}
                  aria-invalid={
                    customWidth !== "" &&
                    parseBreakpointWidthInput(customWidth, existingWidths) ===
                      null
                  }
                  className="h-7 !text-[12px] aria-invalid:border-destructive"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  className="h-7 cursor-pointer px-2 !text-[11px]"
                  disabled={mutationPending}
                >
                  {t("designEditor.breakpointBar.add")}
                </Button>
              </form>
              {onShowAllFramesChange !== undefined ? (
                <>
                  <div className="my-1 h-px bg-border" />
                  <label className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 !text-[12px] hover:bg-muted">
                    <span>
                      {t("designEditor.breakpointBar.showAllBreakpoints")}
                    </span>
                    <Switch
                      checked={showAllFrames ?? true}
                      onCheckedChange={onShowAllFramesChange}
                    />
                  </label>
                </>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
