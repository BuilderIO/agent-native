import { defineAction, embedApp } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import "../server/db/index.js"; // ensure registerShareableResource runs

const MCP_APP_FRAME_DOMAINS = [
  "https:",
  "http://localhost:*",
  "http://127.0.0.1:*",
];

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#x[0-9a-f]+;/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function deckDeepLink(deckId: string): string {
  return buildDeepLink({
    app: "slides",
    view: "editor",
    params: { deckId },
  });
}

export default defineAction({
  description:
    "Get a specific deck with all slides. Returns full deck JSON including slide content. User-visible slide numbers are 1-based and match the UI: slide 1 is the first slide. Use slideId for edits.",
  schema: z.object({
    id: z.string().optional().describe("Deck ID (required)"),
    compact: z
      .enum(["true", "false"])
      .optional()
      .describe("Set to 'true' for compact output (slide summaries only)"),
  }),
  http: { method: "GET" },
  mcpApp: {
    resource: embedApp({
      title: "Deck preview",
      description: "Open the deck in the real Slides editor.",
      iframeTitle: "Agent-Native Slides",
      openLabel: "Open deck",
      frameDomains: MCP_APP_FRAME_DOMAINS,
      height: 680,
    }),
  },
  run: async (args) => {
    if (!args.id) {
      return "Error: --id is required.";
    }

    const access = await resolveAccess("deck", args.id);
    if (!access) {
      return "Error: Deck not found";
    }

    const row = access.resource;
    const data = JSON.parse(row.data);
    const slides = data?.slides || [];

    if (args.compact === "true") {
      return {
        id: row.id,
        title: row.title || data?.title,
        visibility: row.visibility,
        designSystemId: row.designSystemId ?? null,
        slideCount: slides.length,
        slideNumbering:
          'User-visible slide numbers are 1-based and match the UI. "Slide 1" means slideNumber 1 / zeroBasedIndex 0. Use slideId for edits.',
        deepLink: deckDeepLink(row.id),
        slides: slides.map((s: any, i: number) => ({
          slideNumber: i + 1,
          zeroBasedIndex: i,
          id: s.id,
          layout: s.layout ?? null,
          textPreview: stripHtml(s.content || "").slice(0, 120),
        })),
      };
    }

    return {
      id: row.id,
      title: row.title || data?.title,
      visibility: row.visibility,
      designSystemId: row.designSystemId ?? null,
      slideCount: slides.length,
      slideNumbering:
        'User-visible slide numbers are 1-based and match the UI. "Slide 1" means slideNumber 1 / zeroBasedIndex 0. Use slideId for edits.',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deepLink: deckDeepLink(row.id),
      slides: slides.map((s: any, i: number) => ({
        slideNumber: i + 1,
        zeroBasedIndex: i,
        id: s.id,
        layout: s.layout ?? null,
        content: s.content,
        notes: s.notes ?? null,
      })),
    };
  },
  link: ({ result, args }) => {
    const id =
      result && typeof result === "object"
        ? (result as { id?: string }).id
        : typeof args.id === "string"
          ? args.id
          : undefined;
    if (!id) return null;
    return {
      url: deckDeepLink(id),
      label: "Open deck in Slides",
      view: "editor",
    };
  },
});
