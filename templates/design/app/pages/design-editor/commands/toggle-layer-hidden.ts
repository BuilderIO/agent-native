import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";
import { buildCodeLayerProjection } from "@shared/code-layer";

import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import type { LiveScreenSnapshot } from "@/pages/design-editor/command-types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { setCodeLayerAttributeInHtml } from "@/pages/design-editor/html-layer-positioning";
import { hasScopedLayerState } from "@/pages/design-editor/layer-state-scope";
import { resolveOverviewScreenSourceType } from "@/pages/design-editor/pending-edits";
import type { DesignFile } from "@/pages/design-editor/types";

export interface ToggleLayerHiddenArgs {
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
  hiddenLayerIds: Set<string>;
  liveScreenSnapshotsById: Record<string, LiveScreenSnapshot>;
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

export function runToggleLayerHidden(
  {
    activeFile,
    applyFileContentUpdate,
    applyLayerStatePreview,
    canEditDesign,
    codeLayerOwnerByNodeId,
    designSourceType,
    files,
    getFreshActiveContent,
    hiddenLayerIds,
    liveScreenSnapshotsById,
    overviewScreens,
    recordPendingLiveLayerStateEdit,
    sendRuntimeLayerStateSemanticHandoff,
    syncLiveScreenSnapshotPreview,
    updateLiveScreenSnapshotContent,
  }: ToggleLayerHiddenArgs,
  layerId: string,
  hidden: boolean,
) {
  if (!canEditDesign) return;
  const owner = codeLayerOwnerByNodeId.get(layerId);
  const layerScreenId =
    owner?.fileId ??
    (files.some((file) => file.id === layerId)
      ? layerId
      : (activeFile?.id ?? layerId));
  if (hasScopedLayerState(hiddenLayerIds, layerScreenId, layerId) === hidden)
    return;
  const ownerScreen = owner
    ? overviewScreens.find((screen) => screen.id === owner.fileId)
    : undefined;
  if (
    owner &&
    resolveOverviewScreenSourceType(ownerScreen, designSourceType) ===
      "localhost" &&
    recordPendingLiveLayerStateEdit(layerId, "hidden", hidden, !hidden)
  ) {
    applyLayerStatePreview(layerScreenId, layerId, "hidden", hidden);
    return;
  }
  if (owner?.runtimeOnly) {
    if (
      sendRuntimeLayerStateSemanticHandoff(layerId, "hidden", hidden) === false
    ) {
      return;
    }
    applyLayerStatePreview(layerScreenId, layerId, "hidden", hidden);
    return;
  }
  if (files.some((file) => file.id === layerId)) {
    applyLayerStatePreview(layerScreenId, layerId, "hidden", hidden);
    return;
  }
  const node = owner?.node;
  if (!owner || !node) {
    applyLayerStatePreview(layerScreenId, layerId, "hidden", hidden);
    return;
  }
  // BUG-LOCK-HIDE-LIVE-SNAPSHOT: see the matching note in
  // handleToggleLayerLocked, including why `node` has to be re-resolved
  // against the live snapshot content before it's usable there.
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
      "data-agent-native-hidden",
      hidden ? "true" : null,
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
  applyLayerStatePreview(layerScreenId, layerId, "hidden", hidden);
}
