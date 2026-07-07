/**
 * BreakpointDeviceControl (§6.4, BP-DEEP v2) — the single, unified breakpoint
 * targeting control for the design editor.
 *
 * History: breakpoint targeting used to be a floating "BreakpointBar" overlay
 * above the canvas (and briefly a reserved chrome row above it). Both cost
 * canvas space or covered the top of the screen being edited, and the editor
 * ALSO had a separate device-preview dropdown in the right-inspector header —
 * two similar-but-different width controls. BP-DEEP v2 folds all of that into
 * this ONE segmented control that lives in the right-inspector header:
 *
 *   [ Base ] [ 810 ] [ 390 ] [ + ]
 *
 * - Clicking a segment switches BOTH the editing viewport width (single-screen
 *   mode renders the iframe at that width, centered) AND the active edit
 *   scope: edits made while a narrower segment is active persist as
 *   width-scoped overrides that cascade down, while Base edits cascade to
 *   every breakpoint unless overridden.
 * - Each breakpoint segment carries a "…" menu (shadcn DropdownMenu) with a
 *   width input (Enter commits) and a destructive "Remove breakpoint" item —
 *   replaces the old dead hover-"X".
 * - "+" offers Framer's default widths (Desktop 1200 / Tablet 810 / Phone
 *   390) or a custom width, plus the overview "show all breakpoints" toggle.
 *
 * The overview canvas keeps its own frame-attached labels (see
 * BreakpointPreviewRow in MultiScreenCanvas) — this control is the only other
 * breakpoint surface.
 */

import { useT } from "@agent-native/core/client";
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

/** Framer's default breakpoint widths, offered by the "+" affordance. */
export const FRAMER_BREAKPOINT_PRESETS: ReadonlyArray<{
  labelKey: "desktop" | "tablet" | "phone";
  widthPx: number;
}> = [
  { labelKey: "desktop", widthPx: 1200 },
  { labelKey: "tablet", widthPx: 810 },
  { labelKey: "phone", widthPx: 390 },
];

/** Presets not already present in the breakpoint set (by exact width). */
export function availableBreakpointPresets(
  existingWidths: readonly number[],
): Array<{ labelKey: "desktop" | "tablet" | "phone"; widthPx: number }> {
  return FRAMER_BREAKPOINT_PRESETS.filter(
    (preset) => !existingWidths.includes(preset.widthPx),
  );
}

/** Default English label for a preset/custom width (used for add-breakpoint). */
export function breakpointLabelForWidth(widthPx: number): string {
  if (widthPx >= 1024) return "Desktop";
  if (widthPx >= 600) return "Tablet";
  return "Phone";
}

/**
 * Validate a raw width-input string for the add/change-width flows. Returns
 * the parsed integer width when acceptable, or null for non-numeric or
 * out-of-range input, or a width already taken by another breakpoint.
 * Pure/exported for unit tests.
 */
export function parseBreakpointWidthInput(
  raw: string,
  existingWidths: readonly number[],
): number | null {
  const widthPx = Number.parseInt(raw, 10);
  if (!Number.isFinite(widthPx) || widthPx < 320 || widthPx > 3840) return null;
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
  /** The design's breakpoint definitions (any order — sorted internally). */
  breakpoints: BreakpointBarBreakpoint[];
  /** Active breakpoint frame width; undefined = base frame active. */
  activeWidthPx?: number;
  /** The primary frame's width, shown in the Base tooltip when known. */
  baseWidthPx?: number | null;
  /** Gates add/remove/change affordances; selection is allowed read-only. */
  canEdit: boolean;
  /** Linked side-by-side frames toggle (overview). Hidden when undefined. */
  showAllFrames?: boolean;
  onShowAllFramesChange?: (value: boolean) => void;
  /** Segment click: switch viewport + edit scope. undefined = base. */
  onSelect: (widthPx: number | undefined) => void;
  /** "+" affordance: add a breakpoint at a preset or custom width. */
  onAdd?: (widthPx: number, label: string) => void;
  /** "…" menu: remove a breakpoint. */
  onRemove?: (breakpointId: string) => void;
  /** "…" menu: change a breakpoint's width (Enter in the width input). */
  onChangeWidth?: (breakpointId: string, widthPx: number) => void;
  className?: string;
}

export function BreakpointDeviceControl({
  breakpoints,
  activeWidthPx,
  baseWidthPx,
  canEdit,
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
  const [customWidth, setCustomWidth] = useState("");
  /** Which breakpoint's "…" menu is open (id), if any. */
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  /** Draft value of the width input inside the open "…" menu. */
  const [widthDraft, setWidthDraft] = useState("");

  // Framer order: widest first (base segment, then breakpoints desc).
  const ordered = [...breakpoints].sort((a, b) => b.widthPx - a.widthPx);
  const existingWidths = ordered.map((bp) => bp.widthPx);
  const presets = availableBreakpointPresets(existingWidths);
  const baseActive = activeWidthPx === undefined;

  const submitCustomWidth = () => {
    const widthPx = parseBreakpointWidthInput(customWidth, existingWidths);
    setAddOpen(false);
    setCustomWidth("");
    if (widthPx === null) return;
    onAdd?.(widthPx, breakpointLabelForWidth(widthPx));
  };

  const segmentClass = (active: boolean) =>
    cn(
      "flex h-6 cursor-pointer select-none items-center gap-1 rounded-[5px] px-1.5 font-medium !text-[11px] tabular-nums",
      active
        ? "bg-background text-[var(--design-editor-accent-color)] shadow-sm"
        : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div
      data-breakpoint-device-control
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-md bg-[var(--design-editor-control-bg)] p-0.5",
        className,
      )}
    >
      {/* Base segment — the primary/widest editing context. Icon-only with
          the label in the tooltip: this control shares one cramped
          inspector-header row with the collaborators menu and play/share
          actions (~300px total), so every segment stays as narrow as it
          can. */}
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
          canEdit && (onRemove || onChangeWidth) && (active || menuOpen),
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
                  size-3.5) so the segment still fits this ~300px
                  inspector-header row next to play/share; the full label
                  stays in the tooltip. */}
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
                        onChange={(event) => setWidthDraft(event.target.value)}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          const widthPx = parseBreakpointWidthInput(
                            widthDraft,
                            existingWidths.filter(
                              (width) => width !== breakpoint.widthPx,
                            ),
                          );
                          setMenuOpenFor(null);
                          if (
                            widthPx !== null &&
                            widthPx !== breakpoint.widthPx
                          ) {
                            onChangeWidth(breakpoint.id, widthPx);
                          }
                        }}
                        className="h-6 px-1.5 !text-[11px] tabular-nums"
                        aria-label={t("designEditor.breakpointBar.changeWidth")}
                      />
                    </div>
                  ) : null}
                  {onChangeWidth && onRemove ? <DropdownMenuSeparator /> : null}
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

      {/* "+" — Framer default widths or a custom width. */}
      {canEdit && onAdd ? (
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 cursor-pointer rounded-[5px] text-muted-foreground hover:text-foreground"
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
              {presets.length > 0 ? (
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
                  className="h-7 !text-[12px]"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  className="h-7 cursor-pointer px-2 !text-[11px]"
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
