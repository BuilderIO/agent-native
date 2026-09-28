import { buildCodeLayerProjection } from "@shared/code-layer";
import { linkedComponentRootForNode } from "@shared/component-links";
import type { InteractionState } from "@shared/interaction-states";
import type { Dispatch, RefObject, SetStateAction } from "react";

import {
  clearAuthoredSizeStylesForCommit,
  patchAuthoredInlineStyles,
} from "@/components/design/edit-panel/interaction-state-helpers";
import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import type {
  EffectiveCodeLayerState,
  SelectedLayerTarget,
} from "@/pages/design-editor/code-layer-state";
import {
  bridgeSourceIdForCodeLayerNode,
  canonicalElementInfoForCodeLayerNode,
  codeLayerNodeMatchesBridgeTarget,
  preferredCodeLayerSelector,
} from "@/pages/design-editor/code-layer-state";
import type { ResponsiveEditScope } from "@/pages/design-editor/command-types";
import { getFreshActiveFileContent } from "@/pages/design-editor/editor-state";
import {
  applyInteractionStateStyleCommit,
  applyScopedVisualStyleEdit,
} from "@/pages/design-editor/pending-edits";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "./selection-publication";

export interface CommitStylesToSelectedLayersArgs {
  activeCanvasSourceType?: "inline" | "localhost" | "fusion";
  activeBreakpointUpperBoundPx: number | null;
  activeBreakpointWidthStateRef: RefObject<number | undefined>;
  activeContent: string;
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
  applyLinkedComponentEdit?: (
    fileId: string,
    nodeId: string,
    edit: {
      kind: "styleTargetsBatch";
      targets: Array<{
        fileId: string;
        nodeId: string;
        styles: Record<string, string>;
      }>;
    },
  ) => void;
  commitVisualStyles?: (
    selector: string,
    styles: Record<string, string>,
    options?: {
      elementInfo?: ElementInfo;
      pendingUndoGestureId?: string;
      preserveSelection?: boolean;
    },
  ) => void;
  canEditDesign: boolean;
  effectiveCodeLayerStateRef: RefObject<EffectiveCodeLayerState>;
  getScreenContent: (screenId: string) => string;
  getProjectionContentForScreen?: (screenId: string) => string;
  lastLocalContentRef: RefObject<string | null>;
  latestActiveContentRef: RefObject<string | null>;
  responsiveEditScopeRef: RefObject<ResponsiveEditScope>;
  selectedLayerTargetsRef: RefObject<SelectedLayerTarget[]>;
  selectedLayerIdsStateRef: RefObject<string[]>;
  reportLinkedEditUnavailable?: (
    reason: "scope" | "source" | "targets",
  ) => void;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
}

export interface CapturedStyleTargetCommitOptions {
  capturedTargetIds: string[];
  interactionState?: InteractionState;
  scope: { upperBoundPx: number | null; lowerBoundPx: number | null };
}

export function runCommitStylesToSelectedLayers(
  {
    activeCanvasSourceType,
    activeBreakpointUpperBoundPx,
    activeBreakpointWidthStateRef,
    activeContent,
    activeFile,
    applyFileContentUpdate,
    applyLinkedComponentEdit,
    commitVisualStyles,
    canEditDesign,
    effectiveCodeLayerStateRef,
    getScreenContent,
    getProjectionContentForScreen,
    lastLocalContentRef,
    latestActiveContentRef,
    responsiveEditScopeRef,
    selectedLayerTargetsRef,
    selectedLayerIdsStateRef,
    reportLinkedEditUnavailable,
    setSelectedElement,
  }: CommitStylesToSelectedLayersArgs,
  styles: Record<string, string>,
  targetsOverride?: SelectedLayerTarget[],
  capturedOptions?: CapturedStyleTargetCommitOptions,
  pendingUndoGestureId?: string,
) {
  if (!canEditDesign) return false;
  const entries = Object.entries(styles).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return false;
  const effectiveLayerState = effectiveCodeLayerStateRef.current;
  const candidateTargets = targetsOverride ?? selectedLayerTargetsRef.current;
  const targets = candidateTargets.filter(
    (target) =>
      !effectiveLayerState.lockedIds.has(target.fileId) &&
      !effectiveLayerState.hiddenIds.has(target.fileId) &&
      !effectiveLayerState.lockedIds.has(target.layerId) &&
      !effectiveLayerState.hiddenIds.has(target.layerId),
  );
  if (
    targets.length === 0 ||
    (capturedOptions && targets.length !== candidateTargets.length) ||
    (capturedOptions?.interactionState && targets.length !== 1)
  )
    return false;

  const stylesForTargets = Object.fromEntries(entries);
  const styleTargets: Array<{
    fileId: string;
    nodeId: string;
    styles: Record<string, string>;
  }> = [];
  let includesLinkedTarget = false;
  let targetsResolved = true;
  targets.forEach((target) => {
    const source = { kind: "design-file" as const, fileId: target.fileId };
    const baseContent =
      (activeCanvasSourceType ?? "inline") !== "inline" &&
      getProjectionContentForScreen
        ? getProjectionContentForScreen(target.fileId)
        : target.fileId === activeFile?.id
          ? getFreshActiveFileContent({
              activeContent,
              latestContent: latestActiveContentRef.current,
              lastLocalContent: lastLocalContentRef.current,
            })
          : getScreenContent(target.fileId);
    if (!baseContent) {
      targetsResolved = false;
      return;
    }
    const projection = buildCodeLayerProjection(baseContent, { source });
    const sourceId = bridgeSourceIdForCodeLayerNode(target.node);
    const selector = preferredCodeLayerSelector(target.node);
    const node =
      projection.nodes.find((candidate) =>
        codeLayerNodeMatchesBridgeTarget(candidate, selector, sourceId),
      ) ??
      projection.nodes.find((candidate) => candidate.id === target.node.id);
    if (!node) {
      targetsResolved = false;
      return;
    }
    const nodeId = node.dataAttributes["data-agent-native-node-id"] ?? "";
    if (linkedComponentRootForNode(node, projection))
      includesLinkedTarget = true;
    styleTargets.push({
      fileId: target.fileId,
      nodeId,
      styles: stylesForTargets,
    });
  });

  if (includesLinkedTarget) {
    const upperBoundPx = capturedOptions
      ? capturedOptions.scope.upperBoundPx
      : activeBreakpointUpperBoundPx;
    const lowerBoundPx = capturedOptions
      ? capturedOptions.scope.lowerBoundPx
      : responsiveEditScopeRef.current === "only"
        ? (activeBreakpointWidthStateRef.current ?? null)
        : null;
    if (
      upperBoundPx !== null ||
      lowerBoundPx !== null ||
      capturedOptions?.interactionState
    ) {
      reportLinkedEditUnavailable?.("scope");
      return true;
    }
    if (
      !targetsResolved ||
      styleTargets.length !== targets.length ||
      styleTargets.some((target) => !target.nodeId)
    ) {
      reportLinkedEditUnavailable?.("targets");
      return true;
    }
    if (targets.length === 1 && !capturedOptions) return false;
    if ((activeCanvasSourceType ?? "inline") !== "inline") {
      const projectionContentFor =
        getProjectionContentForScreen ?? getScreenContent;
      if (
        !commitVisualStyles ||
        targets.some((target) => target.fileId !== activeFile?.id)
      ) {
        reportLinkedEditUnavailable?.("source");
        return true;
      }
      const sourceTargets = targets.map((target) => {
        const source = { kind: "design-file" as const, fileId: target.fileId };
        const content = projectionContentFor(target.fileId);
        const projection = buildCodeLayerProjection(content, { source });
        const sourceId = bridgeSourceIdForCodeLayerNode(target.node);
        const selector = preferredCodeLayerSelector(target.node);
        const node =
          projection.nodes.find((candidate) =>
            codeLayerNodeMatchesBridgeTarget(candidate, selector, sourceId),
          ) ??
          projection.nodes.find((candidate) => candidate.id === target.node.id);
        return node
          ? {
              selector: preferredCodeLayerSelector(node),
              elementInfo: canonicalElementInfoForCodeLayerNode(
                target.elementInfo,
                node,
              ),
            }
          : null;
      });
      if (sourceTargets.some((target) => !target)) {
        reportLinkedEditUnavailable?.("targets");
        return true;
      }
      sourceTargets.forEach((target) => {
        if (!target) return;
        commitVisualStyles(target.selector, stylesForTargets, {
          elementInfo: target.elementInfo,
          pendingUndoGestureId,
          preserveSelection: true,
        });
      });
      return true;
    }
    if (!applyLinkedComponentEdit) {
      reportLinkedEditUnavailable?.("source");
      return true;
    }
    if (
      styleTargets.length !== targets.length ||
      styleTargets.some((target) => !target.nodeId)
    ) {
      reportLinkedEditUnavailable?.("targets");
      return true;
    }
    const primaryTarget = styleTargets[0];
    if (!primaryTarget) return false;
    applyLinkedComponentEdit(primaryTarget.fileId, primaryTarget.nodeId, {
      kind: "styleTargetsBatch",
      targets: styleTargets,
    });
    return true;
  }
  if (targets.length === 1 && !capturedOptions) return false;

  const targetsByFile = new Map<string, SelectedLayerTarget[]>();
  targets.forEach((target) => {
    targetsByFile.set(target.fileId, [
      ...(targetsByFile.get(target.fileId) ?? []),
      target,
    ]);
  });

  const pendingWrites: { fileId: string; content: string }[] = [];
  let failedTarget = false;
  targetsByFile.forEach((fileTargets, fileId) => {
    const source = { kind: "design-file" as const, fileId };
    const baseContent =
      fileId === activeFile?.id
        ? getFreshActiveFileContent({
            activeContent,
            latestContent: latestActiveContentRef.current,
            lastLocalContent: lastLocalContentRef.current,
          })
        : getScreenContent(fileId);
    if (!baseContent) {
      if (capturedOptions) failedTarget = true;
      return;
    }
    let nextContent = baseContent;
    let projection = buildCodeLayerProjection(nextContent, { source });
    fileTargets.forEach((target) => {
      const sourceId = bridgeSourceIdForCodeLayerNode(target.node);
      const selector = preferredCodeLayerSelector(target.node);
      const node =
        projection.nodes.find((candidate) =>
          codeLayerNodeMatchesBridgeTarget(candidate, selector, sourceId),
        ) ??
        projection.nodes.find((candidate) => candidate.id === target.node.id);
      if (!node) {
        if (capturedOptions) failedTarget = true;
        return;
      }

      if (capturedOptions?.interactionState) {
        nextContent = applyInteractionStateStyleCommit(
          nextContent,
          bridgeSourceIdForCodeLayerNode(node),
          capturedOptions.interactionState,
          Object.fromEntries(entries),
          capturedOptions.scope.upperBoundPx,
        );
        return;
      }
      entries.forEach(([property, value]) => {
        const patch = applyScopedVisualStyleEdit({
          content: nextContent,
          target: { nodeId: node.id },
          property,
          value,
          source,
          upperBoundPx: capturedOptions
            ? capturedOptions.scope.upperBoundPx
            : activeBreakpointUpperBoundPx,
          lowerBoundPx: capturedOptions
            ? capturedOptions.scope.lowerBoundPx
            : responsiveEditScopeRef.current === "only"
              ? activeBreakpointWidthStateRef.current
              : null,
        });
        if (patch.result.status !== "applied") {
          if (capturedOptions) failedTarget = true;
          return;
        }
        nextContent = patch.content;
        projection = patch.projection;
      });
    });
    if (nextContent === baseContent) return;
    pendingWrites.push({ fileId, content: nextContent });
  });

  if (failedTarget) return false;
  const acceptedNodeByLayerId = new Map<
    string,
    NonNullable<ReturnType<typeof mapAcceptedSelectionNode>>
  >();
  pendingWrites.forEach(({ fileId, content }) => {
    const publication = applyFileContentUpdate(fileId, content, {
      forcePreviewFullDocument: fileId === activeFile?.id,
    });
    if (publication.status !== "accepted") return;
    const source = { kind: "design-file" as const, fileId };
    const submittedProjection = buildCodeLayerProjection(content, { source });
    const acceptedProjection = projectAcceptedSource(publication, source);
    for (const target of targets.filter((item) => item.fileId === fileId)) {
      const selector = preferredCodeLayerSelector(target.node);
      const sourceId = bridgeSourceIdForCodeLayerNode(target.node);
      const submittedNode =
        submittedProjection.nodes.find((candidate) =>
          codeLayerNodeMatchesBridgeTarget(candidate, selector, sourceId),
        ) ??
        submittedProjection.nodes.find(
          (candidate) => candidate.id === target.node.id,
        );
      const acceptedNode = mapAcceptedSelectionNode(
        publication,
        acceptedProjection,
        submittedNode,
      );
      if (acceptedNode) acceptedNodeByLayerId.set(target.layerId, acceptedNode);
    }
  });
  const appliedAny = pendingWrites.length > 0;

  const selectionStillMatchesCapturedTargets =
    !capturedOptions ||
    (selectedLayerIdsStateRef.current.length ===
      capturedOptions.capturedTargetIds.length &&
      capturedOptions.capturedTargetIds.every((id) =>
        selectedLayerIdsStateRef.current.includes(id),
      ));
  if (
    appliedAny &&
    selectionStillMatchesCapturedTargets &&
    !capturedOptions?.interactionState
  ) {
    const stylePatch = Object.fromEntries(entries);
    const primaryTarget = targets[targets.length - 1];
    if (primaryTarget) {
      const acceptedPrimaryTarget = acceptedNodeByLayerId.get(
        primaryTarget.layerId,
      );
      if (!acceptedPrimaryTarget) return false;
      setSelectedElement((previous) => {
        const previousMatches =
          previous &&
          codeLayerNodeMatchesBridgeTarget(
            acceptedPrimaryTarget,
            previous.selector,
            previous.sourceId ?? previous.id,
          );
        const base = previousMatches
          ? canonicalElementInfoForCodeLayerNode(
              previous,
              acceptedPrimaryTarget,
            )
          : primaryTarget.elementInfo;
        return {
          ...base,
          computedStyles: {
            ...base.computedStyles,
            ...stylePatch,
          },
          inlineStyles: patchAuthoredInlineStyles(
            base.inlineStyles,
            stylePatch,
          ),
          authoredSizeStyles: clearAuthoredSizeStylesForCommit(
            base.authoredSizeStyles,
            stylePatch,
          ),
        };
      });
    }
  }

  return true;
}
