/**
 * run-design-extension-action — thin dispatcher.
 *
 * Routes an extension action request to the correct first-party action via
 * the existing action surface.  Extensions add NO permanent editor chrome —
 * this action is the single call-through so the agent doesn't need to remember
 * which internal action backs each extension capability.
 *
 * For first-party extensions (design.asset-library, design.shader-fills,
 * design.token-auditor, design.motion-presets), the action dispatches to the
 * correct implementation.  The caller can always call the underlying action
 * directly; this dispatcher exists as a convenience layer for the agent and
 * for extension iframe code that calls `appAction("run-design-extension-action")`.
 *
 * For user-created extensions (kind="user-extension"), the action does NOT
 * inject content into or modify the extension iframe itself — the iframe
 * bridge handles that.  Instead, it records the request context so the agent
 * can follow up.
 *
 * Reuses the existing extension infra:
 * - Core `list-extensions` / `get-extension` for user extension resolution.
 * - Per-action implementations for first-party capabilities.
 * - The `design.editor.inspector` slot contract from DesignExtensionsPanel.tsx.
 *
 * Plan reference: DESIGN-STUDIO-PLAN.md §6.7 + §7 (`run-design-extension-action`).
 */

import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

// ─── Supported first-party extension ids ──────────────────────────────────────

const FIRST_PARTY_IDS = [
  "design.asset-library",
  "design.shader-fills",
  "design.token-auditor",
  "design.motion-presets",
] as const;

type FirstPartyId = (typeof FIRST_PARTY_IDS)[number];

// ─── Capability routing map ───────────────────────────────────────────────────

/**
 * Maps a `extensionId:capabilityId` pair to the action the caller should use.
 * The dispatcher does NOT inline-call other actions (actions are not composable
 * that way in this framework) — it returns routing guidance with the exact
 * action name and params so the agent makes one follow-up call.
 */
interface CapabilityRoute {
  action: string;
  paramHint: string;
  readOnly: boolean;
  gated?: boolean;
  gateReason?: string;
}

const CAPABILITY_ROUTES: Record<string, CapabilityRoute> = {
  // Asset Library
  "design.asset-library:browse": {
    action: "get-design-snapshot",
    paramHint:
      "Call get-design-snapshot to inspect the active design, then use the Assets MCP tool (generate-asset / open-asset-picker) or the Assets app via call-agent.",
    readOnly: true,
  },
  "design.asset-library:insert": {
    action: "insert-asset",
    paramHint:
      "Call insert-asset with { assetUrl, designId?, fileId?, ownerId? }.  Pass ownerId from view-screen.designSelection for selection-aware placement.",
    readOnly: false,
  },
  "design.asset-library:generate": {
    action: "call-agent",
    paramHint:
      'Delegate to the Assets app via call-agent with agent "assets" and a generation prompt.  Pass the returned assetUrl to insert-asset.',
    readOnly: false,
  },

  // Shader Fills
  "design.shader-fills:catalog": {
    action: "get-shader",
    paramHint: "Call get-shader with an optional source context.",
    readOnly: true,
  },
  "design.shader-fills:preview": {
    action: "preview-shader-fill",
    paramHint:
      "Call preview-shader-fill with { descriptor: { preset, params?, colors?, speed? }, target? }.  Returns previewCss + bridgeMessage; no writes.",
    readOnly: true,
  },
  "design.shader-fills:code-snippet": {
    action: "apply-shader",
    paramHint:
      "Call apply-shader with { descriptor, surface?, target?, source? }.  Returns JSX import + snippet or HTML bridge mount for manual insertion.",
    readOnly: true,
  },
  "design.shader-fills:apply": {
    action: "apply-shader-fill",
    paramHint:
      "Call apply-shader-fill with { descriptor, target?, source?, surface? }.  NOTE: currently returns gated:true — all safety conditions are unmet.  Use preview or code-snippet instead.",
    readOnly: false,
    gated: true,
    gateReason:
      "apply-shader-fill is GATED until runtime rendering + source-write path + CSS fallback + diff proof are all in place.  It will return { ok: false, gated: true } today.",
  },

  // Token Auditor
  "design.token-auditor:index": {
    action: "index-design-tokens",
    paramHint:
      "Call index-design-tokens with { designId? } to parse CSS vars from the design.",
    readOnly: true,
  },
  "design.token-auditor:preview-edit": {
    action: "preview-design-token-edit",
    paramHint:
      "Call preview-design-token-edit with { designId, tokenId, value } for a live CSS-var preview.",
    readOnly: true,
  },
  "design.token-auditor:apply-edit": {
    action: "apply-design-token-edit",
    paramHint:
      "Call apply-design-token-edit with { designId, tokenId, value } to persist via the Tweaks loop.",
    readOnly: false,
  },
  "design.token-auditor:write-source": {
    action: "apply-design-token-edit",
    paramHint:
      "Source write-back is planned.  Call apply-design-token-edit — for inline designs it persists via Tweaks; for real-app sources with writeTokens capability it writes to the source file.",
    readOnly: false,
    gated: true,
    gateReason:
      "Source write-back to globals.css / tailwind.config is planned pending bridge hardening.",
  },

  // Motion Presets
  "design.motion-presets:preview": {
    action: "get-motion-timeline",
    paramHint:
      "Motion preview is a client-side postMessage bridge operation, not a server action. " +
      "To inspect an existing timeline before committing, call get-motion-timeline with { designId }. " +
      "To trigger a live scrub preview in the editor iframe, send a `motion-preview` postMessage from the extension UI.",
    readOnly: true,
  },
  "design.motion-presets:apply": {
    action: "apply-motion-edit",
    paramHint:
      "Call apply-motion-edit with { designId, fileId?, timeline: { tracks, durationMs } } for an atomic managed CSS timeline save.",
    readOnly: false,
  },
  "design.motion-presets:write-source": {
    action: "apply-motion-edit",
    paramHint:
      "Real-source CSS module write-back is planned for fusion tier.  Today apply-motion-edit writes to the managed <style> block for inline designs.",
    readOnly: false,
    gated: true,
    gateReason:
      "CSS module write-back is planned pending fusion bridge hardening.",
  },
};

// ─── Action ──────────────────────────────────────────────────────────────────

export default defineAction({
  description: `
Dispatch an action through a first-party Design Studio extension surface.

This is a thin routing layer — it does not call the underlying action itself;
instead it returns the exact action name + param hint so the agent makes one
follow-up call.  This keeps the extension surface composable without
duplicating action logic.

Supported first-party extensions (extensionId):
  design.asset-library   — browse / insert / generate assets.
  design.shader-fills    — catalog / preview / code-snippet / apply (apply is GATED).
  design.token-auditor   — index / preview-edit / apply-edit / write-source.
  design.motion-presets  — preview / apply / write-source.

For user-created Alpine extensions, use list-extensions / get-extension / update-extension.
The extension iframe itself is not called by this action — only the backing action route.
  `.trim(),
  schema: z.object({
    extensionId: z
      .string()
      .describe(
        "First-party extension id.  One of: " + FIRST_PARTY_IDS.join(", "),
      ),
    capabilityId: z
      .string()
      .describe(
        "Capability to invoke within the extension.  Call list-design-extensions to see available capabilities per extension.",
      ),
    context: z
      .object({
        designId: z.string().optional(),
        fileId: z.string().optional(),
        nodeId: z.string().optional(),
        selector: z.string().optional(),
        ownerId: z.string().optional(),
      })
      .optional()
      .describe(
        "Optional context from the current design editor state (view-screen output).",
      ),
  }),
  readOnly: true, // This dispatcher only returns routing guidance; it never writes.
  run: async ({ extensionId, capabilityId, context }) => {
    // Enforce read access before doing anything else when a designId is given,
    // so this dispatcher can't be used to probe whether a design exists.
    if (context?.designId) {
      const access = await resolveAccess("design", context.designId);
      if (!access) {
        const err = new Error("Design not found") as Error & {
          statusCode: number;
        };
        err.statusCode = 404;
        throw err;
      }
    }

    // Validate extension id.
    if (!FIRST_PARTY_IDS.includes(extensionId as FirstPartyId)) {
      return {
        ok: false,
        error: `Unknown first-party extensionId: "${extensionId}".`,
        knownExtensions: FIRST_PARTY_IDS,
        hint: "For user-created extensions, use list-extensions / get-extension / update-extension.",
      };
    }

    const routeKey = `${extensionId}:${capabilityId}`;
    const route = CAPABILITY_ROUTES[routeKey];

    if (!route) {
      // Return available capabilities for this extension.
      const availableCaps = Object.keys(CAPABILITY_ROUTES)
        .filter((k) => k.startsWith(`${extensionId}:`))
        .map((k) => k.split(":")[1]);

      return {
        ok: false,
        error: `Unknown capabilityId "${capabilityId}" for extension "${extensionId}".`,
        availableCapabilities: availableCaps,
        hint: `Call list-design-extensions with extensionId "${extensionId}" to see all capabilities.`,
      };
    }

    // Build a helpful context-aware param hint.
    let contextualHint = route.paramHint;
    if (context?.designId) {
      contextualHint += `  Current designId: "${context.designId}".`;
    }
    if (context?.fileId) {
      contextualHint += `  Current fileId: "${context.fileId}".`;
    }
    if (context?.nodeId ?? context?.selector) {
      const target = context.nodeId
        ? `nodeId="${context.nodeId}"`
        : `selector="${context.selector}"`;
      contextualHint += `  Current target: ${target}.`;
    }
    if (context?.ownerId) {
      contextualHint += `  Current ownerId: "${context.ownerId}".`;
    }

    return {
      ok: true,
      extensionId,
      capabilityId,
      route: {
        action: route.action,
        paramHint: contextualHint,
        readOnly: route.readOnly,
        gated: route.gated ?? false,
        gateReason: route.gateReason ?? null,
      },
      nextStep: route.gated
        ? `NOTE: This capability is gated.  ${route.gateReason ?? ""}  The underlying action will return a clear gated result; do not imply the operation will succeed.`
        : `Call the action "${route.action}" with the params described in paramHint.`,
      slotId: "design.editor.inspector",
    };
  },
});
