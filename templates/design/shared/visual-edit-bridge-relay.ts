export const LOCALHOST_BRIDGE_RELAY_HEADER = "x-agent-native-localhost-bridge";
export const LOCALHOST_BRIDGE_RELAY_CHAIN_HEADER =
  "x-agent-native-motion-relay-chain";
export const LOCALHOST_BRIDGE_RELAY_MARKER =
  "agent-native-localhost-bridge-browser";

export type LocalhostBridgeRelay = {
  __agentNativeLocalhostBridge: typeof LOCALHOST_BRIDGE_RELAY_MARKER;
  operation:
    | "read-file"
    | "list-files"
    | "write-file"
    | "apply-edit"
    | "verify-module-provenance";
  designId: string;
  connectionId: string;
  step?: string;
  challenge?: string;
  chainId?: string;
  actionName?: MotionLocalhostRelayAction;
  inputHash?: string;
  path?: string;
  relPath?: string;
  payload?: Record<string, unknown>;
  bridgeRequest?: Record<string, unknown>;
  bridgeOperationCapability?: string;
};

export type LocalhostBridgeRelayResponse = {
  relay: LocalhostBridgeRelay;
  result: unknown;
};

/** Challenge claims are tied to the server-generated operation, never its nonce. */
export function localhostBridgeRelayChallengeResourceId(
  relay: LocalhostBridgeRelay,
): string {
  return JSON.stringify([
    "agent-native-motion-localhost-relay-v2",
    relay.operation,
    relay.designId,
    relay.connectionId,
    relay.step ?? null,
    relay.chainId ?? null,
    relay.actionName ?? null,
    relay.inputHash ?? null,
    relay.path ?? null,
    relay.relPath ?? null,
    relay.payload ?? null,
  ]);
}

export type MotionLocalhostRelayAction =
  | "get-motion-timeline"
  | "apply-motion-edit"
  | "remove-motion-timeline";
