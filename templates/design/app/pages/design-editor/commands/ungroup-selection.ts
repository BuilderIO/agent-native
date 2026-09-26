import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";
import { applyVisualEdit, buildCodeLayerProjection } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import { trace } from "@/components/design/design-trace";
import type { ElementInfo } from "@/components/design/types";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import {
  codeLayerPatchMessage,
  elementInfoFromCodeLayerNode,
} from "@/pages/design-editor/code-layer-state";
import { buildActiveFileNodeIdSet } from "@/pages/design-editor/selection-state";
import type { DesignFile } from "@/pages/design-editor/types";

import type { ApplyLocalContentUpdateResult } from "./apply-local-content-update";
import {
  dispatchLinkedComponentStructure,
  type ApplyLinkedComponentEdit,
} from "./linked-component-structure";
import {
  mapAcceptedSelectionNode,
  projectAcceptedSource,
} from "./selection-publication";

export interface UngroupSelectionArgs {
  applyLinkedComponentEdit?: ApplyLinkedComponentEdit;
  activeFile: DesignFile;
  applyLocalContentUpdate: (
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      immediateSave?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      historyBeforeContent?: string;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => ApplyLocalContentUpdateResult;
  canEditDesign: boolean;
  codeLayerOwnerByNodeIdRef: RefObject<
    Map<
      string,
      {
        fileId: string;
        node: CodeLayerNode;
        tree: CodeLayerTreeNode[];
        runtimeOnly: boolean;
      }
    >
  >;
  files: DesignFile[];
  getFreshActiveContent: () => string;
  selectedLayerIdsState: string[];
  sendRuntimeLayerSemanticHandoff: (
    operation: "group" | "ungroup" | "auto-layout",
    layerIds: readonly string[],
    options?: {
      desiredChange?: string;
      description?: string;
      commandContext?: string;
    },
  ) => boolean;
  setSelectedElement: Dispatch<SetStateAction<ElementInfo | null>>;
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runUngroupSelection({
  applyLinkedComponentEdit,
  activeFile,
  applyLocalContentUpdate,
  canEditDesign,
  codeLayerOwnerByNodeIdRef,
  files,
  getFreshActiveContent,
  selectedLayerIdsState,
  sendRuntimeLayerSemanticHandoff,
  setSelectedElement,
  setSelectedLayerIdsState,
  t,
}: UngroupSelectionArgs) {
  trace("structure", "ungroup", { layers: selectedLayerIdsState.length });
  if (!canEditDesign || !activeFile) return;
  const selectedRuntimeLayerIds = selectedLayerIdsState.filter(
    (layerId) => codeLayerOwnerByNodeIdRef.current.get(layerId)?.runtimeOnly,
  );
  if (selectedRuntimeLayerIds.length > 0) {
    sendRuntimeLayerSemanticHandoff("ungroup", selectedRuntimeLayerIds);
    return;
  }
  const initialContent = getFreshActiveContent();
  const source = { kind: "design-file" as const, fileId: activeFile.id };
  const fileIds = new Set(files.map((f) => f.id));
  const activeNodeIdSet = buildActiveFileNodeIdSet(
    buildCodeLayerProjection(initialContent, { source }),
  );
  const targetIds = selectedLayerIdsState.filter(
    (id) => !id.startsWith("__") && !fileIds.has(id) && activeNodeIdSet.has(id),
  );
  if (targetIds.length === 0) return;
  if (
    dispatchLinkedComponentStructure({
      content: initialContent,
      source,
      intents: targetIds.map((targetId) => ({ kind: "unwrap", targetId })),
      applyLinkedComponentEdit,
    })
  )
    return;

  let content = initialContent;
  let anySucceeded = false;
  let lastFailureMessage: string | null = null;
  const releasedChildAttrIds = new Set<string>();
  for (const targetId of targetIds) {
    const runningProjection = buildCodeLayerProjection(content, { source });
    const containerNode = runningProjection.nodes.find(
      (n) =>
        n.dataAttributes["data-agent-native-node-id"] === targetId ||
        n.id === targetId,
    );
    const childNodeIds = containerNode?.children ?? [];
    const childAttrIds = childNodeIds
      .map(
        (childId) =>
          runningProjection.nodes.find((n) => n.id === childId)?.dataAttributes[
            "data-agent-native-node-id"
          ],
      )
      .filter((attrId): attrId is string => Boolean(attrId));

    const patch = applyVisualEdit(
      content,
      {
        kind: "unwrap",
        targetId,
      },
      { source },
    );
    if (patch.result.status !== "applied") {
      lastFailureMessage = patch.result.message ?? lastFailureMessage;
      continue;
    }
    content = patch.content;
    anySucceeded = true;
    childAttrIds.forEach((attrId) => releasedChildAttrIds.add(attrId));
  }

  if (!anySucceeded) {
    toast.error(
      codeLayerPatchMessage(
        lastFailureMessage,
        t("designEditor.toasts.layerMoveFailed"),
        t,
      ),
      { duration: 4000 },
    );
    return;
  }
  if (lastFailureMessage) {
    toast.error(
      codeLayerPatchMessage(
        lastFailureMessage,
        t("designEditor.toasts.layerMoveFailed"),
        t,
      ),
      { duration: 4000 },
    );
  }

  const submittedProjection = buildCodeLayerProjection(content, { source });
  const releasedNodeCandidates = submittedProjection.nodes.filter((n) => {
    const attrId = n.dataAttributes["data-agent-native-node-id"];
    return attrId ? releasedChildAttrIds.has(attrId) : false;
  });
  const publication = applyLocalContentUpdate(content, {
    forcePreviewFullDocument: true,
  });
  if (publication.status !== "accepted") return;
  const acceptedProjection = projectAcceptedSource(publication, source);
  const releasedNodes = releasedNodeCandidates
    .map((node) =>
      mapAcceptedSelectionNode(publication, acceptedProjection, node),
    )
    .filter((node): node is NonNullable<typeof node> => node !== null);
  if (releasedNodes.length > 0) {
    setSelectedLayerIdsState(releasedNodes.map((n) => n.id));
    const lastReleasedNode = releasedNodes[releasedNodes.length - 1];
    if (lastReleasedNode) {
      setSelectedElement(elementInfoFromCodeLayerNode(lastReleasedNode));
    }
  } else {
    setSelectedElement(null);
    setSelectedLayerIdsState([]);
  }
}
