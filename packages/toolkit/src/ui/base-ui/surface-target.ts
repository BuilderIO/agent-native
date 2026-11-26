const INTERACTIVE_SLOT =
  "input, button, a, select, textarea, label, summary, [tabindex], [contenteditable], [role=button]";

/** Return the part of a compound surface that owns its background interaction. */
export function surfaceTarget(
  surface: HTMLElement,
  target: EventTarget,
  additionalControl?: string,
) {
  const view = surface.ownerDocument.defaultView;
  if (!view || !(target instanceof view.Element) || !surface.contains(target))
    return null;
  const control = target.closest(
    additionalControl
      ? INTERACTIVE_SLOT + ", " + additionalControl
      : INTERACTIVE_SLOT,
  );
  return control && control !== surface && surface.contains(control)
    ? null
    : target;
}

export function activeElementInRoot(node: HTMLElement) {
  return (node.getRootNode() as Document | ShadowRoot).activeElement;
}
