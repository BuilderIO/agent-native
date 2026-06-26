import { defineAction, embedApp } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs

function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId },
    // `handoff=chat` marks a link opened from a link-only host (CLI / Codex /
    // Claude Code) so the editor shows a copyable paste-back summary after the
    // user picks — the choice can't ride a host chat bridge there.
    to: `/design/${encodeURIComponent(designId)}?handoff=chat`,
  });
}

const FALLBACK_INSTRUCTIONS =
  "If the design opens as a browser link instead of inline, the user picks a " +
  "direction there and the editor shows a copyable summary. Ask them to paste " +
  "that summary back into chat so you can continue from the chosen direction. " +
  'They can also just tell you which one in words (e.g. "use variant A" / "the ' +
  'editorial one") — honor that too instead of insisting on the paste-back.';

const variantSchema = z.object({
  id: z.string().min(1).describe("Stable variant id, e.g. 'minimal-focus'"),
  label: z
    .string()
    .min(1)
    .describe("Short user-facing variant name, e.g. 'One-Line Focus'"),
  content: z
    .string()
    .min(1)
    .describe(
      "Complete self-contained HTML document for this variant. Inline the CSS needed for the preview; avoid relying on external CSS/script CDNs because MCP app sandboxes may block them.",
    ),
});

export default defineAction({
  description:
    "Present generated design directions in the Design editor so the user can " +
    "visually compare options and pick one. Provide 2-5 variants (3 is the " +
    "sweet spot). Use this for design exploration before calling " +
    "generate-design. The user's choice is persisted automatically by the app; " +
    "if it opens as a browser link, they paste a copyable summary back to chat " +
    'or simply tell you which one (e.g. "use variant A").',
  schema: z.object({
    designId: z.string().describe("Design project ID to show variants for"),
    prompt: z
      .string()
      .optional()
      .describe("Caption shown above the variant grid"),
    variants: z
      .array(variantSchema)
      .min(2)
      .max(5)
      .describe(
        "2-5 concise, visually distinct generated design options to preview side by side (3 is the sweet spot). Inline CSS so all options render in the MCP app preview.",
      ),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Design directions",
      description:
        "Open the Design editor with a visual picker for generated variants.",
      iframeTitle: "Agent-Native Design",
      openLabel: "Open design directions",
      height: 720,
    }),
  },
  run: async ({ designId, prompt, variants }) => {
    await assertAccess("design", designId, "editor");

    await writeAppState("design-variants", {
      designId,
      prompt: prompt ?? "Pick a direction",
      variants,
    });

    return {
      designId,
      prompt: prompt ?? "Pick a direction",
      count: variants.length,
      path: `/design/${encodeURIComponent(designId)}?handoff=chat`,
      embed: true,
      fallbackInstructions: FALLBACK_INSTRUCTIONS,
      nextRequiredAction:
        "Wait for the user to pick a variant before refining or calling generate-design.",
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const designId = (result as { designId?: string }).designId;
    if (!designId) return null;
    return {
      url: designDeepLink(designId),
      label: "Open design directions",
      view: "editor",
    };
  },
});
