import { toast } from "sonner";

import { isShaderWriteInFlight } from "@/components/design/inspector/GlslShaderPanel";
import type { ContentHistoryChange } from "@/pages/design-editor/history";
import { designSaveErrorMessage } from "@/pages/design-editor/save-failure";
import { prepareAcceptedSourceContent } from "@/pages/design-editor/source-publication";
import { threeWayMergeContent } from "@/pages/design-editor/three-way-merge";
import type { DesignFile } from "@/pages/design-editor/types";

export interface PreparedContentHistoryReplay {
  historyBeforeContent: string;
  /** The content to write: the entry's target with later edits by others kept. */
  nextContent: string;
}

/**
 * Returned instead of a replay when a collaborator's later edit overlaps the
 * history entry, so replaying it would either clobber their work or guess.
 */
export const STALE_CONTENT_HISTORY_REPLAY = Symbol(
  "stale-content-history-replay",
);

export function prepareContentHistoryReplay(args: {
  activeFile?: DesignFile | null;
  changes: readonly ContentHistoryChange[];
  direction: "undo" | "redo";
  files: readonly DesignFile[];
  getFreshActiveContent: () => string;
  getScreenContent: (fileId: string) => string;
  liveScreenSnapshotsById: Record<string, unknown>;
  t: (key: string, options?: Record<string, unknown>) => string;
}):
  | Map<string, PreparedContentHistoryReplay>
  | typeof STALE_CONTENT_HISTORY_REPLAY
  | null {
  const preparedByFileId = new Map<string, PreparedContentHistoryReplay>();

  for (const change of args.changes) {
    if (
      change.before === change.after ||
      args.liveScreenSnapshotsById[change.fileId]
    ) {
      continue;
    }
    if (isShaderWriteInFlight(change.fileId)) {
      toast.error(args.t("designEditor.toasts.saveConflict"), {
        id: `design-source-shader-conflict:${change.fileId}`,
      });
      return null;
    }

    const historyBeforeContent =
      change.fileId === args.activeFile?.id
        ? args.getFreshActiveContent()
        : args.getScreenContent(change.fileId);
    const [recordedContent, targetContent] =
      args.direction === "undo"
        ? [change.after, change.before]
        : [change.before, change.after];
    // The entry holds whole-document snapshots, so replaying one verbatim would
    // also revert whatever a collaborator saved after it. Replay only this
    // user's edit on top of the content that is live now.
    const nextContent = threeWayMergeContent({
      base: recordedContent,
      mine: targetContent,
      theirs: historyBeforeContent,
    });
    if (nextContent === null) return STALE_CONTENT_HISTORY_REPLAY;
    try {
      prepareAcceptedSourceContent(nextContent, {
        fileId: change.fileId,
        fileType: (change.fileId === args.activeFile?.id
          ? args.activeFile
          : args.files.find((file) => file.id === change.fileId)
        )?.fileType,
        previousContent: historyBeforeContent,
      });
      preparedByFileId.set(change.fileId, {
        historyBeforeContent,
        nextContent,
      });
    } catch (error) {
      toast.error(
        designSaveErrorMessage(error) ?? args.t("common.genericError"),
        { id: `design-source-integrity:${change.fileId}` },
      );
      return null;
    }
  }

  return preparedByFileId;
}
