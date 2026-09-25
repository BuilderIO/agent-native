export type SlideEscapeAction =
  | "edit"
  | "gesture"
  | "mode"
  | "multi-selection"
  | "single-selection"
  | "canvas"
  | "none";

export function decideSlideEscape({
  editing,
  activeGesture,
  activeMode,
  multiSelection,
  singleSelection,
  targetOwnsEscape,
  overlayOwnsEscape,
}: {
  editing: boolean;
  activeGesture: boolean;
  activeMode: boolean;
  multiSelection: boolean;
  singleSelection: boolean;
  targetOwnsEscape: boolean;
  overlayOwnsEscape: boolean;
}): SlideEscapeAction {
  if (targetOwnsEscape || overlayOwnsEscape) return "none";
  if (editing) return "edit";
  if (activeGesture) return "gesture";
  if (activeMode) return "mode";
  if (multiSelection) return "multi-selection";
  if (singleSelection) return "single-selection";
  return "canvas";
}
