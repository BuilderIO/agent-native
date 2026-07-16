import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";
import { LOCAL_FOLDER_SOURCE_TYPE } from "./_local-folder-source.js";

const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;

function hash(content: string) {
  return createHash("sha256").update(content).digest("hex");
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
      !target.database.spaceId
    ) {
      throw new Error(`Open local-folder conflict "${changeSetId}" not found`);
    }
    await resolveContentSpaceAccess(target.database.spaceId, "editor");
    const bodyChange = parseObject(target.changeSet.bodyChangeJson);
    const sourceDeletion = bodyChange.operation === "source_delete";
    const proposedHash =
      typeof bodyChange.proposedHash === "string"
        ? bodyChange.proposedHash
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

    const now = new Date().toISOString();
    await db.transaction(async (tx: any) => {
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
        await tx
          .update(schema.documents)
          .set({
            sourceMode: null,
            sourceKind: null,
            sourcePath: null,
            sourceRootPath: null,
            sourceUpdatedAt: null,
            updatedAt: now,
          })
          .where(eq(schema.documents.id, target.document.id));
      } else if (decision === "accept_source") {
        const metadata = proposedMetadata(target.changeSet.fieldChangesJson);
        const resolvedTitle = Object.prototype.hasOwnProperty.call(
          metadata,
          "title",
        )
          ? (metadata.title ?? "")
          : target.document.title;
        const resolvedDescription = Object.prototype.hasOwnProperty.call(
          metadata,
          "description",
        )
          ? (metadata.description ?? "")
          : (target.document.description ?? "");
        const resolvedIcon = Object.prototype.hasOwnProperty.call(
          metadata,
          "icon",
        )
          ? (metadata.icon ?? null)
          : (target.document.icon ?? null);
        await tx
          .insert(schema.documentVersions)
          .values({
            id: `content_document_version_${createHash("sha256")
              .update(
                `${target.document.id}:${target.document.updatedAt}:${proposedHash}`,
              )
              .digest("hex")
              .slice(0, 32)}`,
            ownerEmail: target.document.ownerEmail,
            documentId: target.document.id,
            title: target.document.title,
            content: target.document.content,
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
      await tx
        .update(schema.contentDatabaseSourceChangeSets)
        .set({
          state: decision === "accept_source" ? "applied" : "rejected",
          updatedAt: now,
        })
        .where(eq(schema.contentDatabaseSourceChangeSets.id, changeSetId));
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
      await tx
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
        .where(eq(schema.contentDatabaseSources.id, target.source.id));
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
