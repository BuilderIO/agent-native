export function isCanvasOverlayInteractionTarget(
  target: EventTarget | null,
): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("[data-review-popover],[data-review-click-plane]"))
  );
}
