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
import { buildReactSemanticHandoff } from "@/pages/design-editor/react-semantic-handoff";
import type { DesignLeftPanel } from "@/pages/design-editor/types";

export interface SendRuntimeLayerSemanticHandoffArgs {
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

export function runSendRuntimeLayerSemanticHandoff(
  {
    codeLayerOwnerByNodeIdRef,
    localhostConnectionRootPathByIdRef,
    overviewScreens,
    runtimeLayerSnapshotsById,
    setActiveLeftPanel,
    t,
  }: SendRuntimeLayerSemanticHandoffArgs,
  operation: "group" | "ungroup" | "auto-layout",
  layerIds: readonly string[],
  options: {
    desiredChange?: string;
    description?: string;
    commandContext?: string;
  } = {},
): boolean {
  const owners = layerIds
    .map((layerId) => codeLayerOwnerByNodeIdRef.current.get(layerId))
    .filter(
      (
        owner,
      ): owner is NonNullable<
        ReturnType<typeof codeLayerOwnerByNodeIdRef.current.get>
      > => Boolean(owner?.runtimeOnly),
    );
  if (owners.length !== layerIds.length || owners.length === 0) return false;
  const screenId = owners[0]!.fileId;
  if (owners.some((owner) => owner.fileId !== screenId)) return false;
  const connectionId = overviewScreens.find(
    (screen) => screen.id === screenId,
  )?.connectionId;
  const rootPath = connectionId
    ? localhostConnectionRootPathByIdRef.current.get(connectionId)
    : undefined;
  const infos = owners.map((owner) => elementInfoFromCodeLayerNode(owner.node));
  const sourceAnchors = infos.map((info, index) =>
    reactSourceAnchorForPendingEdit({
      info,
      id: `subject-${index + 1}`,
      rootPath,
      runtimeMultiplicity: runtimeMultiplicityForElementProvenance(
        runtimeLayerSnapshotsById,
        info,
      ),
    }),
  );
  if (sourceAnchors.some((anchor) => !anchor)) {
    toast.error(
      reactSourceAnchorUnavailableReason(infos)
        ? t("designEditor.toasts.reactSourceAnchorsUnavailable")
        : t("designEditor.toasts.reactSourceAnchorsLoading"),
    );
    return true;
  }
  const subjectAnchorIds = sourceAnchors.map(
    (_anchor, index) => `subject-${index + 1}`,
  );
  const handoff = buildReactSemanticHandoff({
    operation,
    desiredChange:
      options.desiredChange ??
      (operation === "group"
        ? "Wrap the selected runtime React elements in one new group container while preserving their visual order and layout."
        : operation === "ungroup"
          ? "Remove the selected runtime React container wrapper and preserve its children in the same visual position and order."
          : owners.length > 1
            ? "Wrap the selected runtime React elements in an inferred auto-layout container while preserving their visual order."
            : "Convert the selected runtime React container to inferred auto layout without changing unrelated behavior."),
    sourceAnchors: sourceAnchors.filter(
      (anchor): anchor is NonNullable<typeof anchor> => Boolean(anchor),
    ),
    runtimeRelationship: {
      kind:
        operation === "group"
          ? "wrap"
          : operation === "ungroup"
            ? "unwrap"
            : owners.length > 1
              ? "wrap"
              : "style",
      subjectAnchorIds,
      screenId,
      description:
        options.description ??
        `${operation} ${owners.length} selected runtime React layer${owners.length === 1 ? "" : "s"}`,
    },
    versionHashes: [],
  });
  if (!handoff.ok) {
    toast.error(handoff.rejection.reason);
    return true;
  }
  sendToDesignAgentChat({
    message: t("designEditor.pendingVisualStyles.agentMessage"),
    context: [
      options.commandContext ??
        "Apply this runtime Layers-panel command to the connected React source.",
      "The compiler metadata is for source anchoring and validation only; do not use a generic AST structural transform. Respect each anchor's positionPrecision — a non-authored line is the dev server's, not the file's.",
      "Read every target file, obtain human write consent, write with expectedVersionHash and requireExpectedVersionHash: true, then verify the resulting HMR/runtime relationship.",
      JSON.stringify(handoff.handoff, null, 2),
    ].join("\n\n"),
    submit: true,
    openSidebar: true,
  });
  setActiveLeftPanel("agent");
  return true;
}
