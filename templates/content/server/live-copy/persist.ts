import { ActionContractError } from "@agent-native/core";
import type {
  LiveCopyCommit,
  LiveCopyPersistOutcome,
} from "@agent-native/core/collab";
import type { DbExec } from "@agent-native/core/db";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import {
  lockPrimaryBlocksFields,
  persistBlocksFieldIdentity,
} from "../../actions/_blocks-field-identity.js";
import { reconcileInlineDatabasesForDocumentWithDb } from "../../actions/_content-database-lifecycle.js";
import { HISTORY_IDLE_MS } from "../../app/components/editor/document-history-session.js";
import { getDb, schema } from "../db/index.js";
import {
  documentAttributionActor,
  documentEditAttribution,
} from "../lib/document-attribution.js";
import { recordDocumentBodyIntent } from "../lib/document-body-intents.js";
import {
  recordDocumentHistoryTransition,
  type DocumentHistoryCause,
} from "../lib/document-history.js";
import { nextDocumentUpdatedAt } from "../lib/document-updated-at.js";
import {
  liveBodyWriterFlagsOn,
  liveBodyWriterGateForRow,
} from "../lib/live-body-writer.js";
import { syncPrivateCalloutReferences } from "../lib/private-icon-references.js";
import { drizzleOverExec } from "./exec-db.js";
import {
  currentContentBodyWriteCause,
  liveBodyConversionFor,
  type ContentBodyWriteCause,
  type LiveBodyConversion,
} from "./write-cause.js";

type ContentDb = ReturnType<typeof getDb>;

/** What one live-copy commit wrote to its page, read back in the same transaction. */
export interface PersistedContentBodyCommit {
  /** The page body before this commit. */
  before: string;
  /** The page body this commit wrote: the live copy's derived text. */
  after: string;
  bodyRevision: number;
  updatedAt: string;
  /** Inline collections the new body no longer holds, now in Trash. */
  softDeletedDatabaseIds: string[];
}

const persistedCommits = new WeakMap<DbExec, PersistedContentBodyCommit>();

/**
 * What the binding's persist wrote in transaction `tx`, for a caller's own
 * `mutateLiveCopy` persist, which core runs after it in the same
 * transaction. `undefined` when persist did not derive the page (the page
 * went back to its legacy writer) and on an unchanged edit, which commits no
 * live copy.
 */
export function persistedContentBodyCommit(
  tx: DbExec,
): PersistedContentBodyCommit | undefined {
  return persistedCommits.get(tx);
}

export type LiveBodyConversionErrorCode = "base_changed" | "flag_off";

export class LiveBodyConversionError extends Error {
  constructor(
    readonly code: LiveBodyConversionErrorCode,
    readonly documentId: string,
    message: string,
  ) {
    super(message);
    this.name = "LiveBodyConversionError";
  }
}

// A typing session sends a commit every few hundred milliseconds. History
// keeps one row per this interval; the next row carries the skipped commits'
// state, and any later writer records a before checkpoint first.
const LIVE_COPY_HISTORY_INTERVAL_MS = 2_000;

const pageColumns = {
  title: schema.documents.title,
  content: schema.documents.content,
  bodyRevision: schema.documents.bodyRevision,
  collabBodyRevision: schema.documents.collabBodyRevision,
  liveBodySwitchedAt: schema.documents.liveBodySwitchedAt,
  ownerEmail: schema.documents.ownerEmail,
  orgId: schema.documents.orgId,
  updatedAt: schema.documents.updatedAt,
  trashedAt: schema.documents.trashedAt,
};

type PageRow = {
  title: string;
  content: string;
  bodyRevision: number;
  collabBodyRevision: number | null;
  liveBodySwitchedAt: string | null;
  ownerEmail: string;
  orgId: string | null;
  updatedAt: string;
  trashedAt: string | null;
};

type BlocksFields = Awaited<ReturnType<typeof lockPrimaryBlocksFields>>;

interface LockedPage {
  page: PageRow;
  blocksFields: BlocksFields;
  lockedDatabaseIds: ReadonlySet<string>;
}

function scopeChanged(message: string): never {
  throw new ActionContractError(message, {
    errorCode: "DOCUMENT_METADATA_SCOPE_CHANGED",
    statusCode: 409,
  });
}

/**
 * Locks a page for a body write in Content's row-lock order: the collection
 * it backs and the inline collections it owns, in one id-ordered pass; then
 * its memberships; then the page row. Core takes `_collab_docs` after all of
 * them. Undefined when the page does not exist.
 */
async function lockPageForBodyWrite(
  db: ContentDb,
  documentId: string,
): Promise<LockedPage | undefined> {
  // guard:allow-unscoped — reads the owner of a page whose write the collab route or the calling action already authorized.
  const [owner] = await db
    .select({ ownerEmail: schema.documents.ownerEmail })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  if (!owner) return undefined;
  const databases = await db
    .select({
      id: schema.contentDatabases.id,
      documentId: schema.contentDatabases.documentId,
    })
    .from(schema.contentDatabases)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.contentDatabases.documentId),
    )
    .where(
      or(
        and(
          eq(schema.documents.id, documentId),
          eq(schema.documents.ownerEmail, owner.ownerEmail),
        ),
        and(
          eq(schema.contentDatabases.ownerDocumentId, documentId),
          eq(schema.contentDatabases.ownerEmail, owner.ownerEmail),
          isNull(schema.contentDatabases.deletedAt),
        ),
      ),
    )
    .orderBy(sql`${schema.contentDatabases.id} COLLATE "C"`)
    .for("update", { of: schema.contentDatabases });
  if (databases.filter((row) => row.documentId === documentId).length > 1) {
    scopeChanged(
      "The document's backing collection changed. Read the document again and retry.",
    );
  }
  const blocksFields = await lockPrimaryBlocksFields(db, documentId);
  // guard:allow-unscoped — locks the page row whose owner was read above, for a write already authorized.
  const [page] = await db
    .select(pageColumns)
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .for("update");
  if (!page) return undefined;
  if (page.ownerEmail !== owner.ownerEmail) {
    scopeChanged(
      `Page ${documentId} changed owner while its body was being written. Read it again and retry.`,
    );
  }
  return {
    page: page as PageRow,
    blocksFields,
    lockedDatabaseIds: new Set(databases.map((row) => row.id)),
  };
}

// A page in Trash refuses body writes, as update-document refuses them.
function assertEditablePage(page: PageRow): void {
  if (page.trashedAt) {
    throw new ActionContractError("Document not found.", {
      errorCode: "DOCUMENT_NOT_FOUND",
      statusCode: 404,
    });
  }
}

/**
 * The inline-collection reconcile soft-deletes collections the body dropped.
 * One created after the lock pass would be locked after the page, which
 * deadlocks against a Trash of the page: Trash locks it first.
 */
async function assertInlineDatabasesLocked(
  db: ContentDb,
  documentId: string,
  ownerEmail: string,
  lockedDatabaseIds: ReadonlySet<string>,
): Promise<void> {
  const owned = await db
    .select({ id: schema.contentDatabases.id })
    .from(schema.contentDatabases)
    .where(
      and(
        eq(schema.contentDatabases.ownerDocumentId, documentId),
        eq(schema.contentDatabases.ownerEmail, ownerEmail),
        isNull(schema.contentDatabases.deletedAt),
      ),
    );
  if (owned.some((database) => !lockedDatabaseIds.has(database.id))) {
    scopeChanged(
      "An inline collection was added to the document while it saved. Read the document again and retry.",
    );
  }
}

/**
 * History for a commit no server writer caused: the editor's own updates.
 * They join the actor's open session, one row per interval.
 */
async function editorHistoryCause(
  db: ContentDb,
  page: PageRow,
  documentId: string,
  actorEmail: string | null,
  now: string,
): Promise<DocumentHistoryCause | null> {
  const [latest] = await db
    .select({
      groupId: schema.documentVersions.groupId,
      groupKind: schema.documentVersions.groupKind,
      actorEmail: schema.documentVersions.actorEmail,
      createdAt: schema.documentVersions.createdAt,
    })
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.ownerEmail, page.ownerEmail),
        eq(schema.documentVersions.documentId, documentId),
      ),
    )
    .orderBy(
      desc(schema.documentVersions.createdAt),
      sql`case when ${schema.documentVersions.checkpointKind} = 'after' then 0 else 1 end`,
      desc(schema.documentVersions.id),
    )
    .limit(1);
  const base = {
    actorEmail,
    actorKind: "human" as const,
    origin: "collab",
    operation: "live-copy-update",
  };
  const age = latest
    ? Date.parse(now) - Date.parse(latest.createdAt)
    : Number.POSITIVE_INFINITY;
  if (
    latest?.groupId &&
    latest.groupKind === "human_session" &&
    latest.actorEmail === actorEmail &&
    age < HISTORY_IDLE_MS
  ) {
    if (age < LIVE_COPY_HISTORY_INTERVAL_MS) return null;
    return {
      ...base,
      groupId: latest.groupId,
      groupKind: "human_session",
      skipBeforeCheckpoint: true,
    };
  }
  return {
    ...base,
    groupId: `human:${actorEmail ?? "unknown"}:${crypto.randomUUID()}`,
    groupKind: "human_session",
  };
}

function serverHistoryCause(
  cause: ContentBodyWriteCause,
): DocumentHistoryCause {
  return {
    ctx: cause.ctx,
    operation: cause.operation,
    ...(cause.origin ? { origin: cause.origin } : {}),
    ...(cause.historySessionId
      ? { historySessionId: cause.historySessionId }
      : {}),
  };
}

/**
 * Writes `text` as the page body with everything a body write keeps in step:
 * revision, attribution, blocks-field identity, callout references, History,
 * body intent and inline collections. The caller holds the page lock.
 */
async function writeBody(args: {
  tx: DbExec;
  db: ContentDb;
  documentId: string;
  locked: LockedPage;
  text: string;
  cause: ContentBodyWriteCause | undefined;
  extraColumns?: Partial<typeof schema.documents.$inferInsert>;
}): Promise<PersistedContentBodyCommit> {
  const { db, documentId, text, cause } = args;
  const { page, blocksFields, lockedDatabaseIds } = args.locked;
  const changed = text !== page.content;
  const bodyRevision = page.bodyRevision + (changed ? 1 : 0);
  const updatedAt = changed
    ? nextDocumentUpdatedAt(page.updatedAt)
    : page.updatedAt;
  const actor = documentAttributionActor(cause?.ctx);
  if (
    changed ||
    args.extraColumns ||
    page.collabBodyRevision !== bodyRevision
  ) {
    // guard:allow-unscoped — writes the page row this transaction locked, for a write already authorized.
    await db
      .update(schema.documents)
      .set({
        ...args.extraColumns,
        collabBodyRevision: bodyRevision,
        ...(changed
          ? {
              content: text,
              bodyRevision,
              updatedAt,
              ...(actor ? documentEditAttribution(actor) : {}),
            }
          : {}),
      })
      .where(eq(schema.documents.id, documentId));
  }

  let softDeletedDatabaseIds: string[] = [];
  if (changed) {
    for (const field of blocksFields) {
      await persistBlocksFieldIdentity({
        db,
        ownerEmail: field.ownerEmail,
        documentId,
        propertyId: field.propertyId,
        previousMarkdown: page.content,
        markdown: text,
        now: updatedAt,
      });
    }
    await syncPrivateCalloutReferences(db, {
      documentId,
      before: page.content,
      after: text,
      userEmail: actor ?? page.ownerEmail,
      ownerEmail: page.ownerEmail,
      orgId: page.orgId,
    });
    const historyCause = cause
      ? serverHistoryCause(cause)
      : await editorHistoryCause(db, page, documentId, actor, updatedAt);
    if (historyCause) {
      await recordDocumentHistoryTransition({
        db,
        ownerEmail: page.ownerEmail,
        documentId,
        before: { title: page.title, content: page.content },
        after: { title: page.title, content: text },
        beforeBodyRevision: page.bodyRevision,
        afterBodyRevision: bodyRevision,
        cause: historyCause,
        now: updatedAt,
      });
    }
    await assertInlineDatabasesLocked(
      db,
      documentId,
      page.ownerEmail,
      lockedDatabaseIds,
    );
    softDeletedDatabaseIds = await reconcileInlineDatabasesForDocumentWithDb({
      db,
      documentId,
      content: text,
      ownerEmail: page.ownerEmail,
      now: updatedAt,
    });
  }
  if (cause?.intent) {
    await recordDocumentBodyIntent({
      db,
      ownerEmail: page.ownerEmail,
      orgId: page.orgId ?? "",
      documentId,
      intent: cause.intent.intent,
      candidateHash: cause.intent.candidateHash,
      metadataHash: cause.intent.metadataHash,
      committedRevision: bodyRevision,
      changedBlockIndexes: cause.intent.changedBlockIndexes,
      canonicalChanged: changed,
      displacedCheckpointId: cause.intent.displacedCheckpointId,
      now: updatedAt,
    });
  }
  const persisted = {
    before: page.content,
    after: text,
    bodyRevision,
    updatedAt,
    softDeletedDatabaseIds,
  };
  persistedCommits.set(args.tx, persisted);
  return persisted;
}

/**
 * Switches a page whose live copy now holds `text`. Runs in the transaction
 * that committed the copy, or, when the copy already held the body, in the
 * one core opens for the conversion's own persist.
 */
export async function persistLiveBodyConversion(
  tx: DbExec,
  conversion: LiveBodyConversion,
  text: string,
): Promise<PersistedContentBodyCommit> {
  const db = drizzleOverExec(tx);
  const locked = await lockPageForBodyWrite(db, conversion.documentId);
  const page = locked?.page;
  if (!locked || !page || page.bodyRevision !== conversion.baseRevision) {
    throw new LiveBodyConversionError(
      "base_changed",
      conversion.documentId,
      `Page ${conversion.documentId} changed while it was being switched to its live copy.`,
    );
  }
  if (!(await liveBodyWriterFlagsOn(page, { transaction: tx }))) {
    throw new LiveBodyConversionError(
      "flag_off",
      conversion.documentId,
      `The live-copy writer is off for page ${conversion.documentId}'s owner.`,
    );
  }
  assertEditablePage(page);
  return writeBody({
    tx,
    db,
    documentId: conversion.documentId,
    locked,
    text,
    cause: currentContentBodyWriteCause(),
    extraColumns: { liveBodySwitchedAt: new Date().toISOString() },
  });
}

/**
 * The binding's persist: derives the page from its live copy in the commit's
 * transaction. It rechecks the gate under the page lock and leaves a page
 * that went back to its legacy writer alone.
 */
export async function persistContentLiveCopy(
  tx: DbExec,
  commit: LiveCopyCommit,
): Promise<LiveCopyPersistOutcome> {
  const conversion = liveBodyConversionFor(commit.docId);
  if (conversion) {
    await persistLiveBodyConversion(tx, conversion, commit.text);
    return { derived: true };
  }
  const cause = currentContentBodyWriteCause();
  if (!cause && commit.origin !== "update") {
    throw new Error(
      `A server write to page ${commit.docId}'s live copy has no cause; wrap it in withContentBodyWriteCause.`,
    );
  }
  const db = drizzleOverExec(tx);
  const locked = await lockPageForBodyWrite(db, commit.docId);
  const gate = await liveBodyWriterGateForRow(locked?.page, {
    transaction: tx,
  });
  if (!locked || gate.writePath === "legacy") {
    return {
      derived: false,
      reason: gate.writePath === "legacy" ? gate.reason : "no_page",
    };
  }
  assertEditablePage(locked.page);
  await writeBody({
    tx,
    db,
    documentId: commit.docId,
    locked,
    text: commit.text,
    cause,
  });
  return { derived: true };
}
