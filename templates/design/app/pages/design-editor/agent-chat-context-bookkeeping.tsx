import { useAgentChatContext } from "@agent-native/core/client/agent-chat";
import { useLayoutEffect, type RefObject } from "react";

export function AgentChatContextBookkeeping({
  enabled,
  presentRef,
}: {
  enabled: boolean;
  presentRef: RefObject<boolean>;
}) {
  const items = useAgentChatContext(enabled).items;
  useLayoutEffect(() => {
    presentRef.current = items.some(
      (item) => item.key === "design:selected-element",
    );
  }, [items, presentRef]);
  return null;
}
