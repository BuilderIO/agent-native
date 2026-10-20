// The editor bridges bundle this module into every screen, so it stays
// dependency-free.

export function isAutoLayoutDisplay(display: string | undefined): boolean {
  return (
    display === "flex" ||
    display === "inline-flex" ||
    display === "grid" ||
    display === "inline-grid"
  );
}

export interface MarginHandleContext {
  // Computed top, right, bottom, left in px, already rounded.
  margins: readonly number[];
  anyAuto: boolean;
  parentDisplay: string | undefined;
  position: string | undefined;
}

// A zero margin on a plain frame has nothing to edit, and four zero-length
// handles around it read as auto-layout chrome. Margin is offered where it
// already does something: an authored margin, or an in-flow item of a flex or
// grid parent, where it is how siblings are pushed apart.
export function marginHandlesApply(context: MarginHandleContext): boolean {
  if (context.anyAuto) return true;
  if (context.margins.some((margin) => margin !== 0)) return true;
  const inFlow =
    context.position !== "absolute" && context.position !== "fixed";
  return inFlow && isAutoLayoutDisplay(context.parentDisplay);
}
