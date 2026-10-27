import { callAction } from "@agent-native/core/client/hooks";
import type {
  EditorMergeOutcome,
  EditorMergePath,
} from "@shared/editor-merge-outcomes";

type MergeReport = {
  id: string;
  outcome: EditorMergeOutcome;
  path: EditorMergePath;
};

/**
 * Counts each merge of a newer saved body, in an open editor or in a save
 * rebased over it. It reports after the merge, off the merge's own task, and a
 * failed or slow report changes nothing.
 */
export function createEditorMergeReporter(
  report: (event: MergeReport) => unknown,
) {
  return (
    documentId: string,
    path: EditorMergePath,
    { setAside }: { setAside: number },
  ) => {
    const event: MergeReport = {
      id: documentId,
      outcome: setAside > 0 ? "set_aside" : "kept_all",
      path,
    };
    try {
      setTimeout(() => {
        try {
          void Promise.resolve(report(event)).catch(() => {
            // coercion-ok: telemetry delivery never affects the merge.
          });
        } catch {
          // coercion-ok: telemetry delivery never affects the merge.
        }
      }, 0);
    } catch {
      // coercion-ok: scheduling telemetry never affects the merge.
    }
  };
}

export const reportEditorMerge = createEditorMergeReporter((event) =>
  callAction("record-editor-merge", event),
);
