import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
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

function sourceKeyFor(source: {
  sourceKey?: string | null;
  configJson?: string | null;
}) {
  const columnValue = source.sourceKey?.trim();
  if (columnValue) return columnValue;
  const config = parseJson<Record<string, unknown>>(source.configJson, {});
  const configValue = config.sourceKey;
  return typeof configValue === "string" && configValue.trim()
    ? configValue.trim()
    : null;
}

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
    await db
      .update(schema.brainSources)
      .set({
        sourceKey,
        ingestTokenHash,
        configJson: stableJson(config),
        updatedAt: nowIso(),
      })
      .where(eq(schema.brainSources.id, sourceId));
    const [source] = await db
      .select()
      .from(schema.brainSources)
      .where(eq(schema.brainSources.id, sourceId))
      .limit(1);
    if (!source) throw new Error(`Brain source ${sourceId} was not found`);

    return { source: serializeSource(source), ingestToken };
  },
});
