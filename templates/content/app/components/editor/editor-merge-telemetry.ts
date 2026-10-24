import { callAction } from "@agent-native/core/client/hooks";
import type { EditorMergeOutcome } from "@shared/editor-merge-outcomes";

type MergeReport = { id: string; outcome: EditorMergeOutcome };

/**
 * Counts each newer saved body an open editor merges. It reports after the
 * merge, off the merge's own task, and a failed or slow report changes nothing.
 */
export function createEditorMergeReporter(
  report: (event: MergeReport) => unknown,
) {
  return (documentId: string, { setAside }: { setAside: number }) => {
    const event: MergeReport = {
      id: documentId,
      outcome: setAside > 0 ? "set_aside" : "kept_all",
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
