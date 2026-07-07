import { useT } from "@agent-native/core/client";
import { IconLink, IconUnlink } from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  BreakpointOverrideIndicator,
  MotionKeyframeDiamond,
  motionPropertyHasKeyframe,
  ScrubInput,
  type MotionKeyframeCssProperty,
  type ScrubInputChangeMeta,
} from "../inspector";
import type { ElementInfo } from "../types";
import { isMixedValue } from "./selection-helpers";
import {
  resolveBreakpointOverride,
  type BreakpointOverrideFieldContext,
  type MotionKeyframeFieldContext,
  type StyleChangeHandler,
  type StylesChangeHandler,
} from "./style-change-types";
import { parseNumericValue, sidesAreLinked } from "./style-options";

export function DesignSpacingControl({
  label,
  values,
  onChange,
}: {
  label: string;
  values: { top: string; right: string; bottom: string; left: string };
  onChange: (side: string, value: string) => void;
}) {
  const t = useT();
  const [linked, setLinked] = useState(() => sidesAreLinked(values));
  const numeric = {
    top: parseNumericValue(values.top || "0"),
    right: parseNumericValue(values.right || "0"),
    bottom: parseNumericValue(values.bottom || "0"),
    left: parseNumericValue(values.left || "0"),
  };
  const linkedValue = Math.round(
    (numeric.top + numeric.right + numeric.bottom + numeric.left) / 4,
  );
  const setSide = (
    side: "Top" | "Right" | "Bottom" | "Left",
    value: number,
  ) => {
    onChange(side, `${Math.round(value)}px`);
  };
  const setAll = (value: number) => {
    (["Top", "Right", "Bottom", "Left"] as const).forEach((side) =>
      setSide(side, value),
    );
  };
  const linkedLabel = linked
    ? t("editPanel.labels.unlinkSides")
    : t("editPanel.labels.linkSides");

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-1.5">
        <Label className="!text-[11px] font-medium text-muted-foreground">
          {label}
        </Label>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 rounded-md text-muted-foreground hover:text-foreground"
              onClick={() => setLinked((current) => !current)}
              aria-label={linkedLabel}
            >
              {linked ? (
                <IconLink className="size-3.5" />
              ) : (
                <IconUnlink className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{linkedLabel}</TooltipContent>
        </Tooltip>
      </div>
      {linked ? (
        <ScrubInput
          label={t("editPanel.labels.allSides")}
          value={linkedValue}
          onChange={setAll}
          unit="px"
          min={0}
          labelClassName="w-16"
          inputClassName="h-6"
        />
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <ScrubInput
            label={t("editPanel.sidePlaceholders.top")}
            value={numeric.top}
            onChange={(value) => setSide("Top", value)}
            unit="px"
            min={0}
            precision={1}
            inputClassName="h-6"
          />
          <ScrubInput
            label={t("editPanel.sidePlaceholders.right")}
            value={numeric.right}
            onChange={(value) => setSide("Right", value)}
            unit="px"
            min={0}
            precision={1}
            inputClassName="h-6"
          />
          <ScrubInput
            label={t("editPanel.sidePlaceholders.bottom")}
            value={numeric.bottom}
            onChange={(value) => setSide("Bottom", value)}
            unit="px"
            min={0}
            precision={1}
            inputClassName="h-6"
          />
          <ScrubInput
            label={t("editPanel.sidePlaceholders.left")}
            value={numeric.left}
            onChange={(value) => setSide("Left", value)}
            unit="px"
            min={0}
            precision={1}
            inputClassName="h-6"
          />
        </div>
      )}
    </div>
  );
}

/**
 * FieldTrailer — composes the motion keyframe diamond and the breakpoint
 * override indicator/reset for one field, in the Figma-parity order (diamond
 * first, then the override dot). Renders `null` when neither affordance
 * applies, so call sites can drop it in unconditionally next to any
 * keyframeable/overridable field without their own presence checks.
 *
 * `motionCssProperty` drives the keyframe diamond (omit to skip it — e.g.
 * for fields with no motion-catalog equivalent); `overrideProperty` drives
 * the breakpoint override indicator (defaults to `motionCssProperty` when
 * omitted, since most fields use the same identifier for both — pass it
 * explicitly when a field's CSS property differs from its motion-catalog
 * name, e.g. corner radius's independent-corner longhands).
 */
export function FieldTrailer({
  element,
  motionCssProperty,
  overrideProperty,
  motionKeyframeContext,
  breakpointOverrideContext,
  hoverRevealClassName,
  className,
}: {
  element: ElementInfo;
  motionCssProperty?: MotionKeyframeCssProperty;
  overrideProperty?: string;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
  /**
   * Applied ONLY to the keyframe diamond, and only while it's in its muted
   * outline (not-yet-keyframed) state — e.g. `"opacity-0
   * group-hover/field:opacity-100"` to hide it until the field is hovered.
   * A filled (already-keyframed) diamond, and the breakpoint override dot,
   * always render regardless of this class since both convey real state
   * rather than a quiet affordance.
   */
  hoverRevealClassName?: string;
  className?: string;
}) {
  const showDiamond =
    motionCssProperty != null && motionKeyframeContext?.hasTimeline === true;
  const hasKeyframe = showDiamond
    ? motionPropertyHasKeyframe(
        motionKeyframeContext?.keyframedProperties,
        motionCssProperty!,
      )
    : false;
  const resolvedOverrideProperty = overrideProperty ?? motionCssProperty;
  const overrideState = resolvedOverrideProperty
    ? resolveBreakpointOverride(
        breakpointOverrideContext,
        element.classes.join(" "),
        resolvedOverrideProperty,
      )
    : undefined;

  if (!showDiamond && !overrideState?.overriddenAtActive) return null;

  return (
    <span
      className={cn(
        "group/trailer inline-flex items-center gap-0.5",
        className,
      )}
    >
      {showDiamond ? (
        <MotionKeyframeDiamond
          cssProperty={motionCssProperty!}
          hasKeyframe={hasKeyframe}
          onToggle={() => motionKeyframeContext?.onToggle?.(motionCssProperty!)}
          className={hasKeyframe ? undefined : hoverRevealClassName}
        />
      ) : null}
      {overrideState?.overriddenAtActive && resolvedOverrideProperty ? (
        <BreakpointOverrideIndicator
          overridden
          maxWidthPx={overrideState.activeUpperBoundPx}
          onReset={
            breakpointOverrideContext &&
            overrideState.activeUpperBoundPx != null
              ? () =>
                  breakpointOverrideContext.onReset(
                    resolvedOverrideProperty,
                    overrideState.activeUpperBoundPx!,
                  )
              : undefined
          }
        />
      ) : null}
    </span>
  );
}

export function ScrubStyleInput({
  label,
  value,
  placeholder,
  onChange,
  unit = "px",
  min,
  max,
  step = 1,
  labelClassName,
  inputClassName,
  ariaLabel,
  tooltipLabel,
  hideIcon = true,
  icon,
  disabled = false,
}: {
  label: string;
  value: string;
  placeholder?: number;
  onChange: (value: number, meta?: ScrubInputChangeMeta) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  labelClassName?: string;
  inputClassName?: string;
  hideIcon?: boolean;
  ariaLabel?: string;
  tooltipLabel?: string;
  icon?: (props: { className?: string }) => ReactNode;
  disabled?: boolean;
}) {
  const mixed = isMixedValue(value);
  return (
    <ScrubInput
      label={label}
      ariaLabel={ariaLabel}
      tooltipLabel={tooltipLabel}
      icon={hideIcon ? null : icon}
      value={mixed ? 0 : value ? parseNumericValue(value) : (placeholder ?? 0)}
      onChange={onChange}
      mixed={mixed}
      unit={unit}
      min={min}
      max={max}
      step={step}
      precision={1}
      disabled={disabled}
      className="gap-0"
      labelClassName={cn(
        "h-6 w-7 justify-center gap-0 rounded-l-md rounded-r-none border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] !text-[11px] tabular-nums",
        labelClassName,
      )}
      inputClassName={cn(
        "h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
        inputClassName,
      )}
    />
  );
}

export function commitStylePatch(
  styles: Record<string, string>,
  onStyleChange: StyleChangeHandler,
  onStylesChange?: StylesChangeHandler,
) {
  if (onStylesChange) {
    onStylesChange(styles);
    return;
  }
  Object.entries(styles).forEach(([property, value]) => {
    onStyleChange(property, value);
  });
}
