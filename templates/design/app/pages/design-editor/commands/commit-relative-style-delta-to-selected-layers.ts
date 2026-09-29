import type { ScrubRelativeExpression } from "@agent-native/toolkit/design-tweaks";
import { buildCodeLayerProjection } from "@shared/code-layer";
import { linkedComponentRootForNode } from "@shared/component-links";
import type { Dispatch, RefObject, SetStateAction } from "react";

import {
  clearAuthoredSizeStylesForCommit,
  patchAuthoredInlineStyles,
} from "@/components/design/edit-panel/interaction-state-helpers";
import {
  mergeRotationValue,
  parseRotationValue,
} from "@/components/design/edit-panel/transform-helpers";
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
import {
  applyRelativeDeltaToStyleValue,
  applyRelativeExpressionToStyleValue,
  getFreshActiveFileContent,
} from "@/pages/design-editor/editor-state";
import { applyScopedVisualStyleEdit } from "@/pages/design-editor/pending-edits";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyFileContentUpdateResult } from "./apply-file-content-update";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "./selection-publication";

export interface CommitRelativeStyleDeltaToSelectedLayersArgs {
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
  reportLinkedEditUnavailable?: (
    reason: "scope" | "source" | "targets",
  ) => void;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
}

export function applyRelativeRotationToTransform(
  transform: string | undefined,
  operation: number | ScrubRelativeExpression,
): string | null {
  const displayedValue = `${-parseRotationValue(transform)}deg`;
  const nextDisplayedValue =
    typeof operation === "number"
      ? applyRelativeDeltaToStyleValue(displayedValue, operation)
      : applyRelativeExpressionToStyleValue(displayedValue, operation);
  if (!nextDisplayedValue) return null;
  const degrees = Number(nextDisplayedValue.replace(/deg$/i, ""));
  if (!Number.isFinite(degrees)) return null;
  return mergeRotationValue(transform, -degrees);
}

export function runCommitRelativeStyleDeltaToSelectedLayers(
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
    reportLinkedEditUnavailable,
    setSelectedElement,
  }: CommitRelativeStyleDeltaToSelectedLayersArgs,
  property: string | string[],
  operation: number | ScrubRelativeExpression,
  pendingUndoGestureId?: string,
) {
  if (!canEditDesign) return false;
  const effectiveLayerState = effectiveCodeLayerStateRef.current;
  const targets = selectedLayerTargetsRef.current.filter(
    (target) =>
      !effectiveLayerState.lockedIds.has(target.fileId) &&
      !effectiveLayerState.hiddenIds.has(target.fileId) &&
      !effectiveLayerState.lockedIds.has(target.layerId) &&
      !effectiveLayerState.hiddenIds.has(target.layerId),
  );
  if (targets.length === 0) return false;
  const properties = [
    ...new Set(Array.isArray(property) ? property : [property]),
  ];
  if (properties.length === 0) return false;
  const relativeStylesByTarget = new Map<
    SelectedLayerTarget,
    Record<string, string>
  >();
  const stylesForTarget = (target: SelectedLayerTarget) => {
    const styles: Record<string, string> = {};
    for (const property of properties) {
      const writeProperty = property === "rotation" ? "transform" : property;
      const currentValue =
        property === "rotation"
          ? (target.elementInfo.inlineStyles?.transform ??
            target.elementInfo.computedStyles.transform)
          : (target.elementInfo.computedStyles[
              property as keyof typeof target.elementInfo.computedStyles
            ] as string | undefined);
      const nextValue =
        property === "rotation"
          ? applyRelativeRotationToTransform(currentValue, operation)
          : typeof operation === "number"
            ? applyRelativeDeltaToStyleValue(currentValue, operation)
            : applyRelativeExpressionToStyleValue(currentValue, operation);
      if (nextValue === null) return null;
      styles[writeProperty] = nextValue;
    }
    return styles;
  };

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
    const styles = stylesForTarget(target);
    if (!styles) {
      targetsResolved = false;
      return;
    }
    relativeStylesByTarget.set(target, styles);
    if (linkedComponentRootForNode(node, projection))
      includesLinkedTarget = true;
    styleTargets.push({
      fileId: target.fileId,
      nodeId: node.dataAttributes["data-agent-native-node-id"] ?? "",
      styles,
    });
  });
  if (includesLinkedTarget) {
    const lowerBoundPx =
      responsiveEditScopeRef.current === "only"
        ? (activeBreakpointWidthStateRef.current ?? null)
        : null;
    if (activeBreakpointUpperBoundPx !== null || lowerBoundPx !== null) {
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
        const projection = buildCodeLayerProjection(
          projectionContentFor(target.fileId),
          { source },
        );
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
      sourceTargets.forEach((target, index) => {
        const value = styleTargets[index]?.styles;
        if (!target || !value) return;
        commitVisualStyles(target.selector, value, {
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
    const primaryTarget = styleTargets[0];
    if (!primaryTarget) return false;
    applyLinkedComponentEdit(primaryTarget.fileId, primaryTarget.nodeId, {
      kind: "styleTargetsBatch",
      targets: styleTargets,
    });
    return true;
  }
  if (targets.length <= 1) return false;

  const targetsByFile = new Map<string, SelectedLayerTarget[]>();
  targets.forEach((target) => {
    targetsByFile.set(target.fileId, [
      ...(targetsByFile.get(target.fileId) ?? []),
      target,
    ]);
  });

  let appliedAny = false;
  const appliedStylesByLayerId = new Map<string, Record<string, string>>();
  const acceptedNodeByLayerId = new Map<
    string,
    NonNullable<ReturnType<typeof mapAcceptedSelectionNode>>
  >();
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
    if (!baseContent) return;
    let nextContent = baseContent;
    let projection = buildCodeLayerProjection(nextContent, { source });
    fileTargets.forEach((target) => {
      const styles = relativeStylesByTarget.get(target);
      if (!styles) return;
      const sourceId = bridgeSourceIdForCodeLayerNode(target.node);
      const selector = preferredCodeLayerSelector(target.node);
      const node =
        projection.nodes.find((candidate) =>
          codeLayerNodeMatchesBridgeTarget(candidate, selector, sourceId),
        ) ??
        projection.nodes.find((candidate) => candidate.id === target.node.id);
      if (!node) return;
      let targetNextContent = nextContent;
      let targetProjection = projection;
      for (const [writeProperty, value] of Object.entries(styles)) {
        const patch = applyScopedVisualStyleEdit({
          content: targetNextContent,
          target: { nodeId: node.id },
          property: writeProperty,
          value,
          source,
          upperBoundPx: activeBreakpointUpperBoundPx,
          lowerBoundPx:
            responsiveEditScopeRef.current === "only"
              ? activeBreakpointWidthStateRef.current
              : null,
        });
        if (patch.result.status !== "applied") return;
        targetNextContent = patch.content;
        targetProjection = patch.projection;
      }
      nextContent = targetNextContent;
      projection = targetProjection;
      appliedStylesByLayerId.set(target.layerId, styles);
    });
    if (nextContent === baseContent) return;
    appliedAny = true;
    const publication = applyFileContentUpdate(fileId, nextContent, {
      forcePreviewFullDocument: fileId === activeFile?.id,
    });
    if (publication.status !== "accepted") return;
    const submittedProjection = buildCodeLayerProjection(nextContent, {
      source,
    });
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

  if (appliedAny) {
    const primaryTarget = targets[targets.length - 1];
    const primaryStyles = primaryTarget
      ? appliedStylesByLayerId.get(primaryTarget.layerId)
      : undefined;
    if (primaryTarget && primaryStyles !== undefined) {
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
            ...primaryStyles,
          },
          inlineStyles: patchAuthoredInlineStyles(
            base.inlineStyles,
            primaryStyles,
          ),
          authoredSizeStyles: clearAuthoredSizeStylesForCommit(
            base.authoredSizeStyles,
            primaryStyles,
          ),
        };
      });
    }
  }

  return appliedAny;
}
