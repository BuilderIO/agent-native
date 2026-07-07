import { useT } from "@agent-native/core/client";
import {
  IconBorderCorners,
  IconBorderRadius,
  IconCheck,
  IconDroplet,
  IconEye,
  IconEyeOff,
  IconGridDots,
  IconRadiusBottomLeft,
  IconRadiusBottomRight,
  IconRadiusTopLeft,
  IconRadiusTopRight,
} from "@tabler/icons-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { ScrubInput, type ScrubInputChangeMeta } from "../inspector";
import type { ElementInfo } from "../types";
import { elementIdentityKey } from "./element-identity";
import { FieldTrailer } from "./field-primitives";
import { SectionIconToggle } from "./inspector-controls";
import { PanelSection } from "./panel-primitives";
import { cssLengthNumber, fourValuesEqual } from "./position-helpers";
import { isMixedValue, MIXED_VALUE } from "./selection-helpers";
import type {
  BreakpointOverrideFieldContext,
  MotionKeyframeFieldContext,
  StyleChangeHandler,
} from "./style-change-types";
import {
  BLEND_MODE_OPTIONS,
  optionValue,
  parseNumericValue,
} from "./style-options";

export function CornerRadiusControl({
  styles,
  onStyleChange,
  element,
  motionKeyframeContext,
  breakpointOverrideContext,
}: {
  styles: Record<string, string>;
  onStyleChange: StyleChangeHandler;
  /**
   * Optional — only needed to render the keyframe diamond / breakpoint
   * override indicator next to the uniform radius field. Omit for callers
   * that don't wire those features (both affordances stay hidden).
   */
  element?: ElementInfo;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
}) {
  const t = useT();
  const independentCornersLabel = t("editPanel.labels.independentCorners");
  const cornerSources = {
    topLeft: styles.borderTopLeftRadius || styles.borderRadius,
    topRight: styles.borderTopRightRadius || styles.borderRadius,
    bottomRight: styles.borderBottomRightRadius || styles.borderRadius,
    bottomLeft: styles.borderBottomLeftRadius || styles.borderRadius,
  };
  const cornerMixed = {
    topLeft: isMixedValue(cornerSources.topLeft),
    topRight: isMixedValue(cornerSources.topRight),
    bottomRight: isMixedValue(cornerSources.bottomRight),
    bottomLeft: isMixedValue(cornerSources.bottomLeft),
  };
  // Guard cssLengthNumber against the Mixed sentinel — parseFloat("Mixed")
  // would silently coerce it to 0 and render a concrete value.
  const corners = {
    topLeft: cornerMixed.topLeft ? 0 : cssLengthNumber(cornerSources.topLeft),
    topRight: cornerMixed.topRight
      ? 0
      : cssLengthNumber(cornerSources.topRight),
    bottomRight: cornerMixed.bottomRight
      ? 0
      : cssLengthNumber(cornerSources.bottomRight),
    bottomLeft: cornerMixed.bottomLeft
      ? 0
      : cssLengthNumber(cornerSources.bottomLeft),
  };
  const anyCornerMixed =
    cornerMixed.topLeft ||
    cornerMixed.topRight ||
    cornerMixed.bottomRight ||
    cornerMixed.bottomLeft;
  const allCornersMixed =
    cornerMixed.topLeft &&
    cornerMixed.topRight &&
    cornerMixed.bottomRight &&
    cornerMixed.bottomLeft;
  // With mixed sentinels the parsed numbers are placeholders, so compare
  // mixed-ness instead: all-mixed reads as uniform (each element may still be
  // uniform), partially-mixed means at least one element has differing corners.
  const cornersDiffer = anyCornerMixed
    ? !allCornersMixed
    : !fourValuesEqual([
        corners.topLeft,
        corners.topRight,
        corners.bottomRight,
        corners.bottomLeft,
      ]);
  // Seeds the toggle once per selection (this component is remounted per
  // element via `key={elementIdentityKey(element)}` at its call site) and is
  // otherwise a pure user-controlled toggle (see toggleIndependentCorners
  // below). Do NOT add back a useEffect that re-derives this from
  // `cornersDiffer` on every render: commitRadius below applies the 4 corner
  // longhands + shorthand as separate onStyleChange calls, so a scrub
  // gesture that re-invokes commitRadius on every drag tick can hit an
  // intermediate render where one longhand has updated and another hasn't —
  // `cornersDiffer` spikes true for that frame and a reactive effect would
  // force-expand the per-corner view mid-drag, same class of bug as the
  // padding auto-unlink fix above (STEVE TEST BATCH 4 #4 audit).
  const [showIndependentCorners, setShowIndependentCorners] =
    useState(cornersDiffer);
  const radiusMixed =
    anyCornerMixed || (!cornersDiffer && isMixedValue(styles.borderRadius));
  const radius = radiusMixed
    ? 0
    : cornersDiffer
      ? corners.topLeft
      : cssLengthNumber(styles.borderRadius || String(corners.topLeft));
  const commitRadius = (value: number, meta?: ScrubInputChangeMeta) => {
    const next = `${Math.max(0, Math.round(value))}px`;
    // Always write the longhands along with the shorthand: stale inline
    // longhand declarations serialize after the shorthand and would override
    // it, turning uniform-radius commits into silent no-ops.
    onStyleChange("borderRadius", next, meta);
    onStyleChange("borderTopLeftRadius", next, meta);
    onStyleChange("borderTopRightRadius", next, meta);
    onStyleChange("borderBottomRightRadius", next, meta);
    onStyleChange("borderBottomLeftRadius", next, meta);
  };
  const toggleIndependentCorners = () => {
    // Collapsing while corners differ flattens them to the displayed uniform
    // value; otherwise the stale longhands would keep overriding the shorthand
    // and the single field would silently no-op. Mixed selections collapse the
    // UI only — committing would stamp the placeholder 0 onto every object.
    if (showIndependentCorners && cornersDiffer && !radiusMixed) {
      commitRadius(radius);
    }
    setShowIndependentCorners(!showIndependentCorners);
  };

  return (
    <>
      <div className="group/field relative min-w-0">
        <AppearanceScrubField
          label={t("editPanel.labels.cornerRadius")}
          icon={IconBorderRadius}
          value={radius}
          onChange={commitRadius}
          mixed={radiusMixed}
          min={0}
          precision={0}
        />
        {element ? (
          <FieldTrailer
            element={element}
            motionCssProperty="border-radius"
            motionKeyframeContext={motionKeyframeContext}
            breakpointOverrideContext={breakpointOverrideContext}
            className="absolute -top-3.5 right-0"
            hoverRevealClassName="opacity-0 group-hover/field:opacity-100"
          />
        ) : null}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "size-6 rounded-md text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground",
              showIndependentCorners &&
                "bg-[var(--design-editor-accent-color)]/20 text-[var(--design-editor-accent-color)] hover:bg-[var(--design-editor-accent-color)]/20 hover:text-[var(--design-editor-accent-color)]",
            )}
            aria-label={independentCornersLabel}
            aria-pressed={showIndependentCorners}
            onClick={toggleIndependentCorners}
          >
            <IconBorderCorners className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{independentCornersLabel}</TooltipContent>
      </Tooltip>
      {showIndependentCorners ? (
        <>
          <AppearanceScrubField
            label={t("editPanel.labels.topLeft")}
            ariaLabel="Top left"
            icon={IconRadiusTopLeft}
            value={corners.topLeft}
            onChange={(value, meta) =>
              onStyleChange(
                "borderTopLeftRadius",
                `${Math.max(0, Math.round(value))}px`,
                meta,
              )
            }
            mixed={cornerMixed.topLeft}
            min={0}
            precision={1}
          />
          <AppearanceScrubField
            label={t("editPanel.labels.topRight")}
            ariaLabel="Top right"
            icon={IconRadiusTopRight}
            value={corners.topRight}
            onChange={(value, meta) =>
              onStyleChange(
                "borderTopRightRadius",
                `${Math.max(0, Math.round(value))}px`,
                meta,
              )
            }
            mixed={cornerMixed.topRight}
            min={0}
            precision={1}
          />
          <span aria-hidden="true" />
          <AppearanceScrubField
            label={t("editPanel.labels.bottomLeft")}
            ariaLabel="Bottom left"
            icon={IconRadiusBottomLeft}
            value={corners.bottomLeft}
            onChange={(value, meta) =>
              onStyleChange(
                "borderBottomLeftRadius",
                `${Math.max(0, Math.round(value))}px`,
                meta,
              )
            }
            mixed={cornerMixed.bottomLeft}
            min={0}
            precision={1}
          />
          <AppearanceScrubField
            label={t("editPanel.labels.bottomRight")}
            ariaLabel="Bottom right"
            icon={IconRadiusBottomRight}
            value={corners.bottomRight}
            onChange={(value, meta) =>
              onStyleChange(
                "borderBottomRightRadius",
                `${Math.max(0, Math.round(value))}px`,
                meta,
              )
            }
            mixed={cornerMixed.bottomRight}
            min={0}
            precision={1}
          />
          <span aria-hidden="true" />
        </>
      ) : null}
    </>
  );
}

export function AppearanceScrubField({
  label,
  ariaLabel,
  icon,
  value,
  onChange,
  mixed = false,
  min,
  max,
  step,
  unit,
  precision,
  disabled = false,
}: {
  label: string;
  ariaLabel?: string;
  icon: (props: { className?: string }) => ReactNode;
  value: number;
  onChange: (value: number, meta?: ScrubInputChangeMeta) => void;
  mixed?: boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  precision?: number;
  disabled?: boolean;
}) {
  return (
    <ScrubInput
      label={label}
      ariaLabel={ariaLabel ?? label}
      icon={icon}
      value={value}
      onChange={onChange}
      mixed={mixed}
      min={min}
      max={max}
      step={step}
      unit={unit}
      precision={precision}
      disabled={disabled}
      className="min-w-0 gap-0"
      labelClassName="h-6 w-7 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-muted-foreground [&>span]:sr-only"
      inputClassName="h-6 min-w-0 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] border-l-0 bg-[var(--design-editor-control-bg)] px-0 text-left shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
    />
  );
}

export function BlendModeMenu({
  styles,
  onStyleChange,
}: {
  styles: Record<string, string>;
  onStyleChange: StyleChangeHandler;
}) {
  const [open, setOpen] = useState(false);
  const blendMode = optionValue(
    BLEND_MODE_OPTIONS,
    styles.mixBlendMode || "normal",
    "normal",
  );
  // Recognize the Mixed sentinel BEFORE optionValue's fallback maps it to
  // "normal" — a mixed selection must not check a wrong concrete mode.
  // Isolation only disambiguates pass-through vs normal, so it only makes the
  // state mixed when the blend mode itself resolves to normal.
  const blendModeMixed =
    isMixedValue(styles.mixBlendMode) ||
    (blendMode === "normal" && isMixedValue(styles.isolation));
  const selectedBlendMode = blendModeMixed
    ? MIXED_VALUE
    : blendMode === "normal" && styles.isolation !== "isolate"
      ? "pass-through"
      : blendMode;
  const options = [
    {
      value: "pass-through",
      label: "Pass through", // i18n-ignore design blend mode label
    },
    ...BLEND_MODE_OPTIONS,
  ] as const;
  const selectBlendMode = (value: (typeof options)[number]["value"]) => {
    if (value === "pass-through") {
      onStyleChange("mixBlendMode", "normal");
      onStyleChange("isolation", "auto");
      return;
    }
    onStyleChange("mixBlendMode", value);
    if (value === "normal") onStyleChange("isolation", "isolate");
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={"Blend mode" /* i18n-ignore design inspector action */}
          aria-pressed={open}
          className={cn(
            "size-6 cursor-pointer rounded-md text-muted-foreground hover:text-foreground",
            open &&
              "bg-[var(--design-editor-accent-color)]/20 text-[var(--design-editor-accent-color)] hover:text-[var(--design-editor-accent-color)]",
          )}
        >
          <IconDroplet className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="left"
        align="start"
        sideOffset={8}
        className="z-[100010] w-48 rounded-xl border-[var(--design-editor-control-border)] bg-[var(--design-editor-panel-bg)] p-1 text-[13px] text-foreground shadow-2xl"
      >
        {blendModeMixed ? (
          <>
            {/* Placeholder state for a mixed selection: the check sits next to
                "Mixed" instead of a wrong concrete mode. Picking any option
                below applies it to every selected object. */}
            <div className="flex h-9 items-center gap-3 rounded-md px-3 text-[13px] text-muted-foreground">
              <span className="flex size-4 shrink-0 items-center justify-center">
                <IconCheck className="size-4" />
              </span>
              <span>{MIXED_VALUE}</span>
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            className="flex h-9 cursor-pointer items-center gap-3 rounded-md px-3 text-[13px] focus:bg-[var(--design-editor-control-bg)]"
            onSelect={() => selectBlendMode(option.value)}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {selectedBlendMode === option.value ? (
                <IconCheck className="size-4" />
              ) : null}
            </span>
            <span>{option.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppearanceProperties({
  element,
  onStyleChange,
  motionKeyframeContext,
  breakpointOverrideContext,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const hidden =
    styles.visibility === "hidden" ||
    styles.display === "none" ||
    parseNumericValue(styles.opacity || "1") === 0;
  return (
    <PanelSection
      title={t("root.commandAppearance")}
      actions={
        <>
          <SectionIconToggle
            label={
              hidden
                ? "Show" /* i18n-ignore design inspector action */
                : "Hide" /* i18n-ignore design inspector action */
            }
            active={hidden}
            onClick={() =>
              onStyleChange("visibility", hidden ? "visible" : "hidden")
            }
          >
            {hidden ? (
              <IconEyeOff className="size-3.5" />
            ) : (
              <IconEye className="size-3.5" />
            )}
          </SectionIconToggle>
          <BlendModeMenu styles={styles} onStyleChange={onStyleChange} />
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5">
        <p className="min-w-0 truncate !text-[11px] font-medium text-muted-foreground">
          {t("editPanel.labels.opacity")}
        </p>
        <p className="min-w-0 truncate !text-[11px] font-medium text-muted-foreground">
          {t("editPanel.labels.cornerRadius")}
        </p>
        <span aria-hidden="true" />
        <div className="group/field relative min-w-0">
          <AppearanceScrubField
            label={t("editPanel.labels.opacity")}
            icon={IconGridDots}
            value={
              isMixedValue(styles.opacity)
                ? 0
                : parseNumericValue(styles.opacity || "1") * 100
            }
            onChange={(v, meta) =>
              onStyleChange("opacity", String(v / 100), meta)
            }
            mixed={isMixedValue(styles.opacity)}
            min={0}
            max={100}
            step={1}
            unit="%"
            precision={1}
          />
          <FieldTrailer
            element={element}
            motionCssProperty="opacity"
            motionKeyframeContext={motionKeyframeContext}
            breakpointOverrideContext={breakpointOverrideContext}
            className="absolute -top-3.5 right-0"
            hoverRevealClassName="opacity-0 group-hover/field:opacity-100"
          />
        </div>
        {/* Selection-stable key so per-selection UI state (the independent-
            corners toggle, which ratchets open while corners differ) resets on
            selection change instead of leaking to the next element — same
            pattern as ExportSettingsPanel. */}
        <CornerRadiusControl
          key={elementIdentityKey(element)}
          styles={styles}
          onStyleChange={onStyleChange}
          element={element}
          motionKeyframeContext={motionKeyframeContext}
          breakpointOverrideContext={breakpointOverrideContext}
        />
      </div>
    </PanelSection>
  );
}
