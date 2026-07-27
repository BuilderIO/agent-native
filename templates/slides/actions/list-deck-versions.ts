import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#x[0-9a-f]+;/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeVersionData(rawData: string) {
  try {
    const data = JSON.parse(rawData);
    const slides = Array.isArray(data?.slides) ? data.slides : [];
    return {
      slideCount: slides.length,
      aspectRatio: data?.aspectRatio ?? null,
      designSystemId: data?.designSystemId ?? null,
      slidePreviews: slides.slice(0, 3).map((slide: any, index: number) => ({
        slideNumber: index + 1,
        id: slide?.id ?? null,
        layout: slide?.layout ?? null,
        textPreview:
          typeof slide?.content === "string"
            ? stripHtml(slide.content).slice(0, 120)
            : "",
      })),
    };
  } catch {
    return {
      slideCount: 0,
      aspectRatio: null,
      designSystemId: null,
      slidePreviews: [],
    };
  }
}

export default defineAction({
  description:
    "List saved history snapshots for a deck. Use this before restoring a deck to an earlier point in time.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  http: { method: "GET" },
  run: async ({ deckId, limit }) => {
    const access = await assertAccess("deck", deckId, "viewer");
    const ownerEmail = access.resource.ownerEmail as string;
    const db = getDb();

    const versions = await db
      .select({
        id: schema.deckVersions.id,
        deckId: schema.deckVersions.deckId,
        title: schema.deckVersions.title,
        data: schema.deckVersions.data,
        changeLabel: schema.deckVersions.changeLabel,
        createdAt: schema.deckVersions.createdAt,
      })
      .from(schema.deckVersions)
      .where(
        and(
          eq(schema.deckVersions.deckId, deckId),
          eq(schema.deckVersions.ownerEmail, ownerEmail),
        ),
      )
      .orderBy(desc(schema.deckVersions.createdAt))
      .limit(limit);

    return {
      deckId,
      count: versions.length,
      versions: versions.map((version) => ({
        id: version.id,
        deckId: version.deckId,
        title: version.title,
        label: version.changeLabel,
        createdAt: version.createdAt,
        ...summarizeVersionData(version.data),
      })),
    };
  },
});
