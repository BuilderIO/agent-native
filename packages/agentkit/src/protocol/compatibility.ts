import {
  AgentKitProtocolError,
  createCapabilityUnavailableError,
  createProtocolVersionUnsupportedError,
} from "./errors.js";
import type {
  AgentCapabilitiesDiscovery,
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

/** Type-only assertion that keeps future protocol unions narrow. */
export function asAgentKitProtocolVersion(
  compatibility: Extract<AgentProtocolCompatibility, { status: "compatible" }>,
): AgentKitProtocolVersion {
  return compatibility.selectedVersion;
}
