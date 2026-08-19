import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import { sendToDesignAgentChat } from "@/lib/agent-chat";
import { elementInfoFromCodeLayerNode } from "@/pages/design-editor/code-layer-state";
import type { RuntimeLayerSnapshot } from "@/pages/design-editor/command-types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { runtimeMultiplicityForElementProvenance } from "@/pages/design-editor/editor-helpers";
import {
  reactSourceAnchorForPendingEdit,
  reactSourceAnchorUnavailableReason,
} from "@/pages/design-editor/pending-edits";
import { buildRuntimeReactStructureMoveHandoff } from "@/pages/design-editor/react-semantic-handoff";
import type { DesignLeftPanel } from "@/pages/design-editor/types";

export interface SendRuntimeLayerMoveSemanticHandoffArgs {
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
  localhostConnectionRootPathByIdRef: RefObject<Map<string, string>>;
  overviewScreens: OverviewScreen[];
  runtimeLayerSnapshotsById: Record<string, RuntimeLayerSnapshot>;
  setActiveLeftPanel: Dispatch<SetStateAction<DesignLeftPanel>>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runSendRuntimeLayerMoveSemanticHandoff(
  {
    codeLayerOwnerByNodeIdRef,
    localhostConnectionRootPathByIdRef,
    overviewScreens,
    runtimeLayerSnapshotsById,
    setActiveLeftPanel,
    t,
  }: SendRuntimeLayerMoveSemanticHandoffArgs,
  subjectLayerId: string,
  targetLayerId: string,
  placement: "before" | "after" | "inside",
): boolean {
  const subjectOwner = codeLayerOwnerByNodeIdRef.current.get(subjectLayerId);
  const targetOwner = codeLayerOwnerByNodeIdRef.current.get(targetLayerId);
  if (!subjectOwner || !targetOwner) return false;

  const sourceAnchorForOwner = (
    owner: typeof subjectOwner,
    anchorId: "subject" | "target",
  ) => {
    const screen = overviewScreens.find(
      (candidate) => candidate.id === owner.fileId,
    );
    const rootPath = screen?.connectionId
      ? localhostConnectionRootPathByIdRef.current.get(screen.connectionId)
      : undefined;
    const info = elementInfoFromCodeLayerNode(owner.node);
    return reactSourceAnchorForPendingEdit({
      info,
      id: anchorId,
      rootPath,
      runtimeMultiplicity: runtimeMultiplicityForElementProvenance(
        runtimeLayerSnapshotsById,
        info,
      ),
      reason:
        anchorId === "subject"
          ? `Runtime Layers-panel move subject in screen ${owner.fileId}.`
          : `Runtime Layers-panel move target in screen ${owner.fileId}.`,
    });
  };

  const subjectAnchor = sourceAnchorForOwner(subjectOwner, "subject");
  const targetAnchor = sourceAnchorForOwner(targetOwner, "target");
  if (!subjectAnchor || !targetAnchor) {
    // Mixed runtime/source moves are only safe when BOTH endpoints carry
    // exact compiler provenance. Never fall back to selectors or a generic
    // source/AST move for the missing side.
    toast.error(
      reactSourceAnchorUnavailableReason([
        elementInfoFromCodeLayerNode(subjectOwner.node),
        elementInfoFromCodeLayerNode(targetOwner.node),
      ])
        ? t("designEditor.toasts.reactSourceAnchorsUnavailable")
        : t("designEditor.toasts.reactSourceAnchorsLoading"),
    );
    return true;
  }

  const handoff = buildRuntimeReactStructureMoveHandoff({
    subjectAnchor,
    targetAnchor,
    placement,
    sourceScreenId: subjectOwner.fileId,
    targetScreenId: targetOwner.fileId,
  });
  if (!handoff.ok) {
    toast.error(handoff.rejection.reason);
    return true;
  }

  sendToDesignAgentChat({
    message: t("designEditor.pendingVisualStyles.agentMessage"),
    context: [
      "Apply this runtime Layers-panel move/reparent to the connected React source.",
      `The exact subject belongs to screen ${subjectOwner.fileId}; the exact target belongs to screen ${targetOwner.fileId}.`,
      "Compiler provenance is for anchoring and validation only, and only as precise as each anchor's positionPrecision says. Never apply a generic AST reparent or structure transform.",
      "Read every affected file first, obtain human write consent, write with each read's expectedVersionHash and requireExpectedVersionHash: true, re-read/re-plan on conflict, and keep any optimistic preview pending only until HMR confirms the intended runtime relationship.",
      JSON.stringify(handoff.handoff, null, 2),
    ].join("\n\n"),
    submit: true,
    openSidebar: true,
  });
  setActiveLeftPanel("agent");
  return true;
}
