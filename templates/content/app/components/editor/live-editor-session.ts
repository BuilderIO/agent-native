import { createContext, useContext, useEffect } from "react";

import type { FlushLocalSnapshot } from "./document-flush-participant";
import { holdPageDraftWriter } from "./page-draft-journal";

/**
 * The editor's own save state, read the way the agent's document flush reads
 * it: `drain` saves every edit it holds, and `snapshot` names its current edit
 * and whether that edit is saved.
 */
export interface LiveEditorFlush {
  snapshot(): FlushLocalSnapshot;
  drain(): Promise<void>;
}

export interface LiveEditor {
  editorSessionId: string;
  flush: LiveEditorFlush | null;
}

/**
 * Lets the mounted editor tell PageDraftRecovery which editor session is live.
 * A recovery draft written by that session belongs to the editor's own save
 * queue, so recovery must not replace the editor while it settles. Other tabs
 * learn the session is live through its writer lock.
 */
export const LiveEditorSessionContext = createContext<
  ((editor: LiveEditor | null) => void) | null
>(null);

export function useRegisterLiveEditorSession(
  editorSessionId: string,
  flush: LiveEditorFlush | null = null,
): void {
  const register = useContext(LiveEditorSessionContext);
  useEffect(() => {
    if (!register) return;
    register({ editorSessionId, flush });
    return () => register(null);
  }, [editorSessionId, flush, register]);
  useEffect(() => holdPageDraftWriter(editorSessionId), [editorSessionId]);
}
