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

/**
 * Source-level provenance for a selected DOM element, populated from
 * data attributes emitted by the connected app's build-time transform
 * (e.g. @vitejs/plugin-react jsxDEV source maps or a Babel source plugin).
 *
 * - data-source-file / data-loc "file:line:col" → sourceFile
 * - data-source-line / data-loc                 → line
 * - data-source-column / data-loc               → column
 * - data-component-name                         → component
 *
 * All fields are optional because cross-origin localhost iframes cannot be
 * read (same-origin policy), and inline screens may not carry these attrs.
 */
export interface ElementProvenance {
  sourceFile?: string;
  line?: number;
  column?: number;
  component?: string;
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

// Re-export `DesignSourceCapabilities` so callers that import from
// `source-mode` continue to resolve the type without an extra import.
export type { DesignSourceCapabilities };

export interface LocalhostDesignRoute {
  id: string;
  path: string;
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
  /**
   * Low-level bridge operation capabilities (legacy shape).
   *
   * Kept for backward compatibility with existing persistence and consumers
   * (`connect-localhost`, `list-localhost-connections`).  New code should read
   * `sourceCapabilities` for the higher-level capability vocabulary that UI
   * panels and agent actions gate on.
   */
  capabilities: DesignBridgeCapability[];
  /**
   * High-level capability map for this connection (the preferred gate).
   *
   * Derived from and/or overrides `LOCALHOST_DEFAULT_CAPABILITIES`.  Absent
   * means the caller should fall back to the tier defaults via
   * `resolveDescriptorCapabilities()`.  Populated by the bridge handshake and
   * persisted alongside the connection so capability checks remain correct
   * across reconnects.
   */
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
  /**
   * Optional proven capability set for this source.
   *
   * When present, UI panels and actions MUST read capabilities from here
   * rather than inferring them from `sourceType`.  Absent means "use the
   * tier defaults from `resolveDescriptorCapabilities()`".
   */
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
  /**
   * Optional proven capability set for this source.
   *
   * Populated after a successful bridge handshake; overrides the conservative
   * `LOCALHOST_DEFAULT_CAPABILITIES` for capabilities the bridge has verified.
   * Use `resolveDescriptorCapabilities(source)` to merge defaults with proven
   * overrides.
   */
  capabilities?: DesignSourceCapabilities;
}

export interface FusionDesignSource {
  sourceType: "fusion";
  externalId?: string;
  url?: string;
  revision?: string;
  metadata?: Record<string, unknown>;
  /**
   * Whether Builder credentials are configured and a branch project is set for
   * this fusion source.
   *
   * When `true`, `resolveDescriptorCapabilities()` returns
   * `FUSION_CONNECTED_CAPABILITIES` (indexComponents + branch + deployPreview +
   * deploy available; source writes still planned until bridge hardening).
   *
   * When `false` or absent, returns `FUSION_DISCONNECTED_CAPABILITIES`
   * (preview-only — no real-app write or branch operations).
   *
   * Set this field after verifying Builder connection status via
   * `resolveIsBuilderBranchingEnabled()` from `@agent-native/core/server`.
   * Callers that need the capability map without a descriptor can use
   * `resolveFusionCapabilities(connected)` from `capability-resolver.ts`.
   */
  connected?: boolean;
  /**
   * Optional proven capability set for this source.
   *
   * When present, UI panels and actions MUST read capabilities from here
   * rather than inferring them from `sourceType` or `connected`.  Absent means
   * "use the connection-aware tier defaults from
   * `resolveDescriptorCapabilities()`".
   *
   * Populated once the Builder-hosted bridge has proven additional capabilities
   * beyond the defaults (e.g. specific `writeFile` or `applyEdit` readiness).
   */
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
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const data = parsed as Record<string, unknown>;
  if (typeof data.connectionId === "string" && data.connectionId) {
    return data.connectionId;
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
        return connectionId;
      }
    }
  }
  return undefined;
}

export function makeLocalhostRouteId(path: string): string {
  const normalized = path.trim() || "/";
  // Encode structural characters distinctly BEFORE collapsing non-alphanumerics,
  // otherwise paths like "/design/:id" and "/design-id", or "/users" and
  // "/users/*", produce identical ids and silently overwrite each other in the
  // route manifest map.
  const slug = normalized
    .replace(/^\/+/, "")
    .replace(/\*/g, "w") // wildcard segment
    .replace(/:/g, "p") // route param prefix (":id" -> "pid")
    .replace(/[[\]]/g, "") // strip [id] bracket syntax
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  // Slugs are readable but lossy. Hash every normalized path so separators,
  // reserved words, router syntax, and query-state variants remain distinct.
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

/**
 * Return the effective `DesignSourceCapabilities` for a source descriptor.
 *
 * **Preferred over reading `sourceType` directly.**  The function honours the
 * three-level capability contract from DESIGN-STUDIO-PLAN.md §1.1:
 *
 * 1. If the descriptor already carries a proven `capabilities` map (populated
 *    after a bridge handshake or capability verification), return that map.
 * 2. For **fusion** sources, honour the `connected` flag on the descriptor:
 *    - `connected === true` → `FUSION_CONNECTED_CAPABILITIES`: `indexComponents`,
 *      `branch`, `deployPreview`, `deploy` are **available**; source writes
 *      (`writeFile`, `writeTokens`, `writeMotion`) remain **planned** until
 *      bridge hardening.
 *    - `connected === false` / absent → `FUSION_DISCONNECTED_CAPABILITIES`:
 *      preview-only; no real-app write or branch operations.
 * 3. Otherwise fall back to the conservative tier defaults
 *    (`INLINE_DEFAULT_CAPABILITIES` / `LOCALHOST_DEFAULT_CAPABILITIES`).
 *
 * Usage:
 * ```ts
 * import { resolveDescriptorCapabilities } from "./source-mode";
 * import { hasCapability } from "./design-source-capabilities";
 *
 * const caps = resolveDescriptorCapabilities(source);
 * if (hasCapability(caps, "branch")) { ... }
 * ```
 *
 * To set the fusion connection state on a descriptor before resolving:
 * ```ts
 * import { resolveIsBuilderBranchingEnabled } from "@agent-native/core/server";
 *
 * const connected = await resolveIsBuilderBranchingEnabled();
 * const source: FusionDesignSource = { ...existing, connected };
 * const caps = resolveDescriptorCapabilities(source);
 * ```
 *
 * To record proven capabilities discovered after a bridge handshake, spread
 * the defaults and override the specific entries before storing on the
 * descriptor:
 * ```ts
 * import { resolveFusionCapabilities, available } from "./capability-resolver";
 *
 * const caps = {
 *   ...resolveFusionCapabilities(true),
 *   writeFile: available("Bridge write hardening complete"),
 * };
 * const source: FusionDesignSource = { ...existing, capabilities: caps };
 * ```
 *
 * Note: this module cannot import from `capability-resolver.ts` at runtime
 * because `capability-resolver.ts` already imports `DesignSourceType` from
 * here (circular).  The helper is therefore implemented inline using the same
 * canonical default maps re-imported from `design-source-capabilities.ts`.
 */
export function resolveDescriptorCapabilities(
  source: DesignSourceDescriptor,
): DesignSourceCapabilities {
  // If the descriptor carries a proven capability map, use it as-is.
  // (A proven map overrides both sourceType and connected state.)
  if (source.capabilities) return source.capabilities;

  switch (source.sourceType) {
    case "inline":
      return INLINE_DEFAULT_CAPABILITIES;
    case "localhost":
      return LOCALHOST_DEFAULT_CAPABILITIES;
    case "fusion":
      // Honour the connection status flag on the descriptor.
      //
      // - `connected === true` → `FUSION_CONNECTED_CAPABILITIES`:
      //     indexComponents, branch, deployPreview, deploy are available;
      //     source writes (writeFile/writeTokens/writeMotion) remain planned.
      // - `connected === false` or absent → `FUSION_DISCONNECTED_CAPABILITIES`:
      //     preview-only; no real-app write or branch operations.
      //
      // Callers should set `source.connected` after verifying Builder status
      // via `resolveIsBuilderBranchingEnabled()`.  When the status is unknown
      // (e.g. a stale descriptor without the field), the conservative
      // disconnected default is returned.
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
