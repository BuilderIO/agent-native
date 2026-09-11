import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";

import type { ElementInfo } from "@/components/design/types";
import { extractDesignClipboardManagedStyles } from "@/lib/design-clipboard-managed-styles";
import { resolveClipboardLayerSourceHtml } from "@/pages/design-editor/clipboard-layer-source";
import { getElementOuterHtml } from "@/pages/design-editor/clone-and-pen-edit";
import {
  collectCodeLayerAncestors,
  resolveCodeLayerNodeFromElementInfo,
} from "@/pages/design-editor/code-layer-state";
import type {
  LiveScreenSnapshot,
  RuntimeLayerSnapshot,
  SelectedCanvasLayerSnapshot,
} from "@/pages/design-editor/command-types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { shouldUseRuntimeLayerProjection } from "@/pages/design-editor/pending-edits";
import type { DesignFile } from "@/pages/design-editor/types";

export interface GetSelectedLayerSnapshotsArgs {
  activeFile: DesignFile;
  designSourceType: "inline" | "localhost" | "fusion";
  files: DesignFile[];
  getFreshActiveContent: () => string;
  getScreenContent: (screenId: string) => string;
  liveScreenSnapshotsById: Record<string, LiveScreenSnapshot>;
  overviewScreens: OverviewScreen[];
  runtimeLayerSnapshotsById: Record<string, RuntimeLayerSnapshot>;
  selectedElement: ElementInfo | null;
  selectedElementLayerId: string | null;
  selectedLayerIdsState: string[];
}

export function runGetSelectedLayerSnapshots({
  activeFile,
  designSourceType,
  files,
  getFreshActiveContent,
  getScreenContent,
  liveScreenSnapshotsById,
  overviewScreens,
  runtimeLayerSnapshotsById,
  selectedElement,
  selectedElementLayerId,
  selectedLayerIdsState,
}: GetSelectedLayerSnapshotsArgs) {
  const fileIds = new Set(files.map((file) => file.id));
  const candidateIds = selectedLayerIdsState.filter(
    (layerId) => layerId && !layerId.startsWith("__") && !fileIds.has(layerId),
  );
  if (
    selectedElementLayerId &&
    !candidateIds.includes(selectedElementLayerId)
  ) {
    candidateIds.push(selectedElementLayerId);
  }

  const snapshots: SelectedCanvasLayerSnapshot[] = [];
  for (const file of files) {
    // A hydrated localhost app has two snapshots: `/snapshot` is the source
    // or SSR shell, while the runtime layer snapshot is the DOM the user can
    // actually see and select. Layers already prefers that rendered tree, so
    // Copy must resolve against the same id namespace or client-rendered
    // React/Vue/Svelte nodes silently produce an empty clipboard.
    const runtimeProjectionEligible = shouldUseRuntimeLayerProjection({
      screen: overviewScreens.find((screen) => screen.id === file.id),
      fallbackSourceType: designSourceType,
      content: file.content ?? "",
    });
    const runtimeSnapshot = runtimeProjectionEligible
      ? runtimeLayerSnapshotsById[file.id]
      : undefined;
    const content = resolveClipboardLayerSourceHtml({
      runtimeProjectionEligible,
      runtimeSnapshot,
      liveSnapshotHtml: liveScreenSnapshotsById[file.id]?.html,
      storedContent: getScreenContent(file.id),
    });
    if (!content) continue;
    const projection = buildCodeLayerProjection(content);
    const tree = buildCodeLayerTree(projection);
    for (const layerId of candidateIds) {
      const node = projection.nodes.find(
        (candidate) =>
          candidate.id === layerId ||
          candidate.dataAttributes["data-agent-native-node-id"] === layerId,
      );
      if (!node?.source) continue;
      const html = content.slice(node.source.start, node.source.end);
      const portableStyleSnapshot =
        selectedElementLayerId &&
        node.id === selectedElementLayerId &&
        selectedElement?.portableStyleSnapshot
          ? selectedElement.portableStyleSnapshot
          : undefined;
      snapshots.push({
        html,
        rootNodeId: node.dataAttributes["data-agent-native-node-id"] ?? node.id,
        sourceFileId: file.id,
        portableStyleSnapshot,
        managedStyleSnapshot: extractDesignClipboardManagedStyles(
          content,
          html,
        ),
        node,
        sourceIndex: node.source.start,
        tree,
      });
    }
  }

  if (snapshots.length === 0 && activeFile && selectedElement?.selector) {
    const runtimeProjectionEligible = shouldUseRuntimeLayerProjection({
      screen: overviewScreens.find((screen) => screen.id === activeFile.id),
      fallbackSourceType: designSourceType,
      content: activeFile.content ?? "",
    });
    const runtimeSnapshot = runtimeProjectionEligible
      ? runtimeLayerSnapshotsById[activeFile.id]
      : undefined;
    const content = resolveClipboardLayerSourceHtml({
      runtimeProjectionEligible,
      runtimeSnapshot,
      liveSnapshotHtml: liveScreenSnapshotsById[activeFile.id]?.html,
      storedContent: getFreshActiveContent(),
    });
    const projection = buildCodeLayerProjection(content);
    const tree = buildCodeLayerTree(projection);
    const node = resolveCodeLayerNodeFromElementInfo(
      projection,
      selectedElement,
    );
    const html = node?.source
      ? content.slice(node.source.start, node.source.end)
      : getElementOuterHtml(content, selectedElement.selector);
    if (html && node) {
      snapshots.push({
        html,
        rootNodeId:
          node.dataAttributes["data-agent-native-node-id"] ??
          selectedElement.sourceId ??
          selectedElement.id,
        sourceFileId: activeFile.id,
        portableStyleSnapshot: selectedElement.portableStyleSnapshot,
        managedStyleSnapshot: extractDesignClipboardManagedStyles(
          content,
          html,
        ),
        node,
        sourceIndex: node.source?.start ?? Number.MAX_SAFE_INTEGER,
        tree,
      });
    }
  }

  const selectedKeys = new Set(
    snapshots.map((snapshot) => `${snapshot.sourceFileId}:${snapshot.node.id}`),
  );
  const topLevelSnapshots = snapshots.filter(
    (snapshot) =>
      !collectCodeLayerAncestors(snapshot.tree, snapshot.node.id).some(
        (ancestorId) =>
          selectedKeys.has(`${snapshot.sourceFileId}:${ancestorId}`),
      ),
  );
  const fileOrder = new Map(files.map((file, index) => [file.id, index]));
  return topLevelSnapshots.sort((a, b) => {
    const fileDelta =
      (fileOrder.get(a.sourceFileId) ?? 0) -
      (fileOrder.get(b.sourceFileId) ?? 0);
    if (fileDelta !== 0) return fileDelta;
    return a.sourceIndex - b.sourceIndex;
  });
}
