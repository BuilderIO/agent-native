import { type ActionRunContext, fail } from "@agent-native/core/action";
import { isUniqueViolation } from "@agent-native/core/db";
import { and, desc, eq, ne, sql } from "drizzle-orm";

import {
  type DocumentHistoryCheckpoint,
  type DocumentHistoryCheckpointDetail,
  type DocumentHistoryCheckpointKind,
  NAME_DOCUMENT_VERSION_OPERATION,
  type NamedDocumentVersionResult,
} from "../../shared/document-history.js";
import { getDb, schema } from "../db/index.js";
import { resolveDocumentHistoryCause } from "./document-history.js";
import {
  documentVersionChatContextFromAction,
  serializeDocumentVersionChatContext,
} from "./document-version-context.js";

type CheckpointRow = typeof schema.documentVersions.$inferSelect;

export function documentHistoryCheckpoint(
  row: Pick<
    CheckpointRow,
    | "id"
    | "documentId"
    | "groupId"
    | "title"
    | "checkpointKind"
    | "createdAt"
    | "name"
    | "namedBy"
    | "namedAt"
  >,
): DocumentHistoryCheckpoint {
  return {
    id: row.id,
    documentId: row.documentId,
    groupId: row.groupId ?? row.id,
    title: row.title,
    checkpointKind: (row.checkpointKind ??
      "legacy") as DocumentHistoryCheckpointKind,
    createdAt: row.createdAt,
    name: row.name,
    namedBy: row.namedBy,
    namedAt: row.namedAt,
  };
}

export function documentHistoryCheckpointDetail(
  row: CheckpointRow,
): DocumentHistoryCheckpointDetail {
  return { ...documentHistoryCheckpoint(row), content: row.content };
}

export function normalizeDocumentVersionName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function checkpointNotFound(reference: string): never {
  fail(`Checkpoint not found: ${reference}`, {
    errorCode: "DOCUMENT_CHECKPOINT_NOT_FOUND",
    statusCode: 404,
  });
}

function nameTaken(name: string, versionId?: string): never {
  fail(`Another version of this page is already named "${name}".`, {
    errorCode: "DOCUMENT_VERSION_NAME_TAKEN",
    statusCode: 409,
    details: versionId ? { name, versionId } : { name },
  });
}

/** Finds one checkpoint of a page by its ID or, ignoring case, its name. */
export async function findDocumentCheckpoint(args: {
  ownerEmail: string;
  documentId: string;
  versionId?: string;
  versionName?: string;
}): Promise<CheckpointRow> {
  const name =
    args.versionName === undefined
      ? undefined
      : normalizeDocumentVersionName(args.versionName);
  if (!args.versionId && !name) {
    fail("Pass versionId or versionName.", {
      errorCode: "DOCUMENT_CHECKPOINT_REFERENCE_REQUIRED",
      statusCode: 400,
    });
  }
  const [row] = await getDb()
    .select()
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.ownerEmail, args.ownerEmail),
        eq(schema.documentVersions.documentId, args.documentId),
        args.versionId
          ? eq(schema.documentVersions.id, args.versionId)
          : sql`lower(${schema.documentVersions.name}) = lower(${name})`,
      ),
    )
    .limit(1);
  if (!row) checkpointNotFound(args.versionId ?? `"${name}"`);
  return row;
}

async function assertNameFree(args: {
  ownerEmail: string;
  documentId: string;
  name: string;
  exceptVersionId?: string;
}) {
  const [existing] = await getDb()
    .select({ id: schema.documentVersions.id })
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.ownerEmail, args.ownerEmail),
        eq(schema.documentVersions.documentId, args.documentId),
        sql`lower(${schema.documentVersions.name}) = lower(${args.name})`,
        args.exceptVersionId
          ? ne(schema.documentVersions.id, args.exceptVersionId)
          : undefined,
      ),
    )
    .limit(1);
  if (existing) nameTaken(args.name, existing.id);
}

async function namingWrite<T>(name: string, write: () => Promise<T>) {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error)) nameTaken(name);
    throw error;
  }
}

/** Sets, changes or (with a null name) removes the name of a checkpoint. */
export async function setDocumentCheckpointName(args: {
  ownerEmail: string;
  documentId: string;
  versionId: string;
  name: string | null;
  namedBy: string | null;
  now: string;
}): Promise<NamedDocumentVersionResult> {
  if (args.name) {
    await assertNameFree({
      ownerEmail: args.ownerEmail,
      documentId: args.documentId,
      name: args.name,
      exceptVersionId: args.versionId,
    });
  }
  const [row] = await namingWrite(args.name ?? "", () =>
    getDb()
      .update(schema.documentVersions)
      .set(
        args.name
          ? { name: args.name, namedBy: args.namedBy, namedAt: args.now }
          : { name: null, namedBy: null, namedAt: null },
      )
      .where(
        and(
          eq(schema.documentVersions.ownerEmail, args.ownerEmail),
          eq(schema.documentVersions.documentId, args.documentId),
          eq(schema.documentVersions.id, args.versionId),
        ),
      )
      .returning(),
  );
  if (!row) checkpointNotFound(args.versionId);
  return { checkpoint: documentHistoryCheckpoint(row), created: false };
}

/**
 * Names the page as it is now. The newest checkpoint is named when it already
 * holds exactly this title and body and has no name; otherwise a new
 * checkpoint of the current page is saved with the name.
 */
export async function nameCurrentDocumentVersion(args: {
  ownerEmail: string;
  documentId: string;
  current: { title: string; content: string; bodyRevision: number | null };
  name: string;
  ctx?: ActionRunContext;
  now: string;
}): Promise<NamedDocumentVersionResult> {
  await assertNameFree({
    ownerEmail: args.ownerEmail,
    documentId: args.documentId,
    name: args.name,
  });
  const [latest] = await getDb()
    .select()
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.ownerEmail, args.ownerEmail),
        eq(schema.documentVersions.documentId, args.documentId),
      ),
    )
    .orderBy(
      desc(schema.documentVersions.createdAt),
      sql`case when ${schema.documentVersions.checkpointKind} = 'after' then 0 else 1 end`,
      desc(schema.documentVersions.id),
    )
    .limit(1);
  const namedBy = args.ctx?.userEmail ?? null;
  if (
    latest &&
    latest.name === null &&
    latest.title === args.current.title &&
    latest.content === args.current.content
  ) {
    return setDocumentCheckpointName({
      ownerEmail: args.ownerEmail,
      documentId: args.documentId,
      versionId: latest.id,
      name: args.name,
      namedBy,
      now: args.now,
    });
  }
  const latestMs = latest ? new Date(latest.createdAt).getTime() : 0;
  const createdAt = new Date(
    Math.max(new Date(args.now).getTime(), latestMs + 1),
  ).toISOString();
  const [row] = await namingWrite(args.name, () =>
    getDb()
      .insert(schema.documentVersions)
      .values({
        id: crypto.randomUUID(),
        ownerEmail: args.ownerEmail,
        documentId: args.documentId,
        title: args.current.title,
        content: args.current.content,
        bodyRevision: args.current.bodyRevision,
        chatContext: serializeDocumentVersionChatContext(
          documentVersionChatContextFromAction(args.ctx),
        ),
        ...resolveDocumentHistoryCause({
          ctx: args.ctx,
          operation: NAME_DOCUMENT_VERSION_OPERATION,
        }),
        checkpointKind: "after",
        name: args.name,
        namedBy,
        namedAt: args.now,
        createdAt,
        updatedAt: createdAt,
      })
      .returning(),
  );
  if (!row) {
    fail("The named version could not be saved.", {
      errorCode: "DOCUMENT_VERSION_NOT_SAVED",
      statusCode: 409,
    });
  }
  return { checkpoint: documentHistoryCheckpoint(row), created: true };
}
