import { createContext, useContext, useEffect } from "react";

import { holdPageDraftWriter } from "./page-draft-journal";

/**
 * Lets the mounted editor tell PageDraftRecovery which editor session is live.
 * A recovery draft written by that session belongs to the editor's own save
 * queue, so recovery must not replace the editor while it settles. Other tabs
 * learn the session is live through its writer lock.
 */
export const LiveEditorSessionContext = createContext<
  ((editorSessionId: string | null) => void) | null
>(null);

export function useRegisterLiveEditorSession(editorSessionId: string): void {
  const register = useContext(LiveEditorSessionContext);
  useEffect(() => {
    if (!register) return;
    register(editorSessionId);
    return () => register(null);
  }, [editorSessionId, register]);
  useEffect(() => holdPageDraftWriter(editorSessionId), [editorSessionId]);
}
