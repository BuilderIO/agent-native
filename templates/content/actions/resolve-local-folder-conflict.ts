import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";
import { LOCAL_FOLDER_SOURCE_TYPE } from "./_local-folder-source.js";

const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;

function hash(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function metadataHash(value: {
  title: string;
  description?: string | null;
  icon?: string | null;
}) {
  return hash(
    JSON.stringify({
      title: value.title,
      description: value.description ?? "",
      icon: value.icon ?? null,
    }),
  );
}

function parseObject(value: string | null | undefined) {
  if (!value) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function proposedMetadata(value: string | null | undefined) {
  if (!value) return {} as Record<string, string | null>;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return {};
    return Object.fromEntries(
      parsed.flatMap((change) => {
        if (
          !change ||
          typeof change !== "object" ||
          !("field" in change) ||
          !("proposedValue" in change) ||
          !["title", "description", "icon"].includes(String(change.field))
        ) {
          return [];
        }
        const proposed = change.proposedValue;
        return typeof proposed === "string" || proposed === null
          ? [[String(change.field), proposed] as const]
          : [];
      }),
    );
  } catch {
    return {};
  }
}

export default defineAction({
  description:
    "Resolve an incoming local-folder conflict by keeping Content or accepting the exact reviewed folder revision supplied by the trusted bridge.",
  schema: z.object({
    changeSetId: z.string().min(1),
    decision: z.enum(["keep_content", "accept_source"]),
    sourceContent: z.string().max(MAX_SOURCE_FILE_BYTES).optional(),
  }),
  run: async ({ changeSetId, decision, sourceContent }) => {
    const db = getDb();
    const [target] = await db
      .select({
        changeSet: schema.contentDatabaseSourceChangeSets,
        source: schema.contentDatabaseSources,
        database: schema.contentDatabases,
        document: schema.documents,
      })
      .from(schema.contentDatabaseSourceChangeSets)
      .innerJoin(
        schema.contentDatabaseSources,
        eq(
          schema.contentDatabaseSources.id,
          schema.contentDatabaseSourceChangeSets.sourceId,
        ),
      )
      .innerJoin(
        schema.contentDatabases,
        eq(
          schema.contentDatabases.id,
          schema.contentDatabaseSources.databaseId,
        ),
      )
      .innerJoin(
        schema.documents,
        eq(
          schema.documents.id,
          schema.contentDatabaseSourceChangeSets.documentId,
        ),
      )
      .where(eq(schema.contentDatabaseSourceChangeSets.id, changeSetId));
    if (
      !target ||
      target.source.sourceType !== LOCAL_FOLDER_SOURCE_TYPE ||
      target.changeSet.direction !== "incoming" ||
      target.changeSet.state !== "proposed" ||
      !target.database.spaceId ||
      target.database.systemRole !== "files" ||
      target.database.deletedAt ||
      target.document.spaceId !== target.database.spaceId
    ) {
      throw new Error(`Open local-folder conflict "${changeSetId}" not found`);
    }
    const targetSpaceId = target.database.spaceId;
    await resolveContentSpaceAccess(targetSpaceId, "editor");
    await assertAccess("document", target.document.id, "editor");
    const bodyChange = parseObject(target.changeSet.bodyChangeJson);
    const sourceDeletion = bodyChange.operation === "source_delete";
    const proposedHash =
      typeof bodyChange.proposedHash === "string"
        ? bodyChange.proposedHash
        : null;
    const reviewedContentHash =
      typeof bodyChange.currentHash === "string"
        ? bodyChange.currentHash
        : null;
    const reviewedMetadataHash =
      typeof bodyChange.currentMetadataHash === "string"
        ? bodyChange.currentMetadataHash
        : null;
    if (!sourceDeletion && !proposedHash)
      throw new Error("Conflict is missing its source hash");
    if (
      decision === "accept_source" &&
      !sourceDeletion &&
      sourceContent === undefined
    ) {
      throw new Error(
        "sourceContent is required when accepting the folder revision",
      );
    }
    if (
      decision === "accept_source" &&
      !sourceDeletion &&
      hash(sourceContent!) !== proposedHash
    ) {
      throw new Error(
        "The supplied folder revision changed after review; refresh before resolving",
      );
    }
    if (
      decision === "accept_source" &&
      !sourceDeletion &&
      (!reviewedContentHash || !reviewedMetadataHash)
    ) {
      throw new Error(
        "Conflict is missing its reviewed Content revision; refresh before resolving",
      );
    }

    const now = new Date().toISOString();
    await db.transaction(async (tx: any) => {
      const claimedChangeSets = await tx
        .update(schema.contentDatabaseSourceChangeSets)
        .set({
          state: decision === "accept_source" ? "applied" : "rejected",
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.contentDatabaseSourceChangeSets.id, changeSetId),
            eq(
              schema.contentDatabaseSourceChangeSets.sourceId,
              target.source.id,
            ),
            eq(schema.contentDatabaseSourceChangeSets.state, "proposed"),
          ),
        )
        .returning({ id: schema.contentDatabaseSourceChangeSets.id });
      if (claimedChangeSets.length !== 1) {
        throw new Error(
          `Open local-folder conflict "${changeSetId}" changed before resolution`,
        );
      }
      const claimedSources = await tx
        .update(schema.contentDatabaseSources)
        .set({ updatedAt: now })
        .where(
          and(
            eq(schema.contentDatabaseSources.id, target.source.id),
            eq(schema.contentDatabaseSources.databaseId, target.database.id),
            eq(
              schema.contentDatabaseSources.sourceType,
              LOCAL_FOLDER_SOURCE_TYPE,
            ),
          ),
        )
        .returning({ id: schema.contentDatabaseSources.id });
      if (claimedSources.length !== 1) {
        throw new Error(
          `Local folder source "${target.source.id}" was disconnected before resolution`,
        );
      }
      if (decision === "accept_source" && sourceDeletion) {
        await tx
          .delete(schema.contentDatabaseSourceRows)
          .where(
            and(
              eq(schema.contentDatabaseSourceRows.sourceId, target.source.id),
              eq(
                schema.contentDatabaseSourceRows.documentId,
                target.document.id,
              ),
            ),
          );
        const [remainingLocalRow] = await tx
          .select({
            sourceDisplayKey: schema.contentDatabaseSourceRows.sourceDisplayKey,
            sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
            sourceName: schema.contentDatabaseSources.sourceName,
          })
          .from(schema.contentDatabaseSourceRows)
          .innerJoin(
            schema.contentDatabaseSources,
            eq(
              schema.contentDatabaseSources.id,
              schema.contentDatabaseSourceRows.sourceId,
            ),
          )
          .where(
            and(
              eq(
                schema.contentDatabaseSourceRows.documentId,
                target.document.id,
              ),
              ne(schema.contentDatabaseSourceRows.sourceId, target.source.id),
              eq(
                schema.contentDatabaseSources.sourceType,
                LOCAL_FOLDER_SOURCE_TYPE,
              ),
            ),
          )
          .orderBy(schema.contentDatabaseSources.id)
          .limit(1);
        const remainingValues = parseObject(
          remainingLocalRow?.sourceValuesJson,
        );
        const remainingPath =
          typeof remainingValues.relativePath === "string"
            ? remainingValues.relativePath
            : remainingLocalRow?.sourceDisplayKey;
        await tx
          .update(schema.documents)
          .set(
            remainingLocalRow
              ? {
                  sourceMode: "local-files",
                  sourceKind: "file",
                  sourcePath: remainingPath ?? null,
                  sourceRootPath: remainingLocalRow.sourceName,
                  sourceUpdatedAt: now,
                  updatedAt: now,
                }
              : {
                  sourceMode: null,
                  sourceKind: null,
                  sourcePath: null,
                  sourceRootPath: null,
                  sourceUpdatedAt: null,
                  updatedAt: now,
                },
          )
          .where(
            and(
              eq(schema.documents.id, target.document.id),
              eq(schema.documents.spaceId, targetSpaceId),
            ),
          );
      } else if (decision === "accept_source") {
        const [currentDocument] = await tx
          .select()
          .from(schema.documents)
          .where(
            and(
              eq(schema.documents.id, target.document.id),
              eq(schema.documents.spaceId, targetSpaceId),
            ),
          );
        if (
          !currentDocument ||
          hash(currentDocument.content) !== reviewedContentHash ||
          metadataHash(currentDocument) !== reviewedMetadataHash
        ) {
          throw new Error(
            "Content changed after this conflict was reviewed; refresh before resolving",
          );
        }
        const metadata = proposedMetadata(target.changeSet.fieldChangesJson);
        const resolvedTitle = Object.prototype.hasOwnProperty.call(
          metadata,
          "title",
        )
          ? (metadata.title ?? "")
          : currentDocument.title;
        const resolvedDescription = Object.prototype.hasOwnProperty.call(
          metadata,
          "description",
        )
          ? (metadata.description ?? "")
          : (currentDocument.description ?? "");
        const resolvedIcon = Object.prototype.hasOwnProperty.call(
          metadata,
          "icon",
        )
          ? (metadata.icon ?? null)
          : (currentDocument.icon ?? null);
        await tx
          .insert(schema.documentVersions)
          .values({
            id: `content_document_version_${createHash("sha256")
              .update(
                `${currentDocument.id}:${currentDocument.updatedAt}:${proposedHash}`,
              )
              .digest("hex")
              .slice(0, 32)}`,
            ownerEmail: currentDocument.ownerEmail,
            documentId: currentDocument.id,
            title: currentDocument.title,
            content: currentDocument.content,
            createdAt: now,
          })
          .onConflictDoNothing();
        await tx
          .update(schema.documents)
          .set({
            content: sourceContent!,
            ...(Object.prototype.hasOwnProperty.call(metadata, "title")
              ? { title: metadata.title ?? "" }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(metadata, "description")
              ? { description: metadata.description ?? "" }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(metadata, "icon")
              ? { icon: metadata.icon }
              : {}),
            sourceUpdatedAt: now,
            updatedAt: now,
          })
          .where(eq(schema.documents.id, target.document.id));
        const [sourceRow] = await tx
          .select()
          .from(schema.contentDatabaseSourceRows)
          .where(
            and(
              eq(schema.contentDatabaseSourceRows.sourceId, target.source.id),
              eq(
                schema.contentDatabaseSourceRows.documentId,
                target.document.id,
              ),
            ),
          );
        if (sourceRow) {
          const values = parseObject(sourceRow.sourceValuesJson);
          await tx
            .update(schema.contentDatabaseSourceRows)
            .set({
              sourceValuesJson: JSON.stringify({
                ...values,
                contentHash: proposedHash,
                metadataHash: hash(
                  JSON.stringify({
                    title: resolvedTitle,
                    description: resolvedDescription,
                    icon: resolvedIcon,
                  }),
                ),
              }),
              syncState: "linked",
              freshness: "fresh",
              lastSyncedAt: now,
              lastSourceUpdatedAt: now,
              updatedAt: now,
            })
            .where(eq(schema.contentDatabaseSourceRows.id, sourceRow.id));
        }
      }
      const remaining = await tx
        .select({ id: schema.contentDatabaseSourceChangeSets.id })
        .from(schema.contentDatabaseSourceChangeSets)
        .where(
          and(
            eq(
              schema.contentDatabaseSourceChangeSets.sourceId,
              target.source.id,
            ),
            eq(schema.contentDatabaseSourceChangeSets.direction, "incoming"),
            eq(schema.contentDatabaseSourceChangeSets.state, "proposed"),
          ),
        );
      const refreshedSources = await tx
        .update(schema.contentDatabaseSources)
        .set({
          syncState: remaining.length ? "error" : "linked",
          freshness:
            remaining.length || decision === "keep_content" ? "stale" : "fresh",
          lastError: remaining.length
            ? `${remaining.length} file conflict${remaining.length === 1 ? "" : "s"} require review.`
            : decision === "accept_source"
              ? null
              : "Content was kept; push the retained revision to the folder when ready.",
          updatedAt: now,
        })
        .where(eq(schema.contentDatabaseSources.id, target.source.id))
        .returning({ id: schema.contentDatabaseSources.id });
      if (refreshedSources.length !== 1) {
        throw new Error(
          `Local folder source "${target.source.id}" was disconnected during resolution`,
        );
      }
    });
    await writeAppState("refresh-signal", { ts: Date.now() });
    return {
      success: true,
      changeSetId,
      decision,
      documentId: target.document.id,
      sourceId: target.source.id,
      sourceDeleted: sourceDeletion,
      state: decision === "accept_source" ? "applied" : "rejected",
    };
  },
});
