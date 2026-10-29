import { getFrameGroupBounds } from "@shared/canvas-math";
import type {
  CodeLayerNode,
  CodeLayerProjection,
  CodeLayerTreeNode,
} from "@shared/code-layer";
import { applyVisualEdit, buildCodeLayerProjection } from "@shared/code-layer";
import {
  inferFlowArrangement,
  readLayoutModel,
  writeLayoutChange,
} from "@agent-native/toolkit/canvas-interactions/layout-model";
import { isRunningAppSourceType } from "@shared/source-mode";
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
import type { FrameMeasurement } from "@/pages/design-editor/measure-child-rects";
import { resolveOverviewScreenSourceType } from "@/pages/design-editor/pending-edits";
import {
  enableInlineScreenAutoLayout,
  getRuntimeScreenAutoLayoutSubjectIds,
} from "@/pages/design-editor/screen-auto-layout";
import { overviewSelectionTargetsElement } from "@/pages/design-editor/selection-state";
import type { DesignFile } from "@/pages/design-editor/types";

import type { MeasureAlignSelection } from "./align-selection";
import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";
import type { ApplyLocalContentUpdateResult } from "./apply-local-content-update";
import type { LiveSizeHints } from "./frame-selection";
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
  collectSizeHints: (
    nodeIds: string[],
    projection: CodeLayerProjection,
  ) => LiveSizeHints;
  codeLayerOwnerByNodeIdRef: RefObject<
    ReadonlyMap<
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
  measureLayoutFrame: (node: CodeLayerNode) => FrameMeasurement;
  measureSelection: MeasureAlignSelection;
  overviewScreens: OverviewScreen[];
  overviewSelectedScreenIds: string[];
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
  collectSizeHints,
  codeLayerOwnerByNodeIdRef,
  designSourceType,
  effectiveCodeLayerStateRef,
  files,
  getActiveFileSelectedNodeIds,
  getFreshActiveContent,
  getScreenContent,
  measureLayoutFrame,
  measureSelection,
  overviewScreens,
  overviewSelectedScreenIds,
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
  const refuseUnmeasurable = (nodeId: string, reason: string) => {
    trace("structure", "add-auto-layout-refused", { nodeId, reason });
    toast.error(t("designEditor.toasts.layoutUnmeasurable"), {
      duration: 4000,
    });
  };

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

    if (isRunningAppSourceType(screenSourceType)) {
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
    const measured = measureSelection(selectedNodes);
    if (measured.status !== "measured") {
      refuseUnmeasurable(measured.nodeId, measured.reason);
      return;
    }
    const rects = measured.nodes.map((node) => ({
      id: node.id,
      rect: node.rect,
    }));
    const bounds = getFrameGroupBounds(rects.map(({ rect }) => rect));
    const arrangement = bounds
      ? inferFlowArrangement(
          {
            x: bounds.left,
            y: bounds.top,
            width: bounds.width,
            height: bounds.height,
          },
          rects,
        )
      : null;
    const { hints: sizeHints, unmeasured } = collectSizeHints(
      nodeIds,
      projection,
    );
    if (unmeasured.length > 0) {
      refuseUnmeasurable(unmeasured[0]!.nodeId, unmeasured[0]!.reason);
      return;
    }
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
    if (wrapperId && !promotedSelectedNode && arrangement) {
      // Flow follows the layers' on-canvas order, not their source order.
      const nodesById = new Map(selectedNodes.map((node) => [node.id, node]));
      const visualOrder = arrangement.order.map((id) => {
        const node = nodesById.get(id)!;
        return node.dataAttributes["data-agent-native-node-id"] ?? node.id;
      });
      for (let index = 1; index < visualOrder.length; index += 1) {
        const moved = applyVisualEdit(
          nextContent,
          {
            kind: "moveNode",
            target: { nodeId: visualOrder[index]! },
            anchor: { nodeId: visualOrder[index - 1]! },
            placement: "after",
          },
          { source },
        );
        if (moved.result.status === "applied") nextContent = moved.content;
      }
      const gapPatch = applyVisualEdit(
        nextContent,
        {
          kind: "style",
          target: { nodeId: wrapperId },
          property: "flex-direction",
          value: arrangement.direction === "horizontal" ? "row" : "column",
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
            value: `${arrangement.gap}px`,
          },
          { source },
        );
        if (paddingPatch.result.status === "applied") {
          nextContent = paddingPatch.content;
        }
        const alignPatch = applyVisualEdit(
          nextContent,
          {
            kind: "style",
            target: { nodeId: wrapperId },
            property: "align-items",
            value: "flex-start",
          },
          { source },
        );
        if (alignPatch.result.status === "applied") {
          nextContent = alignPatch.content;
        }
      }
      const alignment = arrangement.alignItems;
      if (alignment !== "stretch") {
        const alignmentPatch = applyVisualEdit(
          nextContent,
          {
            kind: "style",
            target: { nodeId: wrapperId },
            property: "align-items",
            value: alignment,
          },
          { source },
        );
        if (alignmentPatch.result.status === "applied") {
          nextContent = alignmentPatch.content;
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
  const soleHasAutoLayout =
    soleNode.layout.isFlexContainer || soleNode.layout.isGridContainer;
  if ((soleNode.children.length === 0 && !soleIsFrame) || soleHasAutoLayout) {
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
  const measured = measureLayoutFrame(soleNode);
  if (measured.status !== "measured") {
    refuseUnmeasurable(measured.nodeId, measured.reason);
    return;
  }
  // A child nothing can address would be left behind in the flow order.
  if (measured.unidentifiedChildren > 0) {
    refuseUnmeasurable(soleNode.id, "unidentified-children");
    return;
  }
  const model = readLayoutModel({
    node: {
      id: soleNode.id,
      styles: { display: "block", boxSizing: measured.boxSizing },
      declaredSize: {
        width: soleNode.style.width,
        height: soleNode.style.height,
      },
      resolvedSize: {
        horizontal: measured.paddingBox.width,
        vertical: measured.paddingBox.height,
      },
    },
    parent: null,
    children: {
      status: "read",
      looseText: false,
      complete: true,
      children: measured.children.map((child) => ({
        id: child.id,
        styles: { position: child.position },
        rect: child.rect,
      })),
    },
  });
  const write = writeLayoutChange(model, { kind: "enable-auto-layout" });
  if (write.status !== "ok") {
    refuseUnmeasurable(soleNode.id, write.reason);
    return;
  }
  let nextContent = baseContent;
  const orderedChildIds = write.order ?? [];
  for (let index = 1; index < orderedChildIds.length; index += 1) {
    const moved = applyVisualEdit(
      nextContent,
      {
        kind: "moveNode",
        target: { nodeId: orderedChildIds[index]! },
        anchor: { nodeId: orderedChildIds[index - 1]! },
        placement: "after",
      },
      { source },
    );
    if (moved.result.status !== "applied") {
      toast.error(
        codeLayerPatchMessage(
          moved.result.message,
          t("designEditor.toasts.layerMoveFailed"),
        ),
        { duration: 4000 },
      );
      return;
    }
    nextContent = moved.content;
  }
  const containerStyles: Record<string, string> = {};
  for (const [property, value] of Object.entries(write.frame)) {
    if (value !== null) containerStyles[property] = value;
  }
  const patch = applyVisualEdit(
    nextContent,
    {
      kind: "autoLayout",
      targetId: soleNode.id,
      enabled: true,
      containerStyles,
      childRects: Object.fromEntries(
        measured.children.map((child) => [
          child.id,
          { ...child.rect, box: child.box },
        ]),
      ),
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
  applyLocalContentUpdate(patch.content, { forcePreviewFullDocument: true });
}
