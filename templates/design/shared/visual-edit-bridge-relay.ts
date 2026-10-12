export const LOCALHOST_BRIDGE_RELAY_HEADER = "x-agent-native-localhost-bridge";
export const LOCALHOST_BRIDGE_RELAY_MARKER =
  "agent-native-localhost-bridge-browser";

export type LocalhostBridgeRelay = {
  __agentNativeLocalhostBridge: typeof LOCALHOST_BRIDGE_RELAY_MARKER;
  operation: "read-file" | "list-files" | "write-file" | "apply-edit";
  designId: string;
  connectionId: string;
  step?: string;
  path?: string;
  relPath?: string;
  payload?: Record<string, unknown>;
};

export type LocalhostBridgeRelayResponse = {
  relay: LocalhostBridgeRelay;
  result: unknown;
};

export type MotionLocalhostRelayAction =
  | "get-motion-timeline"
  | "apply-motion-edit"
  | "remove-motion-timeline";
