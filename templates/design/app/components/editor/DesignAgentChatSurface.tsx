import { AgentChatSurface } from "@agent-native/core/client/agent-chat";
import type { ComponentProps } from "react";

import { DesignContextPicker } from "./DesignContextPicker";
import { useDesignAgentComposer } from "./use-design-agent-composer";

export function DesignAgentChatSurface(
  props: ComponentProps<typeof AgentChatSurface>,
) {
  const { context, selectedSystemId, composerProps } = useDesignAgentComposer(
    props.scope?.id,
  );
  return (
    <>
      <AgentChatSurface {...props} {...composerProps} />
      <DesignContextPicker
        controller={context}
        selectedSystemId={selectedSystemId}
      />
    </>
  );
}
