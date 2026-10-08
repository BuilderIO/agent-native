import { useEffect, useRef } from "react";

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

/**
 * Resumes Suggesting mode after a reload that left this tab there, then
 * remembers each later switch.
 */
export function useRememberedEditorMode({
  documentId,
  isSuggesting,
  canResume,
  resume,
}: {
  documentId: string;
  isSuggesting: boolean;
  /** The state a user's own switch would start from. */
  canResume: boolean;
  resume: () => Promise<unknown>;
}) {
  // Until a resume settles, the stored mode must not be overwritten with Edit
  // mode, or a start that fails would stop the next reload from retrying.
  const restoreRef = useRef<"pending" | "resuming" | "done" | null>(null);
  useEffect(() => {
    restoreRef.current ??=
      readRememberedEditorMode(documentId) === "suggesting"
        ? "pending"
        : "done";
    if (restoreRef.current === "done") return;
    if (isSuggesting) {
      restoreRef.current = "done";
      return;
    }
    if (restoreRef.current !== "pending" || !canResume) return;
    restoreRef.current = "resuming";
    void resume().finally(() => {
      if (restoreRef.current === "resuming") restoreRef.current = "done";
    });
  }, [canResume, documentId, isSuggesting, resume]);
  useEffect(() => {
    if (restoreRef.current !== "done") return;
    rememberEditorMode(documentId, isSuggesting ? "suggesting" : "editing");
  }, [documentId, isSuggesting]);
}
