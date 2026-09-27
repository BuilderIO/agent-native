import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type {
  LiveFigmaSvgSnapshot,
  LiveFigmaSvgSource,
} from "@/lib/figma-svg-copy";
import {
  FigmaSvgCopyError,
  canCopyFigmaSvgToClipboard,
  copyDesignAsFigmaSvg,
} from "@/lib/figma-svg-copy";
import type { DesignFile } from "@/pages/design-editor/types";

export interface CopyAsFigmaSvgArgs {
  activeFile: DesignFile;
  figmaSvgExportingRef: RefObject<boolean>;
  id: string | undefined;
  resolveLiveFigmaSvgSnapshot: (
    targetFileId: string | undefined,
  ) => LiveFigmaSvgSnapshot | null;
  resolveLiveFigmaSvgSource: (
    targetFileId: string | undefined,
  ) => LiveFigmaSvgSource | null;
  selectedElementLayerId: string | null;
  selectedScreenIds: string[];
  setFigmaSvgExporting: Dispatch<SetStateAction<boolean>>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export async function runCopyAsFigmaSvg({
  activeFile,
  figmaSvgExportingRef,
  id,
  resolveLiveFigmaSvgSnapshot,
  resolveLiveFigmaSvgSource,
  selectedElementLayerId,
  selectedScreenIds,
  setFigmaSvgExporting,
  t,
}: CopyAsFigmaSvgArgs) {
  if (figmaSvgExportingRef.current) return;
  if (!canCopyFigmaSvgToClipboard()) {
    toast.error(t("designEditor.toasts.figmaSvgUnsupported"));
    return;
  }

  figmaSvgExportingRef.current = true;
  setFigmaSvgExporting(true);
  try {
    const targetFileId = activeFile?.id ?? selectedScreenIds[0] ?? undefined;
    await copyDesignAsFigmaSvg(
      {
        designId: id,
        fileId: targetFileId,
        nodeId: selectedElementLayerId ?? undefined,
      },
      {
        liveSource: resolveLiveFigmaSvgSource(targetFileId),
        liveSnapshot: resolveLiveFigmaSvgSnapshot(targetFileId),
      },
    );
    toast.success(t("designEditor.toasts.figmaSvgCopied"));
  } catch (error) {
    if (error instanceof FigmaSvgCopyError) {
      const key =
        error.code === "blocked"
          ? "designEditor.toasts.figmaSvgBlocked"
          : error.code === "unsupported"
            ? "designEditor.toasts.figmaSvgUnsupported"
            : error.code === "render-failed"
              ? "designEditor.toasts.figmaSvgRenderError"
              : "designEditor.toasts.figmaSvgWriteError";
      toast.error(t(key));
    } else {
      toast.error(
        error instanceof Error
          ? error.message
          : t("designEditor.toasts.figmaSvgExportError"),
      );
    }
  } finally {
    figmaSvgExportingRef.current = false;
    setFigmaSvgExporting(false);
  }
}
