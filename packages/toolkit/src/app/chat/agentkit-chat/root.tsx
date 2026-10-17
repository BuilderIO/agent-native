import { AgentKitRoot } from "../../agentkit/react/root.js";
import type { AgentKitRootProps } from "../../agentkit/react/root.js";
import { AgentKitActionWidget } from "./action-widget.js";
import { CoreAgentKitApproval } from "./approval-card.js";

export function CoreAgentKitRoot(props: AgentKitRootProps) {
  return (
    <AgentKitRoot
      {...props}
      slots={{
        ...props.slots,
        widget: props.slots?.widget ?? AgentKitActionWidget,
        approval: props.slots?.approval ?? CoreAgentKitApproval,
      }}
    />
  );
}
