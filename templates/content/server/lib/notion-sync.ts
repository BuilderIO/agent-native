// @ts-nocheck — Drizzle ORM types from core vs local resolve to different instances
// in pnpm's node_modules. Logic is correct; types just don't unify across instances.
import { and, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import {
  createNotionPageWithMarkdown,
  fetchNotionPage,
  getNotionConnectionForOwner,
  normalizeNotionPageId,
  notionFetch,
  pushDocumentToNotionPage,
  readNotionPageAsDocument,
} from "./notion.js";
import type { DocumentSyncStatus } from "../../shared/api.js";

type DocumentRow = InferSelectModel<typeof schema.documents>;
type LinkRow = InferSelectModel<typeof schema.documentSyncLinks>;

function nowIso() {
  return new Date().toISOString();
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
  const localChanged = Boolean(
    localUpdatedAt && lastPushed && localUpdatedAt > lastPushed,
  );

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

async function getDocument(documentId: string) {
  const db = getDb();
  const [document] = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  if (!document) throw new Error("Document not found");
  return document;
}

export async function getSyncLink(documentId: string) {
  const db = getDb();
  const [link] = await db
    .select()
    .from(schema.documentSyncLinks)
    .where(eq(schema.documentSyncLinks.documentId, documentId));
  return link ?? null;
}

async function upsertSyncLink(args: {
  documentId: string;
  remotePageId: string;
  state?: string;
  lastSyncedAt?: string | null;
  lastPulledRemoteUpdatedAt?: string | null;
  lastPushedLocalUpdatedAt?: string | null;
  lastKnownRemoteUpdatedAt?: string | null;
  lastError?: string | null;
  warnings?: string[];
  hasConflict?: boolean;
}) {
  const db = getDb();
  const values = {
    documentId: args.documentId,
    provider: "notion",
    remotePageId: args.remotePageId,
    state: args.state || "linked",
    lastSyncedAt: args.lastSyncedAt ?? null,
    lastPulledRemoteUpdatedAt: args.lastPulledRemoteUpdatedAt ?? null,
    lastPushedLocalUpdatedAt: args.lastPushedLocalUpdatedAt ?? null,
    lastKnownRemoteUpdatedAt: args.lastKnownRemoteUpdatedAt ?? null,
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

export async function unlinkDocumentFromNotion(documentId: string) {
  const db = getDb();
  await db
    .delete(schema.documentSyncLinks)
    .where(eq(schema.documentSyncLinks.documentId, documentId));
}

export async function getDocumentSyncStatus(
  owner: string,
  documentId: string,
): Promise<DocumentSyncStatus> {
  const document = await getDocument(documentId);
  const link = await getSyncLink(documentId);
  const connection = await getNotionConnectionForOwner(owner);
  if (!connection || !link) {
    return buildStatus({
      connected: Boolean(connection),
      documentId,
      link,
      documentUpdatedAt: document.updatedAt,
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
    });
  } catch (error: any) {
    await upsertSyncLink({
      documentId,
      remotePageId: link.remotePageId,
      state: "error",
      lastSyncedAt: link.lastSyncedAt,
      lastPulledRemoteUpdatedAt: link.lastPulledRemoteUpdatedAt,
      lastPushedLocalUpdatedAt: link.lastPushedLocalUpdatedAt,
      lastKnownRemoteUpdatedAt: link.lastKnownRemoteUpdatedAt,
      lastError: error.message || "Failed to load Notion page",
      warnings: parseWarnings(link),
      hasConflict: Boolean(link.hasConflict),
    });
    const next = await getSyncLink(documentId);
    return buildStatus({
      connected: true,
      documentId,
      link: next,
      documentUpdatedAt: document.updatedAt,
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
  await getDocument(documentId);
  const pageId = normalizeNotionPageId(pageIdOrUrl);
  const page = await fetchNotionPage(connection.accessToken, pageId);
  await upsertSyncLink({
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
  const document = await getDocument(documentId);
  const link = await getSyncLink(documentId);
  if (!link) throw new Error("Document is not linked to a Notion page.");
  const connection = await getNotionConnectionForOwner(owner);
  if (!connection) throw new Error("Connect Notion before pulling.");

  const pageContent = await readNotionPageAsDocument(
    connection.accessToken,
    link.remotePageId,
  );

  const localChanged = Boolean(
    link.lastPushedLocalUpdatedAt &&
    document.updatedAt > link.lastPushedLocalUpdatedAt,
  );
  const remoteChanged = Boolean(
    link.lastPulledRemoteUpdatedAt &&
    pageContent.lastEditedTime &&
    pageContent.lastEditedTime > link.lastPulledRemoteUpdatedAt,
  );

  if (!force && localChanged && remoteChanged) {
    await upsertSyncLink({
      documentId,
      remotePageId: link.remotePageId,
      state: "conflict",
      lastSyncedAt: link.lastSyncedAt,
      lastPulledRemoteUpdatedAt: link.lastPulledRemoteUpdatedAt,
      lastPushedLocalUpdatedAt: link.lastPushedLocalUpdatedAt,
      lastKnownRemoteUpdatedAt: pageContent.lastEditedTime,
      lastError: null,
      warnings: pageContent.warnings,
      hasConflict: true,
    });
    const updatedLink = await getSyncLink(documentId);
    return buildStatus({
      connected: true,
      documentId,
      link: updatedLink,
      remoteUpdatedAt: pageContent.lastEditedTime,
      documentUpdatedAt: document.updatedAt,
    });
  }

  const updatedAt = nowIso();
  await db
    .update(schema.documents)
    .set({
      title: pageContent.title || document.title,
      content: pageContent.content ?? document.content,
      icon: pageContent.icon,
      updatedAt,
    })
    .where(eq(schema.documents.id, documentId));

  await upsertSyncLink({
    documentId,
    remotePageId: link.remotePageId,
    state: "linked",
    lastSyncedAt: updatedAt,
    lastPulledRemoteUpdatedAt: pageContent.lastEditedTime,
    lastPushedLocalUpdatedAt: updatedAt,
    lastKnownRemoteUpdatedAt: pageContent.lastEditedTime,
    lastError: null,
    warnings: pageContent.warnings,
    hasConflict: false,
  });

  const updatedLink = await getSyncLink(documentId);
  return buildStatus({
    connected: true,
    documentId,
    link: updatedLink,
    remoteUpdatedAt: pageContent.lastEditedTime,
    documentUpdatedAt: updatedAt,
  });
}

export async function pushDocumentToNotion(
  owner: string,
  documentId: string,
  force = false,
): Promise<DocumentSyncStatus> {
  const document = await getDocument(documentId);
  const link = await getSyncLink(documentId);
  if (!link) throw new Error("Document is not linked to a Notion page.");
  const connection = await getNotionConnectionForOwner(owner);
  if (!connection) throw new Error("Connect Notion before pushing.");

  const page = await fetchNotionPage(connection.accessToken, link.remotePageId);
  const remoteChanged = Boolean(
    link.lastPulledRemoteUpdatedAt &&
    page.last_edited_time &&
    page.last_edited_time > link.lastPulledRemoteUpdatedAt,
  );
  const localChanged = Boolean(
    !link.lastPushedLocalUpdatedAt ||
    document.updatedAt > link.lastPushedLocalUpdatedAt,
  );

  if (!force && localChanged && remoteChanged) {
    await upsertSyncLink({
      documentId,
      remotePageId: link.remotePageId,
      state: "conflict",
      lastSyncedAt: link.lastSyncedAt,
      lastPulledRemoteUpdatedAt: link.lastPulledRemoteUpdatedAt,
      lastPushedLocalUpdatedAt: link.lastPushedLocalUpdatedAt,
      lastKnownRemoteUpdatedAt: page.last_edited_time || null,
      lastError: null,
      warnings: parseWarnings(link),
      hasConflict: true,
    });
    const updatedLink = await getSyncLink(documentId);
    return buildStatus({
      connected: true,
      documentId,
      link: updatedLink,
      remoteUpdatedAt: page.last_edited_time || null,
      documentUpdatedAt: document.updatedAt,
    });
  }

  const remote = await pushDocumentToNotionPage({
    accessToken: connection.accessToken,
    pageId: link.remotePageId,
    title: document.title,
    content: document.content,
    icon: document.icon,
  });

  const pushedAt = nowIso();
  await upsertSyncLink({
    documentId,
    remotePageId: link.remotePageId,
    state: "linked",
    lastSyncedAt: pushedAt,
    lastPulledRemoteUpdatedAt: remote.lastEditedTime,
    lastPushedLocalUpdatedAt: document.updatedAt,
    lastKnownRemoteUpdatedAt: remote.lastEditedTime,
    lastError: null,
    warnings: remote.warnings,
    hasConflict: false,
  });

  const updatedLink = await getSyncLink(documentId);
  return buildStatus({
    connected: true,
    documentId,
    link: updatedLink,
    remoteUpdatedAt: remote.lastEditedTime,
    documentUpdatedAt: document.updatedAt,
  });
}

export async function refreshDocumentSyncStatus(
  owner: string,
  documentId: string,
): Promise<DocumentSyncStatus> {
  const status = await getDocumentSyncStatus(owner, documentId);
  if (
    status.connected &&
    status.pageId &&
    status.remoteChanged &&
    !status.localChanged &&
    !status.hasConflict
  ) {
    return pullDocumentFromNotion(owner, documentId, true);
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
): Promise<DocumentSyncStatus> {
  const connection = await getNotionConnectionForOwner(owner);
  if (!connection) throw new Error("Connect Notion before creating a page.");
  const document = await getDocument(documentId);

  // Find a parent page — search for any page the user has access to
  const searchResult = await notionFetch<{
    results: Array<{ id: string; object: string }>;
  }>("/search", connection.accessToken, {
    method: "POST",
    body: JSON.stringify({
      filter: { value: "page", property: "object" },
      page_size: 1,
    }),
  });

  if (!searchResult.results.length) {
    throw new Error(
      "No accessible Notion pages found. Share at least one page with the integration first.",
    );
  }

  const parentId = searchResult.results[0].id;

  const newPage = await createNotionPageWithMarkdown({
    accessToken: connection.accessToken,
    parentPageId: parentId,
    title: document.title,
    content: document.content,
    icon: document.icon,
  });

  await upsertSyncLink({
    documentId,
    remotePageId: newPage.id,
    state: "linked",
    lastKnownRemoteUpdatedAt: null,
    warnings: [],
    hasConflict: false,
  });

  return refreshDocumentSyncStatus(owner, documentId);
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
    );
  return rows;
}
