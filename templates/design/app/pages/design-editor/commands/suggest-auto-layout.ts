import type { CodeLayerNode } from "@shared/code-layer";
import { buildCodeLayerProjection } from "@shared/code-layer";
import { sourceContentHash } from "@shared/source-workspace";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { AutoLayoutSuggestion } from "@/pages/design-editor/auto-layout-suggestion";
import {
  hasMeaningfulCssTransform,
  inferAutoLayoutSuggestion,
} from "@/pages/design-editor/auto-layout-suggestion";
import type { RuntimeLayerSnapshot } from "@/pages/design-editor/command-types";
import type { AlignableRect } from "@/pages/design-editor/layout-operations";
import type { DesignFile } from "@/pages/design-editor/types";

export interface SuggestAutoLayoutArgs {
  activeCanvasSourceType: "inline" | "localhost" | "fusion";
  activeFile: DesignFile;
  canEditDesign: boolean;
  designSourceType: "inline" | "localhost" | "fusion";
  getActiveFileSelectedNodeIds: (content: string) => string[];
  getFreshActiveContent: () => string;
  liveComputedLayoutForNode: (nodeId: string) => {
    display: string;
    transform: string;
    rotate: string;
    scale: string;
  } | null;
  rectFromCodeLayerNode: (node: CodeLayerNode) => AlignableRect;
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
  liveComputedLayoutForNode,
  rectFromCodeLayerNode,
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
  const projection = buildCodeLayerProjection(sourceContent);
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
  const containerMeasured = rectFromCodeLayerNode(container);
  const children = container.children
    .map((childId) => nodesById.get(childId))
    .filter((child): child is CodeLayerNode => Boolean(child))
    .map((child) => {
      const computed = liveComputedLayoutForNode(child.id);
      return {
        ...rectFromCodeLayerNode(child),
        transformed: hasMeaningfulCssTransform({
          transform: computed?.transform ?? child.style.transform,
          rotate: computed?.rotate ?? child.style.rotate,
          scale: computed?.scale ?? child.style.scale,
          classes: child.classes,
        }),
      };
    });
  const suggestion = inferAutoLayoutSuggestion({
    // Child measurements are parent-relative, so the container's own local
    // content box begins at 0,0 even when the container is positioned in its
    // parent. This prevents outer-canvas placement from becoming padding.
    container: {
      id: container.id,
      x: 0,
      y: 0,
      width: containerMeasured.width,
      height: containerMeasured.height,
    },
    children,
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
