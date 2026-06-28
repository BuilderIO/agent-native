import { writeAppState } from "@agent-native/core/application-state";
import { resolveBuilderCredential } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { ROLE_RANK, resolveAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { BUILDER_CMS_SAFE_WRITE_MODEL } from "../shared/api.js";
import {
  builderSourceKindForModel,
  builderSourceRootPath,
  BUILDER_DOCS_MDX_SOURCE_MODE,
  modelFromBuilderSourceKind,
  parseBuilderSourceRootPath,
} from "../shared/builder-docs-blocks.js";
import {
  builderBlocksHash,
  builderEntryToMdxBundle,
  builderEntryBlocks,
  builderMdxToBuilderBlocks,
  builderRawRootForEntry,
  builderSourceHash,
  normalizeRemoteUpdatedAt,
  parseBuilderMdxFile,
  stableHash,
  type BuilderContentEntry,
  type BuilderMdxBundle,
  type BuilderMdxFile,
} from "../shared/builder-mdx.js";
import type { BuilderCmsReadResult } from "./_builder-cms-read-client.js";
import {
  normalizeBuilderCmsApiEntry,
  type BuilderCmsSourceEntry,
} from "./_builder-cms-source-adapter.js";
import { executeBuilderCmsWrite } from "./_builder-cms-write-client.js";
import { flushOpenDocumentEditorToSql } from "./_document-flush.js";

type FetchLike = typeof fetch;

export interface BuilderDocsFilesInput {
  path?: string | null;
  files?: Record<string, string> | null;
}

export interface BuilderDocsResolvedSource {
  mdx: BuilderMdxFile;
  sidecars: Record<string, string>;
}

export interface BuilderDocsCheckResult {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  metadata: BuilderMdxFile["metadata"];
  localBlocksHash?: string;
  remoteBlocksHash?: string;
  remoteLastUpdated?: string;
  remoteSourceHash?: string;
}

const BUILDER_DOCS_LIST_LIMIT = 1000;

type BuilderMcpContentPart = {
  type?: string;
  text?: string;
};

type BuilderMcpToolResult = {
  content?: BuilderMcpContentPart[];
};

async function readBuilderPrivateKey() {
  return (
    (await resolveBuilderCredential("BUILDER_PRIVATE_KEY")) ??
    (await resolveBuilderCredential("BUILDER_CMS_PRIVATE_KEY"))
  );
}

async function readBuilderPublicKey() {
  return await resolveBuilderCredential("BUILDER_PUBLIC_KEY");
}

async function requireBuilderDocsPrivateKey() {
  const privateKey = await readBuilderPrivateKey();
  if (!privateKey) {
    throw new Error(
      "Builder docs MDX sync requires a Builder private credential scoped to the current user/org.",
    );
  }
  return privateKey;
}

function builderMcpEndpoint() {
  return (
    process.env.BUILDER_CMS_MCP_ENDPOINT ??
    "https://cdn.builder.io/api/v1/mcp/builder-content"
  ).replace(/\/+$/, "");
}

function builderContentApiHost() {
  return (
    process.env.BUILDER_CONTENT_API_HOST ??
    process.env.BUILDER_CMS_API_HOST ??
    "https://cdn.builder.io"
  ).replace(/\/+$/, "");
}

function entryArrayFromResponse(value: unknown) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return Array.isArray(record.results) ? record.results : [];
}

function normalizeFullBuilderEntry(
  value: unknown,
  model: string,
): BuilderContentEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id =
    typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : typeof record["@id"] === "string" && record["@id"].trim()
        ? record["@id"].trim()
        : "";
  if (!id) return null;
  const data =
    record.data &&
    typeof record.data === "object" &&
    !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : {};
  return {
    ...record,
    id,
    model,
    data,
    name: typeof record.name === "string" ? record.name : undefined,
    published:
      typeof record.published === "string" ? record.published : undefined,
    lastUpdated:
      typeof record.lastUpdated === "string" ||
      typeof record.lastUpdated === "number"
        ? record.lastUpdated
        : undefined,
  };
}

function parseBuilderMcpToolJson(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const result = value as BuilderMcpToolResult;
  const text = result.content
    ?.filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n");
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function postBuilderMcp(args: {
  endpoint: string;
  privateKey: string;
  payload: Record<string, unknown>;
  sessionId?: string | null;
  fetchImpl: FetchLike;
}) {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${args.privateKey}`,
    "content-type": "application/json",
  };
  if (args.sessionId) headers["mcp-session-id"] = args.sessionId;
  const response = await args.fetchImpl(args.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(args.payload),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Builder MCP request failed with HTTP ${response.status}.`);
  }
  return {
    json: JSON.parse(text) as Record<string, unknown>,
    sessionId: response.headers.get("mcp-session-id"),
  };
}

async function initializeBuilderMcp(args: {
  endpoint: string;
  privateKey: string;
  fetchImpl: FetchLike;
}) {
  const initialized = await postBuilderMcp({
    endpoint: args.endpoint,
    privateKey: args.privateKey,
    fetchImpl: args.fetchImpl,
    payload: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "agent-native-content-builder-mdx",
          version: "0.1.0",
        },
      },
    },
  });
  const sessionId = initialized.sessionId;
  if (sessionId) {
    await postBuilderMcp({
      endpoint: args.endpoint,
      privateKey: args.privateKey,
      fetchImpl: args.fetchImpl,
      sessionId,
      payload: {
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      },
    }).catch(() => null);
  }
  return sessionId;
}

function fullEntryFromToolResponse(value: unknown, model: string) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const entries =
    (Array.isArray(record.content) && record.content) ||
    (Array.isArray(record.results) && record.results) ||
    [];
  return (
    entries
      .map((entry) => normalizeFullBuilderEntry(entry, model))
      .find((entry): entry is BuilderContentEntry => Boolean(entry)) ?? null
  );
}

async function readBuilderDocsPublishedEntries(args: {
  model: string;
  limit: number;
  fetchImpl: FetchLike;
}): Promise<BuilderCmsReadResult> {
  const fetchedAt = new Date().toISOString();
  const publicKey = await readBuilderPublicKey();
  if (!publicKey) {
    return {
      state: "unconfigured",
      entries: [],
      fetchedAt,
      message:
        "Builder docs list skipped because BUILDER_PUBLIC_KEY is not configured.",
    };
  }

  const url = new URL(
    `/api/v3/content/${encodeURIComponent(args.model)}`,
    builderContentApiHost(),
  );
  url.searchParams.set("apiKey", publicKey);
  url.searchParams.set("limit", String(args.limit));
  url.searchParams.set("enrich", "true");
  url.searchParams.set("noCache", "true");

  let response: Response;
  try {
    response = await args.fetchImpl(url, {
      headers: { accept: "application/json" },
    });
  } catch (error) {
    return {
      state: "error",
      entries: [],
      fetchedAt,
      message:
        error instanceof Error
          ? `Builder docs list failed: ${error.message}`
          : "Builder docs list failed.",
    };
  }

  if (!response.ok) {
    return {
      state: "error",
      entries: [],
      fetchedAt,
      message: `Builder docs list failed with HTTP ${response.status}.`,
    };
  }

  const json = (await response.json()) as unknown;
  return {
    state: "live",
    entries: entryArrayFromResponse(json)
      .map((entry) => normalizeBuilderCmsApiEntry(entry, args.model))
      .filter((entry): entry is BuilderCmsSourceEntry => Boolean(entry)),
    fetchedAt,
    message: null,
  };
}

async function readFullBuilderDocsEntryViaMcp(args: {
  model: string;
  entryId: string;
  fetchImpl: FetchLike;
  privateKey: string;
}) {
  const endpoint = builderMcpEndpoint();
  const sessionId = await initializeBuilderMcp({
    endpoint,
    privateKey: args.privateKey,
    fetchImpl: args.fetchImpl,
  });
  const result = await postBuilderMcp({
    endpoint,
    privateKey: args.privateKey,
    fetchImpl: args.fetchImpl,
    sessionId,
    payload: {
      jsonrpc: "2.0",
      id: `builder-mdx-${args.model}-${args.entryId}`,
      method: "tools/call",
      params: {
        name: "get_builder_content",
        arguments: {
          modelName: args.model,
          limit: 1,
          query: { id: args.entryId },
          enrich: true,
          returnFullContent: true,
        },
      },
    },
  });
  const contentJson = parseBuilderMcpToolJson(result.json.result);
  const entry = fullEntryFromToolResponse(contentJson, args.model);
  if (!entry) {
    throw new Error(
      `Builder entry ${args.model}/${args.entryId} was not found.`,
    );
  }
  return entry;
}

export async function listBuilderDocsEntries(args: {
  model: string;
  limit?: number;
  fetchImpl?: FetchLike;
}) {
  return await readBuilderDocsPublishedEntries({
    model: args.model,
    limit: Math.min(
      args.limit ?? BUILDER_DOCS_LIST_LIMIT,
      BUILDER_DOCS_LIST_LIMIT,
    ),
    fetchImpl: args.fetchImpl ?? fetch,
  });
}

export async function readFullBuilderDocsEntry(args: {
  model: string;
  entryId: string;
  fetchImpl?: FetchLike;
}): Promise<BuilderContentEntry> {
  const privateKey = await requireBuilderDocsPrivateKey();
  const fetchImpl = args.fetchImpl ?? fetch;

  return await readFullBuilderDocsEntryViaMcp({
    model: args.model,
    entryId: args.entryId,
    fetchImpl,
    privateKey,
  });
}

function canEditRole(role: string | null | undefined) {
  return (
    !!role && ROLE_RANK[role as keyof typeof ROLE_RANK] >= ROLE_RANK.editor
  );
}

function scopedBuilderDocumentId(args: {
  ownerEmail: string;
  orgId: string | null;
  model: string;
  entryId: string;
}) {
  return `builder_doc_${stableHash(args).slice(0, 24)}`;
}

function withBuilderDocumentId(
  bundle: BuilderMdxBundle,
  documentId: string,
): BuilderMdxBundle {
  if (bundle.mdx.documentId === documentId) return bundle;
  const source = bundle.mdx.source.replace(
    /^id: .+$/m,
    `id: ${JSON.stringify(documentId)}`,
  );
  return {
    ...bundle,
    mdx: {
      ...bundle.mdx,
      documentId,
      frontmatter: {
        ...bundle.mdx.frontmatter,
        id: documentId,
      },
      source,
    },
    files: {
      ...bundle.files,
      [bundle.mdx.path]: source,
    },
  };
}

function builderDocumentSourceFields(bundle: BuilderMdxBundle, now: string) {
  return {
    sourceMode: BUILDER_DOCS_MDX_SOURCE_MODE,
    sourceKind: builderSourceKindForModel(bundle.mdx.metadata.model),
    sourcePath: bundle.mdx.path,
    sourceRootPath: builderSourceRootPath({
      entryId: bundle.mdx.metadata.entryId,
      sourceHash: bundle.mdx.metadata.sourceHash,
      blocksHash: bundle.mdx.metadata.blocksHash,
    }),
    sourceUpdatedAt: bundle.mdx.metadata.lastUpdated ?? now,
  };
}

async function findBuilderDocumentBySource(args: {
  ownerEmail: string;
  orgId: string | null;
  model: string;
  entryId: string;
}) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.ownerEmail, args.ownerEmail),
        args.orgId
          ? eq(schema.documents.orgId, args.orgId)
          : isNull(schema.documents.orgId),
        eq(schema.documents.sourceMode, BUILDER_DOCS_MDX_SOURCE_MODE),
        eq(schema.documents.sourceKind, builderSourceKindForModel(args.model)),
      ),
    );
  return (
    rows.find((row) => {
      const parsed = parseBuilderSourceRootPath(row.sourceRootPath);
      return parsed?.entryId === args.entryId;
    }) ?? null
  );
}

export async function pullBuilderDocIntoContent(args: {
  model: string;
  entryId: string;
  dryRun?: boolean;
  fetchImpl?: FetchLike;
}): Promise<{
  dryRun: boolean;
  documentId: string;
  created: boolean;
  updated: boolean;
  bundle: BuilderMdxBundle;
}> {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) throw new Error("no authenticated user");
  const orgId = getRequestOrgId() ?? null;
  const db = getDb();
  const entry = await readFullBuilderDocsEntry({
    model: args.model,
    entryId: args.entryId,
    fetchImpl: args.fetchImpl,
  });
  const pulledBundle = await builderEntryToMdxBundle(entry);
  const now = new Date().toISOString();
  const existingBySource = await findBuilderDocumentBySource({
    ownerEmail,
    orgId,
    model: args.model,
    entryId: args.entryId,
  });
  const documentId =
    existingBySource?.id ??
    scopedBuilderDocumentId({
      ownerEmail,
      orgId,
      model: args.model,
      entryId: args.entryId,
    });
  const bundle = withBuilderDocumentId(pulledBundle, documentId);
  const access = await resolveAccess("document", documentId);
  const existing = access?.resource ?? existingBySource;
  const existingRole = access?.role ?? (existingBySource ? "owner" : null);
  if (existing && !canEditRole(existingRole)) {
    throw new Error(
      `Requires editor access to update document "${documentId}".`,
    );
  }

  const sourceFields = builderDocumentSourceFields(bundle, now);

  if (!args.dryRun) {
    if (existing) {
      await db
        .update(schema.documents)
        .set({
          title: bundle.mdx.title,
          content: bundle.mdx.body,
          updatedAt: now,
          ...sourceFields,
        })
        .where(eq(schema.documents.id, documentId));
    } else {
      await db.insert(schema.documents).values({
        id: documentId,
        ownerEmail,
        orgId,
        parentId: null,
        title: bundle.mdx.title,
        content: bundle.mdx.body,
        icon: null,
        position: 0,
        isFavorite: 0,
        hideFromSearch: 0,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
        ...sourceFields,
      });
    }
    await replaceBuilderDocumentSidecars({
      db,
      documentId,
      ownerEmail,
      orgId,
      sidecars: sidecarsFromFiles(bundle.files),
      now,
    });
    await writeAppState("refresh-signal", { ts: Date.now() });
  }

  return {
    dryRun: !!args.dryRun,
    documentId,
    created: !existing && !args.dryRun,
    updated: !!existing && !args.dryRun,
    bundle,
  };
}

function singleBuilderMdxPath(
  files: Record<string, string>,
  explicit?: string | null,
) {
  if (explicit) {
    if (!Object.prototype.hasOwnProperty.call(files, explicit)) {
      throw new Error(`Builder MDX file not found in files map: ${explicit}`);
    }
    return explicit;
  }
  const candidates = Object.keys(files).filter((path) =>
    path.endsWith(".builder.mdx"),
  );
  if (candidates.length !== 1) {
    throw new Error("Provide exactly one .builder.mdx file or pass --path.");
  }
  return candidates[0];
}

function sidecarsFromFiles(files: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(files).filter(
      ([path]) =>
        path.includes("/.raw/") &&
        path.endsWith(".json") &&
        !path.includes("\0"),
    ),
  );
}

function builderSidecarId(documentId: string, path: string) {
  return `builder_sidecar_${stableHash({ documentId, path }).slice(0, 24)}`;
}

async function replaceBuilderDocumentSidecars(args: {
  db: ReturnType<typeof getDb>;
  documentId: string;
  ownerEmail: string;
  orgId: string | null;
  sidecars: Record<string, string>;
  now: string;
}) {
  await args.db
    .delete(schema.builderDocSidecars)
    .where(
      and(
        eq(schema.builderDocSidecars.documentId, args.documentId),
        eq(schema.builderDocSidecars.ownerEmail, args.ownerEmail),
      ),
    );

  const rows = Object.entries(args.sidecars).map(([path, content]) => ({
    id: builderSidecarId(args.documentId, path),
    ownerEmail: args.ownerEmail,
    orgId: args.orgId,
    documentId: args.documentId,
    path,
    content,
    contentHash: stableHash(content),
    createdAt: args.now,
    updatedAt: args.now,
  }));
  if (rows.length > 0) {
    await args.db.insert(schema.builderDocSidecars).values(rows);
  }
}

async function refreshBuilderDocumentAfterPush(args: {
  documentId: string;
  entry: BuilderContentEntry;
}): Promise<BuilderMdxBundle> {
  const access = await resolveAccess("document", args.documentId);
  if (!access || !canEditRole(access.role)) {
    throw new Error(`Requires editor access to document "${args.documentId}".`);
  }
  const document = access.resource as {
    id: string;
    ownerEmail?: string | null;
    orgId?: string | null;
  };
  const ownerEmail = document.ownerEmail ?? getRequestUserEmail();
  if (!ownerEmail) {
    throw new Error(`Document "${args.documentId}" is missing owner metadata.`);
  }
  const orgId = document.orgId ?? getRequestOrgId() ?? null;
  const now = new Date().toISOString();
  const db = getDb();
  const bundle = withBuilderDocumentId(
    await builderEntryToMdxBundle(args.entry),
    args.documentId,
  );

  await db
    .update(schema.documents)
    .set({
      title: bundle.mdx.title,
      content: bundle.mdx.body,
      updatedAt: now,
      ...builderDocumentSourceFields(bundle, now),
    })
    .where(eq(schema.documents.id, args.documentId));
  await replaceBuilderDocumentSidecars({
    db,
    documentId: args.documentId,
    ownerEmail,
    orgId,
    sidecars: sidecarsFromFiles(bundle.files),
    now,
  });
  await writeAppState("refresh-signal", { ts: Date.now() });
  return bundle;
}

async function readBuilderDocumentSidecars(documentId: string) {
  const db = getDb();
  const rows = await db
    .select({
      path: schema.builderDocSidecars.path,
      content: schema.builderDocSidecars.content,
      contentHash: schema.builderDocSidecars.contentHash,
    })
    .from(schema.builderDocSidecars)
    .where(eq(schema.builderDocSidecars.documentId, documentId));
  const sidecars: Record<string, string> = {};
  for (const row of rows) {
    const actualHash = stableHash(row.content);
    if (actualHash !== row.contentHash) {
      throw new Error(
        `Builder raw sidecar cache hash mismatch for ${row.path}: expected ${row.contentHash}, got ${actualHash}.`,
      );
    }
    sidecars[row.path] = row.content;
  }
  return sidecars;
}

async function getDocumentMdxSource(
  documentId: string,
): Promise<BuilderDocsResolvedSource> {
  const access = await resolveAccess("document", documentId);
  if (!access || !canEditRole(access.role)) {
    throw new Error(`Requires editor access to document "${documentId}".`);
  }
  await flushOpenDocumentEditorToSql({
    documentId,
    ownerEmail: (access.resource.ownerEmail as string | undefined) || null,
  });
  const freshAccess = await resolveAccess("document", documentId);
  if (!freshAccess || !canEditRole(freshAccess.role)) {
    throw new Error(`Requires editor access to document "${documentId}".`);
  }
  const document = freshAccess.resource as {
    id: string;
    title: string;
    content: string;
    sourceMode?: string | null;
    sourceKind?: string | null;
    sourcePath?: string | null;
    sourceRootPath?: string | null;
    sourceUpdatedAt?: string | null;
  };
  if (document.sourceMode !== BUILDER_DOCS_MDX_SOURCE_MODE) {
    throw new Error(`Document "${documentId}" is not a Builder MDX document.`);
  }
  const model = modelFromBuilderSourceKind(document.sourceKind);
  const sourceRoot = parseBuilderSourceRootPath(document.sourceRootPath);
  if (!model || !sourceRoot) {
    throw new Error(
      `Document "${documentId}" is missing Builder source metadata.`,
    );
  }
  if (!sourceRoot.blocksHash) {
    throw new Error(
      `Document "${documentId}" is missing Builder blocksHash metadata. Pull the Builder entry again before checking or pushing.`,
    );
  }
  const sourceHash = sourceRoot.sourceHash;
  const metadata = {
    model,
    entryId: sourceRoot.entryId,
    lastUpdated: document.sourceUpdatedAt ?? undefined,
    sourceHash,
    blocksHash: sourceRoot.blocksHash,
    rawRoot: builderRawRootForEntry(model, sourceRoot.entryId),
    path: document.sourcePath ?? "",
  };
  const frontmatter = {
    id: document.id,
    title: document.title,
    builder: metadata,
  };
  const source = `---\nid: ${JSON.stringify(document.id)}\ntitle: ${JSON.stringify(
    document.title,
  )}\nbuilder: ${JSON.stringify(metadata)}\n---\n\n${document.content}`;
  return {
    mdx: {
      path: document.sourcePath ?? "",
      documentId: document.id,
      title: document.title,
      metadata,
      frontmatter,
      body: document.content,
      source,
    },
    sidecars: await readBuilderDocumentSidecars(document.id),
  };
}

export async function resolveBuilderDocsSource(args: {
  documentId?: string | null;
  path?: string | null;
  files?: Record<string, string> | null;
}): Promise<BuilderDocsResolvedSource> {
  if (args.files && Object.keys(args.files).length > 0) {
    const path = singleBuilderMdxPath(args.files, args.path);
    return {
      mdx: parseBuilderMdxFile(path, args.files[path]),
      sidecars: sidecarsFromFiles(args.files),
    };
  }
  if (args.documentId) {
    return await getDocumentMdxSource(args.documentId);
  }
  throw new Error("Provide either --files or --documentId.");
}

export async function checkBuilderDocsSource(args: {
  documentId?: string | null;
  path?: string | null;
  files?: Record<string, string> | null;
  fetchImpl?: FetchLike;
}): Promise<BuilderDocsCheckResult> {
  const resolved = await resolveBuilderDocsSource(args);
  const blockers: string[] = [];
  const warnings: string[] = [];
  let localBlocksHash: string | undefined;
  try {
    const local = await builderMdxToBuilderBlocks({
      path: resolved.mdx.path,
      source: resolved.mdx.source,
      sidecars: resolved.sidecars,
    });
    localBlocksHash = local.blocksHash;
  } catch (error) {
    blockers.push(
      error instanceof Error ? error.message : "Could not parse Builder MDX.",
    );
  }

  const remote = await readFullBuilderDocsEntry({
    model: resolved.mdx.metadata.model,
    entryId: resolved.mdx.metadata.entryId,
    fetchImpl: args.fetchImpl,
  });
  const remoteLastUpdated = normalizeRemoteUpdatedAt(remote);
  const remoteSourceHash = builderSourceHash(remote);
  const remoteBlocksHash = builderBlocksHash(builderEntryBlocks(remote));

  if (
    resolved.mdx.metadata.lastUpdated &&
    remoteLastUpdated &&
    resolved.mdx.metadata.lastUpdated !== remoteLastUpdated
  ) {
    blockers.push(
      `Remote Builder entry changed since pull (${resolved.mdx.metadata.lastUpdated} -> ${remoteLastUpdated}). Pull again before pushing.`,
    );
  } else if (
    resolved.mdx.metadata.sourceHash &&
    remoteSourceHash !== resolved.mdx.metadata.sourceHash
  ) {
    blockers.push("Remote Builder source hash changed since pull.");
  }
  if (
    resolved.mdx.metadata.blocksHash &&
    remoteBlocksHash !== resolved.mdx.metadata.blocksHash
  ) {
    blockers.push("Remote Builder blocks changed since pull.");
  }

  if (Object.keys(resolved.sidecars).length === 0) {
    warnings.push(
      "No raw sidecars were available; push will be blocked for existing Builder blocks.",
    );
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    metadata: resolved.mdx.metadata,
    localBlocksHash,
    remoteBlocksHash,
    remoteLastUpdated,
    remoteSourceHash,
  };
}

export async function pushBuilderDocsSource(args: {
  documentId?: string | null;
  path?: string | null;
  files?: Record<string, string> | null;
  dryRun?: boolean;
  fetchImpl?: FetchLike;
}) {
  const check = await checkBuilderDocsSource(args);
  const resolved = await resolveBuilderDocsSource(args);
  if (resolved.mdx.metadata.model !== BUILDER_CMS_SAFE_WRITE_MODEL) {
    check.blockers.push(
      `Live Builder docs pushes are currently allowed only for ${BUILDER_CMS_SAFE_WRITE_MODEL}.`,
    );
  }
  if (check.blockers.length > 0) {
    return {
      dryRun: !!args.dryRun,
      executed: false,
      check: { ...check, ok: false },
      writeResult: null,
    };
  }

  const local = await builderMdxToBuilderBlocks({
    path: resolved.mdx.path,
    source: resolved.mdx.source,
    sidecars: resolved.sidecars,
  });
  const request = {
    method: "PATCH" as const,
    path: `/api/v1/write/${encodeURIComponent(
      resolved.mdx.metadata.model,
    )}/${encodeURIComponent(resolved.mdx.metadata.entryId)}`,
    query: {
      autoSaveOnly: "true",
      triggerWebhooks: "false",
    },
    body: {
      data: {
        blocksString: JSON.stringify(local.blocks),
      },
    },
  };

  if (args.dryRun ?? true) {
    return {
      dryRun: true,
      executed: false,
      check,
      request,
      writeResult: null,
    };
  }

  const writeResult = await executeBuilderCmsWrite({
    request,
    fetchImpl: args.fetchImpl,
  });
  const refreshedDocument =
    writeResult.ok && args.documentId
      ? await refreshBuilderDocumentAfterPush({
          documentId: args.documentId,
          entry: await readFullBuilderDocsEntry({
            model: resolved.mdx.metadata.model,
            entryId: resolved.mdx.metadata.entryId,
            fetchImpl: args.fetchImpl,
          }),
        })
      : null;
  return {
    dryRun: false,
    executed: writeResult.ok,
    check,
    request,
    writeResult,
    refreshedDocument: refreshedDocument
      ? {
          documentId: refreshedDocument.mdx.documentId,
          metadata: refreshedDocument.mdx.metadata,
          sidecarCount: Object.keys(sidecarsFromFiles(refreshedDocument.files))
            .length,
        }
      : null,
  };
}
