// @ts-nocheck — Drizzle ORM types from core vs local resolve to different instances
// in pnpm's node_modules. Logic is correct; types just don't unify across instances.
import crypto from "node:crypto";

import {
  parseIconValue,
  serializeIconValue,
  type IconValue,
} from "@agent-native/core/icons";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import { ensureDocumentFilesMembership } from "../../actions/_content-files.js";
import type { DocumentSyncStatus } from "../../shared/api.js";
import { canonicalizeNfm, nfmToDoc, type PMNode } from "../../shared/nfm.js";
import { getDb, schema } from "../db/index.js";
import { bodyRevisionForContent } from "./document-body-revision.js";
import { nextDocumentUpdatedAt } from "./document-updated-at.js";
import { getCurrentOwnerEmail } from "./documents.js";
import {
  createNotionPageWithMarkdown,
  fetchNotionPage,
  getNotionConnectionForOwner,
  requireNotionConnectionForOwner,
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

function iconAfterNotionSync(
  localIcon: string | null,
  remoteIcon: IconValue | null,
): string | null {
  return parseIconValue(localIcon)?.kind === "library"
    ? localIcon
    : serializeIconValue(remoteIcon);
}

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.randomBytes(size);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

async function replaceDocumentFromExternal(args: {
  document: DocumentRow;
  expectedUpdatedAt: string;
  title: string;
  content: string;
  icon: string | null;
  updatedAt: string;
}): Promise<boolean> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const applied = await tx
      .update(schema.documents)
      .set({
        title: args.title,
        content: args.content,
        bodyRevision: bodyRevisionForContent(args.content),
        icon: args.icon,
        updatedAt: args.updatedAt,
      })
      .where(
        and(
          eq(schema.documents.id, args.document.id),
          eq(schema.documents.ownerEmail, args.document.ownerEmail),
          eq(schema.documents.updatedAt, args.expectedUpdatedAt),
        ),
      )
      .returning({ id: schema.documents.id });

    if (!applied || applied.length === 0) return false;

    if (
      args.title !== args.document.title ||
      args.content !== args.document.content
    ) {
      const versionId = nanoid();
      const checkpointAt = nowIso();
      await tx.insert(schema.documentVersions).values({
        id: versionId,
        ownerEmail: args.document.ownerEmail,
        documentId: args.document.id,
        title: args.document.title,
        content: args.document.content,
        groupId: versionId,
        groupKind: "operation",
        actorKind: "source",
        origin: "notion",
        operation: "sync-notion-document",
        checkpointKind: "before",
        createdAt: checkpointAt,
        updatedAt: checkpointAt,
      });
    }

    return true;
  });
}

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
  if (!args.parent.spaceId) {
    throw new Error("Parent document does not belong to a Content space.");
  }

  let inserted = false;
  try {
    await db.insert(schema.documents).values({
      id,
      spaceId: args.parent.spaceId,
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
    await ensureDocumentFilesMembership(db, id, now);
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
  const connection = await requireNotionConnectionForOwner(
    owner,
    "linking a page",
  );
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
  const link = await getSyncLink(documentId, owner);
  if (!link) throw new Error("Document is not linked to a Notion page.");
  const connection = await requireNotionConnectionForOwner(owner, "pulling");

  const pageContent = await readNotionPageAsDocument(
    connection.accessToken,
    link.remotePageId,
  );

  const freshDocument = await getDocument(documentId, owner);

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
  const newIcon = iconAfterNotionSync(freshDocument.icon, pageContent.icon);
  const contentChanged =
    newTitle !== freshDocument.title ||
    newContent !== freshDocument.content ||
    newIcon !== freshDocument.icon;

  const updatedAt = contentChanged
    ? nextDocumentUpdatedAt(freshDocument.updatedAt)
    : freshDocument.updatedAt;
  if (contentChanged) {
    const applied = await replaceDocumentFromExternal({
      document: freshDocument,
      expectedUpdatedAt: freshDocument.updatedAt,
      title: newTitle,
      content: newContent,
      icon: newIcon,
      updatedAt,
    });

    if (!applied) {
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

    // Keep the Y.Doc intact. The live editor's updatedAt-gated reconcile applies
    // this authoritative SQL snapshot as a minimal Yjs transaction. Deleting
    // collab state here races connected clients (which can re-persist the stale
    // pre-pull state) and briefly makes later flush handshakes miss the editor.
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
  const connection = await requireNotionConnectionForOwner(owner, "pushing");

  const page = await fetchNotionPage(connection.accessToken, link.remotePageId);
  const remoteUpdatedAt = page.last_edited_time || null;
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

  const freshDocument = await getDocument(documentId, owner);
  const newContent = remote.content ?? document.content;
  const newTitle = remote.title || document.title;
  const newIcon = iconAfterNotionSync(freshDocument.icon, remote.icon);
  const contentChanged =
    newTitle !== freshDocument.title ||
    newContent !== freshDocument.content ||
    newIcon !== freshDocument.icon;
  const pushedAt = contentChanged
    ? nextDocumentUpdatedAt(freshDocument.updatedAt)
    : freshDocument.updatedAt;
  let baselineContent = document.content;
  if (contentChanged) {
    const applied = await replaceDocumentFromExternal({
      document: freshDocument,
      expectedUpdatedAt: document.updatedAt,
      title: newTitle,
      content: newContent,
      icon: newIcon,
      updatedAt: pushedAt,
    });

    if (applied) {
      baselineContent = newContent;
      // Preserve the live Y.Doc and let the updatedAt-gated editor reconcile
      // apply this provider-normalized snapshot. Clearing collab persistence
      // here can race a connected client's stale update and resurrect it.
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
const REFRESH_THROTTLE_AUTO_SYNC_MS = 2_000;

export async function refreshDocumentSyncStatus(
  owner: string,
  documentId: string,
  options?: { autoSync?: boolean },
): Promise<DocumentSyncStatus> {
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
    if (options?.autoSync && status.remoteChanged && !status.localChanged) {
      if (await tryClaimSyncLink(documentId, owner)) {
        try {
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
    if (status.localChanged && status.remoteChanged) {
      if (!(await tryClaimSyncLink(documentId, owner))) return status;
      try {
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
              return claimedStatus;
            }

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
  const connection = await requireNotionConnectionForOwner(
    owner,
    "creating a page",
  );
  const document = await getDocument(documentId, owner);

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
