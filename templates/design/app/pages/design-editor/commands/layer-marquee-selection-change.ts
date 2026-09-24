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
  resolveMarqueeAdditive,
  shouldClearBridgeSelectionOnEmptyMarquee,
} from "@/pages/design-editor/selection-state";
import { resolveToolAfterSelection } from "@/pages/design-editor/tool-state";
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
  renderedElementInfoByLayerKeyRef?: RefObject<Map<string, ElementInfo>>;
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

export function runMarqueeSelectionCancellation<T>({
  before,
  flushSync,
  restoreHostSelection,
  restoreSelectionSnapshot,
  run,
  selectedElementBefore,
  setSelectedElement,
}: {
  before: T | null;
  flushSync: (callback: () => void) => void;
  restoreHostSelection: boolean;
  restoreSelectionSnapshot: (selection: T) => void;
  run: () => void;
  selectedElementBefore: ElementInfo | null;
  setSelectedElement: (element: ElementInfo | null) => void;
}) {
  if (before && restoreHostSelection) {
    flushSync(() => {
      restoreSelectionSnapshot(before);
      setSelectedElement(selectedElementBefore);
      run();
    });
    return;
  }
  run();
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
    renderedElementInfoByLayerKeyRef,
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
): void {
  if (intent.cancelled) {
    pendingOverviewScreenSelectionRef.current = null;
    pendingOverviewLayerSelectionRef.current = null;
    lastMarqueeSelectionSignatureRef.current = null;
    clearPendingOverviewLayerSelectionTimer();
    return;
  }
  const additive = resolveMarqueeAdditive(intent);
  // PF10: MultiScreenCanvas reports the marquee hit-set on every
  // mousemove tick during a drag, not just on settle (see
  // reportLayerSelection in MultiScreenCanvas.tsx). Bail before any
  // projection/canonicalization work when an interim reported set is
  // identical to the last tick's — the common case while the marquee rect
  // isn't currently crossing an element boundary. The final tick still runs
  // so its canonical payload is never dropped.
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
      .join("|") + `#${additive ? "1" : "0"}`;
  if (selection.length > 0 && intent.final !== true) {
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
      const node = resolveCodeLayerNodeFromElementInfo(projection, item.info);
      const canonical = canonicalizeElementInfoFromProjection(
        projection,
        item.info,
        item.screenId,
        node,
      );
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
  resolved.forEach((item) => {
    renderedElementInfoByLayerKeyRef?.current.set(
      `${item.screenId}:${item.node.id}`,
      item.elementInfo,
    );
    const stableId = item.node.dataAttributes["data-agent-native-node-id"];
    if (stableId) {
      renderedElementInfoByLayerKeyRef?.current.set(
        `${item.screenId}:${stableId}`,
        item.elementInfo,
      );
    }
  });
  setSelectedLayerIdsState((current) =>
    additive
      ? dedupeStringIds([
          ...current.filter((layerId) => !layerId.startsWith("__")),
          ...hitLayerIds,
        ])
      : hitLayerIds,
  );
  // A marquee gesture already drives top-level screen selection itself
  // (MultiScreenCanvas's own selectedIds -> onScreenSelectionChange), always
  // paired with the layer report it sends here — including the one a
  // fully-enclosed screen produces, whose layer selection is empty by
  // design (screens are excluded from candidates). Clearing screen
  // selection again from that empty report would stomp the screen the
  // marquee just selected; only a pointer/keyboard pick needs this handler
  // to clear it, since nothing else does for those sources.
  if (viewModeRef.current === "overview" && intent.source !== "marquee") {
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
      additive,
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

  setActiveTool(resolveToolAfterSelection);
  setMode("edit");
}

/**
 * A live marquee drag reports a changed hit-set on every mousemove tick (see
 * the PF10 dedup comment above), so recording a selection-history entry
 * around every call it drives would record one undo step per tick instead
 * of Figma's "one drag = one undo step". `pendingBefore` mirrors "what was
 * selected before this gesture's first tick" across the whole live drag —
 * call this once per tick with the gesture's own `final` flag (true only
 * for the mouseup-driven report the canvas sends once the drag ends) and
 * the selection snapshots captured immediately before/after this tick's own
 * selection-changing work ran. Returns the {before, after} pair to record
 * on the final tick only; every earlier tick returns null (nothing to
 * record yet, but `pendingBefore` now remembers the gesture's start).
 */
export function coalesceMarqueeSelectionHistory<T>(
  pendingBefore: { current: T | null },
  isFinal: boolean,
  beforeThisTick: T,
  afterThisTick: T,
): { before: T; after: T } | null {
  if (pendingBefore.current === null) {
    pendingBefore.current = beforeThisTick;
  }
  if (!isFinal) return null;
  const before = pendingBefore.current;
  pendingBefore.current = null;
  return { before, after: afterThisTick };
}
