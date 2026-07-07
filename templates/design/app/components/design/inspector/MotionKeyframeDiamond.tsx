/**
 * MotionKeyframeDiamond — the small ◆ affordance Figma places to the right
 * of a keyframeable property's field/label once a timeline exists on the
 * layer. Two states:
 *   - outline (muted): the property has a timeline but no keyframes yet for
 *     it — clicking adds one at the current playhead position.
 *   - filled accent: the property already has one or more keyframes —
 *     rendered solid so a glance across the panel shows which fields are
 *     currently animated.
 *
 * This component owns ONLY the affordance's rendering + click wiring. It has
 * no opinion on how keyframes are stored or how the timeline UI reacts to a
 * toggle — see `EditPanel`'s `motionKeyframeState`/`onToggleMotionKeyframe`
 * props for that contract. The CSS property name passed in `cssProperty`
 * must be one of the identifiers `MOTION_PROPERTY_PRESETS` in
 * `shared/motion-timeline.ts` already uses (`translate` / `scale` /
 * `rotate` / `opacity` / `border-radius` / `background-color` /
 * `border-color` / `border-width` / `box-shadow`) so the motion machinery
 * that owns the timeline can resolve the click to the right track.
 *
 * Visibility: hidden entirely when there's no timeline for the selected
 * layer (`hasTimeline: false` or the state prop is omitted) — Figma only
 * shows the diamond rail once a layer has been added to a timeline/scroll
 * animation.  When a timeline exists, the diamond is always in the DOM but
 * stays visually muted (low-opacity outline) until the row is hovered, or is
 * always visible once the property already carries a keyframe (filled),
 * matching Figma's "quiet until relevant" treatment.
 */

import { useT } from "@agent-native/core/client";

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
