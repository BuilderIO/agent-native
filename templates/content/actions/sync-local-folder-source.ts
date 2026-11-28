import { createHash } from "node:crypto";

import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { lockLegacyBodyWrites } from "../server/lib/document-body-revision.js";
import { assertLocalFileLinkable } from "../server/lib/live-body-writer.js";
import {
  syncPrivateBodyReferences,
  syncPrivateIconReference,
  verifyPrivateIconAssignment,
} from "../server/lib/private-icon-references.js";
import type { ContentDatabaseSourceTruthPolicy } from "../shared/api.js";
import {
  isBuilderMdxSourcePath,
  isContentSourcePath,
  parseContentSourceFile,
} from "../shared/content-source.js";
import { LOCAL_FOLDER_TRASH_ORIGIN } from "../shared/content-trash.js";
import {
  sameSourceMarkdown,
  sourceMarkdownForm,
} from "../shared/source-markdown.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import { setFavoriteMembership } from "./_content-favorites.js";
import { ensureDocumentsFilesMembership } from "./_content-files.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";
import { provisionContentSpaces } from "./_content-spaces.js";
import {
  lockDatabaseMemberships,
  lockExistingDatabaseMemberships,
} from "./_database-membership-lock.js";
import { assertAgentsMayEditPageText } from "./_document-agent-lock.js";
import {
  LOCAL_FOLDER_SOURCE_TYPE,
  localFolderObservedRevision,
  localFolderSourceFileIdentity,
  localFolderSourceIdentityFromMetadata,
  normalizeLocalFolderSourceIdentity,
} from "./_local-folder-source.js";
import { lockDocumentRows } from "./_row-lock-order.js";
import {
  lockLifecycleGroup,
  restoreDocumentSubtree,
  retryRestoreOnMembershipChange,
  trashDocumentSubtree,
} from "./delete-document.js";

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
  pageHash: string;
  metadataHash: string;
  explicitId: boolean;
  workingCopyId: string;
  bridgeFileIdentity?: string;
}) {
  const observedRevision = localFolderObservedRevision({
    contentHash: args.hash,
    metadataHash: args.metadataHash,
  });
  return JSON.stringify({
    relativePath: args.path,
    extension: args.path.toLowerCase().endsWith(".mdx") ? ".mdx" : ".md",
    title: args.title,
    contentHash: args.hash,
    pageHash: args.pageHash,
    metadataHash: args.metadataHash,
    explicitId: args.explicitId,
    observedRevision,
    sourceFileIdentity: localFolderSourceFileIdentity({
      workingCopyId: args.workingCopyId,
      relativePath: args.path,
      observedRevision,
    }),
    ...(args.bridgeFileIdentity
      ? { bridgeFileIdentity: args.bridgeFileIdentity }
      : {}),
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

type Db = ReturnType<typeof getDb>;
type LinkedFileRow = typeof schema.contentDatabaseSourceRows.$inferSelect;

type RemovedFile = {
  row: LinkedFileRow;
  filesDatabaseId: string;
  spaceId: string;
  sourceRootPath: string;
  now: string;
  ctx: ActionRunContext | undefined;
  stillMissing: ReadonlySet<string>;
};
type RemovedFileOutcome = "trashed" | "unlinked" | "waiting" | "unchanged";

async function activePagesUnder(db: Db, pageId: string) {
  const seen = new Set([pageId]);
  const active: string[] = [];
  let frontier = [pageId];
  while (frontier.length > 0) {
    // guard:allow-unscoped — reads only the ids and Trash state of every owner's pages under a page the caller edits, to keep its Trash from taking or stranding them.
    const children = await db
      .select({
        id: schema.documents.id,
        trashedAt: schema.documents.trashedAt,
      })
      .from(schema.documents)
      .where(inArray(schema.documents.parentId, frontier));
    const rows = await db
      .select({
        id: schema.documents.id,
        trashedAt: schema.documents.trashedAt,
      })
      .from(schema.contentDatabaseItems)
      .innerJoin(
        schema.contentDatabases,
        eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
      )
      .innerJoin(
        schema.documents,
        eq(schema.documents.id, schema.contentDatabaseItems.documentId),
      )
      .where(inArray(schema.contentDatabases.documentId, frontier));
    frontier = [];
    for (const page of [...children, ...rows]) {
      if (seen.has(page.id)) continue;
      seen.add(page.id);
      frontier.push(page.id);
      if (!page.trashedAt) active.push(page.id);
    }
  }
  return active;
}

async function linkedRowUnchanged(tx: Db, row: LinkedFileRow) {
  const unchanged = await tx
    .select({ id: schema.contentDatabaseSourceRows.id })
    .from(schema.contentDatabaseSourceRows)
    .where(
      and(
        eq(schema.contentDatabaseSourceRows.id, row.id),
        eq(schema.contentDatabaseSourceRows.documentId, row.documentId),
        eq(schema.contentDatabaseSourceRows.updatedAt, row.updatedAt),
      ),
    );
  return unchanged.length > 0;
}

async function dropLinkedRow(tx: Db, row: LinkedFileRow) {
  await tx
    .delete(schema.contentDatabaseSourceRows)
    .where(eq(schema.contentDatabaseSourceRows.id, row.id));
  const otherLinks = await tx
    .select({ id: schema.contentDatabaseSourceRows.id })
    .from(schema.contentDatabaseSourceRows)
    .where(
      eq(schema.contentDatabaseSourceRows.databaseItemId, row.databaseItemId),
    )
    .limit(1);
  return otherLinks.length === 0;
}

async function unlinkPageOfRemovedFile(
  tx: Db,
  args: RemovedFile,
): Promise<RemovedFileOutcome> {
  const { row } = args;
  await lockContentDatabaseMutation(tx, args.filesDatabaseId);
  await lockExistingDatabaseMemberships(tx, [row.databaseItemId]);
  await lockDocumentRows(tx, [row.documentId]);
  if (!(await linkedRowUnchanged(tx, row))) return "unchanged";
  if (!(await dropLinkedRow(tx, row))) return "unlinked";
  await tx
    .delete(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.id, row.databaseItemId));
  await tx
    .update(schema.documents)
    .set({
      sourceMode: null,
      sourceKind: null,
      sourcePath: null,
      sourceRootPath: null,
      sourceUpdatedAt: args.now,
      updatedAt: args.now,
    })
    .where(
      and(
        eq(schema.documents.id, row.documentId),
        eq(schema.documents.spaceId, args.spaceId),
        eq(schema.documents.sourceRootPath, args.sourceRootPath),
      ),
    );
  return "unlinked";
}

async function settleRemovedFile(
  db: Db,
  args: RemovedFile,
): Promise<RemovedFileOutcome> {
  const { row } = args;
  return db.transaction(async (tx: Db) => {
    const owners = await tx
      .select({ ownerEmail: schema.documents.ownerEmail })
      .from(schema.documents)
      .where(eq(schema.documents.id, row.documentId));
    const owner = owners.length > 0 ? owners[0] : null;
    const under = owner ? await activePagesUnder(tx, row.documentId) : [];
    if (under.some((id) => !args.stillMissing.has(id))) {
      return unlinkPageOfRemovedFile(tx, args);
    }
    if (under.length > 0) return "waiting";
    const locks = owner
      ? await lockLifecycleGroup(tx, {
          operation: "trash",
          roots: [{ id: row.documentId, ownerEmail: owner.ownerEmail }],
          alsoLockDatabaseIds: [args.filesDatabaseId],
        })
      : null;
    if (!(await linkedRowUnchanged(tx, row))) return "unchanged";
    if (locks && (await activePagesUnder(tx, row.documentId)).length > 0) {
      return "unchanged";
    }
    if (!(await dropLinkedRow(tx, row)) || !owner || !locks) return "unlinked";
    const pages = await tx
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, row.documentId));
    const page = pages.length > 0 ? pages[0] : null;
    if (
      !page ||
      page.trashedAt ||
      page.spaceId !== args.spaceId ||
      page.sourceMode !== "local-files" ||
      page.sourceRootPath !== args.sourceRootPath
    ) {
      return "unlinked";
    }
    await trashDocumentSubtree(
      tx,
      row.documentId,
      owner.ownerEmail,
      args.now,
      locks,
      LOCAL_FOLDER_TRASH_ORIGIN,
      args.ctx,
    );
    return "trashed";
  });
}

async function settleRemovedFiles(
  db: Db,
  rows: LinkedFileRow[],
  args: Omit<RemovedFile, "row" | "stillMissing">,
) {
  const stillMissing = new Set(rows.map((row) => row.documentId));
  const settled: LinkedFileRow[] = [];
  let waiting = rows;
  while (waiting.length > 0) {
    const next: LinkedFileRow[] = [];
    for (const row of waiting) {
      const outcome = await settleRemovedFile(db, {
        ...args,
        row,
        stillMissing,
      });
      if (outcome === "waiting") {
        next.push(row);
        continue;
      }
      if (outcome !== "trashed") stillMissing.delete(row.documentId);
      if (outcome !== "unchanged") settled.push(row);
    }
    if (next.length === waiting.length) break;
    waiting = next;
  }
  return settled;
}

export default defineAction({
  description:
    "Refresh a connected local-folder source through the trusted browser/Desktop bridge, materializing Markdown/MDX as normal SQL-backed Content pages and recording safe source identity and conflicts. When the folder is the source of truth, a page whose file left it moves to Trash (or, when pages that stay sit under it, becomes an ordinary page), and comes back if a file with its id, or one at its old path, returns. A read that lists no files changes no page.",
  schema: z.object({
    sourceId: z.string().min(1),
    files: z
      .record(z.string(), z.string().max(MAX_SOURCE_FILE_BYTES))
      .refine((value) => Object.keys(value).length <= MAX_SOURCE_FILES, {
        message: `Sync is limited to ${MAX_SOURCE_FILES} files.`,
      }),
    fileIdentities: z.record(z.string(), z.string().min(1).max(256)).optional(),
    observedRevisions: z
      .record(z.string(), z.string().regex(/^[a-f0-9]{64}$/i))
      .optional(),
    skippedPaths: z
      .array(z.string().min(1).max(1024))
      .max(MAX_SOURCE_FILES)
      .optional()
      .describe(
        "Markdown files the reader found but didn't send, such as files over 2 MiB. Their pages stay as they are.",
      ),
    dryRun: z.boolean().optional().default(false),
  }),
  run: async (
    {
      sourceId,
      files,
      fileIdentities = {},
      observedRevisions,
      skippedPaths = [],
      dryRun,
    },
    ctx,
  ) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("no authenticated user");
    const builderPaths = Object.keys(files).filter(isBuilderMdxSourcePath);
    if (builderPaths.length) {
      throw new Error(
        `Builder .builder.mdx files require the Builder actions: ${builderPaths.join(", ")}`,
      );
    }
    const entries = normalizedEntries(files);
    const readPaths = new Set([...Object.keys(files), ...skippedPaths]);
    const folderListsFiles = readPaths.size > 0;
    if (observedRevisions) {
      for (const [filePath, content] of entries) {
        if (observedRevisions[filePath] !== contentHash(content)) {
          throw new Error(
            `Local file revision changed while reading "${filePath}"`,
          );
        }
      }
    }
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
    const pathId = (path: string) =>
      opaqueId("content_local_file", `${sourceId}:${path}`);
    const pathIds = valid.map((file) => pathId(file.path));
    type SourceRow = typeof schema.contentDatabaseSourceRows.$inferSelect;
    type Document = typeof schema.documents.$inferSelect;
    const deletedFilePath = (row: SourceRow) => {
      const values = parseJson(row.sourceValuesJson);
      return typeof values.relativePath === "string"
        ? values.relativePath
        : typeof row.sourceDisplayKey === "string"
          ? row.sourceDisplayKey
          : row.sourceRowId;
    };
    const deletionChangeSetId = (row: SourceRow) =>
      opaqueId(
        "content_source_change",
        `${sourceId}:${row.documentId}:source-delete:${deletedFilePath(row)}`,
      );
    const loadSnapshot = async (queryDb: any) => {
      const storedRows = (await queryDb
        .select()
        .from(schema.contentDatabaseSourceRows)
        .where(
          eq(schema.contentDatabaseSourceRows.sourceId, sourceId),
        )) as SourceRow[];
      const rowByPath = new Map(
        storedRows.map((row) => [
          typeof parseJson(row.sourceValuesJson).relativePath === "string"
            ? parseJson(row.sourceValuesJson).relativePath
            : (JSON.stringify(parseJson(row.sourceValuesJson).relativePath) ??
              ""),
          row,
        ]),
      );
      const rowByDocumentId = new Map(
        storedRows.map((row) => [row.documentId, row]),
      );
      const linkedIds = storedRows.map((row) => row.documentId);
      const candidateIds = [
        ...new Set([...explicitIds, ...pathIds, ...linkedIds]),
      ];
      const existingDocuments = (
        candidateIds.length
          ? await queryDb
              .select()
              .from(schema.documents)
              .where(inArray(schema.documents.id, candidateIds))
          : []
      ) as Document[];
      const trashedHere = (
        valid.length
          ? await queryDb
              .select()
              .from(schema.documents)
              .where(
                and(
                  eq(schema.documents.spaceId, targetSpaceId),
                  eq(schema.documents.sourceMode, "local-files"),
                  eq(
                    schema.documents.sourceRootPath,
                    target.source.sourceTable,
                  ),
                  eq(schema.documents.trashOrigin, LOCAL_FOLDER_TRASH_ORIGIN),
                  isNotNull(schema.documents.trashedAt),
                  inArray(
                    schema.documents.sourcePath,
                    valid.map((file) => file.path),
                  ),
                ),
              )
          : []
      ) as Document[];
      const documentById = new Map(
        [...existingDocuments, ...trashedHere].map((document) => [
          document.id,
          document,
        ]),
      );
      const trashedByPath = new Map<string, Document>();
      for (const page of trashedHere.sort((left, right) =>
        (right.trashedAt ?? "").localeCompare(left.trashedAt ?? ""),
      )) {
        if (page.sourcePath && !trashedByPath.has(page.sourcePath)) {
          trashedByPath.set(page.sourcePath, page);
        }
      }
      return {
        storedRows,
        rowByPath,
        rowByDocumentId,
        documentById,
        trashedByPath,
      };
    };

    const initialSnapshot = await loadSnapshot(db);

    const validateDocumentIds = async (
      snapshot: Awaited<ReturnType<typeof loadSnapshot>>,
    ) => {
      for (const existing of snapshot.documentById.values()) {
        if (existing.spaceId !== targetSpaceId) {
          throw new Error(
            `Document "${existing.id}" belongs to another Content space and cannot be imported here`,
          );
        }
        await assertAccess("document", existing.id, "editor");
      }
    };

    await validateDocumentIds(initialSnapshot);

    const sourceSettings = (source: {
      metadataJson: string;
      sourceName: string;
    }) => {
      const metadata = parseJson(source.metadataJson);
      return {
        policy: truthPolicy(metadata.truthPolicy),
        localIdentity:
          localFolderSourceIdentityFromMetadata(metadata.localIdentity) ??
          normalizeLocalFolderSourceIdentity({
            connectionId: target.source.sourceTable,
            label: source.sourceName,
          }),
      };
    };
    let { policy, localIdentity } = sourceSettings(target.source);
    const now = new Date().toISOString();
    const created: Array<{ id: string; path: string; title: string }> = [];
    const updated: Array<{ id: string; path: string; title: string }> = [];
    const unchanged: Array<{ id: string; path: string; title: string }> = [];
    const skipped = [...parseErrors];
    const conflicts: Array<{ id: string; path: string; title: string }> = [];
    const outbound: Array<{ id: string; path: string; title: string }> = [];

    const rowsByMovedFile = (
      snapshot: Awaited<ReturnType<typeof loadSnapshot>>,
      unplaced: typeof valid,
      placedDocumentIds: ReadonlySet<string | undefined>,
    ) => {
      type Move = { files: typeof valid; rows: SourceRow[] };
      const moves = new Map<string, Move>();
      const movesReading = (content: string) => {
        const form = sourceMarkdownForm(content);
        if (!form) return undefined;
        const move = moves.get(form) ?? { files: [], rows: [] };
        moves.set(form, move);
        return move;
      };
      const gone = snapshot.storedRows.filter(
        (row) =>
          !placedDocumentIds.has(row.documentId) &&
          !readPaths.has(deletedFilePath(row)),
      );
      if (gone.length === 0)
        return new Map<(typeof valid)[number], SourceRow>();
      for (const file of unplaced) movesReading(file.content)?.files.push(file);
      for (const row of gone) {
        const page = snapshot.documentById.get(row.documentId);
        if (page) movesReading(page.content)?.rows.push(row);
      }
      return new Map(
        [...moves.values()].flatMap((move) =>
          move.files.length === 1 && move.rows.length === 1
            ? move.files.flatMap((file) =>
                move.rows
                  .filter((row) => mayHaveMoved(snapshot, row, file))
                  .map((row) => [file, row] as const),
              )
            : [],
        ),
      );
    };

    const mayHaveMoved = (
      snapshot: Awaited<ReturnType<typeof loadSnapshot>>,
      row: SourceRow,
      file: (typeof valid)[number],
    ) => {
      const values = parseJson(row.sourceValuesJson);
      const page = snapshot.documentById.get(row.documentId);
      return (
        !!page &&
        values.explicitId === false &&
        (values.pageHash !== contentHash(page.content) ||
          (values.metadataHash !== metadataHash(page) &&
            metadataHash(page) === metadataHash(file)))
      );
    };

    const buildPlans = (snapshot: Awaited<ReturnType<typeof loadSnapshot>>) => {
      const rowByBridgeIdentity = new Map<
        string,
        (typeof snapshot.storedRows)[number]
      >();
      for (const row of snapshot.storedRows) {
        const values = parseJson(row.sourceValuesJson);
        if (typeof values.bridgeFileIdentity === "string") {
          rowByBridgeIdentity.set(values.bridgeFileIdentity, row);
        }
      }

      const explicitIdOf = (file: (typeof valid)[number]) =>
        file.id && localIdentity.workingCopy.kind === "temporary"
          ? opaqueId("content_local_file", `${sourceId}:${file.id}`)
          : file.id;
      const knownRow = (file: (typeof valid)[number]) => {
        const identity = fileIdentities[file.path];
        return (
          snapshot.rowByPath.get(file.path) ??
          (identity ? rowByBridgeIdentity.get(identity) : undefined)
        );
      };
      const movedRows = rowsByMovedFile(
        snapshot,
        valid.filter((file) => !explicitIdOf(file) && !knownRow(file)),
        new Set(
          valid.map((file) => explicitIdOf(file) ?? knownRow(file)?.documentId),
        ),
      );
      const claimedIds = new Set(
        valid.map(
          (file) =>
            explicitIdOf(file) ??
            (knownRow(file) ?? movedRows.get(file))?.documentId,
        ),
      );
      const trashedPageAt = (path: string) => {
        const page = snapshot.trashedByPath.get(path);
        return page && !claimedIds.has(page.id) ? page.id : undefined;
      };

      return valid.map((file, index) => {
        const incomingBridgeFileIdentity = fileIdentities[file.path];
        const incomingHash = contentHash(file.content);
        const pathRow = knownRow(file) ?? movedRows.get(file);
        const explicitId = explicitIdOf(file);
        const id =
          explicitId ??
          pathRow?.documentId ??
          trashedPageAt(file.path) ??
          pathId(file.path);
        const existing = snapshot.documentById.get(id);
        const previousRow = snapshot.rowByDocumentId.get(id) ?? pathRow;
        const previousValues = parseJson(previousRow?.sourceValuesJson);
        const bridgeFileIdentity =
          incomingBridgeFileIdentity ??
          (typeof previousValues.bridgeFileIdentity === "string"
            ? previousValues.bridgeFileIdentity
            : undefined);
        const previousHash =
          typeof previousValues.contentHash === "string"
            ? previousValues.contentHash
            : null;
        const previousMetadataHash =
          typeof previousValues.metadataHash === "string"
            ? previousValues.metadataHash
            : null;
        const previousPageHash =
          typeof previousValues.pageHash === "string"
            ? previousValues.pageHash
            : previousHash;
        const incomingMetadataHash = metadataHash(file);
        const localHash = existing ? contentHash(existing.content) : null;
        const holdsFile =
          !!existing &&
          (localHash === incomingHash ||
            (localHash === previousPageHash && incomingHash === previousHash) ||
            sameSourceMarkdown(existing.content, file.content));
        const localMetadataHash = existing ? metadataHash(existing) : null;
        const incomingChanged =
          previousHash !== incomingHash ||
          previousMetadataHash !== incomingMetadataHash;
        const localChanged =
          !!existing &&
          ((!!previousPageHash &&
            !holdsFile &&
            localHash !== previousPageHash) ||
            (!!previousMetadataHash &&
              localMetadataHash !== previousMetadataHash));
        const conflict =
          !!existing &&
          !!previousHash &&
          incomingChanged &&
          (localChanged || policy === "database_primary") &&
          (!holdsFile || localMetadataHash !== incomingMetadataHash);
        const keepContent =
          !!existing &&
          !!previousHash &&
          localChanged &&
          !incomingChanged &&
          policy !== "source_primary";
        const applyIncoming =
          incomingChanged || (localChanged && policy === "source_primary");
        const pageContent =
          existing && (holdsFile || !applyIncoming)
            ? existing.content
            : file.content;
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
          holdsFile,
          pageContent,
          incomingChanged,
          localChanged,
          conflict,
          keepContent,
          applyIncoming,
          bridgeFileIdentity,
        };
      });
    };

    const comesBackHere = (page: Document | undefined): page is Document =>
      !!page?.trashedAt &&
      page.trashOrigin === LOCAL_FOLDER_TRASH_ORIGIN &&
      page.trashRootId === page.id &&
      page.spaceId === targetSpaceId &&
      page.sourceMode === "local-files" &&
      page.sourceRootPath === target.source.sourceTable;
    const heldInTrash = (page: Document | undefined) =>
      !!page?.trashedAt &&
      page.trashOrigin === LOCAL_FOLDER_TRASH_ORIGIN &&
      !comesBackHere(page);
    let heldPlans: ReturnType<typeof buildPlans> = [];
    const planFiles = (snapshot: Awaited<ReturnType<typeof loadSnapshot>>) => {
      const all = buildPlans(snapshot);
      heldPlans = all.filter((plan) => heldInTrash(plan.existing));
      return all.filter((plan) => !heldInTrash(plan.existing));
    };
    const missingRowsOf = (
      snapshot: Awaited<ReturnType<typeof loadSnapshot>>,
    ) => {
      const plannedIds = new Set(
        [...plans, ...heldPlans].map((plan) => plan.id),
      );
      return snapshot.storedRows.filter(
        (row) =>
          !plannedIds.has(row.documentId) &&
          !readPaths.has(deletedFilePath(row)),
      );
    };

    let plans = planFiles(initialSnapshot);
    let missingRows = missingRowsOf(initialSnapshot);
    const classifyPlans = (
      snapshot: Awaited<ReturnType<typeof loadSnapshot>>,
    ) => {
      created.length = 0;
      updated.length = 0;
      unchanged.length = 0;
      conflicts.length = 0;
      outbound.length = 0;
      for (const row of policy === "source_primary" ? [] : missingRows) {
        const values = parseJson(row.sourceValuesJson);
        const path =
          typeof values.relativePath === "string"
            ? values.relativePath
            : typeof row.sourceDisplayKey === "string"
              ? row.sourceDisplayKey
              : "";
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
          plan.existing.sourcePath !== plan.file.path ||
          plan.existing.sourceRootPath !== target.source.sourceTable
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

    const rebindsExistingPage = (plan: (typeof plans)[number]) =>
      !!plan.existing &&
      !plan.conflict &&
      !plan.keepContent &&
      (plan.applyIncoming ||
        plan.existing.sourcePath !== plan.file.path ||
        plan.existing.sourceRootPath !== target.source.sourceTable);
    // This caller supplies the text, so a sync doesn't get past the lock here
    // the way one from a source a person connected does.
    const assertAgentMayApply = (plan: (typeof plans)[number]) => {
      if (plan.applyIncoming && rebindsExistingPage(plan)) {
        assertAgentsMayEditPageText(plan.existing, ctx);
      }
    };

    let removedRows: SourceRow[] = [];
    if (dryRun) {
      // The sync refuses as a whole when it would link a page switched to its
      // live copy, so its preview does too.
      for (const plan of plans) {
        assertAgentMayApply(plan);
        if (rebindsExistingPage(plan)) await assertLocalFileLinkable(plan.id);
      }
      if (policy === "source_primary" && folderListsFiles) {
        removedRows = missingRows;
      }
    } else {
      const applySync = async (tx: Db) => {
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
          .returning({
            id: schema.contentDatabaseSources.id,
            metadataJson: schema.contentDatabaseSources.metadataJson,
            sourceName: schema.contentDatabaseSources.sourceName,
          });
        if (claimedSources.length !== 1) {
          throw new Error(
            `Local folder source "${sourceId}" was disconnected before sync`,
          );
        }
        // A reconnect rewrites the policy in place, so the one read before
        // the claim may no longer be the folder's.
        ({ policy, localIdentity } = sourceSettings(claimedSources[0]));
        const transactionSnapshot = await loadSnapshot(tx);
        await validateDocumentIds(transactionSnapshot);
        plans = planFiles(transactionSnapshot);
        missingRows = missingRowsOf(transactionSnapshot);
        classifyPlans(transactionSnapshot);
        // The pages' Files memberships, then the pages, each by id, as a save
        // takes them: the writes below update pages before the memberships.
        // A conflict page is locked too, since its plan can change below.
        const existingPageIds = plans
          .filter((plan) => plan.existing)
          .map((plan) => plan.id);
        const lockedPageIds = [
          ...existingPageIds,
          ...missingRows.map((row) => row.documentId),
        ];
        // Add a missing Files membership before locking any page. A page has
        // one per Files database, so once this transaction holds or inserts
        // it, a concurrent insert waits on this one; if it were added after
        // the pages, the later membership lock would wait on its writer.
        await ensureDocumentsFilesMembership(tx, existingPageIds, now);
        const returning = plans.flatMap((plan) =>
          comesBackHere(plan.existing) ? [plan.existing] : [],
        );
        const comebackLocks = returning.length
          ? await lockLifecycleGroup(tx, {
              operation: "restore",
              roots: returning.map((page) => ({
                id: page.id,
                ownerEmail: page.ownerEmail,
              })),
              alsoLockDatabaseIds: [target.database.id],
              alsoLockDocumentIds: lockedPageIds,
            })
          : null;
        if (lockedPageIds.length > 0) {
          const memberships = await tx
            .select({ id: schema.contentDatabaseItems.id })
            .from(schema.contentDatabaseItems)
            .where(
              and(
                eq(schema.contentDatabaseItems.databaseId, target.database.id),
                inArray(schema.contentDatabaseItems.documentId, lockedPageIds),
              ),
            );
          await lockExistingDatabaseMemberships(tx, [
            ...memberships.map((membership: { id: string }) => membership.id),
            ...missingRows.map((row) => row.databaseItemId),
          ]);
          await lockDocumentRows(tx, lockedPageIds);
        }
        if (comebackLocks) {
          for (const page of returning) {
            const current: Document[] = await tx
              .select()
              .from(schema.documents)
              .where(eq(schema.documents.id, page.id));
            if (current.length > 0 && comesBackHere(current[0])) {
              await restoreDocumentSubtree(
                tx,
                page.id,
                page.ownerEmail,
                comebackLocks,
                { keepLocalFolderPages: true },
              );
            }
          }
        }
        // The snapshot read these pages before their locks. A save that
        // committed in between would be written over without a conflict, or
        // leave a conflict proposal for Content as it was before the save,
        // which can't be accepted. Planning them again from the pages as
        // locked records the save.
        if (existingPageIds.length > 0) {
          const lockedPages = (await tx
            .select()
            .from(schema.documents)
            .where(
              inArray(schema.documents.id, existingPageIds),
            )) as Document[];
          for (const page of lockedPages) {
            transactionSnapshot.documentById.set(page.id, page);
          }
          plans = planFiles(transactionSnapshot);
          classifyPlans(transactionSnapshot);
        }
        plans.forEach(assertAgentMayApply);
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
                kind: plan.holdsFile ? "metadata_update" : "body_update",
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
            await verifyPrivateIconAssignment({
              icon: plan.file.icon === undefined ? null : plan.file.icon,
              userEmail,
              orgId: target.database.orgId,
            });
            await tx.insert(schema.documents).values({
              id: plan.id,
              spaceId: target.database.spaceId,
              ownerEmail: userEmail,
              orgId: target.database.orgId,
              parentId: null,
              title: plan.file.title,
              content: plan.pageContent,
              description: plan.file.description ?? "",
              icon: plan.file.icon ?? null,
              position: plan.file.position ?? plan.index,
              isFavorite: plan.file.isFavorite ? 1 : 0,
              hideFromSearch: plan.file.hideFromSearch ? 1 : 0,
              sourceMode: "local-files",
              sourceKind: "file",
              sourcePath: plan.file.path,
              sourceRootPath: target.source.sourceTable,
              sourceUpdatedAt: now,
              visibility: target.database.orgId ? "org" : "private",
              createdAt: now,
              updatedAt: now,
            });
            await syncPrivateIconReference(tx as ReturnType<typeof getDb>, {
              elementType: "document",
              elementId: plan.id,
              documentId: plan.id,
              icon: plan.file.icon === undefined ? null : plan.file.icon,
              ownerEmail: userEmail,
              orgId: target.database.orgId,
            });
            await syncPrivateBodyReferences(tx as ReturnType<typeof getDb>, {
              documentId: plan.id,
              before: "",
              after: plan.pageContent,
              userEmail,
              ownerEmail: userEmail,
              orgId: target.database.orgId,
            });
          } else if (rebindsExistingPage(plan)) {
            await assertLocalFileLinkable(plan.id, { transaction: tx });
            const versionId = opaqueId(
              "content_document_version",
              `${plan.id}:${plan.existing.updatedAt}:${plan.incomingHash}`,
            );
            await tx
              .insert(schema.documentVersions)
              .values({
                id: versionId,
                ownerEmail: plan.existing.ownerEmail,
                documentId: plan.id,
                title: plan.existing.title,
                content: plan.existing.content,
                groupId: versionId,
                groupKind: "operation",
                actorKind: "source",
                origin: "local-folder",
                operation: "sync-local-folder-source",
                checkpointKind: "before",
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoNothing();
            const legacy = plan.applyIncoming
              ? await lockLegacyBodyWrites(tx, [plan.id], {
                  operation: "sync-local-folder-source",
                  content: plan.pageContent,
                })
              : undefined;
            const reboundDocuments = await tx
              .update(schema.documents)
              .set({
                ...(legacy
                  ? {
                      title: plan.file.title,
                      content: plan.pageContent,
                      bodyRevision: legacy.bodyRevision(plan.pageContent),
                      description:
                        plan.file.description ?? plan.existing.description,
                      icon: plan.file.icon ?? plan.existing.icon,
                    }
                  : {}),
                sourceMode: "local-files",
                sourceKind: "file",
                sourcePath: plan.file.path,
                sourceRootPath: target.source.sourceTable,
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
            if (plan.applyIncoming) {
              const nextIcon =
                plan.file.icon === undefined || plan.file.icon === null
                  ? plan.existing.icon
                  : plan.file.icon;
              if (nextIcon !== plan.existing.icon) {
                await verifyPrivateIconAssignment({
                  icon: nextIcon,
                  userEmail,
                  orgId: target.database.orgId,
                });
                await syncPrivateIconReference(tx as ReturnType<typeof getDb>, {
                  elementType: "document",
                  elementId: plan.id,
                  documentId: plan.id,
                  icon: nextIcon,
                  ownerEmail: plan.existing.ownerEmail,
                  orgId: target.database.orgId,
                });
              }
              await syncPrivateBodyReferences(tx as ReturnType<typeof getDb>, {
                documentId: plan.id,
                before: plan.existing.content,
                after: plan.pageContent,
                userEmail,
                ownerEmail: plan.existing.ownerEmail,
                orgId: target.database.orgId,
              });
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
        await lockDatabaseMemberships(
          tx,
          filesItems.map(
            (item: typeof schema.contentDatabaseItems.$inferSelect) => item.id,
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
              pageHash: contentHash(plan.pageContent),
              metadataHash: plan.incomingMetadataHash,
              explicitId: Boolean(plan.file.id),
              workingCopyId: localIdentity.workingCopy.id,
              bridgeFileIdentity: plan.bridgeFileIdentity,
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
        // A file back in the folder makes its open deletion proposal untrue,
        // and accepting it would unlink the page from a file that exists.
        const missingRowIds = new Set(missingRows.map((row) => row.id));
        const retiredDeletionIds = transactionSnapshot.storedRows
          .filter((row) => !missingRowIds.has(row.id))
          .map((row) => deletionChangeSetId(row));
        if (retiredDeletionIds.length > 0) {
          await tx
            .delete(schema.contentDatabaseSourceChangeSets)
            .where(
              and(
                inArray(
                  schema.contentDatabaseSourceChangeSets.id,
                  retiredDeletionIds,
                ),
                eq(schema.contentDatabaseSourceChangeSets.state, "proposed"),
              ),
            );
        }
        for (const row of policy === "source_primary" ? [] : missingRows) {
          const values = parseJson(row.sourceValuesJson);
          const path = deletedFilePath(row);
          const changeSetId = deletionChangeSetId(row);
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
      };
      await retryRestoreOnMembershipChange(() => db.transaction(applySync));
      if (policy === "source_primary" && folderListsFiles) {
        removedRows = await settleRemovedFiles(db, missingRows, {
          filesDatabaseId: target.database.id,
          spaceId: targetSpaceId,
          sourceRootPath: target.source.sourceTable,
          now,
          ctx,
        });
      }
      await writeAppState("refresh-signal", { ts: Date.now() });
    }

    skipped.push(
      ...skippedPaths.map((path) => ({
        path,
        reason:
          "The folder reader didn't send this file (it's over 2 MiB or isn't a regular file), so its page stays as it was.",
      })),
      ...heldPlans.map((plan) => ({
        path: plan.file.path,
        reason:
          "Its page is in Trash, moved there by another folder's sync. Restore the page, and the next sync links it to this file.",
      })),
      ...(policy === "source_primary" && !folderListsFiles
        ? missingRows.map((row) => ({
            path: deletedFilePath(row),
            reason:
              "The folder listed no files, so this sync left the page as it was.",
          }))
        : []),
    );

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
      removed: removedRows.map((row) => ({
        id: row.documentId,
        path: deletedFilePath(row),
      })),
      skipped,
      errors: parseErrors,
      idByPath: Object.fromEntries(
        plans.map((plan) => [plan.file.path, plan.id]),
      ),
    };
  },
});
