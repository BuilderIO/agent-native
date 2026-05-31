import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import "../server/db/index.js"; // ensure registerShareableResource runs

const FALLBACK_INSTRUCTIONS =
  "If the directions open in a normal browser tab instead of inline (e.g. a CLI " +
  "or code editor like Claude Code or Codex), the user can choose in two ways: " +
  '(1) click "Use this one" — the page auto-copies a short handoff summary to ' +
  'paste back into chat, or (2) just tell you which one in words (e.g. "use ' +
  'variant A" / "the editorial one"). The chosen variant is saved as the ' +
  "design's index.html automatically; call get-design-snapshot to read it.";

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
    "persisted automatically by the app. Inline MCP hosts return the pick to " +
    "you automatically; if it opens as a browser link (a CLI or code editor), " +
    "the user either pastes the auto-copied summary or just tells you which " +
    'one (e.g. "use variant A").',
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
      message:
        "Design directions are ready in the editor. In an inline MCP app the " +
        "user's pick comes back to you automatically. If it opens as a browser " +
        'tab (CLI or code editor), the user clicks "Use this one" — the page ' +
        "auto-copies a short summary to paste back — or simply tells you which " +
        'one (e.g. "use the editorial one"). The chosen variant is saved as ' +
        "index.html automatically.",
      fallbackInstructions: FALLBACK_INSTRUCTIONS,
      nextRequiredAction:
        "Wait for the user to choose a direction. Their pick may arrive as a " +
        "chat message (inline app), a pasted summary, or a plain-language " +
        'choice ("use variant A"). Once you know the choice, call ' +
        "get-design-snapshot to read the saved index.html and continue from " +
        "there — do not present new variants unless they ask for more options.",
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
