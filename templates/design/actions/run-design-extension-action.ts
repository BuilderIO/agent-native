import { defineAction } from "@agent-native/core/action";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

const FIRST_PARTY_IDS = [
  "design.asset-library",
  "design.token-auditor",
] as const;

type FirstPartyId = (typeof FIRST_PARTY_IDS)[number];

interface CapabilityRoute {
  action: string;
  paramHint: string;
  readOnly: boolean;
  gated?: boolean;
  gateReason?: string;
  mcpTool?: boolean;
}

const CAPABILITY_ROUTES: Record<string, CapabilityRoute> = {
  "design.asset-library:browse": {
    action: "get-design-snapshot",
    paramHint:
      "Call get-design-snapshot to inspect the active design, then use the Assets MCP tools (generate-asset / open-asset-picker) when they are in your tool list.",
    readOnly: true,
  },
  "design.asset-library:insert": {
    action: "insert-asset",
    paramHint:
      "Call insert-asset with { assetUrl, designId?, fileId?, ownerId? }.  Pass ownerId from view-screen.designSelection for selection-aware placement.",
    readOnly: false,
  },
  "design.asset-library:generate": {
    action: "generate-asset",
    paramHint:
      'Call the Assets MCP tool whose name ends in "__generate-asset" with a generation prompt and callerAppId "design", then pass the returned assetUrl to insert-asset.  If no generate-asset tool is in your tool list, Assets is not connected for this organization: say so (an org owner or admin can run connect-assets-mcp) and do not try to reach another app.',
    readOnly: false,
    mcpTool: true,
  },

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
};

export default defineAction({
  description: `
Dispatch an action through a first-party Design Studio extension surface.

This is a thin routing layer — it does not call the underlying action itself;
instead it returns the exact action name + param hint so the agent makes one
follow-up call.  This keeps the extension surface composable without
duplicating action logic.

Supported first-party extensions (extensionId):
  design.asset-library   — browse / insert / generate assets.
  design.token-auditor   — index / preview-edit / apply-edit / write-source.

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
        mcpTool: route.mcpTool ?? false,
      },
      nextStep: route.gated
        ? `NOTE: This capability is gated.  ${route.gateReason ?? ""}  The underlying action will return a clear gated result; do not imply the operation will succeed.`
        : route.mcpTool
          ? `Call the MCP tool in your tool list whose name ends in "__${route.action}" with the params described in paramHint.`
          : `Call the action "${route.action}" with the params described in paramHint.`,
      slotId: "design.editor.inspector",
    };
  },
});
