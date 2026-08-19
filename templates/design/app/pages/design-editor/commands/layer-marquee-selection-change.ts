import type { CodeLayerNode, CodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { CanvasLayerMarqueeSelection } from "@/components/design/multi-screen/types";
import type {
  ElementInfo,
  ElementSelectionIntent,
} from "@/components/design/types";
import {
  canonicalizeElementInfoFromProjection,
  resolveCodeLayerNodeFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import {
  dedupeStringIds,
  isScreenRootElementInfo,
  shouldClearBridgeSelectionOnEmptyMarquee,
} from "@/pages/design-editor/selection-state";
import type { DesignTool, EditorMode } from "@/pages/design-editor/types";

export interface LayerMarqueeSelectionChangeArgs {
  clearPendingOverviewLayerSelectionTimer: () => void;
  focusDesignInspectorForSelection: () => void;
  getCodeLayerProjectionForScreen: (
    screenId: string,
  ) => CodeLayerProjection | null;
  hasActiveSelectionRef: RefObject<boolean>;
  lastMarqueeSelectionSignatureRef: RefObject<string | null>;
  pendingOverviewLayerSelectionRef: RefObject<string | null>;
  pendingOverviewScreenSelectionRef: RefObject<string | null>;
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setActiveTool: Dispatch<SetStateAction<DesignTool>>;
  setCreatedOverviewLayerSelection: Dispatch<
    SetStateAction<{ screenId: string; layerId: string } | null>
  >;
  setMode: Dispatch<SetStateAction<EditorMode>>;
  setOverviewClearSelectionRequest: Dispatch<SetStateAction<number>>;
  setOverviewSelectedScreenIds: Dispatch<SetStateAction<string[]>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runLayerMarqueeSelectionChange(
  {
    clearPendingOverviewLayerSelectionTimer,
    focusDesignInspectorForSelection,
    getCodeLayerProjectionForScreen,
    hasActiveSelectionRef,
    lastMarqueeSelectionSignatureRef,
    pendingOverviewLayerSelectionRef,
    pendingOverviewScreenSelectionRef,
    setActiveFileId,
    setActiveTool,
    setCreatedOverviewLayerSelection,
    setMode,
    setOverviewClearSelectionRequest,
    setOverviewSelectedScreenIds,
    setSelectedElement,
    setSelectedLayerIdsState,
    viewModeRef,
  }: LayerMarqueeSelectionChangeArgs,
  selection: CanvasLayerMarqueeSelection[],
  intent: ElementSelectionIntent,
) {
  // PF10: MultiScreenCanvas reports the marquee hit-set on every
  // mousemove tick during a drag, not just on settle (see
  // reportLayerSelection in MultiScreenCanvas.tsx). Bail before any
  // projection/canonicalization work when the reported set is identical
  // to the last tick's — the common case while the marquee rect isn't
  // currently crossing an element boundary.
  //
  // The dedup is ONLY applied to non-empty hit-sets. An empty hit-set (a
  // plain empty-space click, or dragging over blank canvas) is cheap to
  // process and must never be deduped away: the last non-marquee selection
  // (iframe click, layers panel, agent, undo/redo, keyboard) does not
  // update this signature, so an empty "#0" tick could otherwise match a
  // stale "#0" and skip the deselect entirely.
  const signature =
    selection
      .map(
        (item) =>
          `${item.screenId}:${item.info.sourceId ?? item.info.selector ?? ""}`,
      )
      .join("|") + `#${intent.additive ? "1" : "0"}`;
  if (selection.length > 0) {
    if (lastMarqueeSelectionSignatureRef.current === signature) return;
  }
  lastMarqueeSelectionSignatureRef.current = signature;

  pendingOverviewScreenSelectionRef.current = null;
  pendingOverviewLayerSelectionRef.current = null;
  clearPendingOverviewLayerSelectionTimer();
  setCreatedOverviewLayerSelection(null);

  const resolved = selection
    .map((item) => {
      const projection = getCodeLayerProjectionForScreen(item.screenId);
      if (!projection) return null;
      const canonical = canonicalizeElementInfoFromProjection(
        projection,
        item.info,
      );
      const node = resolveCodeLayerNodeFromElementInfo(projection, canonical);
      if (!node || isScreenRootElementInfo(canonical)) return null;
      return {
        screenId: item.screenId,
        node,
        elementInfo: canonical,
      };
    })
    .filter(
      (
        item,
      ): item is {
        screenId: string;
        node: CodeLayerNode;
        elementInfo: ElementInfo;
      } => Boolean(item),
    );

  const hitLayerIds = dedupeStringIds(resolved.map((item) => item.node.id));
  setSelectedLayerIdsState((current) =>
    intent.additive
      ? dedupeStringIds([
          ...current.filter((layerId) => !layerId.startsWith("__")),
          ...hitLayerIds,
        ])
      : hitLayerIds,
  );
  if (viewModeRef.current === "overview") {
    setOverviewSelectedScreenIds([]);
  }

  const primary = resolved[resolved.length - 1];
  if (primary) {
    setActiveFileId(primary.screenId);
    setSelectedElement(primary.elementInfo);
    focusDesignInspectorForSelection();
  } else if (
    hasActiveSelectionRef.current &&
    shouldClearBridgeSelectionOnEmptyMarquee({
      resolvedCount: resolved.length,
      additive: intent.additive,
    })
  ) {
    // B5-1: an empty-space click (zero-hit marquee) must deselect an
    // in-screen/bridge element selection too, not just the host
    // selectedElement state. Without bumping this counter, the iframe's
    // own selection-overlay highlight (set via the bridge for an
    // in-screen element) never gets the clear signal and keeps
    // rendering, mirroring the same clear used by Escape (~20428).
    //
    // Gated on hasActiveSelectionRef so that empty ticks during a
    // blank-canvas marquee drag (which now always reach here, since empty
    // sets are no longer deduped) don't bump the clear counter on every
    // mousemove when there is nothing selected to clear.
    setSelectedElement(null);
    setOverviewClearSelectionRequest((request) => request + 1);
  }

  setActiveTool("move");
  setMode("edit");
}
