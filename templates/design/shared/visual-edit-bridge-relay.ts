export const LOCALHOST_BRIDGE_RELAY_HEADER = "x-agent-native-localhost-bridge";
export const LOCALHOST_BRIDGE_RELAY_MARKER =
  "agent-native-localhost-bridge-browser";

export type LocalhostBridgeRelay = {
  __agentNativeLocalhostBridge: typeof LOCALHOST_BRIDGE_RELAY_MARKER;
  operation: "read-file" | "list-files" | "write-file" | "apply-edit";
  designId: string;
  connectionId: string;
  path?: string;
  relPath?: string;
};
