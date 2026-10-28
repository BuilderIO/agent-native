import {
  AgentKitProtocolError,
  createCapabilityUnavailableError,
  createProtocolVersionUnsupportedError,
} from "./errors.js";
import type {
  AgentCapabilities,
  AgentCapabilitiesDiscovery,
  AgentCapabilityAffordance,
  AgentCapabilityDescriptor,
  AgentCapabilityId,
  AgentProtocolCompatibility,
  AgentProtocolVersionOffer,
} from "./index.js";
import {
  AGENTKIT_PROTOCOL_NAME,
  AGENTKIT_SUPPORTED_PROTOCOL_VERSIONS,
  type AgentKitProtocolVersion,
} from "./version.js";

function validatedVersions(values: readonly number[], name: string): number[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${name} must contain at least one protocol version.`);
  }
  const versions = values.map((value) => {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${name} must contain positive safe integers.`);
    }
    return value;
  });
  if (new Set(versions).size !== versions.length) {
    throw new TypeError(`${name} must not contain duplicate versions.`);
  }
  return versions;
}

export function negotiateAgentKitProtocolVersion(
  peer: AgentProtocolVersionOffer,
  options: { correlationId?: string } = {},
): AgentProtocolCompatibility {
  if (peer.protocol !== AGENTKIT_PROTOCOL_NAME) {
    throw new TypeError(
      `protocol must be ${JSON.stringify(AGENTKIT_PROTOCOL_NAME)}.`,
    );
  }
  const peerVersions = validatedVersions(peer.versions, "peer.versions");
  const localVersions = [...AGENTKIT_SUPPORTED_PROTOCOL_VERSIONS];
  const selectedVersion = [...localVersions]
    .sort((left, right) => right - left)
    .find((version) => peerVersions.includes(version));

  if (selectedVersion !== undefined) {
    return {
      status: "compatible",
      selectedVersion,
      localVersions,
      peerVersions,
    };
  }

  return {
    status: "incompatible",
    localVersions,
    peerVersions,
    error: createProtocolVersionUnsupportedError(
      localVersions,
      peerVersions,
      options,
    ),
  };
}

export function createAgentKitProtocolVersionOffer(): AgentProtocolVersionOffer {
  return {
    protocol: AGENTKIT_PROTOCOL_NAME,
    versions: [...AGENTKIT_SUPPORTED_PROTOCOL_VERSIONS],
  };
}

export function getAgentCapabilityStatus(
  discovery: AgentCapabilitiesDiscovery,
  capability: AgentCapabilityId,
): AgentCapabilityDescriptor | undefined {
  return discovery.capabilities.find((entry) => entry.id === capability);
}

export function requireAgentCapability(
  discovery: AgentCapabilitiesDiscovery,
  capability: AgentCapabilityId,
): AgentCapabilityDescriptor {
  const descriptor = getAgentCapabilityStatus(discovery, capability);
  if (!descriptor) {
    throw new AgentKitProtocolError(
      createCapabilityUnavailableError(capability, {
        message: `The ${JSON.stringify(capability)} capability was not included in discovery.`,
        retryable: true,
      }),
    );
  }
  if (descriptor.state === "unsupported") {
    throw new AgentKitProtocolError(descriptor.error);
  }
  if (descriptor.state === "unavailable") {
    throw new AgentKitProtocolError(descriptor.error);
  }
  return descriptor;
}

export function projectAgentCapabilities(
  discovery: AgentCapabilitiesDiscovery,
): AgentCapabilities {
  const projected: Record<string, unknown> = {
    protocolVersion:
      discovery.protocol.status === "compatible"
        ? discovery.protocol.selectedVersion
        : undefined,
  };
  for (const capability of discovery.capabilities) {
    if (capability.id === "reasoning") continue;
    if (capability.state === "available" || capability.state === "degraded") {
      projected[capability.id] = true;
    } else if (capability.state === "unsupported") {
      projected[capability.id] = false;
    }
  }
  return projected as AgentCapabilities;
}

export function resolveAgentCapabilityAffordance(
  source: {
    discovery?: AgentCapabilitiesDiscovery;
    capabilities?: AgentCapabilities;
  },
  capability: AgentCapabilityId,
): AgentCapabilityAffordance {
  const descriptor = source.discovery
    ? getAgentCapabilityStatus(source.discovery, capability)
    : undefined;

  if (descriptor) {
    const reason = descriptor.error?.message ?? descriptor.description;
    switch (descriptor.state) {
      case "available":
        return {
          id: capability,
          state: "available",
          visible: true,
          enabled: true,
        };
      case "degraded":
        return {
          id: capability,
          state: "degraded",
          visible: true,
          enabled: true,
          reason,
        };
      case "unavailable":
        return {
          id: capability,
          state: "unavailable",
          visible: true,
          enabled: false,
          reason,
        };
      case "unsupported":
        return {
          id: capability,
          state: "unsupported",
          visible: false,
          enabled: false,
          reason,
        };
    }
  }

  if (source.discovery) {
    return { id: capability, state: "unknown", visible: false, enabled: false };
  }

  const projected = source.capabilities?.[capability];
  if (projected === undefined) {
    return { id: capability, state: "unknown", visible: false, enabled: false };
  }
  const supported =
    capability === "reasoning" ? projected !== "none" : projected === true;
  return supported
    ? { id: capability, state: "available", visible: true, enabled: true }
    : { id: capability, state: "unsupported", visible: false, enabled: false };
}

export function asAgentKitProtocolVersion(
  compatibility: Extract<AgentProtocolCompatibility, { status: "compatible" }>,
): AgentKitProtocolVersion {
  return compatibility.selectedVersion;
}
