import type { CanvasFrameGeometryById } from "@shared/canvas-frames";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import {
  getDesignClipboardTrustToken,
  plainTextFromDesignHtml,
  writeDesignClipboard,
} from "@/lib/design-clipboard";
import type {
  DesignClipboardPayload,
  DesignClipboardScreenEntry,
} from "@/lib/design-import";
import { serializeDesignClipboardPayload } from "@/lib/design-import";
import { resolveClipboardLayerSourceHtml } from "@/pages/design-editor/clipboard-layer-source";
import { preserveClipboardLayerName } from "@/pages/design-editor/clone-and-pen-edit";
import type {
  CanvasLayerClipboardEntry,
  LiveScreenSnapshot,
  RuntimeLayerSnapshot,
  SelectedCanvasLayerSnapshot,
} from "@/pages/design-editor/command-types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { shouldUseRuntimeLayerProjection } from "@/pages/design-editor/pending-edits";
import type { DesignFile } from "@/pages/design-editor/types";

export interface CopySelectionArgs {
  canvasFrameGeometryById: CanvasFrameGeometryById;
  copiedLayerEntriesRef: RefObject<CanvasLayerClipboardEntry[]>;
  copiedLayerHtmlRef: RefObject<string | null>;
  copiedScreenEntriesRef: RefObject<DesignClipboardScreenEntry[] | undefined>;
  designSourceType: "inline" | "localhost" | "fusion";
  files: DesignFile[];
  getScreenContent: (screenId: string) => string;
  getSelectedLayerSnapshots: () => SelectedCanvasLayerSnapshot[];
  lastWrittenClipboardMarkerRef: RefObject<string | null>;
  lastWrittenClipboardPlainTextRef: RefObject<string | null>;
  liveScreenSnapshotsById: Record<string, LiveScreenSnapshot>;
  overviewScreens: OverviewScreen[];
  overviewSelectedScreenIds: string[];
  pasteCascadeRef: RefObject<number>;
  runtimeLayerSnapshotsById: Record<string, RuntimeLayerSnapshot>;
  setHasCanvasClipboard: Dispatch<SetStateAction<boolean>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  viewModeRef: RefObject<"single" | "overview">;
}

export async function runCopySelection({
  canvasFrameGeometryById,
  copiedLayerEntriesRef,
  copiedLayerHtmlRef,
  copiedScreenEntriesRef,
  designSourceType,
  files,
  getScreenContent,
  getSelectedLayerSnapshots,
  lastWrittenClipboardMarkerRef,
  lastWrittenClipboardPlainTextRef,
  liveScreenSnapshotsById,
  overviewScreens,
  overviewSelectedScreenIds,
  pasteCascadeRef,
  runtimeLayerSnapshotsById,
  setHasCanvasClipboard,
  t,
  viewModeRef,
}: CopySelectionArgs) {
  const snapshots = getSelectedLayerSnapshots();
  const entries = snapshots.map((snapshot) => ({
    html: preserveClipboardLayerName(snapshot.html, snapshot.node.layerName),
    rootNodeId: snapshot.rootNodeId,
    sourceParentNodeId: snapshot.sourceParentNodeId,
    sourceFileId: snapshot.sourceFileId,
    portableStyleSnapshot: snapshot.portableStyleSnapshot,
    styleSnapshotCaptureFailed: snapshot.styleSnapshotCaptureFailed,
    managedStyleSnapshot: snapshot.managedStyleSnapshot,
  }));
  const screens: DesignClipboardPayload["screens"] =
    entries.length === 0 && viewModeRef.current === "overview"
      ? overviewSelectedScreenIds
          .map((screenId): DesignClipboardScreenEntry | null => {
            const file = files.find((candidate) => candidate.id === screenId);
            const runtimeProjectionEligible =
              file &&
              shouldUseRuntimeLayerProjection({
                screen: overviewScreens.find(
                  (screen) => screen.id === screenId,
                ),
                fallbackSourceType: designSourceType,
                content: file.content ?? "",
              });
            const runtimeSnapshot = runtimeProjectionEligible
              ? runtimeLayerSnapshotsById[screenId]
              : undefined;
            const content = resolveClipboardLayerSourceHtml({
              runtimeProjectionEligible: Boolean(runtimeProjectionEligible),
              runtimeSnapshot,
              liveSnapshotHtml: liveScreenSnapshotsById[screenId]?.html,
              storedContent: getScreenContent(screenId) ?? file?.content,
            });
            if (!file || typeof content !== "string") return null;
            return {
              filename: file.filename,
              fileType: file.fileType,
              content,
              canvasFrame: canvasFrameGeometryById[screenId],
            };
          })
          .filter((entry): entry is DesignClipboardScreenEntry =>
            Boolean(entry),
          )
      : [];
  if (entries.length === 0 && screens.length === 0) return false;
  const copiedHtml =
    entries.length > 0
      ? entries.map((entry) => entry.html).join("\n")
      : screens.map((screen) => screen.content).join("\n");
  const plainText = plainTextFromDesignHtml(
    entries.length > 0
      ? entries.map((entry) => entry.html)
      : screens.map((screen) => screen.content),
  );
  const clipboardHtml = serializeDesignClipboardPayload(
    copiedHtml,
    {
      version: 1,
      entries,
      screens,
    },
    getDesignClipboardTrustToken() ?? undefined,
  );
  copiedLayerEntriesRef.current = entries;
  copiedScreenEntriesRef.current = screens;
  copiedLayerHtmlRef.current = clipboardHtml;
  lastWrittenClipboardMarkerRef.current = clipboardHtml;
  lastWrittenClipboardPlainTextRef.current = plainText;
  pasteCascadeRef.current = 0;
  setHasCanvasClipboard(true);
  const writePromise = writeDesignClipboard({ plainText, html: clipboardHtml });
  try {
    await writePromise;
  } catch {
    toast.error(t("designEditor.toasts.clipboardBlocked"));
  }
  return true;
}
