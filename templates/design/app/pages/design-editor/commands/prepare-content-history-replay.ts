import { toast } from "sonner";

import { isShaderWriteInFlight } from "@/components/design/inspector/GlslShaderPanel";
import type { ContentHistoryChange } from "@/pages/design-editor/history";
import { designSaveErrorMessage } from "@/pages/design-editor/save-failure";
import { prepareAcceptedSourceContent } from "@/pages/design-editor/source-publication";
import type { DesignFile } from "@/pages/design-editor/types";

export interface PreparedContentHistoryReplay {
  historyBeforeContent: string;
}

export function prepareContentHistoryReplay(args: {
  activeFile?: DesignFile | null;
  changes: readonly ContentHistoryChange[];
  direction: "undo" | "redo";
  files: readonly DesignFile[];
  getFreshActiveContent: () => string;
  getScreenContent: (fileId: string) => string;
  liveScreenSnapshotsById: Record<string, unknown>;
  t: (key: string, options?: Record<string, unknown>) => string;
}): Map<string, PreparedContentHistoryReplay> | null {
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
    const nextContent =
      args.direction === "undo" ? change.before : change.after;
    try {
      prepareAcceptedSourceContent(nextContent, {
        fileId: change.fileId,
        fileType: (change.fileId === args.activeFile?.id
          ? args.activeFile
          : args.files.find((file) => file.id === change.fileId)
        )?.fileType,
        previousContent: historyBeforeContent,
      });
      preparedByFileId.set(change.fileId, { historyBeforeContent });
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
