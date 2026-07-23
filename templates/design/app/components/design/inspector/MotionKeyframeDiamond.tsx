import { useT } from "@agent-native/core/client/i18n";

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

/**
 * Small ◆ glyph, 8x8, drawn with currentColor so it inherits the button's
 * text color for the outline/filled/hover states below.
 */
function DiamondGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 8 8"
      width="8"
      height="8"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect
        x="1"
        y="1"
        width="6"
        height="6"
        transform="rotate(45 4 4)"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={filled ? 0 : 1.25}
      />
    </svg>
  );
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
          <DiamondGlyph filled={hasKeyframe} />
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
