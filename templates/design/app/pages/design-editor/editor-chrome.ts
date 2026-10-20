/**
 * Which shell the editor renders. An MCP App host (ChatGPT, Codex, Claude)
 * owns navigation and chat, not the editor, so a widget gets the visual-edit
 * shell's minimal-UI editor rather than a layout of its own.
 */
export function resolveEditorChrome({
  shellMode,
  embedded,
  embedChromeRequested,
  widgetEmbed,
}: {
  shellMode: boolean;
  embedded: boolean;
  embedChromeRequested: boolean;
  widgetEmbed: boolean;
}): {
  hostOwnsChrome: boolean;
  minimalUiByDefault: boolean;
  minimalUiLocked: boolean;
} {
  const hostOwnsChrome =
    embedded && !shellMode && !embedChromeRequested && !widgetEmbed;
  return {
    hostOwnsChrome,
    minimalUiByDefault:
      widgetEmbed || (embedded && !hostOwnsChrome && !embedChromeRequested),
    // The full layout brings back the app rail and its agent chat, which the
    // host owns.
    minimalUiLocked: widgetEmbed,
  };
}

/**
 * Minimal UI floats the inspector over the canvas at every width. Only the
 * docked rail falls back to the sheet on a phone.
 */
export function inspectorFitsViewport({
  minimalUi,
  isMobileViewport,
}: {
  minimalUi: boolean;
  isMobileViewport: boolean;
}): boolean {
  return minimalUi || !isMobileViewport;
}
