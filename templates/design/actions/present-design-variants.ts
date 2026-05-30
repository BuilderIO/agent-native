import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import "../server/db/index.js"; // ensure registerShareableResource runs

function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId },
    to: `/design/${encodeURIComponent(designId)}`,
  });
}

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
    "Present exactly 3 generated design directions in the Design editor so the " +
    "user can visually compare options and pick one. Use this for design " +
    "exploration before calling generate-design. The user's choice is " +
    "persisted automatically by the app.",
  schema: z.object({
    designId: z.string().describe("Design project ID to show variants for"),
    prompt: z
      .string()
      .optional()
      .describe("Caption shown above the variant grid"),
    variants: z
      .array(variantSchema)
      .length(3)
      .describe(
        "Exactly 3 concise, visually distinct generated design options to preview side by side. Inline CSS so all options render in the MCP app preview.",
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
      path: `/design/${encodeURIComponent(designId)}`,
      embed: true,
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
