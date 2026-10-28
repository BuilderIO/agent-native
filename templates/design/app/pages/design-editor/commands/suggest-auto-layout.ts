import type { CodeLayerNode } from "@shared/code-layer";
import { buildCodeLayerProjection } from "@shared/code-layer";
import { sourceContentHash } from "@shared/source-workspace";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import { trace } from "@/components/design/design-trace";
import type { AutoLayoutSuggestion } from "@/pages/design-editor/auto-layout-suggestion";
import { inferAutoLayoutSuggestion } from "@/pages/design-editor/auto-layout-suggestion";
import type { RuntimeLayerSnapshot } from "@/pages/design-editor/command-types";
import type { FrameMeasurement } from "@/pages/design-editor/measure-child-rects";
import type { DesignFile } from "@/pages/design-editor/types";

export interface SuggestAutoLayoutArgs {
  activeCanvasSourceType: "inline" | "localhost" | "fusion";
  activeFile: DesignFile;
  canEditDesign: boolean;
  designSourceType: "inline" | "localhost" | "fusion";
  getActiveFileSelectedNodeIds: (content: string) => string[];
  getFreshActiveContent: () => string;
  measureLayoutFrame: (node: CodeLayerNode) => FrameMeasurement;
  runtimeLayerSnapshotsById: Record<string, RuntimeLayerSnapshot>;
  setAutoLayoutSuggestionPreview: Dispatch<
    SetStateAction<{
      suggestion: AutoLayoutSuggestion;
      sourceType: "inline" | "localhost";
      contentHash: string;
      screenId: string;
    } | null>
  >;
  t: (key: string, options?: Record<string, unknown>) => string;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runSuggestAutoLayout({
  activeCanvasSourceType,
  activeFile,
  canEditDesign,
  designSourceType,
  getActiveFileSelectedNodeIds,
  getFreshActiveContent,
  measureLayoutFrame,
  runtimeLayerSnapshotsById,
  setAutoLayoutSuggestionPreview,
  t,
  viewModeRef,
}: SuggestAutoLayoutArgs) {
  if (!canEditDesign || !activeFile || viewModeRef.current !== "single") {
    return;
  }
  const resolvedSourceType = activeCanvasSourceType ?? designSourceType;
  if (resolvedSourceType !== "inline" && resolvedSourceType !== "localhost") {
    return;
  }
  const sourceType =
    resolvedSourceType === "localhost" ? "localhost" : "inline";
  const sourceContent =
    sourceType === "localhost"
      ? runtimeLayerSnapshotsById[activeFile.id]?.html
      : getFreshActiveContent();
  if (!sourceContent) {
    toast.error(t("designEditor.toasts.reactSourceAnchorsLoading"));
    return;
  }
  const projection = buildCodeLayerProjection(sourceContent, {
    source:
      sourceType === "localhost"
        ? { kind: "inline-html", fileId: activeFile.id }
        : { kind: "design-file", fileId: activeFile.id },
  });
  const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));
  const selectedIds = getActiveFileSelectedNodeIds(sourceContent);
  if (selectedIds.length !== 1) {
    toast(t("designEditor.autoLayoutSuggestion.selectContainer"));
    return;
  }
  const container = nodesById.get(selectedIds[0]!);
  if (!container || container.children.length === 0) {
    toast(t("designEditor.autoLayoutSuggestion.selectContainer"));
    return;
  }
  const measured = measureLayoutFrame(container);
  if (measured.status !== "measured" || measured.unidentifiedChildren > 0) {
    trace("structure", "suggest-auto-layout-refused", {
      nodeId: container.id,
      reason:
        measured.status === "measured"
          ? "unidentified-children"
          : measured.reason,
    });
    toast.error(t("designEditor.toasts.layoutUnmeasurable"));
    return;
  }
  // Children are measured from the container's padding box, so the padding
  // box is the container: its own position would skew every inset.
  const suggestion = inferAutoLayoutSuggestion({
    container: {
      id: container.id,
      x: 0,
      y: 0,
      width: measured.paddingBox.width,
      height: measured.paddingBox.height,
    },
    children: measured.children.map((child) => ({
      id: child.id,
      ...child.rect,
      transformed: child.transformed,
    })),
  });
  if (!suggestion) {
    toast(t("designEditor.autoLayoutSuggestion.selectContainer"));
    return;
  }
  setAutoLayoutSuggestionPreview({
    suggestion,
    sourceType,
    contentHash: sourceContentHash(sourceContent),
    screenId: activeFile.id,
  });
}
