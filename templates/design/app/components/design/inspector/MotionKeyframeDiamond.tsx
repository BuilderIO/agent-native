import { useT } from "@agent-native/core/client/i18n";
import { IconDiamond, IconDiamondFilled } from "@tabler/icons-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * The exact CSS property identifiers the motion catalog
 * (`MOTION_PROPERTY_PRESETS` in `shared/motion-timeline.ts`) tracks.
 * `EditPanel` fields must emit one of these when calling
 * `onToggleMotionKeyframe` so the caller can resolve the click to a motion
 * track without guessing at a mapping.
 */
export type MotionKeyframeCssProperty =
  | "translate"
  | "scale"
  | "rotate"
  | "opacity"
  | "border-radius"
  | "background-color"
  | "border-color"
  | "border-width"
  | "box-shadow";

export interface MotionKeyframeDiamondProps {
  /** One of the motion catalog's tracked CSS properties — see module doc. */
  cssProperty: MotionKeyframeCssProperty;
  /** True when this property already has at least one authored keyframe. */
  hasKeyframe: boolean;
  onToggle: () => void;
  className?: string;
}

export function MotionKeyframeDiamond({
  cssProperty,
  hasKeyframe,
  onToggle,
  className,
}: MotionKeyframeDiamondProps) {
  const t = useT();
  const label = hasKeyframe
    ? t("editPanel.motionKeyframe.removeTooltip")
    : t("editPanel.motionKeyframe.addTooltip");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={hasKeyframe}
          aria-label={label}
          data-motion-css-property={cssProperty}
          className={cn(
            // Hover/focus-reveal for the muted outline (not-yet-keyframed)
            // state is the caller's responsibility (see `FieldTrailer`'s
            // wrapper, which fades this whole affordance in on field
            // hover) — this component itself always renders at full
            // opacity so a filled (keyframed) diamond never gets hidden by
            // an ancestor hover state it doesn't control.
            "flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/50 transition-colors",
            "hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
            hasKeyframe &&
              "text-[var(--design-editor-accent-color)] hover:text-[var(--design-editor-accent-color)]",
            className,
          )}
        >
          {hasKeyframe ? (
            <IconDiamondFilled className="size-2.5 shrink-0" />
          ) : (
            <IconDiamond className="size-2.5 shrink-0" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Per-selection lookup helper: does `cssProperty` already have a keyframe,
 * per the `motionKeyframeState.keyframedProperties` list threaded down from
 * DesignEditor. Pure/cheap — safe to call inline in render.
 */
export function motionPropertyHasKeyframe(
  keyframedProperties: readonly string[] | undefined,
  cssProperty: MotionKeyframeCssProperty,
): boolean {
  return keyframedProperties?.includes(cssProperty) ?? false;
}
