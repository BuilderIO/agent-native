import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";
import { buildCodeLayerProjection } from "@shared/code-layer";

import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import type { LiveScreenSnapshot } from "@/pages/design-editor/command-types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { setCodeLayerAttributeInHtml } from "@/pages/design-editor/html-layer-positioning";
import { hasScopedLayerState } from "@/pages/design-editor/layer-state-scope";
import { resolveOverviewScreenSourceType } from "@/pages/design-editor/pending-edits";
import type { DesignFile } from "@/pages/design-editor/types";

export interface ToggleLayerLockedArgs {
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
  applyLayerStatePreview: (
    screenId: string,
    layerId: string,
    state: "hidden" | "locked",
    enabled: boolean,
  ) => void;
  canEditDesign: boolean;
  codeLayerOwnerByNodeId: Map<
    string,
    {
      fileId: string;
      node: CodeLayerNode;
      tree: CodeLayerTreeNode[];
      runtimeOnly: boolean;
    }
  >;
  designSourceType: "inline" | "localhost" | "fusion";
  files: DesignFile[];
  getFreshActiveContent: () => string;
  liveScreenSnapshotsById: Record<string, LiveScreenSnapshot>;
  lockedLayerIds: Set<string>;
  overviewScreens: OverviewScreen[];
  recordPendingLiveLayerStateEdit: (
    layerId: string,
    state: "hidden" | "locked",
    enabled: boolean,
    originalEnabled: boolean,
  ) => boolean;
  sendRuntimeLayerStateSemanticHandoff: (
    layerId: string,
    state: "locked" | "hidden",
    enabled: boolean,
  ) => true | "preview-only" | false;
  syncLiveScreenSnapshotPreview: (screenId: string, html: string) => void;
  updateLiveScreenSnapshotContent: (
    screenId: string,
    html: string,
    options?: { recordHistory?: boolean },
  ) => boolean;
}

export function runToggleLayerLocked(
  {
    activeFile,
    applyFileContentUpdate,
    applyLayerStatePreview,
    canEditDesign,
    codeLayerOwnerByNodeId,
    designSourceType,
    files,
    getFreshActiveContent,
    liveScreenSnapshotsById,
    lockedLayerIds,
    overviewScreens,
    recordPendingLiveLayerStateEdit,
    sendRuntimeLayerStateSemanticHandoff,
    syncLiveScreenSnapshotPreview,
    updateLiveScreenSnapshotContent,
  }: ToggleLayerLockedArgs,
  layerId: string,
  locked: boolean,
) {
  if (!canEditDesign) return;
  const owner = codeLayerOwnerByNodeId.get(layerId);
  const layerScreenId =
    owner?.fileId ??
    (files.some((file) => file.id === layerId)
      ? layerId
      : (activeFile?.id ?? layerId));
  if (hasScopedLayerState(lockedLayerIds, layerScreenId, layerId) === locked)
    return;
  const ownerScreen = owner
    ? overviewScreens.find((screen) => screen.id === owner.fileId)
    : undefined;
  if (
    owner &&
    resolveOverviewScreenSourceType(ownerScreen, designSourceType) ===
      "localhost" &&
    recordPendingLiveLayerStateEdit(layerId, "locked", locked, !locked)
  ) {
    applyLayerStatePreview(layerScreenId, layerId, "locked", locked);
    return;
  }
  if (owner?.runtimeOnly) {
    if (
      sendRuntimeLayerStateSemanticHandoff(layerId, "locked", locked) === false
    ) {
      return;
    }
    applyLayerStatePreview(layerScreenId, layerId, "locked", locked);
    return;
  }
  if (files.some((file) => file.id === layerId)) {
    applyLayerStatePreview(layerScreenId, layerId, "locked", locked);
    return;
  }
  const node = owner?.node;
  if (!owner || !node) {
    applyLayerStatePreview(layerScreenId, layerId, "locked", locked);
    return;
  }
  // BUG-LOCK-HIDE-LIVE-SNAPSHOT: same fix as handleDeleteSelection —
  // getFreshActiveContent()/file.content is a bare URL for a
  // localhost/live-snapshot screen, so setCodeLayerAttributeInHtml below
  // could never find `node` in it and this write silently no-opped.
  // `node` itself is unusable against the live snapshot HTML too:
  // setCodeLayerAttributeInHtml indexes by node.source.openStart/openEnd,
  // raw offsets into whatever string the RUNTIME projection parsed
  // (runtimeLayerSnapshotsById), not the separately-tracked live
  // snapshot — re-resolve a node from that exact content by the one id
  // that's stable across both (see codeLayerOwnerByNodeId's matching
  // note above).
  const liveSnapshot = liveScreenSnapshotsById[owner.fileId];
  const nodeIdAttr = node.dataAttributes["data-agent-native-node-id"];
  const liveNode =
    liveSnapshot && nodeIdAttr
      ? buildCodeLayerProjection(liveSnapshot.html).nodes.find(
          (candidate) =>
            candidate.dataAttributes["data-agent-native-node-id"] ===
            nodeIdAttr,
        )
      : undefined;
  const sourceFile = files.find((file) => file.id === owner.fileId);
  const sourceContent =
    liveSnapshot?.html ??
    (owner.fileId === activeFile?.id
      ? getFreshActiveContent()
      : (sourceFile?.content ?? ""));
  const targetNode = liveSnapshot ? liveNode : node;
  if (sourceContent && targetNode) {
    const nextContent = setCodeLayerAttributeInHtml(
      sourceContent,
      targetNode,
      "data-agent-native-locked",
      locked ? "true" : null,
    );
    if (nextContent && nextContent !== sourceContent) {
      if (liveSnapshot) {
        updateLiveScreenSnapshotContent(owner.fileId, nextContent);
        syncLiveScreenSnapshotPreview(owner.fileId, nextContent);
      } else {
        applyFileContentUpdate(owner.fileId, nextContent, {
          refreshPreview: false,
        });
      }
    }
  }
  applyLayerStatePreview(layerScreenId, layerId, "locked", locked);
}
