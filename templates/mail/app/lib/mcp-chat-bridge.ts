import { isEmbedMcpChatBridgeActive } from "@agent-native/core/client/host";

export function isMcpChatBridgeActive(): boolean {
  return isEmbedMcpChatBridgeActive();
}
