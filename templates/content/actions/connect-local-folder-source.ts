import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { ContentDatabaseSourceTruthPolicy } from "../shared/api.js";
import {
  normalizeContentSpaceEmail,
  resolveContentSpaceAccess,
} from "./_content-space-access.js";
import {
  personalContentSpaceId,
  provisionContentSpaces,
  provisionSourceBackedContentSpace,
} from "./_content-spaces.js";
import {
  LOCAL_FOLDER_SOURCE_TYPE,
  localFolderSourceCapabilities,
  localFolderSourceId,
  localFolderSourceMetadata,
} from "./_local-folder-source.js";

const truthPolicySchema = z
  .enum(["database_primary", "source_primary", "reviewed_bidirectional"])
  .default("database_primary");

export default defineAction({
  description:
    "Connect an opaque trusted local-folder handle to a canonical Files database. The browser or Desktop bridge keeps the real handle/path; Content stores only safe connection metadata.",
  schema: z.object({
    connectionId: z
      .string()
      .min(1)
      .max(300)
      .describe("Stable opaque ID from the trusted browser/Desktop registry"),
    label: z.string().min(1).max(200).describe("User-visible folder label"),
    spaceId: z
      .string()
      .optional()
      .describe(
        "Existing Content space whose Files database receives the source",
      ),
    databaseId: z
      .string()
      .optional()
      .describe("Existing canonical Files database receiving the source"),
    createSourceBackedSpace: z
      .boolean()
      .optional()
      .default(false)
      .describe("Create a separate private Content space for this folder"),
    truthPolicy: truthPolicySchema.describe(
      "Whether Content, the folder, or reviewed conflict resolution is authoritative",
    ),
    dryRun: z.boolean().optional().default(false),
  }),
  run: async (args) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("no authenticated user");
    if (args.spaceId && args.databaseId) {
      throw new Error("Choose either spaceId or databaseId, not both");
    }
    if (args.createSourceBackedSpace && (args.spaceId || args.databaseId)) {
      throw new Error(
        "A new source-backed space cannot also target an existing space or database",
      );
    }

    const db = getDb();
    const connectionId = args.connectionId.trim();
    const label = args.label.trim();
    const truthPolicy = args.truthPolicy as ContentDatabaseSourceTruthPolicy;
    if (args.dryRun) {
      const [existing] = await db
        .select({
          source: schema.contentDatabaseSources,
          database: schema.contentDatabases,
        })
        .from(schema.contentDatabaseSources)
        .innerJoin(
          schema.contentDatabases,
          eq(
            schema.contentDatabases.id,
            schema.contentDatabaseSources.databaseId,
          ),
        )
        .where(
          and(
            eq(
              schema.contentDatabaseSources.sourceType,
              LOCAL_FOLDER_SOURCE_TYPE,
            ),
            eq(schema.contentDatabaseSources.sourceTable, connectionId),
            eq(
              schema.contentDatabaseSources.ownerEmail,
              normalizeContentSpaceEmail(userEmail),
            ),
          ),
        );
      if (!existing?.database.spaceId) {
        return {
          connected: false as const,
          sourceId: null,
          connectionId,
          label,
          truthPolicy,
          spaceId: null,
          filesDatabaseId: null,
        };
      }
      await resolveContentSpaceAccess(existing.database.spaceId, "editor");
      return {
        connected: true as const,
        sourceId: existing.source.id,
        sourceType: LOCAL_FOLDER_SOURCE_TYPE,
        connectionId,
        label,
        truthPolicy,
        spaceId: existing.database.spaceId,
        filesDatabaseId: existing.database.id,
      };
    }
    await provisionContentSpaces(db, userEmail);

    let targetSpaceId = args.spaceId;
    let targetDatabaseId = args.databaseId;
    if (args.createSourceBackedSpace) {
      const provisioned = await provisionSourceBackedContentSpace(
        db,
        userEmail,
        { connectionId, name: label },
      );
      targetSpaceId = provisioned.spaceId;
      targetDatabaseId = provisioned.filesDatabaseId;
    } else if (!targetSpaceId && !targetDatabaseId) {
      targetSpaceId = personalContentSpaceId(userEmail);
    }

    let database: typeof schema.contentDatabases.$inferSelect | undefined;
    if (targetDatabaseId) {
      [database] = await db
        .select()
        .from(schema.contentDatabases)
        .where(eq(schema.contentDatabases.id, targetDatabaseId));
      if (!database || database.deletedAt || database.systemRole !== "files") {
        throw new Error(
          `Database "${targetDatabaseId}" is not a canonical Files database`,
        );
      }
      if (!database.spaceId) {
        throw new Error(`Database "${targetDatabaseId}" has no Content space`);
      }
      targetSpaceId = database.spaceId;
    }
    if (!targetSpaceId) throw new Error("Content space is required");

    await resolveContentSpaceAccess(targetSpaceId, "editor");
    if (!database) {
      [database] = await db
        .select()
        .from(schema.contentDatabases)
        .where(
          and(
            eq(schema.contentDatabases.spaceId, targetSpaceId),
            eq(schema.contentDatabases.systemRole, "files"),
          ),
        );
    }
    if (!database || database.deletedAt) {
      throw new Error(`Content space "${targetSpaceId}" has no Files database`);
    }

    const id = localFolderSourceId(database.id, connectionId);
    const now = new Date().toISOString();
    const values = {
      id,
      ownerEmail: database.ownerEmail,
      orgId: database.orgId,
      databaseId: database.id,
      sourceType: LOCAL_FOLDER_SOURCE_TYPE,
      sourceName: label,
      sourceTable: connectionId,
      syncState: "linked",
      freshness: "unknown",
      capabilitiesJson: JSON.stringify(localFolderSourceCapabilities()),
      metadataJson: JSON.stringify(
        localFolderSourceMetadata({ connectionId, label, truthPolicy }),
      ),
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    await db
      .insert(schema.contentDatabaseSources)
      .values(values)
      .onConflictDoNothing();
    await db
      .update(schema.contentDatabaseSources)
      .set({
        sourceName: label,
        capabilitiesJson: values.capabilitiesJson,
        metadataJson: values.metadataJson,
        updatedAt: now,
      })
      .where(eq(schema.contentDatabaseSources.id, id));

    await writeAppState("refresh-signal", { ts: Date.now() });
    return {
      connected: true as const,
      sourceId: id,
      sourceType: LOCAL_FOLDER_SOURCE_TYPE,
      connectionId,
      label,
      truthPolicy,
      spaceId: targetSpaceId,
      filesDatabaseId: database.id,
    };
  },
});
