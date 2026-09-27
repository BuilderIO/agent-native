import { defineAction } from "@agent-native/core/action";
import { readEmbeddingFamilyAvailability } from "@agent-native/core/embeddings";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export const checkBuilderEmbeddingsSchema = z.object({
  sourceId: z.string().min(1),
  confirmProviderCost: z.literal(true),
});

export default defineAction({
  description:
    "Check Builder embeddings for one Brain source with a single synthetic query; does not index or store data.",
  schema: checkBuilderEmbeddingsSchema,
  toolCallable: false,
  needsApproval: true,
  run: async ({ sourceId }) => {
    await assertAccess("brain-source", sourceId, "admin");
    const [source] = await getDb()
      .select({
        ownerEmail: schema.brainSources.ownerEmail,
        orgId: schema.brainSources.orgId,
      })
      .from(schema.brainSources)
      .where(eq(schema.brainSources.id, sourceId))
      .limit(1);
    if (!source) throw new Error("Brain source was not found.");

    return runWithRequestContext(
      {
        userEmail: source.ownerEmail,
        orgId: source.orgId ?? undefined,
      },
      async () => {
        const availability = await readEmbeddingFamilyAvailability();
        if (availability.unavailableProviders.includes("builder")) {
          throw new Error(
            "Builder embedding credential lookup is unavailable.",
          );
        }
        const family = availability.families.find(
          (candidate) => candidate.provider === "builder",
        );
        if (!family) throw new Error("Builder embeddings are not configured.");
        const vectors = await family.embed(
          [{ text: "Builder embedding connectivity check." }],
          "query",
        );
        const [vector] = vectors;
        if (
          vectors.length !== 1 ||
          !vector ||
          vector.length !== family.dimensions ||
          !vector.every(Number.isFinite)
        ) {
          throw new Error("Builder returned an invalid embedding.");
        }
        return {
          provider: family.provider,
          model: family.model,
          dimensions: family.dimensions,
          success: true,
        };
      },
    );
  },
});
