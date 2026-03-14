import type { HoverAnimationResult } from "./useHoverAnimation";

/**
 * Aggregates multiple hover animation results and determines the active cursor type.
 * 
 * When multiple elements are hovered, the last one in the array takes priority.
 * This matches CSS z-index behavior where elements later in the DOM are "on top".
 * 
 * @param hoverResults - Array of hover animation results from useHoverAnimation/useHoverAnimationSmooth
 * @returns The cursor type to display, or undefined if no hover zones specify a type
 * 
 * @example
 * const button1Hover = useHoverAnimationSmooth(cursorTrack, { ...zone, cursorType: "pointer" });
 * const button2Hover = useHoverAnimationSmooth(cursorTrack, { ...zone, cursorType: "pointer" });
 * const autoCursorType = useCursorTypeFromHover([button1Hover, button2Hover]);
 * 
 * // Pass to Cursor component - it will use autoCursorType if provided
 * <Cursor ... autoType={autoCursorType} />
 */
export function useCursorTypeFromHover(
  hoverResults: HoverAnimationResult[]
): "default" | "pointer" | "text" | undefined {
  // Find the last hovered element with a cursor type preference
  // (iterating backwards gives priority to elements later in the array)
  for (let i = hoverResults.length - 1; i >= 0; i--) {
    const result = hoverResults[i];
    // Only return cursor type if element is actually being hovered
    if (result.isHovering && result.desiredCursorType) {
      return result.desiredCursorType;
    }
  }
  
  // No hover zones are active or none specify a cursor type
  return undefined;
}
