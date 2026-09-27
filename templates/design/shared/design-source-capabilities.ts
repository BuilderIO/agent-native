import type { DesignBridgeOperationStatus } from "./source-mode";

export const DESIGN_CAPABILITY_NAMES = [
  "readFile",
  "writeFile",
  "applyEdit",
  "resolveNodeToFile",
  "previewPatch",
  "diffPatch",
  "captureSnapshot",
  "captureState",
  "indexComponents",
  "indexTokens",
  "writeTokens",
  "previewMotion",
  "writeMotion",
  "branch",
  "deployPreview",
  "deploy",
] as const;

export type DesignCapabilityName = (typeof DESIGN_CAPABILITY_NAMES)[number];

export type CapabilityStatus = DesignBridgeOperationStatus | "unavailable";

export interface DesignSourceCapabilityEntry {
  status: CapabilityStatus;
  reason?: string;
}

export type DesignSourceCapabilities = Record<
  DesignCapabilityName,
  DesignSourceCapabilityEntry
>;

export function hasCapability(
  caps: DesignSourceCapabilities,
  name: DesignCapabilityName,
): boolean {
  return caps[name]?.status === "available";
}

export function available(reason?: string): DesignSourceCapabilityEntry {
  return { status: "available", ...(reason !== undefined ? { reason } : {}) };
}

export function planned(reason?: string): DesignSourceCapabilityEntry {
  return { status: "planned", ...(reason !== undefined ? { reason } : {}) };
}

export function unavailable(reason?: string): DesignSourceCapabilityEntry {
  return {
    status: "unavailable",
    ...(reason !== undefined ? { reason } : {}),
  };
}

export const INLINE_DEFAULT_CAPABILITIES: DesignSourceCapabilities = {
  readFile: available("Inline design files can be read from Design"),
  writeFile: available("Inline design files can be saved through Design"),
  applyEdit: available("Inline design files can be edited through Design"),
  resolveNodeToFile: available(),
  previewPatch: available(),
  diffPatch: available(),
  captureSnapshot: available(),
  captureState: available(),
  indexComponents: unavailable(
    "Connect Builder (free tier available) to index real components",
  ),
  indexTokens: available(),
  writeTokens: unavailable("Token source write-back requires a real app"),
  previewMotion: available(),
  writeMotion: available(),
  branch: unavailable("Branching requires a connected Builder app"),
  deployPreview: unavailable("Deploy previews require a connected Builder app"),
  deploy: unavailable("Deploy requires a connected Builder app"),
};

/**
 * Default capability map for **localhost** designs.
 *
 * File I/O (`readFile`, `writeFile`, `applyEdit`) is `available` through the
 * design bridge started by `agent-native design connect`: reads and writes go
 * through the bridge's token-authenticated `/read-file`, `/write-file`, and
 * `/apply-edit` endpoints, and every write additionally requires an explicit
 * user write-consent grant (`grant-localhost-write-consent` +
 * `verifyWriteGrant`).  Genuinely-unshipped real-app features
 * (`indexComponents`, `writeTokens`) remain `planned` and light up once the
 * bridge proves those capabilities.
 */
export const LOCALHOST_DEFAULT_CAPABILITIES: DesignSourceCapabilities = {
  readFile: available(
    "Local file reads go through the design bridge (agent-native design connect)",
  ),
  writeFile: available(
    "Local file writes go through the design bridge after user write consent",
  ),
  applyEdit: available(
    "Local source edits go through the design bridge after user write consent",
  ),
  resolveNodeToFile: available(),
  previewPatch: available(),
  diffPatch: available(),
  captureSnapshot: available(),
  captureState: available(),
  indexComponents: planned("Component indexing lands with bridge hardening"),
  indexTokens: available(),
  writeTokens: planned("Token write-back lands with bridge hardening"),
  previewMotion: available(),
  writeMotion: available(),
  branch: unavailable("Branching requires a connected Builder app"),
  deployPreview: unavailable("Deploy previews require a connected Builder app"),
  deploy: unavailable("Deploy requires a connected Builder app"),
};

export const FUSION_DISCONNECTED_CAPABILITIES: DesignSourceCapabilities = {
  readFile: planned(
    "Connect Builder (free tier available) to enable file reads on fusion sources",
  ),
  writeFile: unavailable(
    "Connect Builder (free tier available) to enable source writes",
  ),
  applyEdit: unavailable(
    "Connect Builder (free tier available) to enable source edits",
  ),
  resolveNodeToFile: available(),
  previewPatch: available(),
  diffPatch: available(),
  captureSnapshot: available(),
  captureState: available(),
  indexComponents: unavailable(
    "Connect Builder (free tier available) to index real components",
  ),
  indexTokens: available(),
  writeTokens: unavailable(
    "Connect Builder (free tier available) to enable token write-back",
  ),
  previewMotion: available(),
  writeMotion: planned(
    "Motion write-back to real source requires bridge hardening",
  ),
  branch: unavailable(
    "Connect Builder (free tier available) to create branches",
  ),
  deployPreview: unavailable(
    "Connect Builder (free tier available) to deploy previews",
  ),
  deploy: unavailable("Connect Builder (free tier available) to deploy"),
};

export const FUSION_CONNECTED_CAPABILITIES: DesignSourceCapabilities = {
  readFile: available(),
  writeFile: planned(
    "Source file writes remain planned until bridge hardening",
  ),
  applyEdit: planned("Source edits remain planned until bridge hardening"),
  resolveNodeToFile: available(),
  previewPatch: available(),
  diffPatch: available(),
  captureSnapshot: available(),
  captureState: available(),
  indexComponents: available(),
  indexTokens: available(),
  writeTokens: planned(
    "Token write-back remains planned until bridge hardening",
  ),
  previewMotion: available(),
  writeMotion: planned(
    "Motion write-back to real source remains planned until bridge hardening",
  ),
  branch: available(),
  deployPreview: available(),
  deploy: available(),
};

/**
 * Default capability map for **fusion** (Builder-hosted) designs.
 *
 * This is the **conservative default** for when connection status is unknown.
 * It is equivalent to `FUSION_DISCONNECTED_CAPABILITIES` — preview-only with
 * no real-app write operations available.
 *
 * Callers that know the Builder connection is active should use
 * `FUSION_CONNECTED_CAPABILITIES` (or call `resolveFusionCapabilities(true)`
 * from `capability-resolver.ts`) to get the fuller capability set.
 *
 * @deprecated Prefer `FUSION_DISCONNECTED_CAPABILITIES` or
 *   `FUSION_CONNECTED_CAPABILITIES` for clarity.  This alias is kept for
 *   backward compatibility with callers that import the default map.
 */
export const FUSION_DEFAULT_CAPABILITIES: DesignSourceCapabilities =
  FUSION_DISCONNECTED_CAPABILITIES;
