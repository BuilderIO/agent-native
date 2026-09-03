/**
 * Source capability resolver — pure, no DB, no side effects.
 *
 * Maps a `DesignSourceType` (inline | localhost | fusion) to the concrete
 * `DesignSourceCapabilities` map.  Callers that have already proven a richer
 * capability set (e.g. a localhost bridge that has verified `readFile`) should
 * override the defaults after calling this function.
 *
 * The canonical tier semantics live in `DESIGN-STUDIO-PLAN.md` §5:
 *
 * - **inline** — HTML/CSS preview + controlled writes via the deterministic
 *   `replace-document-content` / `apply-tweaks` path; `previewMotion` + Tier-A
 *   `writeMotion` (managed `<style data-agent-native-motion>` block) and CSS-var
 *   token edits are available without a file-write bridge.
 * - **localhost** — starts read-only/preview-only; `readFile` / `applyEdit` /
 *   `writeFile` and real-app capabilities (`indexComponents`, `writeTokens`)
 *   become `available` only after bridge hardening.
 * - **fusion (Builder)** — starts preview-only; unlocks the full set
 *   (`indexComponents`, `writeTokens`, `writeMotion`, `branch`, `deploy`) once
 *   the bridge proves capabilities.
 *
 * The UI must never infer write ability from `sourceType` alone; it must always
 * read the capability map returned here (or an overridden variant).
 */

import {
  available,
  planned,
  unavailable,
  INLINE_DEFAULT_CAPABILITIES,
  LOCALHOST_DEFAULT_CAPABILITIES,
  FUSION_DISCONNECTED_CAPABILITIES,
  FUSION_CONNECTED_CAPABILITIES,
  type DesignSourceCapabilities,
} from "./design-source-capabilities";
import type { DesignSourceType } from "./source-mode";

/**
 * Return the default `DesignSourceCapabilities` for the given `sourceType`.
 *
 * These are **defaults** — they represent the conservative starting point for
 * a freshly connected source.  Callers that have runtime evidence of a richer
 * capability set (e.g. a bridge handshake that confirmed `readFile` works)
 * should spread/override specific entries rather than calling this function
 * again.
 *
 * ```ts
 * const caps = resolveSourceCapabilities(design.sourceType);
 * // Override after bridge handshake:
 * const proven: DesignSourceCapabilities = {
 *   ...caps,
 *   readFile: available("Bridge verified"),
 * };
 * ```
 *
 * @param sourceType - The source type from `DesignSourceType`.
 * @returns A read-only snapshot of the default capability map.
 */
export function resolveSourceCapabilities(
  sourceType: DesignSourceType,
): DesignSourceCapabilities {
  switch (sourceType) {
    case "inline":
      return INLINE_DEFAULT_CAPABILITIES;
    case "localhost":
      return LOCALHOST_DEFAULT_CAPABILITIES;
    case "fusion":
      // Conservative default for fusion when connection status is unknown.
      // Use resolveFusionCapabilities(connected) when Builder connection status
      // is known, or resolveDescriptorCapabilities() which honours the
      // descriptor's proven capabilities map.
      return FUSION_DISCONNECTED_CAPABILITIES;
    default: {
      // Exhaustive check — TypeScript will catch unhandled variants.
      const _exhaustive: never = sourceType;
      void _exhaustive;
      // Fallback: safest option is inline (no file writes, no real-app ops).
      return INLINE_DEFAULT_CAPABILITIES;
    }
  }
}

/**
 * Return the correct `DesignSourceCapabilities` for a **fusion** source based
 * on the current Builder connection status.
 *
 * Per DESIGN-STUDIO-PLAN.md §5:
 * - **Not connected** (`connected = false`): preview-only.  No real-app write
 *   operations (`indexComponents`, `branch`, `deployPreview`, `deploy`,
 *   `writeFile`, `writeTokens`, `writeMotion`) are available.
 * - **Connected** (`connected = true`): `indexComponents`, `branch`,
 *   `deployPreview`, and `deploy` are **available**.  Source writes
 *   (`writeFile`, `writeTokens`, `writeMotion`) remain **planned** until
 *   bridge hardening is complete.
 *
 * Usage (in an action that already resolved Builder status):
 * ```ts
 * import { resolveFusionCapabilities } from "../shared/capability-resolver.js";
 * import { resolveIsBuilderBranchingEnabled } from "@agent-native/core/server";
 *
 * const connected = await resolveIsBuilderBranchingEnabled();
 * const caps = resolveFusionCapabilities(connected);
 * if (hasCapability(caps, "branch")) { ... }
 * ```
 *
 * @param connected - `true` when Builder credentials are configured AND a
 *   branch project is set (i.e. `resolveIsBuilderBranchingEnabled()` returns
 *   `true`).
 */
export function resolveFusionCapabilities(
  connected: boolean,
): DesignSourceCapabilities {
  return connected
    ? FUSION_CONNECTED_CAPABILITIES
    : FUSION_DISCONNECTED_CAPABILITIES;
}

// Re-export factory helpers so callers only need this module to build
// capability maps with override entries.
export { available, planned, unavailable };
export type { DesignSourceCapabilities };
// Re-export the fusion constants for callers that prefer direct access.
export { FUSION_CONNECTED_CAPABILITIES, FUSION_DISCONNECTED_CAPABILITIES };
