import { getFrameGroupBounds } from "@shared/canvas-math";
import type {
  CodeLayerNode,
  CodeLayerTreeNode,
  WrapNodeSizeHint,
} from "@shared/code-layer";
import { applyVisualEdit, buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import { trace } from "@/components/design/design-trace";
import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import type { EffectiveCodeLayerState } from "@/pages/design-editor/code-layer-state";
import {
  codeLayerPatchMessage,
  elementInfoFromCodeLayerNode,
} from "@/pages/design-editor/code-layer-state";
import type { RuntimeLayerSnapshot } from "@/pages/design-editor/command-types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import type { AlignableRect } from "@/pages/design-editor/layout-operations";
import {
  authoredPxLength,
  inferAutoLayoutFromChildren,
} from "@/pages/design-editor/layout-operations";
import { resolveOverviewScreenSourceType } from "@/pages/design-editor/pending-edits";
import {
  enableInlineScreenAutoLayout,
  getRuntimeScreenAutoLayoutSubjectIds,
} from "@/pages/design-editor/screen-auto-layout";
import { overviewSelectionTargetsElement } from "@/pages/design-editor/selection-state";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";
import type { ApplyLocalContentUpdateResult } from "./apply-local-content-update";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "./selection-publication";

export interface AddAutoLayoutArgs {
  activeFile: DesignFile;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => ApplyFileContentUpdateResult;
  applyLocalContentUpdate: (
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      immediateSave?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      historyBeforeContent?: string;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => ApplyLocalContentUpdateResult;
  canEditDesign: boolean;
  codeLayerOwnerByNodeIdRef: RefObject<
    Map<
      string,
      {
        fileId: string;
        node: CodeLayerNode;
        tree: CodeLayerTreeNode[];
        runtimeOnly: boolean;
      }
    >
  >;
  designSourceType: "inline" | "localhost" | "fusion";
  effectiveCodeLayerStateRef: RefObject<EffectiveCodeLayerState>;
  files: DesignFile[];
  getActiveFileSelectedNodeIds: (content: string) => string[];
  getFreshActiveContent: () => string;
  getScreenContent: (screenId: string) => string;
  overviewScreens: OverviewScreen[];
  overviewSelectedScreenIds: string[];
  rectFromCodeLayerNode: (node: CodeLayerNode) => AlignableRect;
  runtimeLayerSnapshotsById: Record<string, RuntimeLayerSnapshot>;
  selectedElement: ElementInfo | null;
  selectedLayerIdsState: string[];
  sendRuntimeLayerSemanticHandoff: (
    operation: "group" | "ungroup" | "auto-layout",
    layerIds: readonly string[],
    options?: {
      desiredChange?: string;
      description?: string;
      commandContext?: string;
    },
  ) => boolean;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runAddAutoLayout({
  activeFile,
  applyFileContentUpdate,
  applyLocalContentUpdate,
  canEditDesign,
  codeLayerOwnerByNodeIdRef,
  designSourceType,
  effectiveCodeLayerStateRef,
  files,
  getActiveFileSelectedNodeIds,
  getFreshActiveContent,
  getScreenContent,
  overviewScreens,
  overviewSelectedScreenIds,
  rectFromCodeLayerNode,
  runtimeLayerSnapshotsById,
  selectedElement,
  selectedLayerIdsState,
  sendRuntimeLayerSemanticHandoff,
  setSelectedElement,
  setSelectedLayerIdsState,
  t,
  viewModeRef,
}: AddAutoLayoutArgs) {
  trace("structure", "add-auto-layout", {
    layers: selectedLayerIdsState.length,
    view: viewModeRef.current,
  });
  if (!canEditDesign) return;

  if (
    viewModeRef.current === "overview" &&
    !overviewSelectionTargetsElement({
      selectedElement,
      selectedLayerIds: selectedLayerIdsState,
      fileIds: files.map((file) => file.id),
    })
  ) {
    if (overviewSelectedScreenIds.length === 0) return;
    if (overviewSelectedScreenIds.length !== 1 || selectedElement !== null) {
      toast(t("designEditor.toasts.autoLayoutScreensUnsupported"));
      return;
    }
    const screenId = overviewSelectedScreenIds[0]!;
    if (
      effectiveCodeLayerStateRef.current.lockedIds.has(screenId) ||
      effectiveCodeLayerStateRef.current.hiddenIds.has(screenId)
    ) {
      return;
    }
    const screen = overviewScreens.find(
      (candidate) => candidate.id === screenId,
    );
    if (!screen) return;
    const screenSourceType = resolveOverviewScreenSourceType(
      screen,
      designSourceType,
    );

    if (screenSourceType === "localhost") {
      const snapshot = runtimeLayerSnapshotsById[screenId];
      if (!snapshot) {
        toast.error(t("designEditor.toasts.reactSourceAnchorsLoading"));
        return;
      }
      const runtimeSubjectIds = getRuntimeScreenAutoLayoutSubjectIds(
        buildCodeLayerProjection(snapshot.html, {
          source: { kind: "inline-html", fileId: screenId },
        }),
      );
      if (runtimeSubjectIds.length === 0) {
        toast.error(t("designEditor.toasts.reactSourceAnchorsLoading"));
        return;
      }
      sendRuntimeLayerSemanticHandoff("auto-layout", runtimeSubjectIds, {
        desiredChange:
          runtimeSubjectIds.length > 1
            ? "Wrap the selected screen's top-level React roots in one inferred auto-layout container while preserving their visual order and all unrelated behavior."
            : "Enable inferred auto layout on the selected screen's editable React root container while preserving its children and all unrelated behavior.",
        description: `enable auto layout on the editable root of screen ${screenId}`,
        commandContext:
          "Apply this selected-screen auto-layout command to the connected React source.",
      });
      return;
    }

    if (screenSourceType === "inline") {
      const baseContent = getScreenContent(screenId);
      if (!baseContent) return;
      const result = enableInlineScreenAutoLayout({
        content: baseContent,
        width: screen.width,
        height: screen.height,
        source: { kind: "design-file", fileId: screenId },
      });
      if (result.status === "unsupported") {
        toast(t("designEditor.toasts.autoLayoutScreensUnsupported"));
        return;
      }
      if (result.status === "failed") {
        toast.error(
          codeLayerPatchMessage(
            result.message,
            t("designEditor.toasts.layerMoveFailed"),
          ),
          { duration: 4000 },
        );
        return;
      }
      if (result.status === "applied") {
        applyFileContentUpdate(screenId, result.content, {
          forcePreviewFullDocument: true,
        });
      }
      return;
    }

    toast(t("designEditor.toasts.autoLayoutScreensUnsupported"));
    return;
  }

  if (!activeFile) return;
  const selectedRuntimeLayerIds = selectedLayerIdsState.filter(
    (layerId) => codeLayerOwnerByNodeIdRef.current.get(layerId)?.runtimeOnly,
  );
  if (selectedRuntimeLayerIds.length > 0) {
    sendRuntimeLayerSemanticHandoff("auto-layout", selectedRuntimeLayerIds);
    return;
  }
  const baseContent = getFreshActiveContent();
  const source = { kind: "design-file" as const, fileId: activeFile.id };
  const nodeIds = getActiveFileSelectedNodeIds(baseContent);
  if (nodeIds.length === 0) return;
  const projection = buildCodeLayerProjection(baseContent, { source });
  const nodesById = new Map(projection.nodes.map((node) => [node.id, node]));

  if (nodeIds.length >= 2) {
    const selectedNodes = nodeIds
      .map((nodeId) => nodesById.get(nodeId))
      .filter((node): node is CodeLayerNode => Boolean(node));
    if (selectedNodes.length < 2) return;
    const selectedRects = selectedNodes.map(rectFromCodeLayerNode);
    const sizeHints: Record<string, WrapNodeSizeHint> = {};
    for (const [index, node] of selectedNodes.entries()) {
      const rect = selectedRects[index];
      if (
        !rect ||
        ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
      ) {
        continue;
      }
      const hint: WrapNodeSizeHint = {
        width: rect.width,
        height: rect.height,
      };
      if (authoredPxLength(node.style.left) === null) hint.left = rect.x;
      if (authoredPxLength(node.style.top) === null) hint.top = rect.y;
      if (Object.keys(hint).length > 0) sizeHints[node.id] = hint;
    }
    const bounds = getFrameGroupBounds(selectedRects);
    const inferred = inferAutoLayoutFromChildren(
      bounds
        ? {
            x: bounds.left,
            y: bounds.top,
            width: bounds.width,
            height: bounds.height,
          }
        : { x: 0, y: 0, width: 0, height: 0 },
      selectedRects,
    );
    const patch = applyVisualEdit(
      baseContent,
      {
        kind: "wrapNodes",
        targetIds: nodeIds,
        autoLayout: true,
        sizeHints: Object.keys(sizeHints).length > 0 ? sizeHints : undefined,
      },
      { source },
    );
    if (patch.result.status !== "applied") {
      toast.error(
        codeLayerPatchMessage(
          patch.result.message,
          t("designEditor.toasts.layerMoveFailed"),
        ),
        { duration: 4000 },
      );
      return;
    }
    let nextContent = patch.content;
    const wrapperId = patch.result.wrapperNodeId;
    const promotedSelectedNode = Boolean(
      wrapperId && nodeIds.includes(wrapperId),
    );
    if (wrapperId && !promotedSelectedNode) {
      const gapPatch = applyVisualEdit(
        nextContent,
        {
          kind: "style",
          target: { nodeId: wrapperId },
          property: "flex-direction",
          value: inferred.direction,
        },
        { source },
      );
      if (gapPatch.result.status === "applied") {
        nextContent = gapPatch.content;
        const paddingPatch = applyVisualEdit(
          nextContent,
          {
            kind: "style",
            target: { nodeId: wrapperId },
            property: "gap",
            value: `${inferred.gap}px`,
          },
          { source },
        );
        if (paddingPatch.result.status === "applied") {
          nextContent = paddingPatch.content;
        }
      }
    }
    const submittedProjection = buildCodeLayerProjection(nextContent, {
      source,
    });
    const wrapperCandidate = wrapperId
      ? submittedProjection.nodes.find(
          (n) => n.dataAttributes["data-agent-native-node-id"] === wrapperId,
        )
      : null;
    const publication = applyLocalContentUpdate(nextContent, {
      forcePreviewFullDocument: true,
    });
    if (publication.status !== "accepted") return;
    if (wrapperId) {
      const wrapperNode = mapAcceptedSelectionNode(
        publication,
        projectAcceptedSource(publication, source),
        wrapperCandidate,
      );
      if (wrapperNode) {
        setSelectedLayerIdsState([wrapperNode.id]);
        setSelectedElement(elementInfoFromCodeLayerNode(wrapperNode));
      }
    }
    return;
  }

  const soleNode = nodesById.get(nodeIds[0]!);
  if (!soleNode) return;
  const soleIsFrame = soleNode.dataAttributes["data-an-primitive"] === "frame";
  if (soleNode.children.length === 0 && !soleIsFrame) {
    const wrapped = applyVisualEdit(
      baseContent,
      {
        kind: "wrapNodes",
        targetIds: [soleNode.id],
        autoLayout: true,
      },
      { source },
    );
    if (wrapped.result.status !== "applied") {
      toast.error(
        codeLayerPatchMessage(
          wrapped.result.message,
          t("designEditor.toasts.layerMoveFailed"),
        ),
        { duration: 4000 },
      );
      return;
    }
    let nextContent = wrapped.content;
    const wrapperId = wrapped.result.wrapperNodeId;
    if (wrapperId) {
      for (const [property, value] of [
        ["flex-direction", "column"],
        ["gap", "10px"],
        ["padding", "0px"],
        ["width", "fit-content"],
        ["height", "fit-content"],
      ] as const) {
        const styled = applyVisualEdit(
          nextContent,
          {
            kind: "style",
            target: { nodeId: wrapperId },
            property,
            value,
          },
          { source },
        );
        if (styled.result.status === "applied") nextContent = styled.content;
      }
    }
    const submittedProjection = buildCodeLayerProjection(nextContent, {
      source,
    });
    const wrapperCandidate = wrapperId
      ? submittedProjection.nodes.find(
          (node) =>
            node.dataAttributes["data-agent-native-node-id"] === wrapperId,
        )
      : null;
    const publication = applyLocalContentUpdate(nextContent, {
      forcePreviewFullDocument: true,
    });
    if (publication.status !== "accepted") return;
    if (wrapperId) {
      const wrapperNode = mapAcceptedSelectionNode(
        publication,
        projectAcceptedSource(publication, source),
        wrapperCandidate,
      );
      if (wrapperNode) {
        setSelectedLayerIdsState([wrapperNode.id]);
        setSelectedElement(elementInfoFromCodeLayerNode(wrapperNode));
      }
    }
    return;
  }
  const childNodes = soleNode.children
    .map((childId) => nodesById.get(childId))
    .filter((node): node is CodeLayerNode => Boolean(node));
  const containerRect = rectFromCodeLayerNode(soleNode);
  const childRects = childNodes.map(rectFromCodeLayerNode);
  const inferred = inferAutoLayoutFromChildren(containerRect, childRects);
  const patch = applyVisualEdit(
    baseContent,
    {
      kind: "autoLayout",
      targetId: soleNode.id,
      enabled: true,
      direction: inferred.direction,
      gap: `${inferred.gap}px`,
    },
    { source },
  );
  if (patch.result.status !== "applied") {
    toast.error(
      codeLayerPatchMessage(
        patch.result.message,
        t("designEditor.toasts.layerMoveFailed"),
      ),
      { duration: 4000 },
    );
    return;
  }
  let nextContent = patch.content;
  const reflowResets: Array<[string, string]> = [
    ["position", "static"],
    ["left", "auto"],
    ["top", "auto"],
    ["right", "auto"],
    ["bottom", "auto"],
  ];
  for (const childNode of childNodes) {
    for (const [property, value] of reflowResets) {
      const stripped = applyVisualEdit(
        nextContent,
        {
          kind: "style",
          target: { nodeId: childNode.id },
          property,
          value,
        },
        { source },
      );
      if (stripped.result.status === "applied") nextContent = stripped.content;
    }
  }
  if (inferred.padding > 0) {
    const paddingPatch = applyVisualEdit(
      nextContent,
      {
        kind: "style",
        target: { nodeId: soleNode.id },
        property: "padding",
        value: `${inferred.padding}px`,
      },
      { source },
    );
    if (paddingPatch.result.status === "applied") {
      nextContent = paddingPatch.content;
    }
  }
  applyLocalContentUpdate(nextContent, { forcePreviewFullDocument: true });
}
