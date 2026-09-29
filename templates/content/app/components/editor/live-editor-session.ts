import { createContext, useContext, useEffect } from "react";

/**
 * Lets the mounted editor tell PageDraftRecovery which editor session is live.
 * A recovery draft written by that session belongs to the editor's own save
 * queue, so recovery must not replace the editor while it settles.
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
}
