// @ts-nocheck — Drizzle ORM types from core vs local resolve to different instances
// in pnpm's node_modules. Logic is correct; types just don't unify across instances.
import crypto from "node:crypto";

import { deleteCollabState, releaseDoc } from "@agent-native/core/collab";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import type { DocumentSyncStatus } from "../../shared/api.js";
import { canonicalizeNfm, nfmToDoc, type PMNode } from "../../shared/nfm.js";
import { getDb, schema } from "../db/index.js";
import { getCurrentOwnerEmail } from "./documents.js";
import {
  createNotionPageWithMarkdown,
  fetchNotionPage,
  getNotionConnectionForOwner,
  normalizeNotionPageId,
  NotionApiError,
  notionFetch,
  pushDocumentToNotionPage,
  readNotionPageAsDocument,
} from "./notion.js";

type DocumentRow = InferSelectModel<typeof schema.documents>;
type LinkRow = InferSelectModel<typeof schema.documentSyncLinks>;

const MAX_CHILD_PAGE_SYNC_DEPTH = 5;

function nowIso() {
  return new Date().toISOString();
}

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.randomBytes(size);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

/**
 * Hash of the canonical content. Two documents with the same hash are
 * byte-identical once canonicalized, so this is the authoritative "did the
 * content actually change" signal — immune to timestamp jitter and to the
 * normalization differences that previously made no-op syncs look like edits.
 */
function hashContent(content: string | null | undefined): string {
  return crypto
    .createHash("sha256")
    .update(canonicalizeNfm(content ?? ""))
    .digest("hex");
}

function parseWarnings(link: Pick<LinkRow, "warningsJson"> | null): string[] {
  if (!link?.warningsJson) return [];
  try {
    const warnings = JSON.parse(link.warningsJson) as unknown;
    return Array.isArray(warnings)
      ? warnings.filter((w) => typeof w === "string")
      : [];
  } catch {
    return [];
  }
}

function normalizeNotionPageIdSafe(input: string | null | undefined) {
  if (!input) return null;
  try {
    return normalizeNotionPageId(input);
  } catch {
    return null;
  }
}

function parseAttrsJson(value: unknown): Record<string, string> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => {
        return typeof entry[0] === "string" && typeof entry[1] === "string";
      }),
    );
  } catch {
    return {};
  }
}

type ChildPageReference = {
  pageId: string;
  title: string;
};

type RemotePageDocumentLookup = Map<string, string>;

type LinkedChildRow = {
  id: string;
  position: number;
  remotePageId: string | null;
};

function extractChildPageReferences(content: string): ChildPageReference[] {
  const doc = nfmToDoc(content);
  const refs: ChildPageReference[] = [];
  const seen = new Set<string>();

  function visit(node: PMNode) {
    if (node.type === "notionBlockAtom" && node.attrs?.tagName === "page") {
      const attrs = parseAttrsJson(node.attrs.attrsJson);
      const pageId =
        normalizeNotionPageIdSafe(attrs.url) ??
        normalizeNotionPageIdSafe(attrs.href) ??
        normalizeNotionPageIdSafe(attrs.id) ??
        normalizeNotionPageIdSafe(attrs.pageId) ??
        normalizeNotionPageIdSafe(attrs.page_id);

      if (pageId && !seen.has(pageId)) {
        seen.add(pageId);
        refs.push({
          pageId,
          title:
            typeof node.attrs.label === "string" && node.attrs.label.trim()
              ? node.attrs.label.trim()
              : "Untitled",
        });
      }
    }

    for (const child of node.content ?? []) visit(child);
  }

  for (const child of doc.content) visit(child);
  return refs;
}

function buildStatus(args: {
  connected: boolean;
  documentId: string;
  link: LinkRow | null;
  remoteUpdatedAt?: string | null;
  documentUpdatedAt?: string | null;
  documentContent?: string | null;
}): DocumentSyncStatus {
  const link = args.link;
  const lastPushed = link?.lastPushedLocalUpdatedAt || null;
  const remoteKnown =
    args.remoteUpdatedAt ?? link?.lastKnownRemoteUpdatedAt ?? null;
  const localUpdatedAt = args.documentUpdatedAt ?? null;
  const remoteChanged = Boolean(
    remoteKnown &&
    link?.lastPulledRemoteUpdatedAt &&
    remoteKnown > link.lastPulledRemoteUpdatedAt,
  );
  // Prefer content-hash change detection: the local doc differs from the
  // last-synced state only if its canonical content hash differs. This is the
  // key fix for the drift — a no-op editor save (identical canonical content)
  // no longer registers as a local change. Fall back to timestamps for links
  // synced before the hash column existed.
  const localChanged =
    args.documentContent != null && link?.lastSyncedContentHash
      ? hashContent(args.documentContent) !== link.lastSyncedContentHash
      : Boolean(localUpdatedAt && lastPushed && localUpdatedAt > lastPushed);

  return {
    provider: "notion",
    connected: args.connected,
    documentId: args.documentId,
    pageId: link?.remotePageId || null,
    pageUrl: link?.remotePageId
      ? `https://www.notion.so/${link.remotePageId.replace(/-/g, "")}`
      : null,
    state: (link?.state as DocumentSyncStatus["state"]) || "idle",
    lastSyncedAt: link?.lastSyncedAt || null,
    lastKnownRemoteUpdatedAt: remoteKnown,
    lastPushedLocalUpdatedAt: lastPushed,
    hasConflict: Boolean(link?.hasConflict),
    remoteChanged,
    localChanged,
    lastError: link?.lastError || null,
    warnings: parseWarnings(link),
  };
}

async function getDocument(documentId: string, owner: string) {
  const db = getDb();
  const [document] = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, documentId),
        eq(schema.documents.ownerEmail, owner),
      ),
    );
  if (!document) throw new Error("Document not found");
  return document;
}

export async function getSyncLink(documentId: string, owner?: string) {
  const db = getDb();
  const ownerEmail = owner ?? getCurrentOwnerEmail();
  const [link] = await db
    .select()
    .from(schema.documentSyncLinks)
    .where(
      and(
        eq(schema.documentSyncLinks.documentId, documentId),
        eq(schema.documentSyncLinks.ownerEmail, ownerEmail),
      ),
    );
  return link ?? null;
}

const SYNC_CLAIM_STALE_MS = 30_000;

/**
 * Best-effort cross-instance mutual exclusion for a single document's Notion
 * sync. Unlike the in-process `lastRefreshAt` throttle (which only protects a
 * single process against rapid repeat calls), this uses a conditional UPDATE
 * on `document_sync_links.sync_claimed_at` so two concurrent syncs for the
 * same document — different browser tabs, different serverless instances —
 * don't both proceed to mutate Notion/the document row at once. A stale claim
 * (older than SYNC_CLAIM_STALE_MS, e.g. a crashed request) is treated as free.
 *
 * Returns true if the claim was acquired. Callers MUST release the claim in a
 * finally block.
 */
async function tryClaimSyncLink(
  documentId: string,
  owner: string,
): Promise<boolean> {
  const db = getDb();
  const now = nowIso();
  const staleBefore = new Date(Date.now() - SYNC_CLAIM_STALE_MS).toISOString();
  try {
    const claimed = await db
      .update(schema.documentSyncLinks)
      .set({ syncClaimedAt: now })
      .where(
        and(
          eq(schema.documentSyncLinks.documentId, documentId),
          eq(schema.documentSyncLinks.ownerEmail, owner),
          or(
            isNull(schema.documentSyncLinks.syncClaimedAt),
            lt(schema.documentSyncLinks.syncClaimedAt, staleBefore),
          ),
        ),
      )
      .returning({ documentId: schema.documentSyncLinks.documentId });
    return Boolean(claimed && claimed.length > 0);
  } catch {
    // If the claim mechanism itself fails (e.g. column not yet migrated on
    // an old replica), fail open rather than blocking sync entirely — this
    // is a best-effort narrowing of the race window, not a hard lock.
    return true;
  }
}

async function releaseSyncLink(documentId: string, owner: string) {
  const db = getDb();
  try {
    await db
      .update(schema.documentSyncLinks)
      .set({ syncClaimedAt: null })
      .where(
        and(
          eq(schema.documentSyncLinks.documentId, documentId),
          eq(schema.documentSyncLinks.ownerEmail, owner),
        ),
      );
  } catch {
    // Best-effort — an unreleased stale claim self-heals after
    // SYNC_CLAIM_STALE_MS.
  }
}

const SYNC_CLAIM_RETRY_DELAYS_MS = [150, 300];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Claim the sync link for a user-triggered pull/push, waiting briefly and
 * retrying a couple times on contention instead of giving up immediately —
 * the other holder (another tab's poll, a concurrent manual action) is
 * usually mid-flight for well under a second. Returns false only if the
 * claim is still held after all retries, in which case the caller must not
 * proceed and should report the current (non-mutating) status instead.
 */
async function claimSyncLinkWithRetry(
  documentId: string,
  owner: string,
): Promise<boolean> {
  if (await tryClaimSyncLink(documentId, owner)) return true;
  for (const delayMs of SYNC_CLAIM_RETRY_DELAYS_MS) {
    await delay(delayMs);
    if (await tryClaimSyncLink(documentId, owner)) return true;
  }
  return false;
}

async function upsertSyncLink(args: {
  owner: string;
  documentId: string;
  remotePageId: string;
  state?: string;
  lastSyncedAt?: string | null;
  lastPulledRemoteUpdatedAt?: string | null;
  lastPushedLocalUpdatedAt?: string | null;
  lastKnownRemoteUpdatedAt?: string | null;
  lastSyncedContentHash?: string | null;
  lastError?: string | null;
  warnings?: string[];
  hasConflict?: boolean;
}) {
  const db = getDb();
  const values = {
    documentId: args.documentId,
    ownerEmail: args.owner,
    provider: "notion",
    remotePageId: args.remotePageId,
    state: args.state || "linked",
    lastSyncedAt: args.lastSyncedAt ?? null,
    lastPulledRemoteUpdatedAt: args.lastPulledRemoteUpdatedAt ?? null,
    lastPushedLocalUpdatedAt: args.lastPushedLocalUpdatedAt ?? null,
    lastKnownRemoteUpdatedAt: args.lastKnownRemoteUpdatedAt ?? null,
    lastSyncedContentHash: args.lastSyncedContentHash ?? null,
    lastError: args.lastError ?? null,
    warningsJson: JSON.stringify(args.warnings || []),
    hasConflict: args.hasConflict ? 1 : 0,
    updatedAt: nowIso(),
  };
  await db
    .insert(schema.documentSyncLinks)
    .values({ ...values, createdAt: nowIso() })
    .onConflictDoUpdate({
      target: schema.documentSyncLinks.documentId,
      set: values,
    });
}

async function loadRemotePageDocumentLookup(
  owner: string,
): Promise<RemotePageDocumentLookup> {
  const db = getDb();
  const links = await db
    .select({
      documentId: schema.documentSyncLinks.documentId,
      remotePageId: schema.documentSyncLinks.remotePageId,
    })
    .from(schema.documentSyncLinks)
    .where(eq(schema.documentSyncLinks.ownerEmail, owner));

  const lookup: RemotePageDocumentLookup = new Map();
  for (const link of links) {
    const remotePageId = normalizeNotionPageIdSafe(link.remotePageId);
    if (remotePageId) lookup.set(remotePageId, link.documentId);
  }
  return lookup;
}

async function listLinkedChildrenForParent(
  owner: string,
  parentId: string,
): Promise<LinkedChildRow[]> {
  const db = getDb();
  const children = await db
    .select({
      id: schema.documents.id,
      position: schema.documents.position,
    })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.ownerEmail, owner),
        eq(schema.documents.parentId, parentId),
      ),
    );

  if (children.length === 0) return [];

  const links = await db
    .select({
      documentId: schema.documentSyncLinks.documentId,
      remotePageId: schema.documentSyncLinks.remotePageId,
    })
    .from(schema.documentSyncLinks)
    .where(
      and(
        eq(schema.documentSyncLinks.ownerEmail, owner),
        inArray(
          schema.documentSyncLinks.documentId,
          children.map((child) => child.id),
        ),
      ),
    );

  const remotePageIdByDocumentId = new Map(
    links.map((link) => [link.documentId, link.remotePageId]),
  );

  return children.map((child) => ({
    id: child.id,
    position: child.position,
    remotePageId: remotePageIdByDocumentId.get(child.id) ?? null,
  }));
}

async function inheritShares(parentId: string, childId: string, now: string) {
  const db = getDb();
  const shares = await db
    .select({
      principalType: schema.documentShares.principalType,
      principalId: schema.documentShares.principalId,
      role: schema.documentShares.role,
      createdBy: schema.documentShares.createdBy,
    })
    .from(schema.documentShares)
    .where(eq(schema.documentShares.resourceId, parentId));

  if (shares.length === 0) return;

  await db.insert(schema.documentShares).values(
    shares.map((share) => ({
      id: nanoid(),
      resourceId: childId,
      principalType: share.principalType,
      principalId: share.principalId,
      role: share.role,
      createdBy: share.createdBy,
      createdAt: now,
    })),
  );
}

async function createLinkedChildDocument(args: {
  owner: string;
  parent: DocumentRow;
  remotePageId: string;
  title: string;
  position: number;
}) {
  const db = getDb();
  const now = nowIso();
  const id = nanoid();

  let inserted = false;
  try {
    await db.insert(schema.documents).values({
      id,
      ownerEmail: args.parent.ownerEmail,
      orgId: args.parent.orgId,
      parentId: args.parent.id,
      title: args.title || "Untitled",
      content: "",
      icon: null,
      position: args.position,
      isFavorite: 0,
      hideFromSearch: args.parent.hideFromSearch,
      visibility: args.parent.visibility,
      createdAt: now,
      updatedAt: now,
    });
    inserted = true;
    await inheritShares(args.parent.id, id, now);
    await upsertSyncLink({
      owner: args.owner,
      documentId: id,
      remotePageId: args.remotePageId,
      state: "linked",
      warnings: [],
      hasConflict: false,
    });
  } catch (error) {
    if (inserted) {
      await deleteImportedPlaceholder(args.owner, id).catch(() => undefined);
    }
    throw error;
  }

  return id;
}

async function deleteImportedPlaceholder(owner: string, documentId: string) {
  const db = getDb();
  await db
    .delete(schema.documentSyncLinks)
    .where(
      and(
        eq(schema.documentSyncLinks.documentId, documentId),
        eq(schema.documentSyncLinks.ownerEmail, owner),
      ),
    );
  await db
    .delete(schema.documentShares)
    .where(eq(schema.documentShares.resourceId, documentId));
  await db
    .delete(schema.documents)
    .where(
      and(
        eq(schema.documents.id, documentId),
        eq(schema.documents.ownerEmail, owner),
      ),
    );
}

async function syncChildPagesFromPulledContent(args: {
  owner: string;
  parent: DocumentRow;
  content: string;
  force: boolean;
  depth: number;
  seenRemotePageIds: Set<string>;
  remotePageDocumentIdByPageId: RemotePageDocumentLookup;
}) {
  if (args.depth >= MAX_CHILD_PAGE_SYNC_DEPTH) return;

  const refs = extractChildPageReferences(args.content);
  const currentRemotePageIds = new Set(refs.map((ref) => ref.pageId));
  const db = getDb();
  const existingChildren = await listLinkedChildrenForParent(
    args.owner,
    args.parent.id,
  );

  for (const child of existingChildren) {
    const remotePageId = normalizeNotionPageIdSafe(child.remotePageId);
    if (!remotePageId || currentRemotePageIds.has(remotePageId)) continue;
    await db
      .update(schema.documents)
      .set({ parentId: null, updatedAt: nowIso() })
      .where(
        and(
          eq(schema.documents.id, child.id),
          eq(schema.documents.ownerEmail, args.owner),
        ),
      );
  }

  if (refs.length === 0) return;

  const manualSiblingMaxPosition = existingChildren.reduce((max, child) => {
    const remotePageId = normalizeNotionPageIdSafe(child.remotePageId);
    return remotePageId ? max : Math.max(max, child.position);
  }, -1);
  const basePosition = manualSiblingMaxPosition + 1;

  for (const [index, ref] of refs.entries()) {
    if (args.seenRemotePageIds.has(ref.pageId)) continue;
    args.seenRemotePageIds.add(ref.pageId);

    let childId = args.remotePageDocumentIdByPageId.get(ref.pageId) ?? null;
    let createdPlaceholder = false;
    const position = basePosition + index;

    if (!childId) {
      // Re-check for an existing link immediately before creating a
      // placeholder. `args.remotePageDocumentIdByPageId` can be stale — it
      // was loaded once at the start of this pull chain, so a concurrent
      // pull (another tab, another serverless instance) may have already
      // created and committed a placeholder for this same remote page in the
      // meantime. Without this re-query, both pulls insert their own
      // document row for the same Notion child page, and both stay attached
      // forever because the detach loop above only removes children whose
      // remote page id is no longer referenced.
      const freshLookup = await loadRemotePageDocumentLookup(args.owner);
      childId = freshLookup.get(ref.pageId) ?? null;
      if (childId) {
        args.remotePageDocumentIdByPageId.set(ref.pageId, childId);
      }
    }

    if (!childId) {
      childId = await createLinkedChildDocument({
        owner: args.owner,
        parent: args.parent,
        remotePageId: ref.pageId,
        title: ref.title,
        position,
      });
      args.remotePageDocumentIdByPageId.set(ref.pageId, childId);
      createdPlaceholder = true;
    } else {
      const [child] = await db
        .select()
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, childId),
            eq(schema.documents.ownerEmail, args.owner),
          ),
        );

      if (!child) continue;

      const updates: Partial<DocumentRow> = {};
      if (child.parentId !== args.parent.id) {
        updates.parentId = args.parent.id;
      }
      if (child.position !== position) {
        updates.position = position;
      }
      if (Object.keys(updates).length > 0) {
        await db
          .update(schema.documents)
          .set(updates)
          .where(
            and(
              eq(schema.documents.id, childId),
              eq(schema.documents.ownerEmail, args.owner),
            ),
          );
      }
    }

    try {
      await pullDocumentFromNotion(args.owner, childId, args.force, {
        depth: args.depth + 1,
        seenRemotePageIds: args.seenRemotePageIds,
      });
    } catch (error) {
      if (createdPlaceholder) {
        await deleteImportedPlaceholder(args.owner, childId);
        args.remotePageDocumentIdByPageId.delete(ref.pageId);
      } else {
        const link = await getSyncLink(childId, args.owner);
        if (link) {
          await upsertSyncLink({
            owner: args.owner,
            documentId: childId,
            remotePageId: link.remotePageId,
            state: "error",
            lastSyncedAt: link.lastSyncedAt,
            lastPulledRemoteUpdatedAt: link.lastPulledRemoteUpdatedAt,
            lastPushedLocalUpdatedAt: link.lastPushedLocalUpdatedAt,
            lastKnownRemoteUpdatedAt: link.lastKnownRemoteUpdatedAt,
            lastSyncedContentHash: link.lastSyncedContentHash,
            lastError:
              error instanceof Error
                ? error.message
                : "Failed to sync Notion child page",
            warnings: parseWarnings(link),
            hasConflict: Boolean(link.hasConflict),
          });
        }
      }
    }
  }
}

export async function unlinkDocumentFromNotion(
  owner: string,
  documentId: string,
) {
  const db = getDb();
  await db
    .delete(schema.documentSyncLinks)
    .where(
      and(
        eq(schema.documentSyncLinks.documentId, documentId),
        eq(schema.documentSyncLinks.ownerEmail, owner),
      ),
    );

  // Clean up comment linkage so relinking to a different Notion page doesn't
  // permanently exclude previously-synced local comments from being pushed
  // again (sync-notion-comments only pushes rows with a NULL notionCommentId).
  // Remove pulled Notion-origin comments outright (they belong to the old
  // page and would otherwise look like stale local content), and clear the
  // notionCommentId on the rest so they become re-pushable.
  await db
    .delete(schema.documentComments)
    .where(
      and(
        eq(schema.documentComments.documentId, documentId),
        eq(schema.documentComments.ownerEmail, owner),
        eq(schema.documentComments.authorEmail, "notion@sync"),
      ),
    );
  await db
    .update(schema.documentComments)
    .set({ notionCommentId: null })
    .where(
      and(
        eq(schema.documentComments.documentId, documentId),
        eq(schema.documentComments.ownerEmail, owner),
      ),
    );
}

export async function getDocumentSyncStatus(
  owner: string,
  documentId: string,
): Promise<DocumentSyncStatus> {
  const document = await getDocument(documentId, owner);
  const link = await getSyncLink(documentId, owner);
  const connection = await getNotionConnectionForOwner(owner);
  if (!connection || !link) {
    return buildStatus({
      connected: Boolean(connection),
      documentId,
      link,
      documentUpdatedAt: document.updatedAt,
      documentContent: document.content,
    });
  }

  try {
    const page = await fetchNotionPage(
      connection.accessToken,
      link.remotePageId,
    );
    const remoteUpdatedAt = page.last_edited_time || null;
    return buildStatus({
      connected: true,
      documentId,
      link,
      remoteUpdatedAt,
      documentUpdatedAt: document.updatedAt,
      documentContent: document.content,
    });
  } catch (error: any) {
    await upsertSyncLink({
      owner,
      documentId,
      remotePageId: link.remotePageId,
      state: "error",
      lastSyncedAt: link.lastSyncedAt,
      lastPulledRemoteUpdatedAt: link.lastPulledRemoteUpdatedAt,
      lastPushedLocalUpdatedAt: link.lastPushedLocalUpdatedAt,
      lastKnownRemoteUpdatedAt: link.lastKnownRemoteUpdatedAt,
      lastSyncedContentHash: link.lastSyncedContentHash,
      lastError: error.message || "Failed to load Notion page",
      warnings: parseWarnings(link),
      hasConflict: Boolean(link.hasConflict),
    });
    const next = await getSyncLink(documentId, owner);
    // A 401 means the user revoked the integration — report the connection
    // itself as broken (connected: false) instead of connected-with-error, so
    // the client's fast auto-sync poll backs off and the UI can fall back to
    // the normal "connect Notion" flow instead of hammering a dead token
    // every ~2s forever.
    const connected = !(
      error instanceof NotionApiError && error.status === 401
    );
    return buildStatus({
      connected,
      documentId,
      link: next,
      documentUpdatedAt: document.updatedAt,
      documentContent: document.content,
    });
  }
}

export async function linkDocumentToNotionPage(
  owner: string,
  documentId: string,
  pageIdOrUrl: string,
): Promise<DocumentSyncStatus> {
  const connection = await getNotionConnectionForOwner(owner);
  if (!connection) throw new Error("Connect Notion before linking a page.");
  await getDocument(documentId, owner);
  const pageId = normalizeNotionPageId(pageIdOrUrl);
  const page = await fetchNotionPage(connection.accessToken, pageId);
  await upsertSyncLink({
    owner,
    documentId,
    remotePageId: page.id,
    state: "linked",
    lastKnownRemoteUpdatedAt: page.last_edited_time || null,
    warnings: [],
    hasConflict: false,
  });
  return pullDocumentFromNotion(owner, documentId, true);
}

/**
 * Public entry point for pulling a document from Notion. Claims the
 * document's sync link before touching Notion/the row (unless the caller
 * already holds the claim — see `childSync.skipClaim`, set by
 * `refreshDocumentSyncStatus`, which claims/releases around its own call so
 * it doesn't double-claim or double-release here) and always releases in a
 * finally block, including on error paths.
 *
 * A user-triggered call (skipClaim not set) that loses the claim race waits
 * briefly and retries a couple times (`claimSyncLinkWithRetry`); if the claim
 * is still held after that, it returns the current non-mutating status
 * instead of racing Notion mutations against the other holder.
 */
export async function pullDocumentFromNotion(
  owner: string,
  documentId: string,
  force = false,
  childSync: {
    depth?: number;
    seenRemotePageIds?: Set<string>;
    remotePageDocumentIdByPageId?: RemotePageDocumentLookup;
    skipClaim?: boolean;
  } = {},
): Promise<DocumentSyncStatus> {
  if (childSync.skipClaim) {
    return pullDocumentFromNotionInner(owner, documentId, force, childSync);
  }
  if (!(await claimSyncLinkWithRetry(documentId, owner))) {
    return getDocumentSyncStatus(owner, documentId);
  }
  try {
    return await pullDocumentFromNotionInner(
      owner,
      documentId,
      force,
      childSync,
    );
  } finally {
    await releaseSyncLink(documentId, owner);
  }
}

async function pullDocumentFromNotionInner(
  owner: string,
  documentId: string,
  force: boolean,
  childSync: {
    depth?: number;
    seenRemotePageIds?: Set<string>;
    remotePageDocumentIdByPageId?: RemotePageDocumentLookup;
  },
): Promise<DocumentSyncStatus> {
  const db = getDb();
  const document = await getDocument(documentId, owner);
  const link = await getSyncLink(documentId, owner);
  if (!link) throw new Error("Document is not linked to a Notion page.");
  const connection = await getNotionConnectionForOwner(owner);
  if (!connection) throw new Error("Connect Notion before pulling.");

  const pageContent = await readNotionPageAsDocument(
    connection.accessToken,
    link.remotePageId,
  );

  // Re-read the document row after the (multi-second) Notion round-trip so a
  // local save that landed while we were fetching is detected instead of
  // silently overwritten below. All change detection and the CAS write use
  // this fresh snapshot, not the pre-fetch `document`.
  const freshDocument = await getDocument(documentId, owner);

  // Content-hash change detection: a side "changed" only if its canonical
  // content actually differs from the last-synced baseline. This is immune to
  // the normalization mismatches and timestamp jitter that previously made
  // every no-op pull look like a fresh edit and drove the drift.
  const localChanged = link.lastSyncedContentHash
    ? hashContent(freshDocument.content) !== link.lastSyncedContentHash
    : Boolean(
        link.lastPushedLocalUpdatedAt &&
        freshDocument.updatedAt > link.lastPushedLocalUpdatedAt,
      );
  const remoteChanged = link.lastSyncedContentHash
    ? hashContent(pageContent.content) !== link.lastSyncedContentHash
    : Boolean(
        link.lastPulledRemoteUpdatedAt &&
        pageContent.lastEditedTime &&
        pageContent.lastEditedTime > link.lastPulledRemoteUpdatedAt,
      );

  // Both sides already agree (e.g. our own prior push already landed this
  // exact content) — converge the baseline instead of flagging a phantom
  // conflict below.
  if (
    localChanged &&
    remoteChanged &&
    hashContent(freshDocument.content) === hashContent(pageContent.content)
  ) {
    await upsertSyncLink({
      owner,
      documentId,
      remotePageId: link.remotePageId,
      state: "linked",
      lastSyncedAt: nowIso(),
      lastPulledRemoteUpdatedAt: pageContent.lastEditedTime,
      lastPushedLocalUpdatedAt: freshDocument.updatedAt,
      lastKnownRemoteUpdatedAt: pageContent.lastEditedTime,
      lastSyncedContentHash: hashContent(freshDocument.content),
      lastError: null,
      warnings: pageContent.warnings,
      hasConflict: false,
    });
    const convergedLink = await getSyncLink(documentId, owner);
    return buildStatus({
      connected: true,
      documentId,
      link: convergedLink,
      remoteUpdatedAt: pageContent.lastEditedTime,
      documentUpdatedAt: freshDocument.updatedAt,
      documentContent: freshDocument.content,
    });
  }

  if (!force && localChanged && remoteChanged) {
    await upsertSyncLink({
      owner,
      documentId,
      remotePageId: link.remotePageId,
      state: "conflict",
      lastSyncedAt: link.lastSyncedAt,
      lastPulledRemoteUpdatedAt: link.lastPulledRemoteUpdatedAt,
      lastPushedLocalUpdatedAt: link.lastPushedLocalUpdatedAt,
      lastKnownRemoteUpdatedAt: pageContent.lastEditedTime,
      lastSyncedContentHash: link.lastSyncedContentHash,
      lastError: null,
      warnings: pageContent.warnings,
      hasConflict: true,
    });
    const updatedLink = await getSyncLink(documentId, owner);
    return buildStatus({
      connected: true,
      documentId,
      link: updatedLink,
      remoteUpdatedAt: pageContent.lastEditedTime,
      documentUpdatedAt: freshDocument.updatedAt,
      documentContent: freshDocument.content,
    });
  }

  const newTitle = pageContent.title || freshDocument.title;
  const newContent = pageContent.content ?? freshDocument.content;
  const newIcon = pageContent.icon;
  const contentChanged =
    newTitle !== freshDocument.title ||
    newContent !== freshDocument.content ||
    newIcon !== freshDocument.icon;

  // Only bump documents.updated_at when something actually changed. A no-op
  // pull must not move the local-clock forward, otherwise the next conflict
  // check will mistake the unchanged document for a fresh local edit.
  const updatedAt = contentChanged ? nowIso() : freshDocument.updatedAt;
  if (contentChanged) {
    // Compare-and-swap: only apply the pulled content if the row is still at
    // the snapshot we just re-read. If a concurrent save landed in between,
    // 0 rows match and we fall through to the conflict path instead of
    // clobbering the newer local write.
    const applied = await db
      .update(schema.documents)
      .set({
        title: newTitle,
        content: newContent,
        icon: newIcon,
        updatedAt,
      })
      .where(
        and(
          eq(schema.documents.id, documentId),
          eq(schema.documents.ownerEmail, owner),
          eq(schema.documents.updatedAt, freshDocument.updatedAt),
        ),
      )
      .returning({ id: schema.documents.id });

    if (!applied || applied.length === 0) {
      // A newer local save raced in after our re-read. Do not adopt the
      // pulled content or advance the hash baseline — surface a conflict so
      // the user resolves it explicitly instead of silently losing the edit.
      await upsertSyncLink({
        owner,
        documentId,
        remotePageId: link.remotePageId,
        state: "conflict",
        lastSyncedAt: link.lastSyncedAt,
        lastPulledRemoteUpdatedAt: link.lastPulledRemoteUpdatedAt,
        lastPushedLocalUpdatedAt: link.lastPushedLocalUpdatedAt,
        lastKnownRemoteUpdatedAt: pageContent.lastEditedTime,
        lastSyncedContentHash: link.lastSyncedContentHash,
        lastError: null,
        warnings: pageContent.warnings,
        hasConflict: true,
      });
      const racedLink = await getSyncLink(documentId, owner);
      const racedDocument = await getDocument(documentId, owner);
      return buildStatus({
        connected: true,
        documentId,
        link: racedLink,
        remoteUpdatedAt: pageContent.lastEditedTime,
        documentUpdatedAt: racedDocument.updatedAt,
        documentContent: racedDocument.content,
      });
    }

    // Reset the Yjs collaborative state so it no longer holds the pre-sync
    // content. Connected clients re-seed their Y.XmlFragment from the new
    // `documents.content` value via VisualEditor's content-sync effect, and
    // a fresh page load starts from an empty server state and seeds from SQL.
    try {
      await deleteCollabState(documentId);
      releaseDoc(documentId);
    } catch {
      // Non-fatal — the client-side sync will still reconcile via setContent.
    }
  }

  await upsertSyncLink({
    owner,
    documentId,
    remotePageId: link.remotePageId,
    state: "linked",
    lastSyncedAt: nowIso(),
    lastPulledRemoteUpdatedAt: pageContent.lastEditedTime,
    lastPushedLocalUpdatedAt: updatedAt,
    lastKnownRemoteUpdatedAt: pageContent.lastEditedTime,
    lastSyncedContentHash: hashContent(newContent),
    lastError: null,
    warnings: pageContent.warnings,
    hasConflict: false,
  });

  const updatedLink = await getSyncLink(documentId, owner);
  const seenRemotePageIds = childSync.seenRemotePageIds ?? new Set<string>();
  const remotePageDocumentIdByPageId =
    childSync.remotePageDocumentIdByPageId ??
    (await loadRemotePageDocumentLookup(owner));
  const currentRemotePageId = normalizeNotionPageIdSafe(link.remotePageId);
  if (currentRemotePageId) seenRemotePageIds.add(currentRemotePageId);
  await syncChildPagesFromPulledContent({
    owner,
    parent: {
      ...freshDocument,
      title: newTitle,
      content: newContent,
      icon: newIcon,
      updatedAt,
    },
    content: newContent,
    force,
    depth: childSync.depth ?? 0,
    seenRemotePageIds,
    remotePageDocumentIdByPageId,
  });

  return buildStatus({
    connected: true,
    documentId,
    link: updatedLink,
    remoteUpdatedAt: pageContent.lastEditedTime,
    documentUpdatedAt: updatedAt,
    documentContent: newContent,
  });
}

/**
 * Public entry point for pushing a document to Notion. Claims the document's
 * sync link before touching Notion/the row (unless the caller already holds
 * the claim — see `internalOptions.skipClaim`, set by
 * `refreshDocumentSyncStatus`) and always releases in a finally block,
 * including on error paths.
 *
 * A user-triggered call (skipClaim not set) that loses the claim race waits
 * briefly and retries a couple times (`claimSyncLinkWithRetry`); if the claim
 * is still held after that, it returns the current non-mutating status
 * instead of racing Notion mutations against the other holder.
 */
export async function pushDocumentToNotion(
  owner: string,
  documentId: string,
  force = false,
  internalOptions?: { skipClaim?: boolean },
): Promise<DocumentSyncStatus> {
  if (internalOptions?.skipClaim) {
    return pushDocumentToNotionInner(owner, documentId, force);
  }
  if (!(await claimSyncLinkWithRetry(documentId, owner))) {
    return getDocumentSyncStatus(owner, documentId);
  }
  try {
    return await pushDocumentToNotionInner(owner, documentId, force);
  } finally {
    await releaseSyncLink(documentId, owner);
  }
}

async function pushDocumentToNotionInner(
  owner: string,
  documentId: string,
  force: boolean,
): Promise<DocumentSyncStatus> {
  const document = await getDocument(documentId, owner);
  const link = await getSyncLink(documentId, owner);
  if (!link) throw new Error("Document is not linked to a Notion page.");
  const connection = await getNotionConnectionForOwner(owner);
  if (!connection) throw new Error("Connect Notion before pushing.");

  const page = await fetchNotionPage(connection.accessToken, link.remotePageId);
  const remoteUpdatedAt = page.last_edited_time || null;
  // Cheap fast-path signal: last_edited_time is minute-granular, so a bump is
  // only a *candidate* remote change. When we have a content baseline, confirm
  // (or rule out) same-minute remote edits by reading the actual content —
  // otherwise a same-minute Notion edit would never be detected and would get
  // force-overwritten by this push.
  const timestampBumped = Boolean(
    link.lastKnownRemoteUpdatedAt &&
    remoteUpdatedAt &&
    remoteUpdatedAt > link.lastKnownRemoteUpdatedAt,
  );
  let remoteChanged = timestampBumped;
  let remotePageContent: Awaited<
    ReturnType<typeof readNotionPageAsDocument>
  > | null = null;
  if (link.lastSyncedContentHash) {
    remotePageContent = await readNotionPageAsDocument(
      connection.accessToken,
      link.remotePageId,
    );
    remoteChanged =
      hashContent(remotePageContent.content) !== link.lastSyncedContentHash;
  }
  const localChanged = link.lastSyncedContentHash
    ? hashContent(document.content) !== link.lastSyncedContentHash
    : Boolean(
        !link.lastPushedLocalUpdatedAt ||
        document.updatedAt > link.lastPushedLocalUpdatedAt,
      );

  // Both sides already agree byte-for-byte (e.g. a prior push already landed
  // this exact content and only the baseline metadata was stale) — converge
  // instead of flagging a phantom conflict or re-pushing needlessly.
  if (
    remotePageContent &&
    localChanged &&
    remoteChanged &&
    hashContent(document.content) === hashContent(remotePageContent.content)
  ) {
    await upsertSyncLink({
      owner,
      documentId,
      remotePageId: link.remotePageId,
      state: "linked",
      lastSyncedAt: nowIso(),
      lastPulledRemoteUpdatedAt: remotePageContent.lastEditedTime,
      lastPushedLocalUpdatedAt: document.updatedAt,
      lastKnownRemoteUpdatedAt: remotePageContent.lastEditedTime,
      lastSyncedContentHash: hashContent(document.content),
      lastError: null,
      warnings: remotePageContent.warnings,
      hasConflict: false,
    });
    const convergedLink = await getSyncLink(documentId, owner);
    return buildStatus({
      connected: true,
      documentId,
      link: convergedLink,
      remoteUpdatedAt: remotePageContent.lastEditedTime,
      documentUpdatedAt: document.updatedAt,
      documentContent: document.content,
    });
  }

  if (!force && localChanged && remoteChanged) {
    await upsertSyncLink({
      owner,
      documentId,
      remotePageId: link.remotePageId,
      state: "conflict",
      lastSyncedAt: link.lastSyncedAt,
      lastPulledRemoteUpdatedAt: link.lastPulledRemoteUpdatedAt,
      lastPushedLocalUpdatedAt: link.lastPushedLocalUpdatedAt,
      lastKnownRemoteUpdatedAt: remoteUpdatedAt,
      lastSyncedContentHash: link.lastSyncedContentHash,
      lastError: null,
      warnings: parseWarnings(link),
      hasConflict: true,
    });
    const updatedLink = await getSyncLink(documentId, owner);
    return buildStatus({
      connected: true,
      documentId,
      link: updatedLink,
      remoteUpdatedAt,
      documentUpdatedAt: document.updatedAt,
      documentContent: document.content,
    });
  }

  const remote = await pushDocumentToNotionPage({
    accessToken: connection.accessToken,
    pageId: link.remotePageId,
    title: document.title,
    content: document.content,
    icon: document.icon,
  });

  // Adopt Notion's post-push normalization locally so both sides are
  // byte-identical and the next sync sees no change. For canonical content this
  // is a no-op (the converter matches Notion's emission); it only does work in
  // the rare case Notion normalizes a construct differently, immediately
  // converging instead of ping-ponging. Re-read the row first so a local save
  // that landed during the multi-round-trip push isn't clobbered below.
  const db = getDb();
  const freshDocument = await getDocument(documentId, owner);
  const newContent = remote.content ?? document.content;
  const newTitle = remote.title || document.title;
  const newIcon = remote.icon;
  const contentChanged =
    newTitle !== freshDocument.title ||
    newContent !== freshDocument.content ||
    newIcon !== freshDocument.icon;
  const pushedAt = contentChanged ? nowIso() : freshDocument.updatedAt;
  // Tracks whatever content the `documents` row actually ends up holding, so
  // the baseline hash we persist below is never out of sync with the row —
  // otherwise Notion normalizing anything makes every later status check
  // report a phantom localChanged and burns an extra convergence round-trip.
  // Defaults to the pushed content (the no-op case: the row already holds
  // exactly what we pushed, since contentChanged is false).
  let baselineContent = document.content;
  if (contentChanged) {
    // Compare-and-swap against the pre-push snapshot: if a concurrent save
    // changed the row since `document` was read, skip adopting Notion's
    // normalized content so the newer local edit is never overwritten. The
    // hash baseline is still advanced to the *pushed* content below so the
    // concurrent edit continues to show as localChanged and gets re-pushed on
    // the next sync cycle.
    const applied = await db
      .update(schema.documents)
      .set({
        title: newTitle,
        content: newContent,
        icon: newIcon,
        updatedAt: pushedAt,
      })
      .where(
        and(
          eq(schema.documents.id, documentId),
          eq(schema.documents.ownerEmail, owner),
          eq(schema.documents.updatedAt, document.updatedAt),
        ),
      )
      .returning({ id: schema.documents.id });

    if (applied && applied.length > 0) {
      // The CAS landed — the row now holds Notion's normalized readback, so
      // the baseline must match that, not the pre-push content we sent.
      baselineContent = newContent;
      try {
        await deleteCollabState(documentId);
        releaseDoc(documentId);
      } catch {
        // Non-fatal — the client reconciles via setContent.
      }
    }
    // else: CAS raced and lost — the row holds the concurrent edit's content,
    // not `newContent` and not `document.content`. Keep baselineContent as
    // `document.content` (the pushed content) so the concurrent edit still
    // reads as localChanged next time, per the comment above.
  }

  await upsertSyncLink({
    owner,
    documentId,
    remotePageId: link.remotePageId,
    state: "linked",
    lastSyncedAt: nowIso(),
    lastPulledRemoteUpdatedAt: remote.lastEditedTime,
    lastPushedLocalUpdatedAt: pushedAt,
    lastKnownRemoteUpdatedAt: remote.lastEditedTime,
    lastSyncedContentHash: hashContent(baselineContent),
    lastError: null,
    warnings: remote.warnings,
    hasConflict: false,
  });

  const updatedLink = await getSyncLink(documentId, owner);
  const finalDocument = await getDocument(documentId, owner);
  return buildStatus({
    connected: true,
    documentId,
    link: updatedLink,
    remoteUpdatedAt: remote.lastEditedTime,
    documentUpdatedAt: finalDocument.updatedAt,
    documentContent: finalDocument.content,
  });
}

const lastRefreshAt = new Map<string, number>();
const REFRESH_THROTTLE_MS = 10_000;
// When auto-sync is on, the user has explicitly opted into fast polling so
// downstream Notion changes surface within a couple seconds. We still throttle
// to at most one real Notion request per doc per ~2s to stay well under
// Notion's ~3 req/s per-integration rate limit.
const REFRESH_THROTTLE_AUTO_SYNC_MS = 2_000;

export async function refreshDocumentSyncStatus(
  owner: string,
  documentId: string,
  options?: { autoSync?: boolean },
): Promise<DocumentSyncStatus> {
  // Throttle Notion API calls per document (prevents excessive requests from
  // multiple tabs or rapid polling). Best-effort in serverless environments.
  const throttleMs = options?.autoSync
    ? REFRESH_THROTTLE_AUTO_SYNC_MS
    : REFRESH_THROTTLE_MS;
  const now = Date.now();
  const lastCall = lastRefreshAt.get(documentId) ?? 0;
  if (now - lastCall < throttleMs) {
    const document = await getDocument(documentId, owner);
    const link = await getSyncLink(documentId, owner);
    const connection = await getNotionConnectionForOwner(owner);
    return buildStatus({
      connected: Boolean(connection),
      documentId,
      link,
      documentUpdatedAt: document.updatedAt,
      documentContent: document.content,
    });
  }
  lastRefreshAt.set(documentId, now);

  const status = await getDocumentSyncStatus(owner, documentId);
  if (status.connected && status.pageId && !status.hasConflict) {
    // Only auto-pull/auto-push when the user has explicitly enabled auto-sync.
    // A plain status poll (autoSync off) must never mutate the document — it
    // just reports remoteChanged/localChanged so the UI can offer a manual
    // Pull/Push action. `force: false` lets pull's own re-check (based on a
    // fresh re-read of the row) turn a racing local edit into a conflict
    // instead of silently overwriting it.
    if (options?.autoSync && status.remoteChanged && !status.localChanged) {
      // Best-effort cross-instance claim: multiple browser tabs or
      // serverless instances can reach this branch for the same document at
      // once (the in-process `lastRefreshAt` throttle above only protects a
      // single process). If another instance is already mid-pull for this
      // document, skip this cycle and report the cheap DB-only status
      // instead of starting a second concurrent pull.
      if (await tryClaimSyncLink(documentId, owner)) {
        try {
          // skipClaim: this branch already holds the claim above — letting
          // pullDocumentFromNotion claim again would be a harmless no-op at
          // best, but skipping keeps claim/release paired 1:1 with the code
          // that actually acquired it.
          return await pullDocumentFromNotion(owner, documentId, false, {
            skipClaim: true,
          });
        } finally {
          await releaseSyncLink(documentId, owner);
        }
      }
      return status;
    }
    if (options?.autoSync && status.localChanged && !status.remoteChanged) {
      if (await tryClaimSyncLink(documentId, owner)) {
        try {
          return await pushDocumentToNotion(owner, documentId, false, {
            skipClaim: true,
          });
        } finally {
          await releaseSyncLink(documentId, owner);
        }
      }
      return status;
    }
    // Both sides changed since last sync — mark as conflict so the user can
    // pick which side wins. Take the same per-document claim used by pull/push
    // before persisting that state: a save-triggered push can be between its
    // remote write and baseline update here, making both sides look changed
    // for a few hundred milliseconds. If that push owns the claim, let it
    // finish instead of flashing a conflict that it immediately clears.
    if (status.localChanged && status.remoteChanged) {
      if (!(await tryClaimSyncLink(documentId, owner))) return status;
      try {
        // The competing push may have finished after the status snapshot but
        // before this poll acquired the claim. Re-read the local/link state
        // under the claim so stale change flags cannot recreate the conflict
        // immediately after that push resolved it.
        const document = await getDocument(documentId, owner);
        const link = await getSyncLink(documentId, owner);
        if (link) {
          const claimedStatus = buildStatus({
            connected: true,
            documentId,
            link,
            remoteUpdatedAt: status.lastKnownRemoteUpdatedAt,
            documentUpdatedAt: document.updatedAt,
            documentContent: document.content,
          });
          if (!claimedStatus.localChanged || !claimedStatus.remoteChanged) {
            return claimedStatus;
          }
          let conflictDocument = document;

          // Notion timestamps are only a cheap candidate signal. Confirm the
          // remote content against the authoritative hash baseline before
          // persisting a conflict; our own completed push (or any metadata-only
          // timestamp bump) can otherwise look like a remote content edit.
          if (link.lastSyncedContentHash) {
            const connection = await getNotionConnectionForOwner(owner);
            if (!connection) return claimedStatus;

            let remotePageContent: Awaited<
              ReturnType<typeof readNotionPageAsDocument>
            >;
            try {
              remotePageContent = await readNotionPageAsDocument(
                connection.accessToken,
                link.remotePageId,
              );
            } catch {
              // Fail closed: an unverified timestamp bump is not enough to
              // interrupt editing with a conflict warning.
              return claimedStatus;
            }

            // Local saves do not take the Notion sync claim, so the editor can
            // keep writing while the remote content request is in flight.
            // Classify the conflict against the latest local row.
            const verifiedDocument = await getDocument(documentId, owner);
            conflictDocument = verifiedDocument;
            const baselineHash = link.lastSyncedContentHash;
            const localHash = hashContent(verifiedDocument.content);
            const remoteHash = hashContent(remotePageContent.content);
            const localHashChanged = localHash !== baselineHash;
            const remoteHashChanged = remoteHash !== baselineHash;

            if (localHash === remoteHash) {
              await upsertSyncLink({
                owner,
                documentId,
                remotePageId: link.remotePageId,
                state: "linked",
                lastSyncedAt: nowIso(),
                lastPulledRemoteUpdatedAt: remotePageContent.lastEditedTime,
                lastPushedLocalUpdatedAt: verifiedDocument.updatedAt,
                lastKnownRemoteUpdatedAt: remotePageContent.lastEditedTime,
                lastSyncedContentHash: localHash,
                lastError: null,
                warnings: remotePageContent.warnings,
                hasConflict: false,
              });
              const convergedLink = await getSyncLink(documentId, owner);
              return buildStatus({
                connected: true,
                documentId,
                link: convergedLink,
                remoteUpdatedAt: remotePageContent.lastEditedTime,
                documentUpdatedAt: verifiedDocument.updatedAt,
                documentContent: verifiedDocument.content,
              });
            }

            if (!localHashChanged || !remoteHashChanged) {
              if (options?.autoSync && localHashChanged) {
                return pushDocumentToNotion(owner, documentId, false, {
                  skipClaim: true,
                });
              }
              if (options?.autoSync && remoteHashChanged) {
                return pullDocumentFromNotion(owner, documentId, false, {
                  skipClaim: true,
                });
              }
              return {
                ...claimedStatus,
                localChanged: localHashChanged,
                remoteChanged: remoteHashChanged,
              };
            }
          }

          await upsertSyncLink({
            owner,
            documentId,
            remotePageId: link.remotePageId,
            state: "conflict",
            lastSyncedAt: link.lastSyncedAt,
            lastPulledRemoteUpdatedAt: link.lastPulledRemoteUpdatedAt,
            lastPushedLocalUpdatedAt: link.lastPushedLocalUpdatedAt,
            lastKnownRemoteUpdatedAt: status.lastKnownRemoteUpdatedAt,
            lastSyncedContentHash: link.lastSyncedContentHash,
            lastError: null,
            warnings: parseWarnings(link),
            hasConflict: true,
          });
          const updatedLink = await getSyncLink(documentId, owner);
          return buildStatus({
            connected: true,
            documentId,
            link: updatedLink,
            remoteUpdatedAt: status.lastKnownRemoteUpdatedAt,
            documentUpdatedAt: conflictDocument.updatedAt,
            documentContent: conflictDocument.content,
          });
        }
      } finally {
        await releaseSyncLink(documentId, owner);
      }
    }
  }
  return status;
}

export async function resolveDocumentSyncConflict(
  owner: string,
  documentId: string,
  direction: "pull" | "push",
) {
  // Defense in depth: callers (routes, actions) should already validate this,
  // but treating anything other than the literal "pull" as "push" would make
  // an undefined/typo'd direction silently force-overwrite the Notion page.
  if (direction !== "pull" && direction !== "push") {
    throw new Error('direction must be "pull" or "push"');
  }
  if (direction === "pull") {
    return pullDocumentFromNotion(owner, documentId, true);
  }
  return pushDocumentToNotion(owner, documentId, true);
}

export async function createAndLinkNotionPage(
  owner: string,
  documentId: string,
  parentPageIdOrUrl?: string,
): Promise<DocumentSyncStatus> {
  const connection = await getNotionConnectionForOwner(owner);
  if (!connection) throw new Error("Connect Notion before creating a page.");
  const document = await getDocument(documentId, owner);

  // Idempotency: if the document is already linked, do NOT create another
  // Notion page. Without this check, retrying after a transient failure (or
  // calling create-and-link on an already-linked doc) creates a duplicate
  // page and silently repoints the link, orphaning the previous page. A
  // transient pull failure here must not escape either — the caller may
  // retry, and retrying must stay idempotent rather than surface an error
  // that invites falling back to some other (page-creating) recovery path.
  const existingLink = await getSyncLink(documentId, owner);
  if (existingLink) {
    try {
      return await pullDocumentFromNotion(owner, documentId, true);
    } catch {
      return buildStatus({
        connected: true,
        documentId,
        link: existingLink,
        documentUpdatedAt: document.updatedAt,
        documentContent: document.content,
      });
    }
  }

  let parentId: string;
  if (parentPageIdOrUrl?.trim()) {
    parentId = normalizeNotionPageId(parentPageIdOrUrl);
    try {
      await fetchNotionPage(connection.accessToken, parentId);
    } catch {
      throw new Error(
        "The selected Notion parent page is not accessible. Share that page with the integration or choose another parent.",
      );
    }
  } else {
    const searchResult = await notionFetch<{
      results: Array<{ id: string; object: string }>;
    }>("/search", connection.accessToken, {
      method: "POST",
      body: JSON.stringify({
        filter: { value: "page", property: "object" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: 1,
      }),
    });

    if (!searchResult.results.length) {
      throw new Error(
        "No accessible Notion pages found. Share at least one page with the integration first.",
      );
    }

    parentId = searchResult.results[0].id;
  }

  const newPage = await createNotionPageWithMarkdown({
    accessToken: connection.accessToken,
    parentPageId: parentId,
    title: document.title,
    content: document.content,
    icon: document.icon,
  });

  await upsertSyncLink({
    owner,
    documentId,
    remotePageId: newPage.id,
    state: "linked",
    lastPushedLocalUpdatedAt: document.updatedAt,
    lastSyncedContentHash: hashContent(document.content),
    warnings: [],
    hasConflict: false,
  });

  // Establish the same pulled baseline as linking an existing page. Without a
  // `lastPulledRemoteUpdatedAt`, later Notion edits are never considered remote
  // changes, so create-and-link can look like inbound sync is broken.
  //
  // The page was already created and linked above — if this initial pull
  // fails (e.g. a transient 429/network blip), do NOT let the error escape
  // and invite a retry that would create a second duplicate Notion page.
  // Return a status built from the link we just upserted; the next regular
  // sync cycle will complete the pull.
  try {
    return await pullDocumentFromNotion(owner, documentId, true);
  } catch (error) {
    const link = await getSyncLink(documentId, owner);
    return buildStatus({
      connected: true,
      documentId,
      link,
      documentUpdatedAt: document.updatedAt,
      documentContent: document.content,
    });
  }
}

export async function listNotionLinks(owner: string) {
  const db = getDb();
  const connection = await getNotionConnectionForOwner(owner);
  if (!connection) return [];
  const rows = await db
    .select({
      documentId: schema.documentSyncLinks.documentId,
      remotePageId: schema.documentSyncLinks.remotePageId,
      title: schema.documents.title,
      updatedAt: schema.documents.updatedAt,
      state: schema.documentSyncLinks.state,
      lastSyncedAt: schema.documentSyncLinks.lastSyncedAt,
      hasConflict: schema.documentSyncLinks.hasConflict,
    })
    .from(schema.documentSyncLinks)
    .innerJoin(
      schema.documents,
      eq(schema.documents.id, schema.documentSyncLinks.documentId),
    )
    .where(
      and(
        eq(schema.documentSyncLinks.ownerEmail, owner),
        eq(schema.documents.ownerEmail, owner),
      ),
    );
  return rows;
}
