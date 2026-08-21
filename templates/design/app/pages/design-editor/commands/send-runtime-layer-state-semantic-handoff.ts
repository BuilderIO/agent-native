import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import { sendToDesignAgentChat } from "@/lib/agent-chat";
import {
  elementInfoFromCodeLayerNode,
  runtimeLayerStateHandoffMode,
} from "@/pages/design-editor/code-layer-state";
import type { RuntimeLayerSnapshot } from "@/pages/design-editor/command-types";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { runtimeMultiplicityForElementProvenance } from "@/pages/design-editor/editor-helpers";
import {
  reactSourceAnchorForPendingEdit,
  reactSourceAnchorUnavailableReason,
} from "@/pages/design-editor/pending-edits";
import { buildRuntimeReactLayerStateHandoff } from "@/pages/design-editor/react-semantic-handoff";
import type { DesignLeftPanel } from "@/pages/design-editor/types";

export interface SendRuntimeLayerStateSemanticHandoffArgs {
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

export function runSendRuntimeLayerStateSemanticHandoff(
  {
    codeLayerOwnerByNodeIdRef,
    localhostConnectionRootPathByIdRef,
    overviewScreens,
    runtimeLayerSnapshotsById,
    setActiveLeftPanel,
    t,
  }: SendRuntimeLayerStateSemanticHandoffArgs,
  layerId: string,
  state: "locked" | "hidden",
  enabled: boolean,
): true | "preview-only" | false {
  const owner = codeLayerOwnerByNodeIdRef.current.get(layerId);
  if (!owner) return "preview-only";

  const screen = overviewScreens.find(
    (candidate) => candidate.id === owner.fileId,
  );
  const rootPath = screen?.connectionId
    ? localhostConnectionRootPathByIdRef.current.get(screen.connectionId)
    : undefined;
  const info = elementInfoFromCodeLayerNode(owner.node);
  if (
    runtimeLayerStateHandoffMode({
      runtimeOnly: owner.runtimeOnly,
      provenanceSourceFile: info.provenance?.sourceFile,
    }) === "preview-only"
  ) {
    return "preview-only";
  }
  const subjectAnchor = reactSourceAnchorForPendingEdit({
    info,
    id: "subject",
    rootPath,
    runtimeMultiplicity: runtimeMultiplicityForElementProvenance(
      runtimeLayerSnapshotsById,
      info,
    ),
    reason: `Runtime Layers-panel ${state} state for layer ${layerId} in screen ${owner.fileId}.`,
  });
  if (!subjectAnchor) {
    toast.error(
      reactSourceAnchorUnavailableReason([info])
        ? t("designEditor.toasts.reactSourceAnchorsUnavailable")
        : t("designEditor.toasts.reactSourceAnchorsLoading"),
    );
    return false;
  }

  const handoff = buildRuntimeReactLayerStateHandoff({
    subjectAnchor,
    screenId: owner.fileId,
    state,
    enabled,
  });
  if (!handoff.ok) {
    toast.error(handoff.rejection.reason);
    return false;
  }

  const attributeName = `data-agent-native-${state}`;
  sendToDesignAgentChat({
    message: t("designEditor.pendingVisualStyles.agentMessage"),
    context: [
      `Apply this runtime Layers-panel ${state} change to the connected React source.`,
      `Use the compiler anchor to ${enabled ? `set ${attributeName}=\"true\" on` : `remove ${attributeName} from`} the existing JSX host element. The runtime Layers snapshot recognizes this durable source metadata; do not replace it with CSS, a transient DOM mutation, or a wrapper.`,
      "Compiler provenance is for anchoring and validation only, and only as precise as each anchor's positionPrecision says. Never apply a generic AST transform.",
      "Read the affected file first, obtain human write consent, write with that read's expectedVersionHash and requireExpectedVersionHash: true, re-read/re-plan on conflict, and keep the optimistic layer-state preview only until HMR confirms the source metadata.",
      JSON.stringify(handoff.handoff, null, 2),
    ].join("\n\n"),
    submit: true,
    openSidebar: true,
  });
  setActiveLeftPanel("agent");
  return true;
}
