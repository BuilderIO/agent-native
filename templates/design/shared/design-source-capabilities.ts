/**
 * Source capability vocabulary for the Design Studio.
 *
 * Every source (inline, localhost, fusion) advertises an explicit capability
 * set.  The UI gates controls on this — never on `sourceType` alone.  The
 * agent reads the same map and never claims a write the source cannot perform.
 *
 * Relation to `source-mode.ts`:
 * - `DesignBridgeOperation` ("select" | "resolveNodeToFile" | "readFile" |
 *   "applyEdit" | "writeFile" | "captureSnapshot" | "captureState" |
 *   "listFiles") describes
 *   the low-level bridge RPC surface.
 * - `DesignCapabilityName` below is the *higher-level* capability vocabulary
 *   that UI panels and agent actions read.  Several capabilities build on one
 *   or more bridge operations; others (e.g. `previewMotion`, `writeTokens`) are
 *   implemented above the bridge layer and have no direct bridge op.
 * - `DesignBridgeOperationStatus` ("available" | "planned" | "disabled") is
 *   reused here as `CapabilityStatus`.
 */

import type { DesignBridgeOperationStatus } from "./source-mode";

// ─── Capability name vocabulary ──────────────────────────────────────────────

/**
 * The full set of named capabilities a design source can advertise.
 *
 * - **readFile / writeFile / applyEdit** — low-level file I/O; bridge-backed.
 * - **resolveNodeToFile** — resolve a DOM node → source file + span.
 * - **previewPatch / diffPatch** — preview or diff a proposed source edit
 *   without committing it.
 * - **captureSnapshot / captureState** — snapshot the rendered iframe or
 *   capture running-app route+data state.
 * - **indexComponents** — static AST or runtime parse of React/TS components.
 * - **indexTokens** — parse CSS vars / Tailwind config / theme JSON for tokens.
 * - **writeTokens** — write token changes back to the real source files.
 * - **previewMotion** — scrub/play keyframe animations without writing to DB.
 * - **writeMotion** — commit a motion timeline (managed `<style>` block or
 *   real CSS module, depending on tier).
 * - **branch** — create/manage a Builder-hosted branch (fusion tier only).
 * - **deployPreview** — deploy a branch preview URL.
 * - **deploy** — merge/publish the branch to production.
 */
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

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * Mirrors `DesignBridgeOperationStatus` from `source-mode.ts` so callers can
 * import a single type.
 *
 * - `available`   — the source can perform this operation right now.
 * - `planned`     — the operation is understood but not yet hardened/enabled.
 * - `unavailable` — not supported for this source type; show a migration CTA.
 */
export type CapabilityStatus = DesignBridgeOperationStatus | "unavailable";

// ─── Per-capability entry ─────────────────────────────────────────────────────

export interface DesignSourceCapabilityEntry {
  status: CapabilityStatus;
  /** Optional human-readable explanation surfaced in CTA / tooltip copy. */
  reason?: string;
}

// ─── Full capability map ──────────────────────────────────────────────────────

/**
 * A map of every `DesignCapabilityName` to its status for a given source.
 * Read by UI panels and server-side actions to decide whether to enable,
 * preview-only, or show a migration CTA.
 */
export type DesignSourceCapabilities = Record<
  DesignCapabilityName,
  DesignSourceCapabilityEntry
>;

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Pure helper — returns `true` only when the named capability is `available`.
 * All other statuses ("planned", "unavailable", "disabled") return `false`.
 *
 * Usage:
 * ```ts
 * if (hasCapability(caps, "writeTokens")) { ... }
 * ```
 */
export function hasCapability(
  caps: DesignSourceCapabilities,
  name: DesignCapabilityName,
): boolean {
  return caps[name]?.status === "available";
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

/**
 * Build a `DesignSourceCapabilityEntry` with status `available`.
 * Convenience for constructing canonical capability maps.
 */
export function available(reason?: string): DesignSourceCapabilityEntry {
  return { status: "available", ...(reason !== undefined ? { reason } : {}) };
}

/**
 * Build a `DesignSourceCapabilityEntry` with status `planned`.
 * Used for capabilities that are understood by the bridge but not yet hardened.
 */
export function planned(reason?: string): DesignSourceCapabilityEntry {
  return { status: "planned", ...(reason !== undefined ? { reason } : {}) };
}

/**
 * Build a `DesignSourceCapabilityEntry` with status `unavailable`.
 * Used to signal a migration CTA to the UI.
 */
export function unavailable(reason?: string): DesignSourceCapabilityEntry {
  return {
    status: "unavailable",
    ...(reason !== undefined ? { reason } : {}),
  };
}

// ─── Well-known default maps per source tier ──────────────────────────────────

/**
 * Default capability map for **inline** (HTML/Alpine/SQL) designs.
 *
 * - CSS-var token edits and motion are available through the Tweaks loop and
 *   the managed `<style data-agent-native-motion>` block respectively.
 * - File-level ops (`readFile`, `writeFile`, `applyEdit`) are available for
 *   inline SQL-backed design_files through the Design source action surface.
 * - Real-app-only capabilities (`indexComponents`, `writeTokens`, `branch`,
 *   `deploy*`) are `unavailable` and trigger the "Make it real" CTA.
 */
export const INLINE_DEFAULT_CAPABILITIES: DesignSourceCapabilities = {
  readFile: available("Inline design files can be read from Design"),
  writeFile: available("Inline design files can be saved through Design"),
  applyEdit: available("Inline design files can be edited through Design"),
  resolveNodeToFile: available(),
  previewPatch: available(),
  diffPatch: available(),
  captureSnapshot: available(),
  captureState: available(),
  indexComponents: unavailable("Connect Builder to index real components"),
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

/**
 * Default capability map for a **fusion** (Builder-hosted) design where Builder
 * is **not yet connected** (no credentials / no branch project configured).
 *
 * Preview-only: the canvas can render and snapshot the remote app but no
 * real-app operations (`indexComponents`, `branch`, `deployPreview`, `deploy`,
 * write ops) are available until Builder credentials are confirmed.
 *
 * Use `FUSION_CONNECTED_CAPABILITIES` once `resolveHasCompleteBuilderConnection`
 * returns `true` and a branch project is configured.
 */
export const FUSION_DISCONNECTED_CAPABILITIES: DesignSourceCapabilities = {
  readFile: planned("Connect Builder to enable file reads on fusion sources"),
  writeFile: unavailable("Connect Builder to enable source writes"),
  applyEdit: unavailable("Connect Builder to enable source edits"),
  resolveNodeToFile: available(),
  previewPatch: available(),
  diffPatch: available(),
  captureSnapshot: available(),
  captureState: available(),
  indexComponents: unavailable("Connect Builder to index real components"),
  indexTokens: available(),
  writeTokens: unavailable("Connect Builder to enable token write-back"),
  previewMotion: available(),
  writeMotion: planned(
    "Motion write-back to real source requires bridge hardening",
  ),
  branch: unavailable("Connect Builder to create branches"),
  deployPreview: unavailable("Connect Builder to deploy previews"),
  deploy: unavailable("Connect Builder to deploy"),
};

/**
 * Capability map for a **fusion** (Builder-hosted) design where Builder **is
 * connected** (credentials present + branch project configured).
 *
 * Per DESIGN-STUDIO-PLAN.md §5:
 * - `indexComponents`, `branch`, `deployPreview`, `deploy` are **available**.
 * - Source writes (`writeFile`, `writeTokens`, `writeMotion` to real source)
 *   remain **planned** until bridge hardening is complete.
 * - `readFile`, `applyEdit`, `previewPatch`, `diffPatch`, `captureSnapshot`,
 *   `captureState`, `indexTokens`, and `previewMotion` are **available**.
 */
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
