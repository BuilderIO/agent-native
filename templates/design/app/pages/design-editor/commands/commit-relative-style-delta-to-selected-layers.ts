import { buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";

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
  getFreshActiveFileContent,
} from "@/pages/design-editor/editor-state";
import { applyScopedVisualStyleEdit } from "@/pages/design-editor/pending-edits";
import type { DesignFile } from "@/pages/design-editor/types";

export interface CommitRelativeStyleDeltaToSelectedLayersArgs {
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
  ) => void;
  canEditDesign: boolean;
  effectiveCodeLayerStateRef: RefObject<EffectiveCodeLayerState>;
  getScreenContent: (screenId: string) => string;
  lastLocalContentRef: RefObject<string | null>;
  latestActiveContentRef: RefObject<string | null>;
  responsiveEditScopeRef: RefObject<ResponsiveEditScope>;
  selectedLayerTargetsRef: RefObject<SelectedLayerTarget[]>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
}

export function runCommitRelativeStyleDeltaToSelectedLayers(
  {
    activeBreakpointUpperBoundPx,
    activeBreakpointWidthStateRef,
    activeContent,
    activeFile,
    applyFileContentUpdate,
    canEditDesign,
    effectiveCodeLayerStateRef,
    getScreenContent,
    lastLocalContentRef,
    latestActiveContentRef,
    responsiveEditScopeRef,
    selectedLayerTargetsRef,
    setSelectedElement,
  }: CommitRelativeStyleDeltaToSelectedLayersArgs,
  property: string,
  delta: number,
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
  if (targets.length <= 1) return false;

  const targetsByFile = new Map<string, SelectedLayerTarget[]>();
  targets.forEach((target) => {
    targetsByFile.set(target.fileId, [
      ...(targetsByFile.get(target.fileId) ?? []),
      target,
    ]);
  });

  let appliedAny = false;
  const appliedValueByLayerId = new Map<string, string>();
  targetsByFile.forEach((fileTargets, fileId) => {
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
    let projection = buildCodeLayerProjection(nextContent);
    fileTargets.forEach((target) => {
      const nextValue = applyRelativeDeltaToStyleValue(
        target.elementInfo.computedStyles[
          property as keyof typeof target.elementInfo.computedStyles
        ] as string | undefined,
        delta,
      );
      if (nextValue === null) return;
      const sourceId = bridgeSourceIdForCodeLayerNode(target.node);
      const selector = preferredCodeLayerSelector(target.node);
      const node =
        projection.nodes.find((candidate) =>
          codeLayerNodeMatchesBridgeTarget(candidate, selector, sourceId),
        ) ??
        projection.nodes.find((candidate) => candidate.id === target.node.id);
      if (!node) return;
      // §6.4 — relative-delta commits (mixed-value arrow steps) route
      // through the same breakpoint scoping as absolute commits.
      const patch = applyScopedVisualStyleEdit({
        content: nextContent,
        target: { nodeId: node.id },
        property,
        value: nextValue,
        upperBoundPx: activeBreakpointUpperBoundPx,
        lowerBoundPx:
          responsiveEditScopeRef.current === "only"
            ? activeBreakpointWidthStateRef.current
            : null,
      });
      if (patch.result.status !== "applied") return;
      nextContent = patch.content;
      projection = patch.projection;
      appliedValueByLayerId.set(target.layerId, nextValue);
    });
    if (nextContent === baseContent) return;
    appliedAny = true;
    // Same flash-free full-document routing (and same persist caveat) as
    // commitStylesToSelectedLayers above.
    applyFileContentUpdate(fileId, nextContent, {
      forcePreviewFullDocument: fileId === activeFile?.id,
    });
  });

  if (appliedAny) {
    const primaryTarget = targets[targets.length - 1];
    const primaryValue = primaryTarget
      ? appliedValueByLayerId.get(primaryTarget.layerId)
      : undefined;
    if (primaryTarget && primaryValue !== undefined) {
      setSelectedElement((previous) => {
        const previousMatches =
          previous &&
          codeLayerNodeMatchesBridgeTarget(
            primaryTarget.node,
            previous.selector,
            previous.sourceId ?? previous.id,
          );
        const base = previousMatches
          ? canonicalElementInfoForCodeLayerNode(previous, primaryTarget.node)
          : primaryTarget.elementInfo;
        return {
          ...base,
          computedStyles: {
            ...base.computedStyles,
            [property]: primaryValue,
          },
        };
      });
    }
  }

  return appliedAny;
}
