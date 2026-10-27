export const INTERACT_ZOOM_FIT = "fit" as const;

/** The percentages the Interact zoom control offers besides Fit. */
export const INTERACT_ZOOM_STEPS = [50, 75, 100, 125, 150, 200] as const;

export type InteractZoomStep = (typeof INTERACT_ZOOM_STEPS)[number];
export type InteractZoomChoice = typeof INTERACT_ZOOM_FIT | InteractZoomStep;

export function isInteractZoomChoice(
  value: unknown,
): value is InteractZoomChoice {
  return (
    value === INTERACT_ZOOM_FIT ||
    INTERACT_ZOOM_STEPS.some((step) => step === value)
  );
}

/** The scale Interact renders at: the fit zoom for Fit, else the chosen step. */
export function resolveInteractZoom(
  choice: InteractZoomChoice,
  fitZoom: number,
): number {
  return choice === INTERACT_ZOOM_FIT ? fitZoom : choice;
}

export function formatInteractZoomLabel(zoom: number): string {
  return `${Number.isFinite(zoom) ? Math.round(zoom) : 100}%`;
}
