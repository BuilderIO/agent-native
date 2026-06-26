/**
 * Tracks hover/click state for Remotion UI elements and resolves the active
 * animation values. Progress is duration-based so configured timings stay
 * stable across playback speeds.
 */

import { useEffect, useMemo, useRef } from "react";
import { useCurrentFrame } from "remotion";

import { useCurrentElement } from "@/contexts/CurrentElementContext";
import { getEasingFunction, type EasingKey } from "@/remotion/easingFunctions";
import {
  getCursorTypeForElement,
  type InteractiveElementType,
} from "@/remotion/utils/interactiveElements";
import type { AnimationTrack } from "@/types";
import type { ElementAnimation } from "@/types/elementAnimations";
import { getAnimationValue } from "@/types/elementAnimations";

import type { CursorFrame } from "./useCursorHistory";
import { useCursorTypeFromHover } from "./useCursorTypeFromHover";
import type { HoverZone } from "./useHoverAnimation";
import { useHoverAnimationSmooth } from "./useHoverAnimationSmooth";
import { useRegisterInteractiveElement } from "./useRegisterInteractiveElement";

/**
 * Shorthand for defining animation properties
 */
export interface AnimationPropertyShorthand {
  property: string;
  from: number | string;
  to: number | string;
  unit?: string;
  min?: number;
  max?: number;
}

/**
 * Shorthand for defining animations
 */
export interface AnimationShorthand {
  duration: number; // frames
  easing?: string; // default: "expo.out"
  properties: AnimationPropertyShorthand[];
}

export interface UseInteractiveComponentOptions {
  /** Unique ID for this element instance */
  id: string;

  /** Element type (e.g., "Button", "Card") - used for animation lookup */
  elementType: string;

  /** Display label for sidebar */
  label: string;

  /** Composition ID */
  compositionId: string;

  /** Hit zone for interaction detection */
  zone: HoverZone;

  /** Pre-calculated cursor history */
  cursorHistory: CursorFrame[];

  /** All composition tracks, accepted for generated component compatibility */
  tracks?: AnimationTrack[];

  /** Optional hover animation (auto-registered on mount) */
  hoverAnimation?: AnimationShorthand | ElementAnimation;

  /** Optional click animation (auto-registered on mount) */
  clickAnimation?: AnimationShorthand | ElementAnimation;

  /**
   * Cursor type to show on hover (optional)
   * If not provided, automatically inferred from interactiveElementType
   * Examples: "pointer" (buttons, cards), "text" (inputs), "default" (custom)
   */
  cursorType?: "default" | "pointer" | "text";

  /**
   * Interactive element type for smart cursor defaults (optional)
   * Examples: "button", "card", "input", "link"
   * If not provided and cursorType is also not provided, defaults to "pointer"
   */
  interactiveElementType?: InteractiveElementType;
}

export interface InteractiveComponentState {
  /** Unique identifier for this component */
  id: string;

  /** Hover state */
  hover: {
    isHovering: boolean;
    progress: number; // 0→1 smooth transition
  };

  /** Click state */
  click: {
    isClicking: boolean;
    progress: number; // 0→1→0 animation
  };

  /** Combined hover + click progress for convenience */
  combinedProgress: number;

  /** Cursor type for this element (e.g., "pointer") */
  cursorType: string;

  /** Current cursor position */
  cursorX: number;
  cursorY: number;

  /** Zone definition (for reference) */
  zone: HoverZone;

  /** Computed animation property values from stored animations */
  animatedProperties: Record<string, number | string>;

  /** Target values at progress=1 for each animated property (used for color blending) */
  animatedTargets: Record<string, number | string>;

  /** Hover animation targets (for two-track color system) */
  hoverTargets: Record<string, number | string>;

  /** Click animation targets (for two-track color system) */
  clickTargets: Record<string, number | string>;
}

/**
 * Convert shorthand to full ElementAnimation
 */
function expandAnimation(
  shorthand: AnimationShorthand | ElementAnimation,
  elementType: string,
  triggerType: "hover" | "click",
): ElementAnimation {
  // If already expanded, return as-is
  if ("id" in shorthand) {
    return shorthand;
  }

  // Expand shorthand to full format
  return {
    id: `${elementType.toLowerCase()}-${triggerType}-${Date.now()}`,
    elementType,
    triggerType,
    duration: shorthand.duration,
    easing: shorthand.easing || "expo.out",
    properties: shorthand.properties.map((prop) => ({
      property: prop.property,
      keyframes: [
        { progress: 0, value: prop.from },
        { progress: 1, value: prop.to },
      ],
      unit: prop.unit || "",
      min: prop.min,
      max: prop.max,
    })),
  };
}

/**
 * Main hook - creates a fully-registered interactive component
 */
export function useInteractiveComponent(
  options: UseInteractiveComponentOptions,
): InteractiveComponentState {
  const {
    id,
    elementType,
    label,
    compositionId,
    zone,
    cursorHistory,
    hoverAnimation,
    clickAnimation,
    cursorType,
    interactiveElementType,
  } = options;

  // Step 1.5: Get all context functions (combined for efficiency)
  const { getCursorType, getAnimationsForElement, addAnimation } =
    useCurrentElement();

  // Determine cursor type priority: stored > explicit > inferred > default
  // useMemo ensures this recalculates when stored cursor type changes
  const resolvedCursorType = useMemo(() => {
    const storedCursorType = getCursorType(compositionId, elementType);
    return (
      storedCursorType ??
      cursorType ??
      (interactiveElementType
        ? getCursorTypeForElement(interactiveElementType)
        : "pointer")
    );
  }, [
    getCursorType,
    compositionId,
    elementType,
    cursorType,
    interactiveElementType,
  ]);

  // Step 2: Get hover/click state with cursor type (reactive to cursor type changes)
  const zoneWithCursor = useMemo(
    () => ({ ...zone, cursorType: resolvedCursorType }),
    [zone, resolvedCursorType],
  );
  const hoverState = useHoverAnimationSmooth(cursorHistory, zoneWithCursor);

  // Step 2.5: Memoize element info to prevent infinite loop in useRegisterInteractiveElement
  const elementInfo = useMemo(
    () => ({
      id,
      type: elementType,
      label,
      compositionId,
      cursorType: resolvedCursorType,
    }),
    [id, elementType, label, compositionId, resolvedCursorType],
  );

  // Step 3: Register element (sidebar visibility) with cursor type
  useRegisterInteractiveElement(elementInfo, hoverState);

  // Frame tracking keeps animation durations tied to UI configuration and
  // allows smooth animate-out when interactions end.
  const frame = useCurrentFrame();
  const hoverStartFrameRef = useRef<number | null>(null);
  const hoverEndFrameRef = useRef<number | null>(null);
  const hoverMaxProgressRef = useRef<number>(0); // Track max progress reached
  const clickStartFrameRef = useRef<number | null>(null);
  const clickEndFrameRef = useRef<number | null>(null);
  const clickMaxProgressRef = useRef<number>(0);
  const prevHoverStateRef = useRef<boolean>(false);
  const prevClickStateRef = useRef<boolean>(false);
  const prevFrameRef = useRef<number>(frame);

  if (frame < prevFrameRef.current) {
    hoverStartFrameRef.current = null;
    hoverEndFrameRef.current = null;
    hoverMaxProgressRef.current = 0;
    clickStartFrameRef.current = null;
    clickEndFrameRef.current = null;
    clickMaxProgressRef.current = 0;
    prevHoverStateRef.current = false;
    prevClickStateRef.current = false;
  }

  prevFrameRef.current = frame;

  // Track hover start/end for animate in AND animate out
  if (hoverState.isHovering) {
    if (hoverStartFrameRef.current === null) {
      hoverStartFrameRef.current = frame;
      hoverEndFrameRef.current = null; // Clear end frame when starting
      hoverMaxProgressRef.current = 0; // Reset max progress
    }
  } else if (
    prevHoverStateRef.current === true &&
    hoverEndFrameRef.current === null
  ) {
    // Hover JUST ended (transition from true → false)
    hoverEndFrameRef.current = frame;
  }

  prevHoverStateRef.current = hoverState.isHovering;

  // Track click start/end
  if (hoverState.isClicking) {
    if (clickStartFrameRef.current === null) {
      clickStartFrameRef.current = frame;
      clickEndFrameRef.current = null;
      clickMaxProgressRef.current = 0;
    }
  } else if (
    prevClickStateRef.current === true &&
    clickEndFrameRef.current === null
  ) {
    // Click JUST ended
    clickEndFrameRef.current = frame;
  }

  prevClickStateRef.current = hoverState.isClicking;

  // Calculate frames elapsed since interaction started (for animate in)
  const hoverElapsedFrames =
    hoverStartFrameRef.current !== null
      ? frame - hoverStartFrameRef.current
      : 0;
  const clickElapsedFrames =
    clickStartFrameRef.current !== null
      ? frame - clickStartFrameRef.current
      : 0;

  // Calculate frames since interaction ended (for animate out)
  const hoverEndElapsedFrames =
    hoverEndFrameRef.current !== null ? frame - hoverEndFrameRef.current : 0;
  const clickEndElapsedFrames =
    clickEndFrameRef.current !== null ? frame - clickEndFrameRef.current : 0;

  // Step 4: Register animations (sidebar content)
  // Use a ref to track if we've initialized animations for this element
  const animationsInitialized = useRef(false);

  useEffect(() => {
    // Only register animations once - don't re-add them if user deletes them
    if (animationsInitialized.current) return;

    const existingAnimations = getAnimationsForElement(
      compositionId,
      elementType,
    );

    // Register hover animation if provided and not already exists
    if (hoverAnimation) {
      const hasHover = existingAnimations.some(
        (a) => a.triggerType === "hover",
      );
      if (!hasHover) {
        const expanded = expandAnimation(hoverAnimation, elementType, "hover");
        addAnimation(compositionId, expanded);
      }
    }

    // Register click animation if provided and not already exists
    if (clickAnimation) {
      const hasClick = existingAnimations.some(
        (a) => a.triggerType === "click",
      );
      if (!hasClick) {
        const expanded = expandAnimation(clickAnimation, elementType, "click");
        addAnimation(compositionId, expanded);
      }
    }

    // Mark as initialized
    animationsInitialized.current = true;
  }, [
    compositionId,
    elementType,
    hoverAnimation,
    clickAnimation,
    getAnimationsForElement,
    addAnimation,
  ]);

  const storedAnimations = getAnimationsForElement(compositionId, elementType);
  const storedHoverAnimation = storedAnimations.find(
    (a) => a.triggerType === "hover",
  );
  const storedClickAnimation = storedAnimations.find(
    (a) => a.triggerType === "click",
  );

  // Progress supports both animate-in and animate-out transitions.
  const hoverAnimProgress = storedHoverAnimation
    ? (() => {
        if (hoverState.isHovering) {
          // Animate IN: 0 → 1
          const linearProgress = Math.min(
            1,
            hoverElapsedFrames / storedHoverAnimation.duration,
          );
          const easingFn = getEasingFunction(
            (storedHoverAnimation.easing as EasingKey) || "linear",
          );
          const progress = easingFn(linearProgress);

          // Track the maximum progress reached (for animate-out)
          hoverMaxProgressRef.current = Math.max(
            hoverMaxProgressRef.current,
            progress,
          );

          // CRITICAL: Don't reset refs when animate-in completes!
          // Element should stay at full hover progress while hovering
          // Refs only get reset when animate-OUT completes (see below)
          return progress;
        } else if (hoverEndFrameRef.current !== null) {
          // Animate OUT: Start from max progress reached → 0
          const maxProgress = hoverMaxProgressRef.current;
          const linearProgress = Math.min(
            1,
            hoverEndElapsedFrames / storedHoverAnimation.duration,
          );
          const easingFn = getEasingFunction(
            (storedHoverAnimation.easing as EasingKey) || "linear",
          );
          const reverseProgress = maxProgress * (1 - easingFn(linearProgress)); // Scale by max progress

          // When animate-OUT completes, reset tracking
          if (linearProgress >= 1) {
            hoverStartFrameRef.current = null;
            hoverEndFrameRef.current = null;
            hoverMaxProgressRef.current = 0;
          }

          return Math.max(0, reverseProgress);
        }
        return 0;
      })()
    : 0;

  const clickAnimProgress = storedClickAnimation
    ? (() => {
        if (hoverState.isClicking) {
          // Animate IN: 0 → 1
          const linearProgress = Math.min(
            1,
            clickElapsedFrames / storedClickAnimation.duration,
          );
          const easingFn = getEasingFunction(
            (storedClickAnimation.easing as EasingKey) || "linear",
          );
          const progress = easingFn(linearProgress);

          // Track the maximum progress reached (for animate-out)
          clickMaxProgressRef.current = Math.max(
            clickMaxProgressRef.current,
            progress,
          );

          // CRITICAL: Don't reset refs when animate-in completes!
          // Element should stay at full click progress while clicking
          // Refs only get reset when animate-OUT completes (see below)
          return progress;
        } else if (clickEndFrameRef.current !== null) {
          // Animate OUT: Start from max progress reached → 0
          const maxProgress = clickMaxProgressRef.current;
          const linearProgress = Math.min(
            1,
            clickEndElapsedFrames / storedClickAnimation.duration,
          );
          const easingFn = getEasingFunction(
            (storedClickAnimation.easing as EasingKey) || "linear",
          );
          const reverseProgress = maxProgress * (1 - easingFn(linearProgress));

          // When animate-OUT completes, reset tracking
          if (linearProgress >= 1) {
            clickStartFrameRef.current = null;
            clickEndFrameRef.current = null;
            clickMaxProgressRef.current = 0;
          }

          return Math.max(0, reverseProgress);
        }
        return 0;
      })()
    : 0;

  const animatedProperties = useMemo(() => {
    const result: Record<string, number | string> = {};

    // Apply hover animations when hover progress > 0 (includes animate-out!)
    // NOTE: We apply hover even during click so properties without click animations stay hovered
    if (hoverAnimProgress > 0) {
      const hoverAnims = storedAnimations.filter(
        (a) => a.triggerType === "hover",
      );
      hoverAnims.forEach((animation) => {
        animation.properties.forEach((prop) => {
          const value = getAnimationValue(prop, hoverAnimProgress);
          result[prop.property] = value;
        });
      });
    }

    // Apply click animations when click progress > 0 (includes animate-out!)
    if (clickAnimProgress > 0) {
      const clickAnims = storedAnimations.filter(
        (a) => a.triggerType === "click",
      );
      clickAnims.forEach((animation) => {
        animation.properties.forEach((prop) => {
          const hoverValue = result[prop.property]; // Current hover value (computed above)
          const peakClickValue = getAnimationValue(prop, 1); // Full click target at progress=1

          if (
            hoverState.isHovering &&
            hoverValue !== undefined &&
            typeof hoverValue === "number" &&
            typeof peakClickValue === "number"
          ) {
            // HOVER → CLICK → HOVER (user's mental model):
            // Blend click RELATIVE to hover value, not static value.
            // This ensures click animate-out goes back to HOVER (not static).
            // Formula: hover + (clickPeak - hover) * clickProgress
            // - At clickProgress=1: = clickPeak ✓
            // - At clickProgress=0: = hoverValue ✓ (returns to hover!)
            result[prop.property] =
              hoverValue + (peakClickValue - hoverValue) * clickAnimProgress;
          } else {
            // No hover active or non-numeric: use standard click animation
            result[prop.property] = getAnimationValue(prop, clickAnimProgress);
          }
        });
      });
    }

    return result;
  }, [
    storedAnimations,
    hoverAnimProgress,
    clickAnimProgress,
    hoverState.isClicking,
    hoverState.isHovering,
    frame,
  ]);

  // Step 5.5: Combined animated targets (for AnimatedElement's allKeys iteration)
  // NOTE: The actual blending is done by hoverTargets/clickTargets below.
  // This just ensures all animated property keys are iterated in AnimatedElement.
  const animatedTargets = useMemo(() => {
    const result: Record<string, number | string> = {};
    // Include all hover and click targets so AnimatedElement iterates them
    storedAnimations.forEach((animation) => {
      animation.properties.forEach((prop) => {
        if (prop.to !== undefined) result[prop.property] = prop.to;
      });
    });
    return result;
  }, [storedAnimations]);

  // TWO-TRACK SYSTEM: Compute hover and click targets separately
  // This allows AnimatedElement to blend hover → click smoothly
  const hoverTargets = useMemo(() => {
    const result: Record<string, number | string> = {};
    const hoverAnims = storedAnimations.filter(
      (a) => a.triggerType === "hover",
    );

    hoverAnims.forEach((animation) => {
      animation.properties.forEach((prop) => {
        if (prop.keyframes && prop.keyframes.length > 0) {
          // Use last keyframe value
          const lastKeyframe = prop.keyframes[prop.keyframes.length - 1];
          result[prop.property] = lastKeyframe.value;
        } else if (prop.to !== undefined) {
          // Fallback: use the 'to' value when no keyframes
          result[prop.property] = prop.to;
        }
      });
    });

    return result;
  }, [storedAnimations]);

  const clickTargets = useMemo(() => {
    const result: Record<string, number | string> = {};
    const clickAnims = storedAnimations.filter(
      (a) => a.triggerType === "click",
    );

    clickAnims.forEach((animation) => {
      animation.properties.forEach((prop) => {
        if (prop.keyframes && prop.keyframes.length > 0) {
          // Use last keyframe value
          const lastKeyframe = prop.keyframes[prop.keyframes.length - 1];
          result[prop.property] = lastKeyframe.value;
        } else if (prop.to !== undefined) {
          // Fallback: use the 'to' value when no keyframes
          result[prop.property] = prop.to;
        }
      });
    });

    return result;
  }, [storedAnimations]);

  // Return convenient state object with duration-based progress values
  return {
    id,
    hover: {
      isHovering: hoverState.isHovering,
      progress: hoverAnimProgress,
    },
    click: {
      isClicking: hoverState.isClicking,
      progress: clickAnimProgress,
    },
    combinedProgress: Math.max(hoverAnimProgress, clickAnimProgress),
    cursorType: resolvedCursorType,
    cursorX: hoverState.cursorX,
    cursorY: hoverState.cursorY,
    zone,
    animatedProperties,
    animatedTargets,
    hoverTargets, // Separate hover targets for two-track color system
    clickTargets, // Separate click targets for two-track color system
  };
}

export function useInteractiveComponents(
  components: UseInteractiveComponentOptions[],
): Record<string, InteractiveComponentState> {
  const result: Record<string, InteractiveComponentState> = {};

  components.forEach((config) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    result[config.id] = useInteractiveComponent(config);
  });

  return result;
}

// Click animations blend from the current hover value; their `from` values are
// retained only for schema consistency.
export const AnimationPresets = {
  /** Scale up on hover */
  scaleHover: (amount = 0.15): AnimationShorthand => ({
    duration: 6,
    easing: "expo.out",
    properties: [{ property: "scale", from: 1, to: 1 + amount, unit: "" }],
  }),

  /** Lift up on hover */
  liftHover: (distance = 20): AnimationShorthand => ({
    duration: 9,
    easing: "expo.out",
    properties: [
      { property: "translateY", from: 0, to: -distance, unit: "px" },
      { property: "shadowBlur", from: 20, to: 40, unit: "px" },
    ],
  }),

  /** Glow effect on hover */
  glowHover: (intensity = 40): AnimationShorthand => ({
    duration: 8,
    easing: "expo.out",
    properties: [
      { property: "shadowBlur", from: 0, to: intensity, unit: "px" },
    ],
  }),

  /** Color shift on hover */
  colorHover: (fromColor: string, toColor: string): AnimationShorthand => ({
    duration: 9,
    easing: "expo.out",
    properties: [
      { property: "backgroundColor", from: fromColor, to: toColor, unit: "" },
    ],
  }),

  /** Scale down on click; returns to hover scale, not default scale. */
  pressClick: (amount = 0.95): AnimationShorthand => ({
    duration: 12,
    easing: "expo.out",
    properties: [
      { property: "scale", from: 1, to: amount, unit: "" },
      { property: "brightness", from: 1, to: 1.2, unit: "" },
    ],
  }),

  /** Blur on click */
  blurClick: (amount = 8): AnimationShorthand => ({
    duration: 9,
    easing: "expo.out",
    properties: [{ property: "blur", from: 0, to: amount, unit: "px" }],
  }),

  /** 3D rotate on click */
  rotateClick: (degrees = 360): AnimationShorthand => ({
    duration: 18,
    easing: "back.out",
    properties: [{ property: "rotateY", from: 0, to: degrees, unit: "deg" }],
  }),
};
/**
 * Aggregate cursor type from multiple interactive components
 *
 * Automatically determines which cursor type to show based on hover states.
 * Pass the result to CameraHost's `autoCursorType` prop.
 *
 * @param components - Array of interactive component states
 * @returns The active cursor type, or undefined if no elements are hovered
 *
 * @example
 * ```tsx
 * const card1 = useInteractiveComponent({ ...config1 });
 * const card2 = useInteractiveComponent({ ...config2 });
 * const autoCursorType = useInteractiveComponentsCursor([card1, card2]);
 *
 * <CameraHost tracks={tracks} autoCursorType={autoCursorType}>
 *   {content}
 * </CameraHost>
 * ```
 */
export function useInteractiveComponentsCursor(
  components: InteractiveComponentState[],
): "default" | "pointer" | "text" | undefined {
  // Convert to format useCursorTypeFromHover expects
  const hoverResults = components.map((comp) => ({
    isHovering: comp.hover.isHovering,
    hoverProgress: comp.hover.progress,
    isClicking: comp.click.isClicking,
    clickProgress: comp.click.progress,
    cursorX: comp.cursorX,
    cursorY: comp.cursorY,
    // Only set cursor type if element is actually being hovered
    desiredCursorType: comp.hover.isHovering
      ? (comp.cursorType as "default" | "pointer" | "text" | undefined)
      : undefined,
  }));

  return useCursorTypeFromHover(hoverResults);
}
