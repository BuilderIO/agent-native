import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
} from "react";

type LiveEditorDraft = { title: string; content: string };
type RegisterLiveEditorSession = (
  editorSessionId: string,
  draft: LiveEditorDraft | null,
  active: boolean,
) => void;

/**
 * Lets the mounted editor tell PageDraftRecovery which editor session is live.
 * A recovery draft written by that session belongs to the editor's own save
 * queue, so recovery must not replace the editor while it settles.
 */
export const LiveEditorSessionContext =
  createContext<RegisterLiveEditorSession | null>(null);

export function useRegisterLiveEditorSession(editorSessionId: string) {
  const register = useContext(LiveEditorSessionContext);
  const active = useRef(false);
  const reportedDraft = useRef<LiveEditorDraft | null>(null);
  const hasReportedDraft = useRef(false);
  useLayoutEffect(() => {
    if (!register) return;
    active.current = true;
    register(
      editorSessionId,
      hasReportedDraft.current ? reportedDraft.current : null,
      true,
    );
    return () => {
      active.current = false;
      register(editorSessionId, null, false);
    };
  }, [editorSessionId, register]);

  return useCallback(
    (draft: LiveEditorDraft | null) => {
      if (!active.current) {
        reportedDraft.current = draft;
        hasReportedDraft.current = true;
        return;
      }
      register?.(editorSessionId, draft, true);
    },
    [editorSessionId, register],
  );
}
