import { type ActionRunContext, fail } from "@agent-native/core/action";
import { isUniqueViolation } from "@agent-native/core/db";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";

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
import { firstRow } from "./first-row.js";

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

export async function findDocumentCheckpoint(args: {
  ownerEmail: string;
  documentId: string;
  versionId?: string | undefined;
  versionName?: string | undefined;
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
  const row = firstRow(
    await getDb()
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
      .limit(1),
  );
  if (!row) checkpointNotFound(args.versionId ?? `"${name}"`);
  return row;
}

async function assertNameFree(args: {
  ownerEmail: string;
  documentId: string;
  name: string;
  exceptVersionId?: string;
}) {
  const existing = firstRow(
    await getDb()
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
      .limit(1),
  );
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
  const updated = await namingWrite(args.name ?? "", () =>
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
  const row = firstRow(updated);
  if (!row) checkpointNotFound(args.versionId);
  return { checkpoint: documentHistoryCheckpoint(row), created: false };
}

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
  const namedBy = args.ctx?.userEmail ?? null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await latestDocumentCheckpoint(args);
    if (
      !latest ||
      latest.name !== null ||
      latest.title !== args.current.title ||
      latest.content !== args.current.content
    ) {
      return insertNamedDocumentVersion(args, latest, namedBy);
    }
    const claimed = firstRow(
      await namingWrite(args.name, () =>
        getDb()
          .update(schema.documentVersions)
          .set({ name: args.name, namedBy, namedAt: args.now })
          .where(
            and(
              eq(schema.documentVersions.ownerEmail, args.ownerEmail),
              eq(schema.documentVersions.documentId, args.documentId),
              eq(schema.documentVersions.id, latest.id),
              isNull(schema.documentVersions.name),
            ),
          )
          .returning(),
      ),
    );
    if (claimed) {
      return { checkpoint: documentHistoryCheckpoint(claimed), created: false };
    }
  }
  versionNotSaved();
}

function versionNotSaved(): never {
  fail("The named version could not be saved.", {
    errorCode: "DOCUMENT_VERSION_NOT_SAVED",
    statusCode: 409,
  });
}

async function latestDocumentCheckpoint(args: {
  ownerEmail: string;
  documentId: string;
}) {
  return firstRow(
    await getDb()
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
      .limit(1),
  );
}

async function insertNamedDocumentVersion(
  args: Parameters<typeof nameCurrentDocumentVersion>[0],
  latest: CheckpointRow | undefined,
  namedBy: string | null,
): Promise<NamedDocumentVersionResult> {
  const latestMs = latest ? new Date(latest.createdAt).getTime() : 0;
  const createdAt = new Date(
    Math.max(new Date(args.now).getTime(), latestMs + 1),
  ).toISOString();
  const inserted = await namingWrite(args.name, () =>
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
          operation: NAME_DOCUMENT_VERSION_OPERATION,
          ...(args.ctx ? { ctx: args.ctx } : {}),
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
  const row = firstRow(inserted);
  if (!row) versionNotSaved();
  return { checkpoint: documentHistoryCheckpoint(row), created: true };
}
