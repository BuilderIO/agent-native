import { AgentSidebar } from "@agent-native/core/client/agent-chat";
import type { ComponentProps } from "react";

import { DesignContextPicker } from "./DesignContextPicker";
import { useDesignAgentComposer } from "./use-design-agent-composer";

export function DesignAgentSidebar(props: ComponentProps<typeof AgentSidebar>) {
  const { context, selectedSystemId, composerProps } = useDesignAgentComposer(
    props.scope?.id,
  );
  return (
    <>
      <AgentSidebar {...props} {...composerProps} />
      <DesignContextPicker
        controller={context}
        selectedSystemId={selectedSystemId}
      />
    </>
  );
}
