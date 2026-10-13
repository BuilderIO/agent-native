/**
 * Source modes, bridge operations, and capability-aware source descriptors for
 * the Design Studio.
 *
 * This module is the single canonical home for:
 * - `DesignSourceType` — the three runtime tiers (inline | localhost | fusion).
 * - `DesignBridgeOperation` — the low-level bridge RPC surface.
 * - `DesignSourceDescriptor` variants — now optionally carry a proven
 *   `DesignSourceCapabilities` map so callers never infer write ability from
 *   `sourceType` alone (see §1.1 of DESIGN-STUDIO-PLAN.md).
 * - `resolveDescriptorCapabilities()` — preferred helper: returns the proven
 *   capability set when present on the descriptor, otherwise falls back to the
 *   `resolveSourceCapabilities()` tier defaults from `capability-resolver.ts`.
 *
 * Relation to `design-source-capabilities.ts`:
 * - `DesignBridgeOperation` / `DesignBridgeOperationStatus` describe the
 *   low-level bridge RPC surface (used in `DesignBridgeCapability` and
 *   `LocalhostDesignConnectionConfig.capabilities`).
 * - `DesignCapabilityName` / `DesignSourceCapabilities` (defined in
 *   `design-source-capabilities.ts`) are the higher-level vocabulary that UI
 *   panels and server actions gate on.  They extend
 *   `DesignBridgeOperationStatus` with `"unavailable"` to support the
 *   migration-CTA pattern.
 */

// Circular-safe imports from `design-source-capabilities.ts`.
//
// `design-source-capabilities.ts` imports only via `import type` from this
// module, so the runtime module graph has NO cycle.  TypeScript's type checker
// handles the bidirectional type reference correctly; `tsc --noEmit` passes.
//
// - Type-only import: used for the `capabilities?` fields on source descriptors
//   and `LocalhostDesignConnectionConfig.sourceCapabilities`.
// - Value import: the canonical default maps consumed by
//   `resolveDescriptorCapabilities()`.
import type { DesignSourceCapabilities } from "./design-source-capabilities";
import {
  FUSION_DISCONNECTED_CAPABILITIES,
  FUSION_CONNECTED_CAPABILITIES,
  INLINE_DEFAULT_CAPABILITIES,
  LOCALHOST_DEFAULT_CAPABILITIES,
} from "./design-source-capabilities";

export const DESIGN_SOURCE_TYPES = ["inline", "localhost", "fusion"] as const;

export interface ElementProvenance {
  framework?: ElementProvenanceFramework;
  sourceFile?: string;
  line?: number;
  column?: number;
  component?: string;
  ownerSourceFile?: string;
  ownerLine?: number;
  ownerColumn?: number;
  ownerComponentName?: string;
  ownerKey?: string;
  method?: ElementProvenanceMethod;
  ownerMethod?: ElementProvenanceMethod;
  unavailableReason?: ElementProvenanceUnavailableReason;
}

export type ElementProvenanceUnavailableReason =
  | "not-framework"
  | "not-react"
  | "no-debug-info";

export type ElementProvenanceMethod =
  | "data-attribute"
  | "debug-source"
  | "debug-stack"
  | "debug-stack-remapped"
  | "vue-inspector"
  | "svelte-meta";

export type ElementProvenanceFramework =
  | "html"
  | "react"
  | "vue"
  | "svelte"
  | "angular"
  | "lwc";

export interface RuntimeComponentIdentity {
  componentId: string;
  instanceId: string;
  name: string;
  framework: ElementProvenanceFramework;
  sourceFile?: string;
  line?: number;
  column?: number;
  method?: ElementProvenanceMethod;
  ownerKey?: string;
  props: Array<{ name: string; value: string }>;
  writeCapability: "authored-jsx-literal" | "unsupported";
  reason?: string;
}

export const ELEMENT_PROVENANCE_METHODS: readonly ElementProvenanceMethod[] = [
  "data-attribute",
  "debug-source",
  "debug-stack",
  "debug-stack-remapped",
  "vue-inspector",
  "svelte-meta",
];

export type SourcePositionPrecision = "authored" | "transformed" | "unknown";

export function sourcePositionPrecision(
  method: ElementProvenanceMethod | undefined,
): SourcePositionPrecision {
  if (method === "debug-stack") return "transformed";
  return method ? "authored" : "unknown";
}

export function parseDataLocProvenance(
  dataLoc: string,
): Pick<ElementProvenance, "sourceFile" | "line" | "column"> | null {
  const lastColonIndex = dataLoc.lastIndexOf(":");
  if (lastColonIndex < 0) return null;
  const lastPart = dataLoc.slice(lastColonIndex + 1);
  if (!/^\d+$/.test(lastPart)) return null;

  const beforeLastPart = dataLoc.slice(0, lastColonIndex);
  const previousColonIndex = beforeLastPart.lastIndexOf(":");
  const previousPart =
    previousColonIndex >= 0 ? beforeLastPart.slice(previousColonIndex + 1) : "";
  const hasColumn = /^\d+$/.test(previousPart);
  const sourceFile = (
    hasColumn ? beforeLastPart.slice(0, previousColonIndex) : beforeLastPart
  ).trim();
  const line = Number(hasColumn ? previousPart : lastPart);
  const column = hasColumn ? Number(lastPart) : undefined;

  if (!sourceFile || !Number.isFinite(line)) return null;
  if (column !== undefined && !Number.isFinite(column)) return null;
  return { sourceFile, line, column };
}

export type DesignSourceType = (typeof DESIGN_SOURCE_TYPES)[number];

export const DESIGN_BRIDGE_OPERATIONS = [
  "select",
  "resolveNodeToFile",
  "readFile",
  "applyEdit",
  "writeFile",
  "captureSnapshot",
  "captureState",
  "listFiles",
] as const;

export type DesignBridgeOperation = (typeof DESIGN_BRIDGE_OPERATIONS)[number];

export type DesignBridgeOperationStatus = "available" | "planned" | "disabled";

export interface DesignBridgeCapability {
  operation: DesignBridgeOperation;
  status: DesignBridgeOperationStatus;
  reason?: string;
}

export type { DesignSourceCapabilities };

export interface LocalhostDesignRoute {
  id: string;
  connectionId?: string;
  path: string;
  url?: string;
  title: string;
  sourceFile?: string;
  sourceKind?: "react-router" | "html" | "manual";
  screenshotUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface LocalhostDesignRouteManifest {
  version: 1;
  sourceType: "localhost";
  devServerUrl: string;
  rootPath?: string;
  routes: LocalhostDesignRoute[];
  generatedAt: string;
}

export interface LocalhostDesignConnectionConfig {
  id: string;
  sourceType: "localhost";
  name: string;
  devServerUrl: string;
  bridgeUrl?: string;
  rootPath?: string;
  routeManifest: LocalhostDesignRouteManifest;
  capabilities: DesignBridgeCapability[];
  sourceCapabilities?: DesignSourceCapabilities;
  status: "connected" | "detected" | "manual" | "error";
  lastSeenAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface InlineDesignSource {
  sourceType: "inline";
  designId?: string;
  fileId?: string;
  filename?: string;
  revision?: string;
  capabilities?: DesignSourceCapabilities;
}

export interface LocalhostDesignSource {
  sourceType: "localhost";
  connectionId: string;
  routeId?: string;
  path?: string;
  url?: string;
  bridgeUrl?: string;
  revision?: string;
  capabilities?: DesignSourceCapabilities;
}

export interface FusionDesignSource {
  sourceType: "fusion";
  externalId?: string;
  url?: string;
  revision?: string;
  metadata?: Record<string, unknown>;
  connected?: boolean;
  capabilities?: DesignSourceCapabilities;
}

export type DesignSourceDescriptor =
  | InlineDesignSource
  | LocalhostDesignSource
  | FusionDesignSource;

export interface FlowCanvasSnapshotRef {
  id: string;
  sourceType: DesignSourceType;
  capturedAt: string;
  imageUrl?: string;
  stateUrl?: string;
  contentHash?: string;
  width?: number;
  height?: number;
}

export interface FlowCanvasArtboard {
  id: string;
  title: string;
  sourceType: DesignSourceType;
  source: DesignSourceDescriptor;
  routeId?: string;
  path?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  snapshot?: FlowCanvasSnapshotRef;
  metadata?: Record<string, unknown>;
}

export interface FlowCanvasEdge {
  id: string;
  fromArtboardId: string;
  toArtboardId: string;
  trigger?: string;
  derivedFrom?: {
    operation: "captureState" | "captureSnapshot" | "manual";
    sourceNodeId?: string;
    selector?: string;
  };
  metadata?: Record<string, unknown>;
}

export type DesignBridgeRequest =
  | {
      operation: "select";
      source: DesignSourceDescriptor;
      selector?: string;
      nodeId?: string;
    }
  | {
      operation: "resolveNodeToFile";
      source: DesignSourceDescriptor;
      selector?: string;
      nodeId?: string;
    }
  | {
      operation: "readFile";
      source: DesignSourceDescriptor;
      path: string;
    }
  | {
      operation: "applyEdit";
      source: DesignSourceDescriptor;
      path: string;
      edit: {
        kind: "replace" | "instruction";
        search?: string;
        replacement?: string;
        instruction?: string;
      };
    }
  | {
      operation: "writeFile";
      source: DesignSourceDescriptor;
      path: string;
      content: string;
    }
  | {
      operation: "captureSnapshot" | "captureState";
      source: DesignSourceDescriptor;
      routeId?: string;
      path?: string;
    };

export interface DesignBridgeResponse<T = unknown> {
  ok: boolean;
  operation: DesignBridgeOperation;
  data?: T;
  error?: string;
}

export function isDesignSourceType(value: unknown): value is DesignSourceType {
  return (
    typeof value === "string" &&
    (DESIGN_SOURCE_TYPES as readonly string[]).includes(value)
  );
}

export function isRunningAppSourceType(value: unknown): boolean {
  const sourceType = normalizeDesignSourceType(value);
  return sourceType === "localhost" || sourceType === "fusion";
}

export function normalizeDesignSourceType(
  value: unknown,
): DesignSourceType | null {
  if (isDesignSourceType(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "design-file" ||
    normalized === "inline-html" ||
    normalized === "sql" ||
    normalized === "snapshot"
  ) {
    return "inline";
  }
  if (
    normalized === "local" ||
    normalized === "local-file" ||
    normalized === "localhost" ||
    normalized === "dev-server"
  ) {
    return "localhost";
  }
  if (normalized === "fusion" || normalized === "remote-url") {
    return "fusion";
  }
  return null;
}

export function designScreenSourceTypeFromData(
  data: Record<string, unknown>,
  fileId: string,
): DesignSourceType | null {
  const screen = isRecord(data.screenMetadata)
    ? data.screenMetadata[fileId]
    : undefined;
  const legacyScreen = isRecord(data.localhostScreens)
    ? data.localhostScreens[fileId]
    : undefined;
  const metadata = isRecord(screen) ? screen : legacyScreen;
  const screenSourceType = isRecord(metadata)
    ? (normalizeDesignSourceType(metadata.sourceType) ??
      (typeof metadata.bridgeUrl === "string" && metadata.bridgeUrl
        ? "localhost"
        : null))
    : null;

  return (
    screenSourceType ??
    normalizeDesignSourceType(data.sourceType) ??
    normalizeDesignSourceType(data.sourceMode)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Resolve the source tier stored in a design's JSON data blob.
 *
 * `sourceType` is the canonical field. Early localhost/fusion writers used
 * `sourceMode`, though, and those persisted designs must not silently fall
 * back to inline editing. Accepting both here gives actions and workspace
 * providers one migration-safe gate instead of open-coding subtly different
 * JSON parsing at every call site.
 */
export function designSourceTypeFromData(
  value: unknown,
  fallback: DesignSourceType = "inline",
): DesignSourceType {
  let parsed = value;
  if (typeof parsed === "string") {
    const direct = normalizeDesignSourceType(parsed);
    if (direct) return direct;
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return fallback;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fallback;
  }
  const data = parsed as Record<string, unknown>;
  return (
    normalizeDesignSourceType(data.sourceType) ??
    normalizeDesignSourceType(data.sourceMode) ??
    fallback
  );
}

export function designConnectionIdFromData(value: unknown): string | undefined {
  return designConnectionIdsFromData(value)[0];
}

export function designConnectionIdsFromData(value: unknown): string[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      // coercion-ok: malformed persisted design data has no connection ids.
      return [];
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  const data = parsed as Record<string, unknown>;
  const ids = new Set<string>();
  if (typeof data.connectionId === "string" && data.connectionId) {
    ids.add(data.connectionId);
  }
  for (const metadataKey of ["screenMetadata", "localhostScreens"] as const) {
    const metadata = data[metadataKey];
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      continue;
    }
    for (const entry of Object.values(metadata as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const connectionId = (entry as Record<string, unknown>).connectionId;
      if (typeof connectionId === "string" && connectionId) {
        ids.add(connectionId);
      }
    }
  }
  return [...ids];
}

export function makeLocalhostRouteId(path: string): string {
  const normalized = path.trim() || "/";
  const slug = normalized
    .replace(/^\/+/, "")
    .replace(/\*/g, "w")
    .replace(/:/g, "p")
    .replace(/[[\]]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const readable =
    normalized === "/"
      ? "root"
      : /^\/\*+$/.test(normalized) || !slug
        ? "wildcard"
        : slug;
  return `route-${readable}-${stableRoutePathHash(normalized)}`;
}

function stableRoutePathHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0)!);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(36);
}

export function titleFromRoutePath(path: string): string {
  const normalized = path.trim();
  if (!normalized || normalized === "/") return "Home";
  if (normalized === "/*" || normalized === "*") return "Wildcard";
  return (
    normalized
      .replace(/^\/+/, "")
      .replace(/[:$]/g, "")
      .replace(/[-_/]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase()) || "Screen"
  );
}

export function resolveDescriptorCapabilities(
  source: DesignSourceDescriptor,
): DesignSourceCapabilities {
  if (source.capabilities) return source.capabilities;

  switch (source.sourceType) {
    case "inline":
      return INLINE_DEFAULT_CAPABILITIES;
    case "localhost":
      return LOCALHOST_DEFAULT_CAPABILITIES;
    case "fusion":
      return source.connected
        ? FUSION_CONNECTED_CAPABILITIES
        : FUSION_DISCONNECTED_CAPABILITIES;
    default: {
      const _exhaustive: never = source;
      void _exhaustive;
      return INLINE_DEFAULT_CAPABILITIES;
    }
  }
}
