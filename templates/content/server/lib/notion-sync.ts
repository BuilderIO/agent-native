// @ts-nocheck — Drizzle ORM types from core vs local resolve to different instances
// in pnpm's node_modules. Logic is correct; types just don't unify across instances.
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { canonicalizeNfm } from "../../shared/nfm.js";
import { deleteCollabState, releaseDoc } from "@agent-native/core/collab";
import {
  createNotionPageWithMarkdown,
  fetchNotionPage,
  getNotionConnectionForOwner,
  normalizeNotionPageId,
  notionFetch,
  pushDocumentToNotionPage,
  readNotionPageAsDocument,
} from "./notion.js";
import { getCurrentOwnerEmail } from "./documents.js";
import type { DocumentSyncStatus } from "../../shared/api.js";

type DocumentRow = InferSelectModel<typeof schema.documents>;
type LinkRow = InferSelectModel<typeof schema.documentSyncLinks>;

function nowIso() {
  return new Date().toISOString();
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
    return buildStatus({
      connected: true,
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

export async function pullDocumentFromNotion(
  owner: string,
  documentId: string,
  force = false,
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

  // Content-hash change detection: a side "changed" only if its canonical
  // content actually differs from the last-synced baseline. This is immune to
  // the normalization mismatches and timestamp jitter that previously made
  // every no-op pull look like a fresh edit and drove the drift.
  const localChanged = link.lastSyncedContentHash
    ? hashContent(document.content) !== link.lastSyncedContentHash
    : Boolean(
        link.lastPushedLocalUpdatedAt &&
        document.updatedAt > link.lastPushedLocalUpdatedAt,
      );
  const remoteChanged = link.lastSyncedContentHash
    ? hashContent(pageContent.content) !== link.lastSyncedContentHash
    : Boolean(
        link.lastPulledRemoteUpdatedAt &&
        pageContent.lastEditedTime &&
        pageContent.lastEditedTime > link.lastPulledRemoteUpdatedAt,
      );

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
      documentUpdatedAt: document.updatedAt,
      documentContent: document.content,
    });
  }

  const newTitle = pageContent.title || document.title;
  const newContent = pageContent.content ?? document.content;
  const newIcon = pageContent.icon;
  const contentChanged =
    newTitle !== document.title ||
    newContent !== document.content ||
    newIcon !== document.icon;

  // Only bump documents.updated_at when something actually changed. A no-op
  // pull must not move the local-clock forward, otherwise the next conflict
  // check will mistake the unchanged document for a fresh local edit.
  const updatedAt = contentChanged ? nowIso() : document.updatedAt;
  if (contentChanged) {
    await db
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
        ),
      );

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
  return buildStatus({
    connected: true,
    documentId,
    link: updatedLink,
    remoteUpdatedAt: pageContent.lastEditedTime,
    documentUpdatedAt: updatedAt,
    documentContent: newContent,
  });
}

export async function pushDocumentToNotion(
  owner: string,
  documentId: string,
  force = false,
): Promise<DocumentSyncStatus> {
  const document = await getDocument(documentId, owner);
  const link = await getSyncLink(documentId, owner);
  if (!link) throw new Error("Document is not linked to a Notion page.");
  const connection = await getNotionConnectionForOwner(owner);
  if (!connection) throw new Error("Connect Notion before pushing.");

  const page = await fetchNotionPage(connection.accessToken, link.remotePageId);
  const remoteUpdatedAt = page.last_edited_time || null;
  // Did Notion's content actually change since we last synced? The cheap signal
  // is last_edited_time; with a content baseline we treat any time bump as a
  // candidate remote change (the pulled content below confirms it).
  const remoteChanged = Boolean(
    link.lastKnownRemoteUpdatedAt &&
    remoteUpdatedAt &&
    remoteUpdatedAt > link.lastKnownRemoteUpdatedAt,
  );
  const localChanged = link.lastSyncedContentHash
    ? hashContent(document.content) !== link.lastSyncedContentHash
    : Boolean(
        !link.lastPushedLocalUpdatedAt ||
        document.updatedAt > link.lastPushedLocalUpdatedAt,
      );

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
  // converging instead of ping-ponging.
  const db = getDb();
  const newContent = remote.content ?? document.content;
  const newTitle = remote.title || document.title;
  const newIcon = remote.icon;
  const contentChanged =
    newTitle !== document.title ||
    newContent !== document.content ||
    newIcon !== document.icon;
  const pushedAt = contentChanged ? nowIso() : document.updatedAt;
  if (contentChanged) {
    await db
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
        ),
      );
    try {
      await deleteCollabState(documentId);
      releaseDoc(documentId);
    } catch {
      // Non-fatal — the client reconciles via setContent.
    }
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
    lastSyncedContentHash: hashContent(newContent),
    lastError: null,
    warnings: remote.warnings,
    hasConflict: false,
  });

  const updatedLink = await getSyncLink(documentId, owner);
  return buildStatus({
    connected: true,
    documentId,
    link: updatedLink,
    remoteUpdatedAt: remote.lastEditedTime,
    documentUpdatedAt: pushedAt,
    documentContent: newContent,
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
    if (status.remoteChanged && !status.localChanged) {
      return pullDocumentFromNotion(owner, documentId, true);
    }
    // Only auto-push when the user has explicitly enabled auto-sync
    if (options?.autoSync && status.localChanged && !status.remoteChanged) {
      return pushDocumentToNotion(owner, documentId, true);
    }
    // Both sides changed since last sync — mark as conflict so the user can
    // pick which side wins. Without this, auto-sync silently stalls whenever
    // the user has unpushed local edits AND Notion also changed, and pulls
    // never happen. Matches the conflict handling in pull/pushDocumentToNotion.
    if (status.localChanged && status.remoteChanged) {
      const link = await getSyncLink(documentId, owner);
      if (link) {
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
        const document = await getDocument(documentId, owner);
        const updatedLink = await getSyncLink(documentId, owner);
        return buildStatus({
          connected: true,
          documentId,
          link: updatedLink,
          remoteUpdatedAt: status.lastKnownRemoteUpdatedAt,
          documentUpdatedAt: document.updatedAt,
          documentContent: document.content,
        });
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
  return pullDocumentFromNotion(owner, documentId, true);
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
