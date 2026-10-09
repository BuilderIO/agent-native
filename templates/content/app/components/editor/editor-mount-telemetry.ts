import { callAction } from "@agent-native/core/client/hooks";
import type {
  EditorMountMode,
  EditorMountOutcome,
} from "@shared/editor-mount-outcomes";

type MountReport = {
  id: string;
  visitId: string;
  outcome: EditorMountOutcome;
  mode: EditorMountMode;
};

export function createEditorMountObserver(
  report: (event: MountReport) => unknown,
  createVisitId: () => string = () => crypto.randomUUID(),
) {
  const editors = new WeakSet<object>();
  let currentEditor: object | null = null;
  let visit: {
    id: string;
    documentId: string;
    routeKey: string;
    mode: EditorMountMode;
  } | null = null;
  const observe = (
    editor: object,
    documentId: string,
    routeKey: string,
    mode: EditorMountMode,
  ): string | null => {
    if (editors.has(editor)) return null;
    editors.add(editor);
    currentEditor = editor;
    let outcome: EditorMountOutcome;
    if (!visit) outcome = "initial";
    else if (visit.documentId !== documentId || visit.routeKey !== routeKey)
      outcome = "navigation";
    else outcome = visit.mode !== mode ? "mode_switch" : "remount";
    if (outcome === "initial" || outcome === "navigation") {
      visit = { id: createVisitId(), documentId, routeKey, mode };
    } else visit!.mode = mode;
    const event = { id: documentId, visitId: visit!.id, outcome, mode };
    try {
      setTimeout(() => {
        try {
          void Promise.resolve(report(event)).catch(() => {
            // coercion-ok: telemetry delivery never affects editor creation.
          });
        } catch {
          // coercion-ok: telemetry delivery never affects editor creation.
        }
      }, 0);
    } catch {
      // coercion-ok: scheduling telemetry never affects editor creation.
    }
    return visit!.id;
  };
  observe.contextChanged = (
    editor: object,
    documentId: string,
    routeKey: string,
    mode: EditorMountMode,
  ) => {
    if (currentEditor !== editor || !visit) return;
    if (visit.documentId !== documentId || visit.routeKey !== routeKey)
      visit = { id: createVisitId(), documentId, routeKey, mode };
    else visit.mode = mode;
  };
  return observe;
}

// The visit survives React/editor remounts, but is private to this browser tab.
export const observeEditorMount = createEditorMountObserver((event) =>
  callAction("record-editor-mount", event),
);
