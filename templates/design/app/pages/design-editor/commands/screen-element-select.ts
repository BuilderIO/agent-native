import type { CodeLayerProjection } from "@shared/code-layer";
import {
  applyVisualEdit,
  ensureCodeLayerNodeIdsInHtml,
} from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type {
  ElementInfo,
  ElementSelectionIntent,
} from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  canonicalizeElementInfoFromProjection,
  resolveCodeLayerNodeFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import {
  dedupeStringIds,
  isScreenRootElementInfo,
  shouldIgnoreOverviewLayerCreationEcho,
} from "@/pages/design-editor/selection-state";
import type { DesignTool, EditorMode } from "@/pages/design-editor/types";

export interface ScreenElementSelectArgs {
  activeBreakpointWidthStateRef: RefObject<number | undefined>;
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
  clearPendingOverviewLayerSelectionTimer: () => void;
  focusDesignInspectorForSelection: () => void;
  getCodeLayerProjectionForScreen: (
    screenId: string,
  ) => CodeLayerProjection | null;
  getScreenContent: (screenId: string) => string;
  handleBreakpointBarSelect: (widthPx: number | undefined) => void;
  id: string | undefined;
  pendingOverviewLayerSelectionRef: RefObject<string | null>;
  pendingOverviewScreenSelectionRef: RefObject<string | null>;
  selectedLayerIdsState: string[];
  setActiveFileId: Dispatch<SetStateAction<string | null>>;
  setActiveTool: Dispatch<SetStateAction<DesignTool>>;
  setCreatedOverviewLayerSelection: Dispatch<
    SetStateAction<{ screenId: string; layerId: string } | null>
  >;
  setHoveredElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setHoveredElementScreenId: Dispatch<SetStateAction<string | null>>;
  setMode: Dispatch<SetStateAction<EditorMode>>;
  setOverviewSelectedScreenIds: Dispatch<SetStateAction<string[]>>;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  shouldPreserveBlockedOverviewLayerSelectionRef: RefObject<
    (screenId: string) => boolean
  >;
  t: (key: string, options?: Record<string, unknown>) => string;
  viewModeRef: RefObject<"single" | "overview">;
}

export function runScreenElementSelect(
  {
    activeBreakpointWidthStateRef,
    applyFileContentUpdate,
    clearPendingOverviewLayerSelectionTimer,
    focusDesignInspectorForSelection,
    getCodeLayerProjectionForScreen,
    getScreenContent,
    handleBreakpointBarSelect,
    id,
    pendingOverviewLayerSelectionRef,
    pendingOverviewScreenSelectionRef,
    selectedLayerIdsState,
    setActiveFileId,
    setActiveTool,
    setCreatedOverviewLayerSelection,
    setHoveredElement,
    setHoveredElementScreenId,
    setMode,
    setOverviewSelectedScreenIds,
    setSelectedElement,
    setSelectedLayerIdsState,
    shouldPreserveBlockedOverviewLayerSelectionRef,
    t,
    viewModeRef,
  }: ScreenElementSelectArgs,
  screenId: string,
  info: ElementInfo,
  intent?: ElementSelectionIntent,
  options: {
    persistPendingNodeId?: boolean;
    breakpointWidthPx?: number;
  } = {},
) {
  const pendingLayerId = pendingOverviewLayerSelectionRef.current;
  const pendingScreenId = pendingOverviewScreenSelectionRef.current;
  const projection = getCodeLayerProjectionForScreen(screenId);
  const canonical = projection
    ? canonicalizeElementInfoFromProjection(projection, info)
    : info;
  const node = projection
    ? resolveCodeLayerNodeFromElementInfo(projection, canonical)
    : null;
  if (
    shouldIgnoreOverviewLayerCreationEcho({
      pendingLayerId,
      pendingScreenId,
      screenId,
      info: canonical,
      resolvedLayerId: node?.id,
      event: "select",
    })
  ) {
    return;
  }
  pendingOverviewScreenSelectionRef.current = null;
  pendingOverviewLayerSelectionRef.current = null;
  clearPendingOverviewLayerSelectionTimer();
  setCreatedOverviewLayerSelection(null);
  if (
    shouldPreserveBlockedOverviewLayerSelectionRef.current(screenId) &&
    (isScreenRootElementInfo(canonical) ||
      !node ||
      selectedLayerIdsState.includes(node.id))
  ) {
    return;
  }
  // Node-id integrity (id-on-demand): AI-generated/duplicated screens
  // frequently ship elements with a missing or empty-string
  // `data-agent-native-node-id` — every id-keyed operation on that
  // element (move/reorder, style commits that resolve a targetNode,
  // motion tracks, scrub) then silently no-ops or throws "Node with
  // data-agent-native-node-id=\"\" not found in sourceHtml". The bridge
  // (editor-chrome.bridge.ts's getElementInfo) mints a durable
  // `pendingNodeId` on the SELECTION payload whenever it can't resolve a
  // stable id for the element (`!sourceId`) and exposes it as
  // `canonical.pendingNodeId`; persist it as the element's real
  // `data-agent-native-node-id` right now via the same deterministic,
  // guarded write path every other edit uses (applyVisualEdit's new
  // "attribute" intent + applyFileContentUpdate), so every subsequent
  // id-keyed op against this element resolves normally afterward. This is
  // more reliable than resolving through the host's own static-HTML
  // projection (`node`, below) — the bridge already knows the live DOM
  // element and its working selector candidates even when the host's
  // positional-selector projection match drifts.
  const pendingNodeId = (canonical as { pendingNodeId?: string }).pendingNodeId;
  if (
    options.persistPendingNodeId !== false &&
    !isScreenRootElementInfo(canonical) &&
    pendingNodeId &&
    !canonical.sourceId &&
    canonical.selector
  ) {
    const rawContent = getScreenContent(screenId);
    if (rawContent) {
      const result = applyVisualEdit(
        rawContent,
        {
          kind: "attribute",
          target: { selector: canonical.selector },
          name: "data-agent-native-node-id",
          value: pendingNodeId,
        },
        {
          source: { kind: "design-file", designId: id, fileId: screenId },
        },
      );
      if (result.result.status === "applied" && result.content !== rawContent) {
        applyFileContentUpdate(screenId, result.content, {
          recordHistory: false,
        });
      }
    }
  } else if (
    options.persistPendingNodeId !== false &&
    // Fallback sweep: an element the bridge didn't mint a pendingNodeId
    // for (older bridge instance, or a node resolved only through the
    // host's own projection) but that still lacks a stable id per the
    // host's own projection match. Runs the whole-document stamp helper
    // so any other id-less siblings pick up ids in the same pass too.
    !isScreenRootElementInfo(canonical) &&
    node &&
    !node.dataAttributes["data-agent-native-node-id"]?.trim()
  ) {
    const rawContent = getScreenContent(screenId);
    if (rawContent) {
      const stamped = ensureCodeLayerNodeIdsInHtml(rawContent, {
        source: { kind: "design-file", designId: id, fileId: screenId },
      });
      if (stamped.changed && stamped.content !== rawContent) {
        applyFileContentUpdate(screenId, stamped.content, {
          recordHistory: false,
        });
      }
    }
  }
  // Known limitation: elements rendered from a `<template x-for>`
  // repeater (common in AI-generated Alpine.js list/task UIs) have no
  // per-instance static DOM node in the SOURCE HTML at all — neither
  // resolveCodeLayerNodeFromElementInfo nor a selector-based
  // applyVisualEdit resolution can find a unique per-instance node to
  // stamp. Fixing that requires the code-layer projection itself to
  // model `<template>` repeater children as selectable/attributable
  // nodes, which is out of scope for this selection-time fix.
  const additiveSelection = Boolean(
    node &&
    (intent?.additive ||
      intent?.range ||
      intent?.shiftKey ||
      intent?.metaKey ||
      intent?.ctrlKey),
  );
  setActiveFileId(screenId);
  setSelectedElement(canonical);
  setHoveredElement(null);
  setHoveredElementScreenId(null);
  if (node && additiveSelection) {
    setSelectedLayerIdsState((current) => {
      const removeExisting =
        Boolean(intent?.metaKey || intent?.ctrlKey) &&
        !intent?.shiftKey &&
        current.includes(node.id);
      if (removeExisting) {
        const next = current.filter((layerId) => layerId !== node.id);
        return next.length > 0 ? next : [node.id];
      }
      return dedupeStringIds([...current, node.id]);
    });
  } else {
    setSelectedLayerIdsState(node ? [node.id] : []);
  }
  if (viewModeRef.current === "overview") {
    setOverviewSelectedScreenIds([]);
    // A responsive sub-frame now owns a full editor bridge, so selection
    // carries its exact width into the edit scope. Primary-frame clicks
    // still return to Base. This prevents two identical selectors in the
    // base and responsive runtimes from racing for one global scope.
    if (options.breakpointWidthPx !== undefined) {
      handleBreakpointBarSelect(options.breakpointWidthPx);
      const guidanceKey = `design-responsive-edit-guidance:${id}:${screenId}`;
      if (window.localStorage.getItem(guidanceKey) !== "shown") {
        window.localStorage.setItem(guidanceKey, "shown");
        toast.info(t("designEditor.breakpointBar.scope.firstEditGuidance"), {
          duration: 6000,
        });
      }
    } else if (activeBreakpointWidthStateRef.current !== undefined) {
      handleBreakpointBarSelect(undefined);
    }
  }
  setActiveTool("move");
  setMode("edit");
  focusDesignInspectorForSelection();
}
