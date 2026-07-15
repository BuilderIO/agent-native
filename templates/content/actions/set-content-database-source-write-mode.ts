import { defineAction } from "@agent-native/core";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  type ContentDatabaseResponse,
  type ContentDatabaseSourcePushMode,
  type ContentDatabaseSourceWriteMode,
  type SetContentDatabaseSourceWriteModeRequest,
} from "../shared/api.js";
import {
  buildBuilderCmsWriteModeJson,
  type BuilderCmsLiveWriteMode,
} from "./_builder-cms-write-settings.js";
import {
  getExistingSourceForWrite,
  resolveDatabaseForSourceMutation,
} from "./_database-source-utils.js";
import { getContentDatabaseResponse } from "./_database-utils.js";

const legacyWriteModeSchema = z.enum(["autosave", "draft", "publish"]);
const sourceWriteModeSchema = z.enum([
  "read_only",
  "stage_only",
  "publish_updates",
]);

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
    "Set the tiered Builder CMS write mode for one source. Writes stay off by default and require document administrator access to enable or change.",
  schema: z.object({
    databaseId: z.string().optional().describe("Database ID"),
    documentId: z.string().optional().describe("Database document/page ID"),
    sourceId: z
      .string()
      .optional()
      .describe("Target source ID (defaults to the primary source)"),
    liveWritesEnabled: z
      .boolean()
      .optional()
      .describe("Whether this source may execute guarded live Builder writes"),
    writeMode: sourceWriteModeSchema
      .optional()
      .describe("Tiered Builder write mode for this source"),
    allowPublicationTransitions: z
      .boolean()
      .optional()
      .describe(
        "Allow explicit per-item publish/unpublish transitions in publish updates mode",
      ),
    allowedWriteModes: z
      .array(legacyWriteModeSchema)
      .optional()
      .describe("Legacy Builder write modes allowed for this source"),
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
    await assertAccess("document", database.documentId, "admin");

    const db = getDb();
    const source = await getExistingSourceForWrite(database.id, args.sourceId);
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
      writeMode: args.writeMode as ContentDatabaseSourceWriteMode | undefined,
      allowPublicationTransitions: args.allowPublicationTransitions,
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
