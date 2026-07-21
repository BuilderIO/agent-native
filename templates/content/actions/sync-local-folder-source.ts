import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { ContentDatabaseSourceTruthPolicy } from "../shared/api.js";
import {
  isBuilderMdxSourcePath,
  isContentSourcePath,
  parseContentSourceFile,
} from "../shared/content-source.js";
import { setFavoriteMembership } from "./_content-favorites.js";
import { ensureDocumentsFilesMembership } from "./_content-files.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";
import { provisionContentSpaces } from "./_content-spaces.js";
import { LOCAL_FOLDER_SOURCE_TYPE } from "./_local-folder-source.js";

const MAX_SOURCE_FILES = 500;
const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;

function opaqueId(kind: string, value: string) {
  return `${kind}_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

function contentHash(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function metadataHash(value: {
  title: string;
  description?: string | null;
  icon?: string | null;
}) {
  return contentHash(
    JSON.stringify({
      title: value.title,
      description: value.description ?? "",
      icon: value.icon ?? null,
    }),
  );
}

function parseJson(value: string | null | undefined) {
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

function truthPolicy(value: unknown): ContentDatabaseSourceTruthPolicy {
  return value === "source_primary" || value === "reviewed_bidirectional"
    ? value
    : "database_primary";
}

function normalizedEntries(files: Record<string, string>) {
  return Object.entries(files)
    .filter(([path]) => isContentSourcePath(path))
    .sort(([left], [right]) => left.localeCompare(right));
}

function sourceValues(args: {
  path: string;
  title: string;
  hash: string;
  metadataHash: string;
}) {
  return JSON.stringify({
    relativePath: args.path,
    extension: args.path.toLowerCase().endsWith(".mdx") ? ".mdx" : ".md",
    title: args.title,
    contentHash: args.hash,
    metadataHash: args.metadataHash,
  });
}

function bodyChangeJson(args: {
  currentHash: string;
  incomingHash: string;
  currentMetadataHash: string;
  incomingMetadataHash: string;
}) {
  return JSON.stringify({
    summary: "Local folder and Content both changed since the last sync.",
    currentExcerpt: null,
    proposedExcerpt: null,
    currentHash: args.currentHash,
    proposedHash: args.incomingHash,
    currentMetadataHash: args.currentMetadataHash,
    proposedMetadataHash: args.incomingMetadataHash,
  });
}

function deletionChangeJson(args: {
  path: string;
  previousHash: string | null;
}) {
  return JSON.stringify({
    operation: "source_delete",
    relativePath: args.path,
    previousHash: args.previousHash,
  });
}

function metadataChanges(
  current: { title: string; description?: string | null; icon?: string | null },
  proposed: {
    title: string;
    description?: string | null;
    icon?: string | null;
  },
) {
  return (["title", "description", "icon"] as const).flatMap((field) => {
    const currentValue =
      current[field] ?? (field === "description" ? "" : null);
    const proposedValue =
      proposed[field] ?? (field === "description" ? "" : null);
    return currentValue === proposedValue
      ? []
      : [{ field, currentValue, proposedValue }];
  });
}

export default defineAction({
  description:
    "Refresh a connected local-folder source through the trusted browser/Desktop bridge, materializing Markdown/MDX as normal SQL-backed Content pages and recording safe source identity and conflicts.",
  schema: z.object({
    sourceId: z.string().min(1),
    files: z
      .record(z.string(), z.string().max(MAX_SOURCE_FILE_BYTES))
      .refine((value) => Object.keys(value).length <= MAX_SOURCE_FILES, {
        message: `Sync is limited to ${MAX_SOURCE_FILES} files.`,
      }),
    dryRun: z.boolean().optional().default(false),
  }),
  run: async ({ sourceId, files, dryRun }) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("no authenticated user");
    const builderPaths = Object.keys(files).filter(isBuilderMdxSourcePath);
    if (builderPaths.length) {
      throw new Error(
        `Builder .builder.mdx files require the Builder actions: ${builderPaths.join(", ")}`,
      );
    }
    const entries = normalizedEntries(files);
    const db = getDb();
    const [target] = await db
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
      .where(eq(schema.contentDatabaseSources.id, sourceId));
    if (
      !target ||
      target.source.sourceType !== LOCAL_FOLDER_SOURCE_TYPE ||
      target.database.systemRole !== "files" ||
      !target.database.spaceId
    ) {
      throw new Error(`Local folder source "${sourceId}" not found`);
    }
    await resolveContentSpaceAccess(target.database.spaceId, "editor");
    if (!dryRun) await provisionContentSpaces(db, userEmail);
    const targetSpaceId = target.database.spaceId;

    const parsed = entries.map(([path, value]) =>
      parseContentSourceFile(path, value),
    );
    const parseErrors = parsed.flatMap((file) =>
      file.errors?.length
        ? [{ path: file.path, reason: file.errors.join(" ") }]
        : [],
    );
    const valid = parsed.filter((file) => !file.errors?.length);
    const duplicateIds = new Set<string>();
    const seenIds = new Set<string>();
    for (const file of valid) {
      if (!file.id) continue;
      if (seenIds.has(file.id)) duplicateIds.add(file.id);
      seenIds.add(file.id);
    }
    if (duplicateIds.size) {
      throw new Error(
        `Duplicate source ids: ${[...duplicateIds].sort().join(", ")}`,
      );
    }

    const explicitIds = valid.flatMap((file) => (file.id ? [file.id] : []));
    type SourceRow = typeof schema.contentDatabaseSourceRows.$inferSelect;
    type Document = typeof schema.documents.$inferSelect;
    const loadSnapshot = async (queryDb: any) => {
      const storedRows = (await queryDb
        .select()
        .from(schema.contentDatabaseSourceRows)
        .where(
          eq(schema.contentDatabaseSourceRows.sourceId, sourceId),
        )) as SourceRow[];
      const rowByPath = new Map(
        storedRows.map((row) => [
          String(parseJson(row.sourceValuesJson).relativePath ?? ""),
          row,
        ]),
      );
      const rowByDocumentId = new Map(
        storedRows.map((row) => [row.documentId, row]),
      );
      const linkedIds = storedRows.map((row) => row.documentId);
      const candidateIds = [...new Set([...explicitIds, ...linkedIds])];
      const existingDocuments = (
        candidateIds.length
          ? await queryDb
              .select()
              .from(schema.documents)
              .where(inArray(schema.documents.id, candidateIds))
          : []
      ) as Document[];
      const documentById = new Map(
        existingDocuments.map((document) => [document.id, document]),
      );
      return { storedRows, rowByPath, rowByDocumentId, documentById };
    };

    const initialSnapshot = await loadSnapshot(db);

    const validateDocumentIds = async (
      snapshot: Awaited<ReturnType<typeof loadSnapshot>>,
    ) => {
      const documentIds = new Set([
        ...explicitIds,
        ...snapshot.storedRows.map((row) => row.documentId),
      ]);
      for (const id of documentIds) {
        const existing = snapshot.documentById.get(id);
        if (!existing) continue;
        if (existing.spaceId !== targetSpaceId) {
          throw new Error(
            `Document "${id}" belongs to another Content space and cannot be imported here`,
          );
        }
        await assertAccess("document", id, "editor");
      }
    };

    await validateDocumentIds(initialSnapshot);

    const metadata = parseJson(target.source.metadataJson);
    const policy = truthPolicy(metadata.truthPolicy);
    const now = new Date().toISOString();
    const created: Array<{ id: string; path: string; title: string }> = [];
    const updated: Array<{ id: string; path: string; title: string }> = [];
    const unchanged: Array<{ id: string; path: string; title: string }> = [];
    const skipped = [...parseErrors];
    const conflicts: Array<{ id: string; path: string; title: string }> = [];
    const outbound: Array<{ id: string; path: string; title: string }> = [];

    const buildPlans = (snapshot: Awaited<ReturnType<typeof loadSnapshot>>) =>
      valid.map((file, index) => {
        const pathRow = snapshot.rowByPath.get(file.path);
        const id =
          file.id ??
          pathRow?.documentId ??
          opaqueId("content_local_file", `${sourceId}:${file.path}`);
        const existing = snapshot.documentById.get(id);
        const previousRow = snapshot.rowByDocumentId.get(id) ?? pathRow;
        const previousValues = parseJson(previousRow?.sourceValuesJson);
        const previousHash =
          typeof previousValues.contentHash === "string"
            ? previousValues.contentHash
            : null;
        const previousMetadataHash =
          typeof previousValues.metadataHash === "string"
            ? previousValues.metadataHash
            : null;
        const incomingHash = contentHash(file.content);
        const incomingMetadataHash = metadataHash(file);
        const localHash = existing ? contentHash(existing.content) : null;
        const localMetadataHash = existing ? metadataHash(existing) : null;
        const incomingChanged =
          previousHash !== incomingHash ||
          previousMetadataHash !== incomingMetadataHash;
        const localChanged =
          !!existing &&
          ((!!previousHash && localHash !== previousHash) ||
            (!!previousMetadataHash &&
              localMetadataHash !== previousMetadataHash));
        const conflict =
          !!existing &&
          !!previousHash &&
          incomingChanged &&
          (localChanged || policy === "database_primary") &&
          (localHash !== incomingHash ||
            localMetadataHash !== incomingMetadataHash);
        const keepContent =
          !!existing &&
          !!previousHash &&
          localChanged &&
          !incomingChanged &&
          policy !== "source_primary";
        const applyIncoming =
          incomingChanged || (localChanged && policy === "source_primary");
        return {
          file,
          index,
          id,
          existing,
          previousRow,
          previousHash,
          incomingHash,
          incomingMetadataHash,
          localHash,
          localMetadataHash,
          incomingChanged,
          localChanged,
          conflict,
          keepContent,
          applyIncoming,
        };
      });

    let plans = buildPlans(initialSnapshot);
    const initialDocumentIds = new Set(plans.map((plan) => plan.id));
    let missingRows = initialSnapshot.storedRows.filter(
      (row) => !initialDocumentIds.has(row.documentId),
    );
    const classifyPlans = (
      snapshot: Awaited<ReturnType<typeof loadSnapshot>>,
    ) => {
      created.length = 0;
      updated.length = 0;
      unchanged.length = 0;
      conflicts.length = 0;
      outbound.length = 0;
      for (const row of missingRows) {
        const values = parseJson(row.sourceValuesJson);
        const path = String(values.relativePath ?? row.sourceDisplayKey ?? "");
        const document = snapshot.documentById.get(row.documentId);
        conflicts.push({
          id: row.documentId,
          path,
          title: document?.title ?? path,
        });
      }

      for (const plan of plans) {
        if (plan.conflict) {
          conflicts.push({
            id: plan.id,
            path: plan.file.path,
            title: plan.file.title,
          });
        } else if (!plan.existing) {
          created.push({
            id: plan.id,
            path: plan.file.path,
            title: plan.file.title,
          });
        } else if (
          plan.applyIncoming ||
          plan.existing.title !== plan.file.title ||
          plan.existing.sourcePath !== plan.file.path
        ) {
          updated.push({
            id: plan.id,
            path: plan.file.path,
            title: plan.file.title,
          });
        } else {
          unchanged.push({
            id: plan.id,
            path: plan.file.path,
            title: plan.file.title,
          });
        }
        if (plan.keepContent) {
          outbound.push({
            id: plan.id,
            path: plan.file.path,
            title: plan.file.title,
          });
        }
      }
    };
    classifyPlans(initialSnapshot);

    if (!dryRun) {
      await db.transaction(async (tx: any) => {
        const claimedSources = await tx
          .update(schema.contentDatabaseSources)
          .set({ updatedAt: now })
          .where(
            and(
              eq(schema.contentDatabaseSources.id, sourceId),
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
            `Local folder source "${sourceId}" was disconnected before sync`,
          );
        }
        const transactionSnapshot = await loadSnapshot(tx);
        await validateDocumentIds(transactionSnapshot);
        plans = buildPlans(transactionSnapshot);
        const currentDocumentIds = new Set(plans.map((plan) => plan.id));
        missingRows = transactionSnapshot.storedRows.filter(
          (row) => !currentDocumentIds.has(row.documentId),
        );
        classifyPlans(transactionSnapshot);
        for (const plan of plans) {
          if (plan.conflict) {
            const changeSetId = opaqueId(
              "content_source_change",
              `${sourceId}:${plan.id}:${plan.incomingHash}:${plan.incomingMetadataHash}:${plan.localHash}:${plan.localMetadataHash}`,
            );
            await tx
              .insert(schema.contentDatabaseSourceChangeSets)
              .values({
                id: changeSetId,
                ownerEmail: target.source.ownerEmail,
                sourceId,
                databaseItemId: plan.previousRow?.databaseItemId ?? null,
                documentId: plan.id,
                kind:
                  plan.localHash === plan.incomingHash
                    ? "metadata_update"
                    : "body_update",
                direction: "incoming",
                state: "proposed",
                pushMode: "none",
                localOnly: 0,
                summary: `Review concurrent local-folder changes for "${plan.file.title}".`,
                fieldChangesJson: JSON.stringify(
                  metadataChanges(plan.existing!, plan.file),
                ),
                bodyChangeJson: bodyChangeJson({
                  currentHash: plan.localHash!,
                  incomingHash: plan.incomingHash,
                  currentMetadataHash: plan.localMetadataHash!,
                  incomingMetadataHash: plan.incomingMetadataHash,
                }),
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoNothing();
            continue;
          }

          if (plan.keepContent) {
            const changeSetId = opaqueId(
              "content_source_change",
              `${sourceId}:${plan.id}:outbound:${plan.localHash}`,
            );
            await tx
              .insert(schema.contentDatabaseSourceChangeSets)
              .values({
                id: changeSetId,
                ownerEmail: target.source.ownerEmail,
                sourceId,
                databaseItemId: plan.previousRow?.databaseItemId ?? null,
                documentId: plan.id,
                kind: "body_update",
                direction: "outbound",
                state: "proposed",
                pushMode: "none",
                localOnly: 1,
                summary: `Content has a newer revision of "${plan.file.title}" ready to export.`,
                fieldChangesJson: "[]",
                bodyChangeJson: bodyChangeJson({
                  currentHash: plan.incomingHash,
                  incomingHash: plan.localHash!,
                  currentMetadataHash: plan.incomingMetadataHash,
                  incomingMetadataHash: plan.localMetadataHash!,
                }),
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoNothing();
            continue;
          }

          if (!plan.existing) {
            await tx.insert(schema.documents).values({
              id: plan.id,
              spaceId: target.database.spaceId,
              ownerEmail: userEmail,
              orgId: target.database.orgId,
              parentId: null,
              title: plan.file.title,
              content: plan.file.content,
              description: plan.file.description ?? "",
              icon: plan.file.icon ?? null,
              position: plan.file.position ?? plan.index,
              isFavorite: plan.file.isFavorite ? 1 : 0,
              hideFromSearch: plan.file.hideFromSearch ? 1 : 0,
              sourceMode: "local-files",
              sourceKind: "file",
              sourcePath: plan.file.path,
              sourceRootPath: target.source.sourceName,
              sourceUpdatedAt: now,
              visibility: target.database.orgId ? "org" : "private",
              createdAt: now,
              updatedAt: now,
            });
          } else if (
            plan.applyIncoming ||
            plan.existing.sourcePath !== plan.file.path
          ) {
            await tx
              .insert(schema.documentVersions)
              .values({
                id: opaqueId(
                  "content_document_version",
                  `${plan.id}:${plan.existing.updatedAt}:${plan.incomingHash}`,
                ),
                ownerEmail: plan.existing.ownerEmail,
                documentId: plan.id,
                title: plan.existing.title,
                content: plan.existing.content,
                createdAt: now,
              })
              .onConflictDoNothing();
            const reboundDocuments = await tx
              .update(schema.documents)
              .set({
                ...(plan.applyIncoming
                  ? {
                      title: plan.file.title,
                      content: plan.file.content,
                      description:
                        plan.file.description ?? plan.existing.description,
                      icon: plan.file.icon ?? plan.existing.icon,
                    }
                  : {}),
                sourceMode: "local-files",
                sourceKind: "file",
                sourcePath: plan.file.path,
                sourceRootPath: target.source.sourceName,
                sourceUpdatedAt: now,
                updatedAt: now,
              })
              .where(
                and(
                  eq(schema.documents.id, plan.id),
                  eq(schema.documents.spaceId, targetSpaceId),
                ),
              )
              .returning({ id: schema.documents.id });
            if (reboundDocuments.length !== 1) {
              throw new Error(
                `Document "${plan.id}" left this Content space during local-folder sync`,
              );
            }
          }
        }

        for (const plan of plans) {
          if (plan.conflict || plan.existing || !plan.file.isFavorite) continue;
          await setFavoriteMembership({
            db: tx,
            userEmail,
            documentId: plan.id,
            favorite: true,
            now,
          });
        }

        const materializedIds = plans
          .filter((plan) => !plan.conflict)
          .map((plan) => plan.id);
        await ensureDocumentsFilesMembership(tx, materializedIds, now);
        const filesItems = materializedIds.length
          ? await tx
              .select()
              .from(schema.contentDatabaseItems)
              .where(
                and(
                  eq(
                    schema.contentDatabaseItems.databaseId,
                    target.database.id,
                  ),
                  inArray(
                    schema.contentDatabaseItems.documentId,
                    materializedIds,
                  ),
                ),
              )
          : [];
        const itemByDocumentId = new Map<
          string,
          typeof schema.contentDatabaseItems.$inferSelect
        >(
          filesItems.map(
            (item: typeof schema.contentDatabaseItems.$inferSelect) =>
              [item.documentId, item] as const,
          ),
        );
        for (const plan of plans.filter((candidate) => !candidate.conflict)) {
          if (plan.keepContent) continue;
          const item = itemByDocumentId.get(plan.id);
          if (!item) {
            throw new Error(
              `Files membership was not created for "${plan.id}"`,
            );
          }
          const rowId = opaqueId(
            "content_source_row",
            `${sourceId}:${plan.id}`,
          );
          const rowValues = {
            sourceId,
            databaseItemId: item.id,
            documentId: plan.id,
            sourceRowId: plan.file.path,
            sourceQualifiedId: `local-folder://${target.source.sourceTable}/${encodeURIComponent(plan.file.path)}`,
            sourceDisplayKey: plan.file.path,
            sourceValuesJson: sourceValues({
              path: plan.file.path,
              title: plan.file.title,
              hash: plan.incomingHash,
              metadataHash: plan.incomingMetadataHash,
            }),
            provenance: "trusted local-folder bridge",
            syncState: "linked",
            freshness: "fresh",
            lastSyncedAt: now,
            lastSourceUpdatedAt: now,
            updatedAt: now,
          };
          await tx
            .insert(schema.contentDatabaseSourceRows)
            .values({
              id: rowId,
              ownerEmail: target.source.ownerEmail,
              createdAt: now,
              ...rowValues,
            })
            .onConflictDoNothing();
          await tx
            .update(schema.contentDatabaseSourceRows)
            .set(rowValues)
            .where(eq(schema.contentDatabaseSourceRows.id, rowId));
        }
        for (const row of missingRows) {
          const values = parseJson(row.sourceValuesJson);
          const path = String(
            values.relativePath ?? row.sourceDisplayKey ?? row.sourceRowId,
          );
          const changeSetId = opaqueId(
            "content_source_change",
            `${sourceId}:${row.documentId}:source-delete:${path}`,
          );
          await tx
            .insert(schema.contentDatabaseSourceChangeSets)
            .values({
              id: changeSetId,
              ownerEmail: target.source.ownerEmail,
              sourceId,
              databaseItemId: row.databaseItemId,
              documentId: row.documentId,
              kind: "metadata_update",
              direction: "incoming",
              state: "proposed",
              pushMode: "none",
              localOnly: 0,
              summary: `The local source no longer contains "${path}". Review before unlinking it.`,
              fieldChangesJson: "[]",
              bodyChangeJson: deletionChangeJson({
                path,
                previousHash:
                  typeof values.contentHash === "string"
                    ? values.contentHash
                    : null,
              }),
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing();
        }
        const refreshedSources = await tx
          .update(schema.contentDatabaseSources)
          .set({
            syncState: conflicts.length ? "error" : "linked",
            freshness: conflicts.length || outbound.length ? "stale" : "fresh",
            lastRefreshedAt: now,
            lastSourceUpdatedAt: now,
            lastError: conflicts.length
              ? `${conflicts.length} file conflict${conflicts.length === 1 ? "" : "s"} require review.`
              : outbound.length
                ? `${outbound.length} Content change${outbound.length === 1 ? " is" : "s are"} ready to export.`
                : null,
            updatedAt: now,
          })
          .where(eq(schema.contentDatabaseSources.id, sourceId))
          .returning({ id: schema.contentDatabaseSources.id });
        if (refreshedSources.length !== 1) {
          throw new Error(
            `Local folder source "${sourceId}" was disconnected during sync`,
          );
        }
      });
      await writeAppState("refresh-signal", { ts: Date.now() });
    }

    return {
      sourceId,
      spaceId: target.database.spaceId,
      filesDatabaseId: target.database.id,
      truthPolicy: policy,
      dryRun,
      filesSeen: entries.length,
      created,
      updated,
      unchanged,
      conflicts,
      outbound,
      skipped,
      errors: parseErrors,
      idByPath: Object.fromEntries(
        plans.map((plan) => [plan.file.path, plan.id]),
      ),
    };
  },
});
