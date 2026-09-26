
export type PillMode = "recording" | "confirm" | "done";

export type ToolbarEnabledEffect =
  | "adopt-new-session"
  /** No session owns the pill: snap the segments back to their rest state. */
  | "reset-to-rest"
  /** Leave the pill exactly as it is. */
  | "keep";

export function toolbarEnabledEffect(
  enabled: boolean,
  mode: PillMode,
): ToolbarEnabledEffect {
  if (enabled) {
    return mode === "done" ? "adopt-new-session" : "keep";
  }
  return mode === "done" ? "keep" : "reset-to-rest";
}
