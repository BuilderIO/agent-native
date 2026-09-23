import type { CodeLayerProjection } from "@shared/code-layer";
import { applyVisualEdit, buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type {
  ElementInfo,
  ElementSelectionIntent,
} from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  canonicalElementInfoForCodeLayerNode,
  canonicalizeElementInfoFromProjection,
  elementInfoFromCodeLayerNode,
  resolveCodeLayerNodeFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import type { ApplyFileContentUpdateResult } from "@/pages/design-editor/commands/apply-file-content-update";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "@/pages/design-editor/commands/selection-publication";
import { withMeasuredGeometry } from "@/pages/design-editor/editor-helpers";
import {
  dedupeStringIds,
  isScreenRootElementInfo,
  shouldIgnoreOverviewLayerCreationEcho,
} from "@/pages/design-editor/selection-state";
import { resolveToolAfterSelection } from "@/pages/design-editor/tool-state";
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
      historyBeforeContent?: string;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => ApplyFileContentUpdateResult;
  clearPendingOverviewLayerSelectionTimer: () => void;
  createdOverviewLayerSelection: { screenId: string; layerId: string } | null;
  focusDesignInspectorForSelection: () => void;
  getCodeLayerProjectionForScreen: (
    screenId: string,
  ) => CodeLayerProjection | null;
  getScreenContent: (screenId: string) => string;
  handleBreakpointBarSelect: (widthPx: number | undefined) => void;
  id: string | undefined;
  liveScreenIds?: ReadonlySet<string>;
  pendingOverviewLayerSelectionRef: RefObject<string | null>;
  pendingOverviewScreenSelectionRef: RefObject<string | null>;
  renderedElementInfoByLayerKeyRef?: RefObject<Map<string, ElementInfo>>;
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
    createdOverviewLayerSelection,
    focusDesignInspectorForSelection,
    getCodeLayerProjectionForScreen,
    getScreenContent,
    handleBreakpointBarSelect,
    id,
    liveScreenIds,
    pendingOverviewLayerSelectionRef,
    pendingOverviewScreenSelectionRef,
    renderedElementInfoByLayerKeyRef,
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
  const pendingScreenId =
    pendingOverviewScreenSelectionRef.current ??
    (createdOverviewLayerSelection?.layerId === pendingLayerId
      ? createdOverviewLayerSelection.screenId
      : null);
  let projection = getCodeLayerProjectionForScreen(screenId);
  let canonical = projection
    ? canonicalizeElementInfoFromProjection(projection, info, screenId)
    : info;
  let node = projection
    ? resolveCodeLayerNodeFromElementInfo(projection, canonical)
    : null;
  const ignoredLayerSelectionEcho = shouldIgnoreOverviewLayerCreationEcho({
    pendingLayerId,
    pendingScreenId,
    screenId,
    info: canonical,
    resolvedLayerId: node?.id,
    event: "select",
  });
  const blockedSelection =
    shouldPreserveBlockedOverviewLayerSelectionRef.current(screenId);
  const exactPendingLayerEcho =
    pendingLayerId !== null &&
    (node?.id === pendingLayerId ||
      (pendingScreenId === screenId &&
        node?.dataAttributes["data-agent-native-node-id"] ===
          pendingLayerId)) &&
    !isScreenRootElementInfo(canonical) &&
    (canonical.portableStyleSnapshot !== undefined ||
      canonical.styleSnapshotCaptureFailed === true) &&
    !blockedSelection;
  if (ignoredLayerSelectionEcho) {
    if (exactPendingLayerEcho) setSelectedElement(canonical);
    return false;
  }
  pendingOverviewScreenSelectionRef.current = null;
  pendingOverviewLayerSelectionRef.current = null;
  clearPendingOverviewLayerSelectionTimer();
  setCreatedOverviewLayerSelection(null);
  if (
    blockedSelection &&
    (isScreenRootElementInfo(canonical) ||
      !node ||
      selectedLayerIdsState.includes(node.id))
  ) {
    return false;
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
    !(liveScreenIds?.has(screenId) ?? false) &&
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
        const submittedProjection = buildCodeLayerProjection(result.content, {
          source: { kind: "design-file", designId: id, fileId: screenId },
        });
        const submittedNode = submittedProjection.nodes.find(
          (candidate) =>
            candidate.dataAttributes["data-agent-native-node-id"] ===
            pendingNodeId,
        );
        const publication = applyFileContentUpdate(screenId, result.content, {
          recordHistory: false,
          historyBeforeContent: rawContent,
        });
        if (publication.status === "accepted") {
          const acceptedProjection = projectAcceptedSource(publication, {
            kind: "design-file",
            designId: id,
            fileId: screenId,
          });
          node = mapAcceptedSelectionNode(
            publication,
            acceptedProjection,
            submittedNode,
          );
          if (node) {
            projection = acceptedProjection;
            canonical = withMeasuredGeometry(
              canonicalElementInfoForCodeLayerNode(canonical, node, screenId),
              screenId,
            );
          }
        }
      }
    }
  } else if (
    options.persistPendingNodeId !== false &&
    !(liveScreenIds?.has(screenId) ?? false) &&
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
      const publication = applyFileContentUpdate(screenId, rawContent, {
        recordHistory: false,
        historyBeforeContent: rawContent,
      });
      if (publication.status === "accepted") {
        const acceptedProjection = projectAcceptedSource(publication, {
          kind: "design-file",
          designId: id,
          fileId: screenId,
        });
        node = mapAcceptedSelectionNode(publication, acceptedProjection, node);
        if (node) {
          projection = acceptedProjection;
          canonical = withMeasuredGeometry(
            canonicalElementInfoForCodeLayerNode(canonical, node, screenId),
            screenId,
          );
        }
      }
    }
  }
  if (node) {
    if (viewModeRef.current === "overview") {
      // Activate the frame scope before caching its measurement. The scope
      // switch invalidates rendered metadata, so doing this after the write
      // drops the only responsive measurement for the selected layer.
      if (options.breakpointWidthPx !== undefined) {
        handleBreakpointBarSelect(options.breakpointWidthPx);
        const guidanceKey = `design-responsive-edit-guidance:${id}:${screenId}`;
        if (
          typeof window !== "undefined" &&
          window.localStorage.getItem(guidanceKey) !== "shown"
        ) {
          window.localStorage.setItem(guidanceKey, "shown");
          toast.info(t("designEditor.breakpointBar.scope.firstEditGuidance"), {
            duration: 6000,
          });
        }
      } else if (activeBreakpointWidthStateRef.current !== undefined) {
        handleBreakpointBarSelect(undefined);
      }
    }
    renderedElementInfoByLayerKeyRef?.current.set(
      `${screenId}:${node.id}`,
      canonical,
    );
    const stableId = node.dataAttributes["data-agent-native-node-id"];
    if (stableId) {
      renderedElementInfoByLayerKeyRef?.current.set(
        `${screenId}:${stableId}`,
        canonical,
      );
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
  // Figma spec §1: Shift+click is the only additive (union) click gesture.
  // Cmd/Ctrl+click alone deep-selects and REPLACES, same as a plain click —
  // it must not be OR'd in here, or a deep-selected child gets unioned onto
  // the container it was cycled out of instead of replacing it.
  const additiveSelection = Boolean(
    node && (intent?.additive || intent?.range || intent?.shiftKey),
  );
  setActiveFileId(screenId);
  setSelectedElement(canonical);
  setHoveredElement(null);
  setHoveredElementScreenId(null);
  if (node && additiveSelection) {
    // Figma spec §1: Shift+click toggles membership — an already-selected
    // object is removed, same as Screens' overview toggle
    // (MultiScreenCanvas.tsx's handleFrameClick). Cmd/Ctrl never reaches
    // here: additiveSelection above is shiftKey/additive/range only, so
    // this branch is exclusively the Shift gesture.
    if (selectedLayerIdsState.includes(node.id)) {
      // `selectedElement` was just set to the clicked node above, but that
      // node is the one being REMOVED — selectedCodeLayerNode (and the
      // inspector/motion tools it feeds) derives from selectedElement, so it
      // must follow the member that remains, not stay pointed at a node no
      // longer selected. Pick the same member Screens' own toggle would
      // (nextSelectedIds[nextSelectedIds.length - 1]).
      const remainingIds = selectedLayerIdsState.filter(
        (layerId) => layerId !== node.id,
      );
      const remainingId = remainingIds[remainingIds.length - 1];
      const remainingNode = remainingId
        ? (projection?.nodes.find(
            (candidate) => candidate.id === remainingId,
          ) ?? null)
        : null;
      setSelectedElement(
        remainingNode
          ? // elementInfoFromCodeLayerNode's boundingRect is always zero (it
            // has no live DOM to measure) — Shift+2 zoom-to-selection and
            // the inspector both need a real rect, so measure the live
            // preview node the same way projection-derived selections
            // already do elsewhere.
            withMeasuredGeometry(
              elementInfoFromCodeLayerNode(remainingNode),
              screenId,
            )
          : null,
      );
    }
    setSelectedLayerIdsState((current) =>
      current.includes(node.id)
        ? current.filter((layerId) => layerId !== node.id)
        : dedupeStringIds([...current, node.id]),
    );
  } else if (node) {
    // An intent-less select is the bridge re-anchoring after a content
    // replace, not a user picking one object, so it must not collapse a live
    // multi-selection down to the member it re-found.
    setSelectedLayerIdsState((current) =>
      !intent && current.length > 1 && current.includes(node.id)
        ? current
        : [node.id],
    );
  } else {
    setSelectedLayerIdsState([]);
  }
  if (viewModeRef.current === "overview") {
    // Mirrors the intent-less-echo guard on selectedLayerIdsState above: a
    // content-replace re-anchoring echo (no intent) must not clear a live
    // overview screen selection out from under the user — only a real pick
    // clears it.
    setOverviewSelectedScreenIds((current) =>
      !intent && current.length > 0 ? current : [],
    );
  }
  setActiveTool(resolveToolAfterSelection);
  setMode("edit");
  focusDesignInspectorForSelection();
  return true;
}
