import { defineAction } from "@agent-native/core";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";
import "../server/db/index.js"; // ensure registerShareableResource runs

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#x[0-9a-f]+;/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default defineAction({
  description:
    "Get a specific deck with all slides. Returns full deck JSON including slide content.",
  schema: z.object({
    id: z.string().optional().describe("Deck ID (required)"),
    compact: z
      .enum(["true", "false"])
      .optional()
      .describe("Set to 'true' for compact output (slide summaries only)"),
  }),
  http: { method: "GET" },
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
        slideCount: slides.length,
        slides: slides.map((s: any, i: number) => ({
          index: i,
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
      slideCount: slides.length,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      slides: slides.map((s: any, i: number) => ({
        index: i,
        id: s.id,
        layout: s.layout ?? null,
        content: s.content,
        notes: s.notes ?? null,
      })),
    };
  },
});
