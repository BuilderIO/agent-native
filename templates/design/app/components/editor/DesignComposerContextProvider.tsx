import { useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { AssistantChatComposerContextProviderProps } from "@agent-native/toolkit/app/chat/chat";
import { useState } from "react";

import { useDesignSystemWorkflows } from "@/hooks/use-design-system-workflows";
import { useDesignSystems } from "@/hooks/use-design-systems";

import { designSystemPickerOptions } from "./design-start-pickers";
import { useHomePromptContext } from "./HomePromptContext";

const ignoreTemplateChange = () => {};

export function DesignComposerContextProvider(
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
    "design",
    session?.authUserId,
    session?.email,
    session?.orgId,
    props.threadId,
  ]);
  return (
    <DesignComposerContext
      key={scopeKey}
      {...props}
      scopeKey={scopeKey}
      draftScope={draftScope}
    />
  );
}

function DesignComposerContext({
  children,
  isActive,
  scopeKey,
  draftScope,
}: AssistantChatComposerContextProviderProps & {
  scopeKey: string;
  draftScope: string;
}) {
  const t = useT();
  const systemsEnabled = useDesignSystemWorkflows();
  const systems = useDesignSystems(systemsEnabled && isActive);
  const [systemId, setSystemId] = useState<string | null>(null);
  const context = useHomePromptContext({
    active: isActive,
    scopeKey,
    draftScope,
    systems: designSystemPickerOptions(systems.designSystems),
    systemId,
    onSystemChange: setSystemId,
    systemsLoading: systems.isLoading,
    systemsError: systems.error,
    retrySystems: () => void systems.refetch(),
    templates: [],
    templateId: null,
    onTemplateChange: ignoreTemplateChange,
  });
  return children({
    menuItems: context.menuItems,
    contextItems: context.contextItems,
    onRemoveContextItem: context.remove,
    onRetryContextItem: context.retry,
    prepareSubmission: async (snapshot) => {
      const prepared = await context.prepareSubmission(snapshot);
      if (!prepared) throw new Error(t("homeContext.loadFailed"));
      return prepared;
    },
    submissionAccepted: context.submissionAccepted,
  });
}
