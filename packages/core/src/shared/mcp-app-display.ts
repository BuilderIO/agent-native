/**
 * True when the MCP App host owns the frame's height (a side panel, fullscreen
 * view, or a container with a fixed `containerDimensions.height`), so the app
 * should fill 100% of the frame. False for inline cards, whose height follows
 * the content the app reports; filling there would feed the frame's own height
 * back into it and grow without bound.
 *
 * The widget shell embeds a copy of this function in its HTML because that
 * document cannot import modules. `embed-app.spec.ts` runs both over the same
 * table so they cannot drift.
 */
export function mcpAppHostFillsContainer(context: unknown): boolean {
  const record =
    context && typeof context === "object"
      ? (context as Record<string, unknown>)
      : {};
  const dimensions =
    record.containerDimensions && typeof record.containerDimensions === "object"
      ? (record.containerDimensions as Record<string, unknown>)
      : {};
  const fixedHeight = dimensions.height;
  if (
    typeof fixedHeight === "number" &&
    Number.isFinite(fixedHeight) &&
    fixedHeight > 0
  ) {
    return true;
  }
  return record.displayMode === "fullscreen" || record.displayMode === "pip";
}

/** Set on the app document's `<html>` while the host fills the frame. */
export const MCP_APP_HOST_FILL_ATTRIBUTE = "data-agent-native-host-fill";
