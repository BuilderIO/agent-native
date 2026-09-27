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

export function resolveSourceCapabilities(
  sourceType: DesignSourceType,
): DesignSourceCapabilities {
  switch (sourceType) {
    case "inline":
      return INLINE_DEFAULT_CAPABILITIES;
    case "localhost":
      return LOCALHOST_DEFAULT_CAPABILITIES;
    case "fusion":
      return FUSION_DISCONNECTED_CAPABILITIES;
    default: {
      const _exhaustive: never = sourceType;
      void _exhaustive;
      return INLINE_DEFAULT_CAPABILITIES;
    }
  }
}

export function resolveFusionCapabilities(
  connected: boolean,
): DesignSourceCapabilities {
  return connected
    ? FUSION_CONNECTED_CAPABILITIES
    : FUSION_DISCONNECTED_CAPABILITIES;
}

export { available, planned, unavailable };
export type { DesignSourceCapabilities };
export { FUSION_CONNECTED_CAPABILITIES, FUSION_DISCONNECTED_CAPABILITIES };
