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

/** Selects the highest mutually supported version and never guesses a fallback. */
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

/**
 * Enforces discovery semantics at a call site. Omitted descriptors are unknown,
 * not silently unsupported, and therefore fail as temporarily unavailable.
 */
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

/**
 * Lossy on purpose: the boolean map has no way to say "degraded" or "down
 * right now", so it reports both as available and omits what discovery did
 * not mention. Anything that gates behavior must use
 * `resolveAgentCapabilityAffordance` against the descriptors instead.
 */
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

/**
 * The single place capability presentation is decided. Enforcement in the
 * client already branches on all four descriptor states, so a caller that
 * reads the boolean projection instead will show controls the client then
 * rejects, and hide ones that work. Both directions are silent.
 */
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

  // Discovery that ran and omitted the capability is reporting unknown, not
  // unsupported, so it must not be read as a denial.
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

/** Type-only assertion that keeps future protocol unions narrow. */
export function asAgentKitProtocolVersion(
  compatibility: Extract<AgentProtocolCompatibility, { status: "compatible" }>,
): AgentKitProtocolVersion {
  return compatibility.selectedVersion;
}
