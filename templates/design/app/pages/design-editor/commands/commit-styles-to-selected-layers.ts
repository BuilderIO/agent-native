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
import { getFreshActiveFileContent } from "@/pages/design-editor/editor-state";
import { applyScopedVisualStyleEdit } from "@/pages/design-editor/pending-edits";
import type { DesignFile } from "@/pages/design-editor/types";

export interface CommitStylesToSelectedLayersArgs {
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

export function runCommitStylesToSelectedLayers(
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
  }: CommitStylesToSelectedLayersArgs,
  styles: Record<string, string>,
) {
  if (!canEditDesign) return false;
  const entries = Object.entries(styles).filter(
    ([, value]) => value !== undefined,
  );
  if (entries.length === 0) return false;
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
      const sourceId = bridgeSourceIdForCodeLayerNode(target.node);
      const selector = preferredCodeLayerSelector(target.node);
      const node =
        projection.nodes.find((candidate) =>
          codeLayerNodeMatchesBridgeTarget(candidate, selector, sourceId),
        ) ??
        projection.nodes.find((candidate) => candidate.id === target.node.id);
      if (!node) return;

      entries.forEach(([property, value]) => {
        // §6.4 — multi-selection commits route through the same
        // class-vs-media breakpoint scoping as single-selection edits.
        const patch = applyScopedVisualStyleEdit({
          content: nextContent,
          target: { nodeId: node.id },
          property,
          value,
          upperBoundPx: activeBreakpointUpperBoundPx,
          lowerBoundPx:
            responsiveEditScopeRef.current === "only"
              ? activeBreakpointWidthStateRef.current
              : null,
        });
        if (patch.result.status !== "applied") return;
        nextContent = patch.content;
        projection = patch.projection;
      });
    });
    if (nextContent === baseContent) return;
    appliedAny = true;
    // Multi-node commit — the change is NOT scoped to the currently
    // selected element's subtree, so request the bridge's in-place
    // FULL-document replace instead of `refreshPreview: true`'s srcdoc
    // rebuild (real iframe reload, white flash — the same anti-pattern
    // getPersistedContentHostSyncOptions' doc comment describes, and the
    // same forcePreviewFullDocument routing undo/redo uses). Deliberately
    // NOT the helper itself: this content is a client-authored edit that
    // still must persist — the helper's `persist: false` would cancel the
    // queued save and silently drop the commit.
    applyFileContentUpdate(fileId, nextContent, {
      forcePreviewFullDocument: fileId === activeFile?.id,
    });
  });

  if (appliedAny) {
    const stylePatch = Object.fromEntries(entries);
    const primaryTarget = targets[targets.length - 1];
    if (primaryTarget) {
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
            ...stylePatch,
          },
        };
      });
    }
  }

  return true;
}
