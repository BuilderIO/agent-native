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
    setSelectedElement(null);
    setOverviewClearSelectionRequest((request) => request + 1);
  }

  setActiveTool(resolveToolAfterSelection);
  setMode("edit");
}

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
