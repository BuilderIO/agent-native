import {
  tryCallActionKeepalive,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { WorkflowGraph } from "@/lib/workflow-editor";

import { DraftSync, draftIntent, type DraftWire } from "./workflow-drafts";
import { readActionFailure } from "./workflow-errors";
import { useWorkflowStrings } from "./workflow-strings";

interface WorkflowDraftInput {
  factoryId: string;
  workflowId: string;
  /** The graph on the canvas. */
  graph: WorkflowGraph;
  /** The saved version the graph is based on. */
  baseVersion: number;
  dirty: boolean;
  /** A save is running: its outcome decides what happens to the draft. */
  saving: boolean;
  /** The draft the editor opened from, or true when the server holds one that was not restored. */
  held?: DraftWire | true | undefined;
}

/**
 * Keeps a private server draft of the canvas's unsaved edits, so they are back
 * when the workflow is opened again, and clears it whenever the canvas returns
 * to the saved graph. Returns `clear`, for the edits being thrown away on purpose.
 */
export function useWorkflowDraft({
  factoryId,
  workflowId,
  graph,
  baseVersion,
  dirty,
  saving,
  held,
}: WorkflowDraftInput): { clear: () => void } {
  const ws = useWorkflowStrings();
  const wsRef = useRef(ws);
  wsRef.current = ws;

  const { mutateAsync: writeDraft } = useActionMutation(
    "save-factory-workflow-draft",
    { skipActionQueryInvalidation: true },
  );
  const { mutateAsync: discardDraft } = useActionMutation(
    "discard-factory-workflow-draft",
    { skipActionQueryInvalidation: true },
  );

  const [sync] = useState(
    () =>
      new DraftSync({
        write: (draft) => writeDraft({ factoryId, workflowId, ...draft }),
        discard: () => discardDraft({ factoryId, workflowId }),
        writeOnHide: (draft) => {
          const attempt = tryCallActionKeepalive(
            "save-factory-workflow-draft",
            { factoryId, workflowId, ...draft },
          );
          return attempt.accepted ? attempt.completion : null;
        },
        onWriteFailure: (error) =>
          toast.error(
            wsRef.current.draft.saveFailed(
              readActionFailure(error, wsRef.current.errors.unknown).message,
            ),
          ),
        onDiscardFailure: (error) =>
          toast.error(
            wsRef.current.draft.discardFailed(
              readActionFailure(error, wsRef.current.errors.unknown).message,
            ),
          ),
        held,
      }),
  );

  const intent = draftIntent({ dirty, saving });
  useEffect(() => {
    if (intent === "write") sync.schedule({ baseVersion, graph });
    else if (intent === "hold") sync.cancel();
    else sync.clear();
  }, [sync, intent, baseVersion, graph]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") sync.flushOnHide();
    };
    const onPageHide = () => sync.flushOnHide();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      sync.flush();
    };
  }, [sync]);

  return { clear: () => sync.clear() };
}
