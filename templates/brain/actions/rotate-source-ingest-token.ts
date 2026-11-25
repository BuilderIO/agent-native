import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  nanoid,
  nowIso,
  parseJson,
  serializeSource,
  sha256Hex,
  stableJson,
} from "../server/lib/brain.js";
import { sourceKeyFor } from "../server/lib/source-ingest.js";
import { sourceConfigUnchanged } from "./_source-config.js";

export default defineAction({
  description:
    "Rotate the signed ingest token for a configured Clips or generic Brain source. The new token is returned once so it can be saved in the sending app.",
  agentTool: false,
  toolCallable: false,
  schema: z.object({
    sourceId: z.string().min(1),
  }),
  run: async ({ sourceId }) => {
    const access = await assertAccess("brain-source", sourceId, "admin");
    const existing = access.resource;
    if (existing.provider !== "clips" && existing.provider !== "generic") {
      throw new Error(
        "Only configured Clips or generic sources can rotate an ingest token.",
      );
    }

    const sourceKey = sourceKeyFor(existing);
    if (!sourceKey) {
      throw new Error("This source is missing a signed-ingest source key.");
    }

    const ingestToken = `brain_${nanoid(32)}`;
    const ingestTokenHash = await sha256Hex(ingestToken);
    const config = {
      ...parseJson<Record<string, unknown>>(existing.configJson, {}),
      sourceKey,
      ingestTokenHash,
    };
    const db = getDb();
    const saved = await db
      .update(schema.brainSources)
      .set({
        sourceKey,
        ingestTokenHash,
        configJson: stableJson(config),
        updatedAt: nowIso(),
      })
      .where(sourceConfigUnchanged(existing))
      .returning();
    const source = saved.find((row) => row.id === sourceId);
    if (!source)
      fail("The source changed. Reload it and retry the rotation.", {
        errorCode: "source_config_conflict",
        statusCode: 409,
      });

    return { source: serializeSource(source), sourceKey, ingestToken };
  },
});
