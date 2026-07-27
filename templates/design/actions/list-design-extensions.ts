/**
 * list-design-extensions — read action.
 *
 * Returns the first-party Design Studio extensions with their capability and
 * availability status.  The four built-in extensions are:
 *
 *   1. Asset Library     — selection-aware asset insertion (ships now).
 *   2. Shader Fills      — GPU shader fill previews (preview-only now; apply gated).
 *   3. Token Auditor     — reads token usage across the design and flags clashes.
 *   4. Motion Presets    — one-click motion preset application.
 *
 * These are FIRST-PARTY extensions described as static metadata — they do not
 * live in the extensions SQL table (they are capabilities of the design app,
 * not user-created Alpine mini-apps).  The UI surfaces them in the
 * `design.editor.inspector` slot alongside user-installed extensions.
 *
 * The action also returns which actions power each extension, so the agent
 * can invoke them directly without going through the extension iframe sandbox.
 *
 * Plan reference: DESIGN-STUDIO-PLAN.md §6.7 + §7 (`list-design-extensions`).
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";

// ─── First-party extension catalog ───────────────────────────────────────────

export type DesignExtensionAvailability =
  | "available" // ships now; can be used immediately
  | "preview-only" // read / preview possible; write/apply is gated
  | "planned"; // exists in the plan; not yet implemented

export interface DesignExtensionCapabilityEntry {
  id: string;
  label: string;
  status: DesignExtensionAvailability;
  reason?: string;
}

export interface FirstPartyDesignExtension {
  /** Stable machine identifier — used by run-design-extension-action. */
  id: string;
  name: string;
  description: string;
  /** Tabler icon name (without the `Icon` prefix). */
  icon: string;
  /**
   * Overall availability of this extension.
   * Individual capabilities may be more restrictive.
   */
  availability: DesignExtensionAvailability;
  /** Human-readable availability note shown in the UI. */
  availabilityNote: string;
  /** Fine-grained capability breakdown. */
  capabilities: DesignExtensionCapabilityEntry[];
  /** Design Studio actions that power this extension. */
  actions: string[];
  /**
   * Whether this extension is registered in the `design.editor.inspector`
   * extension slot as an installable first-party item.
   */
  slotId: "design.editor.inspector";
}

const FIRST_PARTY_EXTENSIONS: FirstPartyDesignExtension[] = [
  // ── 1. Asset Library ─────────────────────────────────────────────────────
  {
    id: "design.asset-library",
    name: "Asset Library",
    description:
      "Browse and insert Design primitives, generated or uploaded media, and rendered Figma library components into the active design screen. " +
      "Selection-aware: inserts near the selected element when one is active.",
    icon: "Photo",
    availability: "available",
    availabilityNote:
      "Fully available — call list-design-native-assets then insert-design-native-asset for editable Design primitives, insert-asset for media, or list-figma-library-assets then insert-figma-library-asset for Figma components.",
    capabilities: [
      {
        id: "native",
        label: "Browse Design assets",
        status: "available",
        reason:
          "Uses list-design-native-assets and insert-design-native-asset for editable HTML primitives/components.",
      },
      {
        id: "media",
        label: "Browse generated and uploaded media",
        status: "available",
      },
      {
        id: "insert",
        label: "Insert asset into design",
        status: "available",
        reason:
          "Uses insert-asset; selection-aware insertion lands immediately.",
      },
      {
        id: "generate",
        label: "Generate new asset via Assets app",
        status: "available",
        reason:
          "Delegate to the Assets app via call-agent or the Assets MCP tool.",
      },
      {
        id: "figma",
        label: "Browse Figma library assets",
        status: "available",
        reason:
          "Uses FIGMA_ACCESS_TOKEN to list Figma file components/component sets and insert rendered nodes with provenance.",
      },
    ],
    actions: [
      "list-design-native-assets",
      "insert-design-native-asset",
      "insert-asset",
      "list-figma-library-assets",
      "insert-figma-library-asset",
      "get-design-snapshot",
    ],
    slotId: "design.editor.inspector",
  },

  // ── 2. Shader Fills ──────────────────────────────────────────────────────
  {
    id: "design.shader-fills",
    name: "Shader Fills",
    description:
      "GPU-accelerated shader fill presets (MeshGradient, GrainGradient, Voronoi, " +
      "Metaballs, Warp, GodRays, Dithering, PaperTexture).  Preview as CSS gradient " +
      "without writing anything; full apply is gated until runtime rendering + " +
      "source-write + fallback + diff proof are all in place.",
    icon: "Sparkles",
    availability: "preview-only",
    availabilityNote:
      "Preview-only.  Call preview-shader-fill for a live CSS preview or " +
      "apply-shader for a manual-edit code snippet.  apply-shader-fill is " +
      "gated and will return NOT_YET_AVAILABLE until safety conditions are met.",
    capabilities: [
      {
        id: "catalog",
        label: "Browse shader preset catalog",
        status: "available",
        reason: "Call get-shader to see all 8 presets.",
      },
      {
        id: "preview",
        label: "Preview shader fill as CSS gradient",
        status: "available",
        reason:
          "Call preview-shader-fill — returns previewCss + bridgeMessage; no writes.",
      },
      {
        id: "code-snippet",
        label: "Generate code snippet for manual edit",
        status: "available",
        reason:
          "Call apply-shader — returns JSX import + snippet or HTML bridge mount.",
      },
      {
        id: "apply",
        label: "Apply shader fill (persist to design)",
        status: "preview-only",
        reason:
          "apply-shader-fill is GATED until: (1) runtime WebGL rendering verified via " +
          "captureSnapshot, (2) source-write bridge available, (3) CSS fallback embedded " +
          "alongside canvas, (4) before/after diff produced.  Today it returns gated:true.",
      },
    ],
    actions: [
      "get-shader",
      "preview-shader-fill",
      "apply-shader",
      "apply-shader-fill",
    ],
    slotId: "design.editor.inspector",
  },

  // ── 3. Token Auditor ─────────────────────────────────────────────────────
  {
    id: "design.token-auditor",
    name: "Token Auditor",
    description:
      "Reads CSS custom property (token) usage across the active design, surfaces " +
      "clashes (e.g. hard-coded colours that should be tokens, unused tokens), and " +
      "guides token-first editing via the Tweaks loop.",
    icon: "Palette",
    availability: "available",
    availabilityNote:
      "Token reads are available for all source types.  Token write-back " +
      "to real source files (globals.css / tailwind.config) is gated on bridge " +
      "hardening and requires a real-app source type.",
    capabilities: [
      {
        id: "index",
        label: "Index tokens from design",
        status: "available",
        reason: "Call index-design-tokens to parse CSS vars from the design.",
      },
      {
        id: "preview-edit",
        label: "Preview token edit",
        status: "available",
        reason: "Call preview-design-token-edit for a live CSS-var preview.",
      },
      {
        id: "apply-edit",
        label: "Apply token edit (persist)",
        status: "available",
        reason:
          "Call apply-design-token-edit — persists via the Tweaks loop for inline designs.",
      },
      {
        id: "write-source",
        label: "Write token back to source file",
        status: "preview-only",
        reason:
          "Source write-back (globals.css / tailwind.config) requires a real-app " +
          "source type and bridge hardening.  Currently planned.",
      },
    ],
    actions: [
      "index-design-tokens",
      "preview-design-token-edit",
      "apply-design-token-edit",
      "get-design-surface-index",
    ],
    slotId: "design.editor.inspector",
  },

  // ── 4. Motion Presets ────────────────────────────────────────────────────
  {
    id: "design.motion-presets",
    name: "Motion Presets",
    description:
      "One-click animation presets (fade-in, slide-up, pulse, bounce, spin) that " +
      "apply to the selected node via the motion timeline.  Preview is live; " +
      "track edits persist to managed CSS atomically.",
    icon: "PlayerPlay",
    availability: "available",
    availabilityNote:
      "Motion preview is available for all source types.  Managed CSS persistence " +
      "(apply-motion-edit) is atomic and available for inline + localhost. Source write-back to real CSS " +
      "modules remains planned for the fusion tier.",
    capabilities: [
      {
        id: "preview",
        label: "Preview motion preset (scrub, no write)",
        status: "available",
        reason:
          "Preview sends a motion-preview bridge message — no DB / collab write.",
      },
      {
        id: "apply",
        label: "Persist keyframes to managed CSS (apply-motion-edit)",
        status: "available",
        reason:
          "apply-motion-edit is atomic: persists timeline row + compiled CSS + " +
          "Yjs/collab update + diff proof in one call.",
      },
      {
        id: "write-source",
        label: "Write to real CSS module / motion-react",
        status: "preview-only",
        reason:
          "Real-source CSS module write-back is planned for fusion tier after bridge hardening.",
      },
    ],
    actions: [
      "get-motion-timeline",
      "apply-motion-edit",
      "remove-motion-timeline",
    ],
    slotId: "design.editor.inspector",
  },
];

// ─── Action ──────────────────────────────────────────────────────────────────

export default defineAction({
  description: `
List the first-party Design Studio extensions with their capability and availability status.

Returns the four built-in extensions:
  1. Asset Library     — native components, media, and Figma imports (available now).
  2. Shader Fills      — GPU shader fill previews (preview-only; apply is gated).
  3. Token Auditor     — token usage reads + edits (available; source write-back planned).
  4. Motion Presets    — one-click animation presets (available; source write-back planned).

Each entry includes the actions that power it so the agent can call them directly.
Use run-design-extension-action to dispatch an action through the extension surface.
  `.trim(),
  schema: z.object({
    filter: z
      .object({
        availability: z
          .enum(["available", "preview-only", "planned", "all"])
          .optional()
          .default("all")
          .describe("Return only extensions with this availability status."),
        extensionId: z
          .string()
          .optional()
          .describe("Return only the extension with this id."),
      })
      .optional(),
  }),
  readOnly: true,
  run: async ({ filter }) => {
    let extensions = FIRST_PARTY_EXTENSIONS;

    if (filter?.extensionId) {
      extensions = extensions.filter((e) => e.id === filter.extensionId);
    }

    if (filter?.availability && filter.availability !== "all") {
      extensions = extensions.filter(
        (e) => e.availability === filter.availability,
      );
    }

    return {
      extensions,
      count: extensions.length,
      slotId: "design.editor.inspector",
      note:
        "These are first-party Design Studio extensions.  User-created extensions " +
        "live in the `design.editor.inspector` slot and can be listed via the core " +
        "`list-extensions` action with a search filter for the slot id.",
    };
  },
});
