import { useSession } from "@agent-native/core/client/hooks";
import type { AssistantChatComposerContextProviderProps } from "@agent-native/toolkit/app/chat/chat";
import { useNavigate } from "react-router";

import { useDesignSystemWorkflows } from "@/hooks/use-design-system-workflows";
import { useDesignSystems } from "@/hooks/use-design-systems";

import { useSlidesComposerContext } from "./SlidesComposerContext";

export function SlidesComposerContextProvider(
  props: AssistantChatComposerContextProviderProps,
) {
  const { session } = useSession();
  const scopeKey = JSON.stringify([
    session?.authUserId,
    session?.email,
    session?.orgId,
    props.threadId,
    props.tabId,
  ]);
  const draftScope = JSON.stringify([
    "slides",
    session?.authUserId,
    session?.email,
    session?.orgId,
    props.threadId,
  ]);
  return (
    <SlidesComposerContext
      key={scopeKey}
      {...props}
      scopeKey={scopeKey}
      draftScope={draftScope}
    />
  );
}

function SlidesComposerContext({
  children,
  isActive,
  scopeKey,
  draftScope,
}: AssistantChatComposerContextProviderProps & {
  scopeKey: string;
  draftScope: string;
}) {
  const navigate = useNavigate();
  const systemsEnabled = useDesignSystemWorkflows();
  const systems = useDesignSystems(systemsEnabled && isActive);
  const context = useSlidesComposerContext({
    active: isActive,
    scopeKey,
    draftScope,
    persistSelection: false,
    defaultDesignSystemId: null,
    systems: systems.designSystems,
    systemsError: systems.error,
    systemsLoading: systems.isLoading,
    retrySystems: systems.refetch,
    onCreateDesignSystem: () => navigate("/design-systems"),
  });
  return children({
    menuItems: context.props.contextMenuItems,
    contextItems: context.props.contextItems,
    onRemoveContextItem: context.props.onRemoveContextItem,
    onRetryContextItem: context.props.onRetryContextItem,
    onInspectContextItem: context.props.onInspectContextItem,
    dialogs: context.dialogs,
    prepareSubmission: async (snapshot) =>
      (await context.beforeSend(snapshot)).items,
    submissionAccepted: context.submissionAccepted,
  });
}
