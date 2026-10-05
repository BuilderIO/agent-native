const PREFIX = "content-editor-mode-v1:";

export type RememberedEditorMode = "suggesting" | "editing" | "unavailable";

// Session storage is per tab and survives a reload, so a reload reopens the
// Page in the mode this tab left it in while other tabs keep their own.
export function readRememberedEditorMode(
  documentId: string,
): RememberedEditorMode {
  let stored: string | null;
  try {
    stored = window.sessionStorage.getItem(PREFIX + documentId);
  } catch (error) {
    console.warn("Could not read the Page's last editing mode", error);
    return "unavailable";
  }
  return stored === "suggesting" ? "suggesting" : "editing";
}

export function rememberEditorMode(
  documentId: string,
  mode: "suggesting" | "editing",
) {
  try {
    if (mode === "suggesting")
      window.sessionStorage.setItem(PREFIX + documentId, mode);
    else window.sessionStorage.removeItem(PREFIX + documentId);
  } catch (error) {
    console.warn("Could not remember the Page's editing mode", error);
  }
}
