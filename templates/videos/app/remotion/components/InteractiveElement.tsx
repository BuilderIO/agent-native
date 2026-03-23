import React, { ReactNode } from "react";
import { useHoverAnimationSmooth } from "../hooks/useHoverAnimationSmooth";
import type { CursorFrame } from "../hooks/useCursorHistory";
import {
  getCursorTypeForElement,
  type InteractiveElementType,
} from "../utils/interactiveElements";

export interface InteractiveElementProps {
  /** Unique identifier for this element */
  id: string;

  /** Element type (determines default cursor type) */
  type: InteractiveElementType;

  /** Display label for debugging/properties panel */
  label: string;

  /** Cursor history from parent composition */
  cursorHistory: CursorFrame[];

  /** Element position and size */
  zone: {
    x: number;
    y: number;
    width: number;
    height: number;
    padding?: number;
  };

  /** Override cursor type (optional) */
  cursorType?: "default" | "pointer" | "text";

  /** Callback when hover state changes */
  onHoverChange?: (isHovering: boolean, progress: number) => void;

  /** Callback when click detected */
  onClick?: (frame: number) => void;

  /** Children can be a render function or elements */
  children:
    | ReactNode
    | ((state: {
        isHovering: boolean;
        hoverProgress: number;
        isClicking: boolean;
        clickProgress: number;
      }) => ReactNode);
}

/**
 * InteractiveElement - Wrapper component for making UI elements interactive
 *
 * Automatically handles:
 * - Cursor type changes on hover (pointer for buttons, text for inputs)
 * - Hover state detection with smooth transitions
 * - Click detection
 * - Hover/click callbacks
 *
 * @example
 * <InteractiveElement
 *   id="submit-btn"
 *   type="button"
 *   label="Submit Button"
 *   cursorHistory={cursorHistory}
 *   zone={{ x: 500, y: 600, width: 120, height: 40 }}
 * >
 *   {({ isHovering, isClicking }) => (
 *     <div style={{
 *       transform: `scale(${isClicking ? 0.95 : isHovering ? 1.05 : 1})`
 *     }}>
 *       Submit
 *     </div>
 *   )}
 * </InteractiveElement>
 */
export const InteractiveElement: React.FC<InteractiveElementProps> = ({
  id,
  type,
  label,
  cursorHistory,
  zone,
  cursorType,
  onHoverChange,
  onClick,
  children,
}) => {
  // Determine cursor type (custom or default for element type)
  const effectiveCursorType = cursorType ?? getCursorTypeForElement(type);

  // Set up hover detection (cursorType goes in zone object)
  const hover = useHoverAnimationSmooth(cursorHistory, {
    ...zone,
    cursorType: effectiveCursorType,
  });

  // Track hover state changes
  React.useEffect(() => {
    if (onHoverChange) {
      onHoverChange(hover.isHovering, hover.hoverProgress);
    }
  }, [hover.isHovering, hover.hoverProgress, onHoverChange]);

  // Track click events
  React.useEffect(() => {
    if (hover.isClicking && onClick) {
      // Find current frame from cursor history
      const currentFrame = cursorHistory[cursorHistory.length - 1];
      if (currentFrame) {
        onClick(0); // TODO: Pass actual frame number
      }
    }
  }, [hover.isClicking, onClick, cursorHistory]);

  // Render children with state
  const content =
    typeof children === "function"
      ? children({
          isHovering: hover.isHovering,
          hoverProgress: hover.hoverProgress,
          isClicking: hover.isClicking,
          clickProgress: hover.clickProgress,
        })
      : children;

  return <>{content}</>;
};

/**
 * Hook for using interactive element state without the wrapper component
 *
 * @example
 * const submitBtn = useInteractiveElement({
 *   id: "submit-btn",
 *   type: "button",
 *   cursorHistory,
 *   zone: { x: 500, y: 600, width: 120, height: 40 }
 * });
 *
 * // Use submitBtn.isHovering, submitBtn.cursorType, etc.
 */
export function useInteractiveElement(
  config: Omit<InteractiveElementProps, "children" | "label">,
) {
  const effectiveCursorType =
    config.cursorType ?? getCursorTypeForElement(config.type);

  const hover = useHoverAnimationSmooth(config.cursorHistory, {
    ...config.zone,
    cursorType: effectiveCursorType,
  });

  return {
    ...hover,
    cursorType: effectiveCursorType,
    id: config.id,
    type: config.type,
  };
}
