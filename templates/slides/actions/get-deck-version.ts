import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Get one saved deck history snapshot, including the full slide data for previewing before restore.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    versionId: z.string().describe("Version snapshot ID"),
  }),
  http: { method: "GET" },
  run: async ({ deckId, versionId }) => {
    const access = await assertAccess("deck", deckId, "viewer");
    const ownerEmail = access.resource.ownerEmail as string;
    const db = getDb();

    const [version] = await db
      .select()
      .from(schema.deckVersions)
      .where(
        and(
          eq(schema.deckVersions.id, versionId),
          eq(schema.deckVersions.deckId, deckId),
          eq(schema.deckVersions.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);

    if (!version) {
      throw new Error(`Deck version not found: ${versionId}`);
    }

    const data = JSON.parse(version.data);
    const slides = Array.isArray(data?.slides) ? data.slides : [];

    return {
      id: version.id,
      deckId: version.deckId,
      title: version.title,
      label: version.changeLabel,
      createdAt: version.createdAt,
      data,
      slides,
      slideCount: slides.length,
      aspectRatio: data?.aspectRatio ?? null,
      designSystemId: data?.designSystemId ?? null,
    };
  },
});
