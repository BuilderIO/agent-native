// One definition of "grows with its text", shared by the object layer
// (isFitTextObject) and the text session (ownsFlowSlot). They used to read
// height/bottom/position differently, so a box could be fit for one and
// pinned for the other.

function isExplicit(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== "" && trimmed !== "auto";
}

export function hasInlineHeight(element: HTMLElement): boolean {
  return isExplicit(element.style.getPropertyValue("height"));
}

/** `bottom` pins the lower edge; with `top` and an auto height it stretches the box. */
export function hasInlineBottom(element: HTMLElement): boolean {
  return isExplicit(element.style.getPropertyValue("bottom"));
}

/**
 * An absolute or fixed box with neither an inline height nor an inline
 * bottom grows with its text and takes no space in the flow.
 */
export function isFitFreeformFrame(element: HTMLElement): boolean {
  const { position } = window.getComputedStyle(element);
  return (
    (position === "absolute" || position === "fixed") &&
    !hasInlineHeight(element) &&
    !hasInlineBottom(element)
  );
}
