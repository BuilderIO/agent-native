import { useEffect, useRef } from "react";
import { useCurrentElement } from "@/contexts/CurrentElementContext";
import type { HoverAnimationResult } from "./useHoverAnimation";
import type { CurrentElement } from "@/contexts/CurrentElementContext";

/**
 * Hook to register an interactive element and update CurrentElementContext on hover.
 * This makes the element appear in the "Cursor Interactions" sidebar panel.
 *
 * @param elementInfo - Element identification info
 * @param hoverState - Hover animation result from useHoverAnimationSmooth
 *
 * @example
 * const btnHover = useHoverAnimationSmooth(cursorHistory, zone);
 * useRegisterInteractiveElement({
 *   id: "submit-btn",
 *   type: "Button",
 *   label: "Submit Button",
 *   compositionId: "my-comp"
 * }, btnHover);
 */
export function useRegisterInteractiveElement(
  elementInfo: CurrentElement,
  hoverState: HoverAnimationResult,
) {
  const { setCurrentElement, currentElement } = useCurrentElement();

  // Use ref to track previous hover state
  const prevHoveringRef = useRef(false);

  useEffect(() => {
    const isHovering = hoverState.isHovering;

    // Only act when hover state changes
    if (prevHoveringRef.current !== isHovering) {
      if (isHovering) {
        // When hovering, set this as the current element (if not already)
        if (currentElement?.id !== elementInfo.id) {
          setCurrentElement(elementInfo);
        }
      } else {
        // When not hovering, clear if we were the current element
        if (currentElement?.id === elementInfo.id) {
          setCurrentElement(null);
        }
      }

      prevHoveringRef.current = isHovering;
    }
    // Note: currentElement is intentionally NOT in deps to prevent infinite loops
    // We only care about hover state changes, not currentElement changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverState.isHovering, elementInfo, setCurrentElement]);
}
