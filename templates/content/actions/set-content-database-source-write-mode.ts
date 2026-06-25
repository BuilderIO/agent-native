import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  type ContentDatabaseResponse,
  type ContentDatabaseSourcePushMode,
  type SetContentDatabaseSourceWriteModeRequest,
} from "../shared/api.js";
import {
  buildBuilderCmsWriteModeJson,
  type BuilderCmsLiveWriteMode,
} from "./_builder-cms-write-settings.js";
import { resolveDatabaseForSourceMutation } from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

const writeModeSchema = z.enum(["autosave", "draft", "publish"]);

function executableWriteModes(
  modes: readonly ContentDatabaseSourcePushMode[] | undefined,
): BuilderCmsLiveWriteMode[] {
  return (modes ?? []).filter(
    (mode): mode is BuilderCmsLiveWriteMode =>
      mode === "autosave" || mode === "draft" || mode === "publish",
  );
}

export default defineAction({
  description:
    "Enable or disable live Builder CMS writes for one source. Live writes stay off by default and can only be enabled for the safe Builder test collection with explicit allowed write modes.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    liveWritesEnabled: z
      .boolean()
      .describe("Whether this source may execute guarded live Builder writes"),
    allowedWriteModes: z
      .array(writeModeSchema)
      .optional()
      .describe("Explicit Builder write modes allowed for this source"),
    allowDraftWrites: z
      .boolean()
      .optional()
      .describe("Explicitly allow draft writes when draft is an allowed mode"),
    allowPublishWrites: z
      .boolean()
      .optional()
      .describe(
        "Explicitly allow publish writes when publish is an allowed mode",
      ),
  }),
  run: async (
    args: SetContentDatabaseSourceWriteModeRequest,
  ): Promise<ContentDatabaseResponse> => {
    const database = await resolveDatabaseForSourceMutation(args);
    if (!database) throw new Error("Database not found.");
    await assertAccess("document", database.documentId, "editor");

    const db = getDb();
    const [source] = await db
      .select()
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.databaseId, database.id))
      .orderBy(asc(schema.contentDatabaseSources.createdAt))
      .limit(1);
    if (!source) {
      throw new Error(
        "Attach a Builder CMS source before changing write mode.",
      );
    }
    if (source.sourceType !== "builder-cms") {
      throw new Error(
        "Live writes can only be configured for Builder CMS sources.",
      );
    }

    const next = buildBuilderCmsWriteModeJson({
      sourceType: source.sourceType,
      sourceTable: source.sourceTable,
      capabilitiesJson: source.capabilitiesJson,
      metadataJson: source.metadataJson,
      liveWritesEnabled: args.liveWritesEnabled,
      allowedWriteModes: executableWriteModes(args.allowedWriteModes),
      allowDraftWrites: args.allowDraftWrites,
      allowPublishWrites: args.allowPublishWrites,
    });
    const now = new Date().toISOString();
    await db
      .update(schema.contentDatabaseSources)
      .set({
        capabilitiesJson: next.capabilitiesJson,
        metadataJson: next.metadataJson,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(schema.contentDatabaseSources.id, source.id));

    return getContentDatabaseResponse(database.id);
  },
});
