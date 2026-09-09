export const AGENTKIT_PROTOCOL_NAME = "agentkit" as const;
export const AGENTKIT_PROTOCOL_VERSION = 1 as const;
export const AGENTKIT_SUPPORTED_PROTOCOL_VERSIONS = [
  AGENTKIT_PROTOCOL_VERSION,
] as const;

export type AgentKitProtocolName = typeof AGENTKIT_PROTOCOL_NAME;
export type AgentKitProtocolVersion =
  (typeof AGENTKIT_SUPPORTED_PROTOCOL_VERSIONS)[number];

export function isAgentKitProtocolVersion(
  value: unknown,
): value is AgentKitProtocolVersion {
  return (AGENTKIT_SUPPORTED_PROTOCOL_VERSIONS as readonly unknown[]).includes(
    value,
  );
}
