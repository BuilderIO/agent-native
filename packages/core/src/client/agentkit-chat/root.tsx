import { AgentKitRoot } from "@agent-native/agentkit/react/root";
import type { AgentKitRootProps } from "@agent-native/agentkit/react/root";

import { AgentKitActionWidget } from "./action-widget.js";

export function CoreAgentKitRoot(props: AgentKitRootProps) {
  return (
    <AgentKitRoot
      {...props}
      slots={{
        ...props.slots,
        widget: props.slots?.widget ?? AgentKitActionWidget,
      }}
    />
  );
}
