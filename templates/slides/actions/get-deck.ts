import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { z } from "zod";

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

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.decks)
      .where(eq(schema.decks.id, args.id))
      .limit(1);

    if (rows.length === 0) {
      return "Error: Deck not found";
    }

    const row = rows[0];
    const data = JSON.parse(row.data);
    const slides = data?.slides || [];

    if (args.compact === "true") {
      return {
        id: row.id,
        title: row.title || data?.title,
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
      slideCount: slides.length,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      slides: slides.map((s: any, i: number) => ({
        index: i,
        id: s.id,
        layout: s.layout ?? null,
        content: s.content,
      })),
    };
  },
});
