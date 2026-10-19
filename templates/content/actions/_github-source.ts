import { createHash, randomUUID } from "node:crypto";

import {
  ActionContractError,
  isAgentConnectionRequiredError,
} from "@agent-native/core/action";
import {
  getActiveFileUploadProviderForRequest,
  uploadFile,
} from "@agent-native/core/file-upload";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { bodyRevisionForContent } from "../server/lib/document-body-revision.js";
import { recordDocumentHistoryTransition } from "../server/lib/document-history.js";
import {
  GitHubSourceDeadlineError,
  GitHubSourceError,
  readGitHubBlob,
  readGitHubBranchHead,
  readGitHubDefaultBranch,
  readGitHubFolderTree,
  readGitHubRenames,
  type GitHubTreeEntry,
} from "../server/lib/github-source-client.js";
import {
  classifyGitHubSourceFile,
  fitsGitHubFieldType,
  GITHUB_SOURCE_MAX_FILES,
  GITHUB_SOURCE_MAX_IMAGE_BYTES,
  GITHUB_SOURCE_TYPE,
  githubBranchCandidates,
  githubFieldPropertyInput,
  githubFolderLabel,
  githubFolderWebUrl,
  githubRepoPath,
  githubSourceTable,
  inferGitHubFieldType,
  normalizeGitHubFolderPath,
  parseGitHubFolderUrl,
  type GitHubFieldType,
  type GitHubFolderLocation,
  type GitHubFolderPreview,
  type GitHubSourceProblemCode,
  type GitHubSourceSkipReason,
} from "../shared/github-source.js";
import { finalizeMarkdownImport } from "../shared/import/finalize.js";
import {
  newTablePaddingBudget,
  parseMarkdownImport,
  type MarkdownImportDraft,
} from "../shared/import/markdown.js";
import {
  dataUrlBytes,
  importImageMediaType,
  isImportImageMediaType,
  MAX_IMPORT_PAGE_CHARACTERS,
} from "../shared/import/plan.js";
import type {
  ImportAssetRequest,
  ImportAssetResolution,
} from "../shared/import/types.js";
import {
  defaultPropertyOptions,
  normalizePropertyValueWithOptions,
  parsePropertyOptions,
  serializePropertyOptions,
  serializePropertyValue,
  type DocumentPropertyOptionColor,
  type DocumentPropertyOptions,
} from "../shared/properties.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import { ensureDocumentsFilesMembership } from "./_content-files.js";
import { mutateContentDatabaseSourceMetadata } from "./_database-source-utils.js";
import {
  githubSourceCapabilities,
  githubSourceId,
  githubSourceMetadataRecord,
  readGitHubSourceState,
  rememberedSkips,
  type GitHubSourceState,
} from "./_github-source-metadata.js";
import {
  databaseItemsPositionScope,
  documentsPositionScope,
  nextAppendPosition,
  withPositionLock,
} from "./_position-utils.js";
import { nanoid } from "./_property-utils.js";
import { trashDocumentSubtree } from "./delete-document.js";

type Db = ReturnType<typeof getDb>;
type DatabaseRow = typeof schema.contentDatabases.$inferSelect;
type DocumentRow = typeof schema.documents.$inferSelect;
type SourceRow = typeof schema.contentDatabaseSourceRows.$inferSelect;

export const GITHUB_SYNC_OPERATION = "sync-github-source";
/** How long a running sync holds its lease; longer than any sync's budget. */
const SYNC_LEASE_MS = 2 * 60 * 1000;
/** Files previewed before linking, enough to see the frontmatter's shape. */
const PREVIEW_SAMPLE_FILES = 25;
const PREVIEW_READ_CONCURRENCY = 5;
/** Reserved key in a source row's values for the sync's own bookkeeping. */
const ROW_STATE_KEY = "$github";

const OPTION_COLORS: DocumentPropertyOptionColor[] = [
  "blue",
  "green",
  "purple",
  "pink",
  "orange",
  "yellow",
  "red",
  "gray",
];

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function opaqueId(kind: string, value: string) {
  return `${kind}_${hash(value).slice(0, 32)}`;
}

/** Only sync writes these columns, so bad JSON is corruption and throws. */
function parseJsonObject(value: string | null | undefined) {
  if (!value) return {} as Record<string, unknown>;
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/** Runs GitHub reads as the person who linked the folder. */
async function asLinker<T>(
  state: Pick<GitHubSourceState, "linkedBy">,
  orgId: string | null,
  run: () => Promise<T>,
): Promise<T> {
  return await runWithRequestContext(
    { userEmail: state.linkedBy, orgId: orgId ?? undefined },
    run,
  );
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index]!);
      }
    }),
  );
  return results;
}

function decodeText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // coercion-ok: null means not UTF-8, and the caller skips the file as "not-text".
  } catch {
    return null;
  }
}

export interface GitHubFolderLinkInput {
  url?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  path?: string;
  connectionId?: string | null;
}

export interface ResolvedGitHubFolder {
  location: GitHubFolderLocation;
  commitSha: string;
  etag: string | null;
}

function invalidInput(message: string): never {
  throw new ActionContractError(message, {
    errorCode: "INVALID_GITHUB_FOLDER",
    statusCode: 400,
  });
}

const PROBLEM_STATUS: Record<GitHubSourceProblemCode, number> = {
  connection: 401,
  forbidden: 403,
  repository_not_found: 404,
  branch_not_found: 404,
  folder_not_found: 404,
  rate_limited: 429,
  too_large: 413,
  unavailable: 502,
  storage_unavailable: 503,
};

/** Gives a GitHub read failure the error code and status agents act on. */
export function githubActionError(error: unknown): unknown {
  if (!(error instanceof GitHubSourceError)) return error;
  return new ActionContractError(error.message, {
    errorCode: `GITHUB_${error.code.toUpperCase()}`,
    statusCode: PROBLEM_STATUS[error.code],
  });
}

/**
 * Settles a pasted URL (or explicit parts) into one branch and folder, trying
 * the ways a `/tree/` path can split until GitHub knows the branch.
 */
export async function resolveGitHubFolder(
  input: GitHubFolderLinkInput,
): Promise<ResolvedGitHubFolder> {
  let owner = input.owner?.trim();
  let repo = input.repo?.trim();
  let candidates: Array<{ branch: string; path: string }> = [];
  if (input.url) {
    const parsed = parseGitHubFolderUrl(input.url);
    if (!parsed.ok) {
      invalidInput(
        parsed.reason === "file"
          ? "That's a link to a file. Paste the link to its folder instead."
          : parsed.reason === "not-github"
            ? "That isn't a github.com link."
            : "Paste a GitHub folder link like https://github.com/owner/repo/tree/main/docs.",
      );
    }
    owner = parsed.owner;
    repo = parsed.repo;
    candidates = githubBranchCandidates(parsed.refPath);
  }
  if (!owner || !repo)
    invalidInput("A GitHub owner and repository are required.");
  const target = { owner, repo, connectionId: input.connectionId };
  if (input.branch?.trim()) {
    candidates = [
      {
        branch: input.branch.trim(),
        path: input.path ?? candidates[0]?.path ?? "",
      },
    ];
  } else if (candidates.length === 0) {
    candidates = [
      { branch: await readGitHubDefaultBranch(target), path: input.path ?? "" },
    ];
  } else if (input.path !== undefined) {
    candidates = candidates.map((candidate) => ({
      ...candidate,
      path: input.path!,
    }));
  }

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const head = await readGitHubBranchHead({
        ...target,
        branch: candidate.branch,
      });
      if (head.status !== "ok") continue;
      return {
        location: {
          owner,
          repo,
          branch: candidate.branch,
          path: normalizeGitHubFolderPath(candidate.path),
        },
        commitSha: head.sha,
        etag: head.etag,
      };
    } catch (error) {
      if (
        error instanceof GitHubSourceError &&
        error.code === "branch_not_found"
      ) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw (
    lastError ??
    new GitHubSourceError(
      "branch_not_found",
      `GitHub has no matching branch in ${owner}/${repo}.`,
    )
  );
}

interface FolderFiles {
  /** Markdown files that become rows, by folder-relative path. */
  markdown: GitHubTreeEntry[];
  skipped: Array<{ path: string; reason: GitHubSourceSkipReason }>;
  /** Every file, so pages can find the images they reference. */
  blobs: Map<string, GitHubTreeEntry>;
}

function classifyFolder(entries: GitHubTreeEntry[]): FolderFiles {
  const markdown: GitHubTreeEntry[] = [];
  const skipped: FolderFiles["skipped"] = [];
  const blobs = new Map<string, GitHubTreeEntry>();
  for (const entry of entries) {
    if (entry.type !== "blob") continue;
    blobs.set(entry.path, entry);
    const kind = classifyGitHubSourceFile(entry.path, entry.size);
    if (kind.kind === "markdown") markdown.push(entry);
    else if (kind.kind === "skipped") {
      skipped.push({ path: entry.path, reason: kind.reason });
    }
  }
  markdown.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  skipped.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { markdown, skipped, blobs };
}

function tooManyFiles(count: number): GitHubSourceError {
  return new GitHubSourceError(
    "too_large",
    `This folder has ${count} Markdown files; a link can follow up to ${GITHUB_SOURCE_MAX_FILES}. Link a smaller folder.`,
  );
}

/** Frontmatter keys that become columns; title, description and icon are page fields. */
function frontmatterValues(
  draft: MarkdownImportDraft,
): Record<string, unknown> {
  return draft.frontmatter.unmapped ?? {};
}

function exampleText(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 80);
  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        typeof entry === "string" ? entry : JSON.stringify(entry),
      )
      .join(", ")
      .slice(0, 80);
  }
  return JSON.stringify(value).slice(0, 80);
}

/**
 * Reports what linking the folder would create without creating anything:
 * how many files become rows, which are skipped and why, and the columns the
 * frontmatter becomes, read from the first files.
 */
export async function previewGitHubFolder(
  resolved: ResolvedGitHubFolder,
  connectionId?: string | null,
): Promise<GitHubFolderPreview> {
  const { location } = resolved;
  const target = {
    owner: location.owner,
    repo: location.repo,
    connectionId,
  };
  const files = classifyFolder(
    await readGitHubFolderTree({
      ...target,
      commitSha: resolved.commitSha,
      path: location.path,
    }),
  );
  if (files.markdown.length > GITHUB_SOURCE_MAX_FILES) {
    throw tooManyFiles(files.markdown.length);
  }
  const sampleEntries = files.markdown.slice(0, PREVIEW_SAMPLE_FILES);
  const skipped = [...files.skipped];
  const drafts = await mapLimit(
    sampleEntries,
    PREVIEW_READ_CONCURRENCY,
    async (entry) => {
      const text = decodeText(
        await readGitHubBlob({ ...target, sha: entry.sha }),
      );
      if (text === null) {
        skipped.push({ path: entry.path, reason: "not-text" });
        return null;
      }
      return {
        path: entry.path,
        draft: parseMarkdownImport({
          sourcePath: entry.path,
          text,
          tablePadding: newTablePaddingBudget(),
        }),
      };
    },
  );
  const valuesByKey = new Map<string, unknown[]>();
  const sample: GitHubFolderPreview["sample"] = [];
  for (const parsed of drafts) {
    if (!parsed) continue;
    sample.push({ path: parsed.path, title: parsed.draft.title });
    for (const [key, value] of Object.entries(
      frontmatterValues(parsed.draft),
    )) {
      const values = valuesByKey.get(key) ?? [];
      values.push(value);
      valuesByKey.set(key, values);
    }
  }
  return {
    location,
    label: githubFolderLabel(location),
    folderUrl: githubFolderWebUrl(location),
    commitSha: resolved.commitSha,
    markdownFiles: files.markdown.length,
    skipped: skipped.sort((a, b) => (a.path < b.path ? -1 : 1)),
    fields: [...valuesByKey].map(([key, values]) => ({
      key,
      type: inferGitHubFieldType(key, values),
      examples: values
        .filter((value) => value !== null && value !== "")
        .slice(0, 3)
        .map(exampleText),
    })),
    sample,
    sampledFiles: sample.length,
    images: [...files.blobs.keys()].filter((path) => importImageMediaType(path))
      .length,
    storageReady: Boolean(await getActiveFileUploadProviderForRequest()),
  };
}

interface GitHubColumn {
  fieldId: string;
  propertyId: string;
  key: string;
  type: GitHubFieldType;
  options: DocumentPropertyOptions;
}

function githubFieldRowId(sourceId: string, key: string) {
  return opaqueId("content_source_field", `${sourceId}:${key}`);
}

function isGitHubFieldType(value: string): value is GitHubFieldType {
  return [
    "text",
    "number",
    "checkbox",
    "date",
    "url",
    "select",
    "multi_select",
  ].includes(value);
}

async function loadColumns(db: Db, sourceId: string) {
  const rows = await db
    .select({
      field: schema.contentDatabaseSourceFields,
      property: schema.documentPropertyDefinitions,
    })
    .from(schema.contentDatabaseSourceFields)
    .innerJoin(
      schema.documentPropertyDefinitions,
      eq(
        schema.documentPropertyDefinitions.id,
        schema.contentDatabaseSourceFields.propertyId,
      ),
    )
    .where(
      and(
        eq(schema.contentDatabaseSourceFields.sourceId, sourceId),
        eq(schema.contentDatabaseSourceFields.mappingType, "property"),
      ),
    );
  const columns = new Map<string, GitHubColumn>();
  for (const { field, property } of rows) {
    columns.set(field.sourceFieldKey, {
      fieldId: field.id,
      propertyId: property.id,
      key: field.sourceFieldKey,
      type: isGitHubFieldType(property.type) ? property.type : "text",
      options: parsePropertyOptions(property.optionsJson),
    });
  }
  // A key whose column someone removed stays unmapped rather than coming back.
  const removed = new Set(
    (
      await db
        .select({ key: schema.contentDatabaseSourceFields.sourceFieldKey })
        .from(schema.contentDatabaseSourceFields)
        .where(
          and(
            eq(schema.contentDatabaseSourceFields.sourceId, sourceId),
            eq(schema.contentDatabaseSourceFields.mappingType, "property"),
          ),
        )
    )
      .map((row) => row.key)
      .filter((key) => !columns.has(key)),
  );
  return { columns, removed };
}

async function insertColumn(
  tx: Db,
  args: {
    database: DatabaseRow;
    sourceId: string;
    key: string;
    type: GitHubFieldType;
    now: string;
  },
): Promise<GitHubColumn> {
  const [maxPosition] = await tx
    .select({ max: sql<unknown>`COALESCE(MAX(position), -1)` })
    .from(schema.documentPropertyDefinitions)
    .where(eq(schema.documentPropertyDefinitions.databaseId, args.database.id));
  const propertyId = nanoid();
  // Choices come from the files, so a new select starts without the
  // placeholder option Content gives columns made by hand.
  const options =
    args.type === "select" || args.type === "multi_select"
      ? { options: [] }
      : defaultPropertyOptions(args.type);
  await tx.insert(schema.documentPropertyDefinitions).values({
    id: propertyId,
    ownerEmail: args.database.ownerEmail,
    orgId: args.database.orgId ?? null,
    databaseId: args.database.id,
    name: args.key,
    type: args.type,
    optionsJson: serializePropertyOptions(options),
    position: nextAppendPosition(maxPosition?.max),
    createdAt: args.now,
    updatedAt: args.now,
  });
  const fieldId = githubFieldRowId(args.sourceId, args.key);
  await tx
    .insert(schema.contentDatabaseSourceFields)
    .values({
      id: fieldId,
      ownerEmail: args.database.ownerEmail,
      sourceId: args.sourceId,
      propertyId,
      localFieldKey: propertyId,
      sourceFieldKey: args.key,
      sourceFieldLabel: args.key,
      sourceFieldType: args.type,
      mappingType: "property",
      writeOwner: "source",
      readOnly: 1,
      provenance: "github frontmatter",
      freshness: "fresh",
      lastSyncedAt: args.now,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoNothing();
  return { fieldId, propertyId, key: args.key, type: args.type, options };
}

/** Adds any select options a value names, so its stored ids resolve. */
async function ensureOptions(
  tx: Db,
  column: GitHubColumn,
  value: unknown,
  now: string,
) {
  if (column.type !== "select" && column.type !== "multi_select") return;
  const names = (Array.isArray(value) ? value : [value]).filter(
    (name): name is string => typeof name === "string" && !!name.trim(),
  );
  const options = [...(column.options.options ?? [])];
  const known = new Set(
    options.map((option) => option.name.trim().toLowerCase()),
  );
  const usedIds = new Set(options.map((option) => option.id));
  let added = false;
  for (const raw of names) {
    const name = raw.trim();
    if (known.has(name.toLowerCase())) continue;
    known.add(name.toLowerCase());
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "option";
    let id = base;
    for (let index = 2; usedIds.has(id); index++) id = `${base}-${index}`;
    usedIds.add(id);
    options.push({
      id,
      name,
      color: OPTION_COLORS[options.length % OPTION_COLORS.length]!,
    });
    added = true;
  }
  if (!added) return;
  column.options = { ...column.options, options };
  await tx
    .update(schema.documentPropertyDefinitions)
    .set({
      optionsJson: serializePropertyOptions(column.options),
      updatedAt: now,
    })
    .where(eq(schema.documentPropertyDefinitions.id, column.propertyId));
}

function textFromStoredValue(
  column: GitHubColumn,
  raw: unknown,
): string | null {
  if (raw === null || raw === undefined) return null;
  const optionName = (id: unknown) =>
    column.options.options?.find((option) => option.id === id)?.name ??
    String(id);
  if (column.type === "select") return optionName(raw);
  if (column.type === "multi_select" && Array.isArray(raw)) {
    return raw.map(optionName).join(", ");
  }
  if (column.type === "date" && raw && typeof raw === "object") {
    const date = raw as { start?: string; end?: string | null };
    return date.end ? `${date.start} – ${date.end}` : (date.start ?? null);
  }
  return typeof raw === "string" ? raw : JSON.stringify(raw);
}

/**
 * A file's value no longer fits its column (a number column meets "TBD"),
 * so the column becomes text, keeping every row's value as words.
 */
async function widenColumnToText(tx: Db, column: GitHubColumn, now: string) {
  const values = await tx
    .select()
    .from(schema.documentPropertyValues)
    .where(eq(schema.documentPropertyValues.propertyId, column.propertyId));
  for (const value of values) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(value.valueJson);
    } catch {
      parsed = value.valueJson;
    }
    await tx
      .update(schema.documentPropertyValues)
      .set({
        valueJson: serializePropertyValue(textFromStoredValue(column, parsed)),
        updatedAt: now,
      })
      .where(eq(schema.documentPropertyValues.id, value.id));
  }
  column.type = "text";
  column.options = defaultPropertyOptions("text");
  await tx
    .update(schema.documentPropertyDefinitions)
    .set({
      type: "text",
      optionsJson: serializePropertyOptions(column.options),
      updatedAt: now,
    })
    .where(eq(schema.documentPropertyDefinitions.id, column.propertyId));
  await tx
    .update(schema.contentDatabaseSourceFields)
    .set({ sourceFieldType: "text", updatedAt: now })
    .where(eq(schema.contentDatabaseSourceFields.id, column.fieldId));
}

interface RowState {
  /** Repository path of the file. */
  path: string;
  blobSha: string;
  /** Hash of the stored body, so a reformat-only commit writes nothing. */
  contentHash: string;
  /** Hash of the title, description and icon the file gave the page. */
  metaHash: string;
  frontmatterId: string | null;
  /** Images uploaded for this page, by folder-relative path. */
  assets: Record<string, { sha: string; url: string }>;
  /** Images left out because file storage isn't set up; retried once it is. */
  imagesWaiting?: number;
}

function rowState(row: Pick<SourceRow, "sourceValuesJson">): RowState | null {
  const state = parseJsonObject(row.sourceValuesJson)[ROW_STATE_KEY];
  if (!state || typeof state !== "object") return null;
  const value = state as Record<string, unknown>;
  if (typeof value.path !== "string" || typeof value.blobSha !== "string") {
    return null;
  }
  const assets: RowState["assets"] = {};
  if (value.assets && typeof value.assets === "object") {
    for (const [path, raw] of Object.entries(
      value.assets as Record<string, unknown>,
    )) {
      const asset = raw as { sha?: unknown; url?: unknown };
      if (typeof asset?.sha === "string" && typeof asset.url === "string") {
        assets[path] = { sha: asset.sha, url: asset.url };
      }
    }
  }
  return {
    path: value.path,
    blobSha: value.blobSha,
    contentHash: typeof value.contentHash === "string" ? value.contentHash : "",
    metaHash: typeof value.metaHash === "string" ? value.metaHash : "",
    frontmatterId:
      typeof value.frontmatterId === "string" ? value.frontmatterId : null,
    assets,
    ...(typeof value.imagesWaiting === "number" && value.imagesWaiting > 0
      ? { imagesWaiting: value.imagesWaiting }
      : {}),
  };
}

function metaHash(page: {
  title: string;
  description: string | null;
  icon: string | null;
}) {
  return hash(
    JSON.stringify([page.title, page.description ?? "", page.icon ?? null]),
  );
}

function frontmatterId(values: Record<string, unknown>): string | null {
  const id = values.id;
  return typeof id === "string" && id.trim()
    ? id.trim()
    : typeof id === "number"
      ? String(id)
      : null;
}

export interface GitHubSyncResult {
  state: "unchanged" | "synced" | "partial" | "busy" | "error";
  commitSha: string | null;
  created: number;
  updated: number;
  unchanged: number;
  renamed: number;
  trashed: number;
  remaining: number;
  /** Images left out because file storage isn't set up. */
  imagesWaiting: number;
  problem: GitHubSourceState["problem"];
}

function emptyResult(
  state: GitHubSyncResult["state"],
  commitSha: string | null,
  problem: GitHubSourceState["problem"] = null,
): GitHubSyncResult {
  return {
    state,
    commitSha,
    created: 0,
    updated: 0,
    unchanged: 0,
    renamed: 0,
    trashed: 0,
    remaining: 0,
    imagesWaiting: 0,
    problem,
  };
}

/** The problem a sync records when it fails for a reason it can't name, like a dropped socket. */
function unexpectedProblem(
  at: string,
): NonNullable<GitHubSourceState["problem"]> {
  return {
    code: "unavailable",
    message: "The sync failed. The background sync tries again.",
    at,
  };
}

/** A sync that failed before it could record why. */
export function unexpectedSyncFailure(at: string): GitHubSyncResult {
  return emptyResult("error", null, unexpectedProblem(at));
}

/** The status problem for images a sync couldn't store, if there are any. */
function storageProblem(
  imagesWaiting: number,
  at: string,
): GitHubSourceState["problem"] {
  if (imagesWaiting === 0) return null;
  return {
    code: "storage_unavailable",
    message: `${imagesWaiting === 1 ? "1 image isn't" : `${imagesWaiting} images aren't`} shown because file storage isn't set up. Connect storage in Settings → File uploads; the next sync adds ${imagesWaiting === 1 ? "it" : "them"}.`,
    at,
  };
}

async function readSource(sourceId: string) {
  const [target] = await getDb()
    .select({
      source: schema.contentDatabaseSources,
      database: schema.contentDatabases,
    })
    .from(schema.contentDatabaseSources)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseSources.databaseId),
    )
    .where(eq(schema.contentDatabaseSources.id, sourceId));
  if (!target || target.source.sourceType !== GITHUB_SOURCE_TYPE) return null;
  const state = readGitHubSourceState(
    parseJsonObject(target.source.metadataJson),
  );
  return state ? { ...target, state } : null;
}

/** Applies a change to the link's state, merged into whatever is stored now. */
async function updateState(
  sourceId: string,
  now: string,
  change: (state: GitHubSourceState) => GitHubSourceState | null,
  columns: (state: GitHubSourceState) => Partial<{
    syncState: string;
    freshness: string;
    lastRefreshedAt: string;
    lastSourceUpdatedAt: string;
    lastError: string | null;
  }> = () => ({}),
) {
  await mutateContentDatabaseSourceMetadata({
    sourceId,
    now,
    buildPatch: (current) => {
      const metadata = parseJsonObject(current.metadataJson);
      const state = readGitHubSourceState(metadata);
      const next = state ? change(state) : null;
      if (!next) return { metadataJson: current.metadataJson };
      return {
        metadataJson: JSON.stringify({
          ...metadata,
          ...githubSourceMetadataRecord(next),
        }),
        ...columns(next),
      };
    },
  });
}

async function claimSync(
  sourceId: string,
  now: string,
): Promise<string | null> {
  const claimId = randomUUID();
  let claimed = false;
  await updateState(
    sourceId,
    now,
    (state) => {
      claimed = false;
      if (state.claim && Date.parse(state.claim.until) > Date.parse(now)) {
        return null;
      }
      claimed = true;
      return {
        ...state,
        claim: {
          id: claimId,
          until: new Date(Date.parse(now) + SYNC_LEASE_MS).toISOString(),
        },
      };
    },
    () => ({ syncState: "refreshing" }),
  );
  return claimed ? claimId : null;
}

function problemFrom(
  error: unknown,
  now: string,
): NonNullable<GitHubSourceState["problem"]> | null {
  if (error instanceof GitHubSourceError) {
    return { code: error.code, message: error.message, at: now };
  }
  if (isAgentConnectionRequiredError(error)) {
    return {
      code: "connection",
      message:
        "GitHub isn't connected for the person who linked this folder. Reconnect GitHub, then refresh.",
      at: now,
    };
  }
  return null;
}

interface PlannedFile {
  entry: GitHubTreeEntry;
  repoPath: string;
  row: SourceRow | null;
  /** The row this file takes over when Git renamed it. */
  renamedFrom: SourceRow | null;
  /** The file's text once read, or null when it isn't UTF-8. */
  text?: string | null;
  /** Images this sync couldn't store for the file's page. */
  imagesWaiting?: number;
}

interface SyncRun {
  db: Db;
  database: DatabaseRow;
  databaseDocument: DocumentRow;
  sourceId: string;
  sourceTable: string;
  state: GitHubSourceState;
  commitSha: string;
  files: FolderFiles;
  columns: Map<string, GitHubColumn>;
  removedKeys: Set<string>;
  /** Document id for each folder-relative path, for links between files. */
  documentIdByPath: Map<string, string>;
  /** Uploaded image URL by blob SHA, shared across pages. */
  assetUrlBySha: Map<string, string>;
  /** Set once an upload finds no file storage, so later images skip the read. */
  storageMissing: boolean;
  now: string;
  actor: string;
  /** Aborts GitHub requests once the sync's time budget runs out. */
  signal: AbortSignal;
}

function documentIdForNewFile(run: SyncRun, repoPath: string) {
  return opaqueId("content_github_page", `${run.sourceId}:${repoPath}`);
}

function itemIdForDocument(run: SyncRun, documentId: string) {
  return opaqueId("content_github_item", `${run.sourceId}:${documentId}`);
}

function folderRelative(run: SyncRun, repoPath: string) {
  const folder = normalizeGitHubFolderPath(run.state.path);
  return folder ? repoPath.slice(folder.length + 1) : repoPath;
}

/**
 * Copies one image into Content's file storage. `"no-storage"` means none is
 * set up, so the page leaves the image out until a later sync can store it.
 */
async function uploadAsset(
  run: SyncRun,
  request: ImportAssetRequest,
): Promise<{ sha: string; url: string } | "no-storage" | null> {
  if (request.kind === "data-url") {
    if (!isImportImageMediaType(request.mediaType)) return null;
    const data = dataUrlBytes(request.dataUrl);
    if (!data || data.byteLength > GITHUB_SOURCE_MAX_IMAGE_BYTES) return null;
    const sha = hash(request.dataUrl);
    const cached = run.assetUrlBySha.get(sha);
    if (cached) return { sha, url: cached };
    if (run.storageMissing) return "no-storage";
    const extension = request.mediaType.split("/")[1]?.split("+")[0] ?? "img";
    const uploaded = await asLinker(run.state, run.database.orgId, () =>
      uploadFile({
        data,
        filename: `github-image.${extension}`,
        mimeType: request.mediaType,
        ownerEmail: run.database.ownerEmail,
      }),
    );
    if (!uploaded?.url) {
      run.storageMissing = true;
      return "no-storage";
    }
    run.assetUrlBySha.set(sha, uploaded.url);
    return { sha, url: uploaded.url };
  }
  const entry = run.files.blobs.get(request.path);
  const mimeType = importImageMediaType(request.path);
  if (!entry || !mimeType) return null;
  if (entry.size !== null && entry.size > GITHUB_SOURCE_MAX_IMAGE_BYTES) {
    return null;
  }
  const cached = run.assetUrlBySha.get(entry.sha);
  if (cached) return { sha: entry.sha, url: cached };
  if (run.storageMissing) return "no-storage";
  const data = await asLinker(run.state, run.database.orgId, () =>
    readGitHubBlob({
      owner: run.state.owner,
      repo: run.state.repo,
      connectionId: run.state.connectionId,
      sha: entry.sha,
      signal: run.signal,
    }),
  );
  const uploaded = await asLinker(run.state, run.database.orgId, () =>
    uploadFile({
      data,
      filename: request.path.split("/").pop() ?? "image",
      mimeType,
      ownerEmail: run.database.ownerEmail,
    }),
  );
  if (!uploaded?.url) {
    run.storageMissing = true;
    return "no-storage";
  }
  run.assetUrlBySha.set(entry.sha, uploaded.url);
  return { sha: entry.sha, url: uploaded.url };
}

/**
 * Turns a file into the page Content stores: the same codec the importer
 * uses, with images copied into Content storage and links to other files in
 * the folder pointing at their pages.
 */
async function buildPage(run: SyncRun, relativePath: string, text: string) {
  const draft = parseMarkdownImport({
    sourcePath: relativePath,
    text,
    tablePadding: newTablePaddingBudget(),
  });
  const requests = new Map<string, ImportAssetRequest>();
  finalizeMarkdownImport(
    draft,
    {
      asset: (request): ImportAssetResolution => {
        requests.set(
          request.kind === "file"
            ? `file:${request.path}`
            : `data:${request.dataUrl}`,
          request,
        );
        return { status: "available" };
      },
      link: () => null,
    },
    "preview",
  );
  const assets: RowState["assets"] = {};
  const urls = new Map<string, string>();
  let imagesWaiting = 0;
  for (const [key, request] of requests) {
    const uploaded = await uploadAsset(run, request);
    if (uploaded === "no-storage") imagesWaiting += 1;
    if (!uploaded || uploaded === "no-storage") continue;
    urls.set(key, uploaded.url);
    if (request.kind === "file") assets[request.path] = uploaded;
  }
  const page = finalizeMarkdownImport(
    draft,
    {
      asset: (request) => {
        const url = urls.get(
          request.kind === "file"
            ? `file:${request.path}`
            : `data:${request.dataUrl}`,
        );
        return url ? { status: "resolved", url } : { status: "missing" };
      },
      link: (path) => {
        const documentId = run.documentIdByPath.get(path);
        return documentId ? `/page/${documentId}` : null;
      },
    },
    "apply",
  );
  return { draft, page, assets, imagesWaiting };
}

/** Writes the file's frontmatter into its columns; true when a value changed. */
async function writePropertyValues(
  tx: Db,
  run: SyncRun,
  documentId: string,
  values: Record<string, unknown>,
): Promise<boolean> {
  for (const [key, value] of Object.entries(values)) {
    if (run.removedKeys.has(key) || value === null || value === undefined) {
      continue;
    }
    let column = run.columns.get(key);
    if (!column) {
      column = await insertColumn(tx, {
        database: run.database,
        sourceId: run.sourceId,
        key,
        type: inferGitHubFieldType(key, [value]),
        now: run.now,
      });
      run.columns.set(key, column);
    } else if (!fitsGitHubFieldType(column.type, value)) {
      await widenColumnToText(tx, column, run.now);
    }
    await ensureOptions(tx, column, value, run.now);
  }

  const columns = [...run.columns.values()];
  if (columns.length === 0) return false;
  const stored = await tx
    .select()
    .from(schema.documentPropertyValues)
    .where(
      and(
        eq(schema.documentPropertyValues.documentId, documentId),
        inArray(
          schema.documentPropertyValues.propertyId,
          columns.map((column) => column.propertyId),
        ),
      ),
    );
  const storedByProperty = new Map(
    stored.map((row) => [row.propertyId, row] as const),
  );
  let changed = false;
  for (const column of columns) {
    const normalized = normalizePropertyValueWithOptions(
      column.type,
      githubFieldPropertyInput(column.type, values[column.key]),
      column.options,
    );
    const existing = storedByProperty.get(column.propertyId);
    if (normalized === null) {
      // A key removed from the file clears its value.
      if (existing) {
        await tx
          .delete(schema.documentPropertyValues)
          .where(eq(schema.documentPropertyValues.id, existing.id));
        changed = true;
      }
      continue;
    }
    const valueJson = serializePropertyValue(normalized);
    if (existing?.valueJson === valueJson) continue;
    changed = true;
    if (existing) {
      await tx
        .update(schema.documentPropertyValues)
        .set({ valueJson, updatedAt: run.now })
        .where(eq(schema.documentPropertyValues.id, existing.id));
    } else {
      await tx.insert(schema.documentPropertyValues).values({
        id: nanoid(),
        ownerEmail: run.database.ownerEmail,
        documentId,
        propertyId: column.propertyId,
        valueJson,
        createdAt: run.now,
        updatedAt: run.now,
      });
    }
  }
  return changed;
}

function sourceRowValues(
  run: SyncRun,
  state: RowState,
  values: Record<string, unknown>,
) {
  return JSON.stringify({ ...values, [ROW_STATE_KEY]: state });
}

async function upsertSourceRow(
  tx: Db,
  run: SyncRun,
  args: {
    rowId: string;
    itemId: string;
    documentId: string;
    state: RowState;
    values: Record<string, unknown>;
  },
) {
  const values = {
    sourceId: run.sourceId,
    databaseItemId: args.itemId,
    documentId: args.documentId,
    sourceRowId: args.state.path,
    sourceQualifiedId: `github://${run.state.owner}/${run.state.repo}/${encodeURIComponent(run.state.branch)}/${args.state.path}`,
    sourceDisplayKey: args.state.path,
    sourceValuesJson: sourceRowValues(run, args.state, args.values),
    provenance: "github",
    syncState: "linked",
    freshness: "fresh",
    lastSyncedAt: run.now,
    lastSourceUpdatedAt: run.now,
    updatedAt: run.now,
  };
  await tx
    .insert(schema.contentDatabaseSourceRows)
    .values({
      id: args.rowId,
      ownerEmail: run.database.ownerEmail,
      createdAt: run.now,
      ...values,
    })
    .onConflictDoNothing();
  await tx
    .update(schema.contentDatabaseSourceRows)
    .set(values)
    .where(eq(schema.contentDatabaseSourceRows.id, args.rowId));
}

type FileOutcome =
  | "created"
  | "updated"
  | "unchanged"
  | "renamed"
  | { skipped: GitHubSourceSkipReason };

async function readFileText(run: SyncRun, file: PlannedFile) {
  if (file.text !== undefined) return file.text;
  const bytes = await asLinker(run.state, run.database.orgId, () =>
    readGitHubBlob({
      owner: run.state.owner,
      repo: run.state.repo,
      connectionId: run.state.connectionId,
      sha: file.entry.sha,
      signal: run.signal,
    }),
  );
  file.text = decodeText(bytes);
  return file.text;
}

/**
 * Reads one file and makes its row match it, in one transaction. A file
 * that can't become a page is skipped with its reason, and its row, if it
 * has one, keeps the last version that could.
 */
async function applyFile(
  run: SyncRun,
  file: PlannedFile,
): Promise<FileOutcome> {
  const relativePath = file.entry.path;
  const text = await readFileText(run, file);
  if (text === null) return { skipped: "not-text" };
  const { draft, page, assets, imagesWaiting } = await buildPage(
    run,
    relativePath,
    text,
  );
  if (page.content.length > MAX_IMPORT_PAGE_CHARACTERS) {
    return { skipped: "too-large" };
  }
  file.imagesWaiting = imagesWaiting;
  const values = frontmatterValues(draft);
  const linkedRow = file.row ?? file.renamedFrom;
  const previous = linkedRow ? rowState(linkedRow) : null;
  const nextState: RowState = {
    path: file.repoPath,
    blobSha: file.entry.sha,
    contentHash: hash(page.content),
    metaHash: metaHash(page),
    frontmatterId: frontmatterId(values),
    assets,
    ...(imagesWaiting ? { imagesWaiting } : {}),
  };

  return withPositionLock(
    documentsPositionScope(run.database.ownerEmail, run.database.documentId),
    () =>
      withPositionLock(databaseItemsPositionScope(run.database.id), () =>
        run.db.transaction(async (tx: Db): Promise<FileOutcome> => {
          await lockLinkedCollection(tx, run);
          if (linkedRow) {
            const [document] = await tx
              .select()
              .from(schema.documents)
              .where(eq(schema.documents.id, linkedRow.documentId));
            if (document) {
              const bodyChanged =
                !previous ||
                previous.contentHash !== nextState.contentHash ||
                previous.metaHash !== nextState.metaHash;
              const moved = document.sourcePath !== file.repoPath;
              if (bodyChanged) {
                const [written] = await tx
                  .update(schema.documents)
                  .set({
                    title: page.title,
                    content: page.content,
                    bodyRevision: bodyRevisionForContent(page.content),
                    description: page.description ?? "",
                    icon: page.icon ?? document.icon,
                    sourcePath: file.repoPath,
                    sourceUpdatedAt: run.now,
                    updatedAt: run.now,
                  })
                  .where(eq(schema.documents.id, document.id))
                  .returning({ bodyRevision: schema.documents.bodyRevision });
                if (
                  document.title !== page.title ||
                  document.content !== page.content
                ) {
                  await recordDocumentHistoryTransition({
                    db: tx,
                    ownerEmail: document.ownerEmail,
                    documentId: document.id,
                    before: {
                      title: document.title,
                      content: document.content,
                    },
                    after: { title: page.title, content: page.content },
                    beforeBodyRevision: document.bodyRevision,
                    afterBodyRevision: written?.bodyRevision,
                    cause: {
                      groupId: `github:${run.sourceId}:${run.commitSha}:${document.id}`,
                      groupKind: "operation",
                      actorKind: "source",
                      actorEmail: null,
                      origin: "github",
                      operation: GITHUB_SYNC_OPERATION,
                    },
                    now: run.now,
                  });
                }
              } else if (moved) {
                await tx
                  .update(schema.documents)
                  .set({
                    sourcePath: file.repoPath,
                    sourceUpdatedAt: run.now,
                    updatedAt: run.now,
                  })
                  .where(eq(schema.documents.id, document.id));
              }
              const valuesChanged = await writePropertyValues(
                tx,
                run,
                document.id,
                values,
              );
              await upsertSourceRow(tx, run, {
                rowId: linkedRow.id,
                itemId: linkedRow.databaseItemId,
                documentId: document.id,
                state: nextState,
                values,
              });
              return file.renamedFrom
                ? "renamed"
                : bodyChanged || valuesChanged
                  ? "updated"
                  : "unchanged";
            }
            // The page is gone for good (purged from Trash): the file gets a
            // new page, and the stale row is replaced below.
            await tx
              .delete(schema.contentDatabaseSourceRows)
              .where(eq(schema.contentDatabaseSourceRows.id, linkedRow.id));
          }

          let documentId = run.documentIdByPath.get(relativePath)!;
          const [taken] = await tx
            .select({ id: schema.documents.id })
            .from(schema.documents)
            .where(eq(schema.documents.id, documentId));
          if (taken) {
            documentId = opaqueId(
              "content_github_page",
              `${run.sourceId}:${file.repoPath}:${run.commitSha}`,
            );
            run.documentIdByPath.set(relativePath, documentId);
          }
          const itemId = itemIdForDocument(run, documentId);
          const [maxDocument] = await tx
            .select({ max: sql<unknown>`COALESCE(MAX(position), -1)` })
            .from(schema.documents)
            .where(
              and(
                eq(schema.documents.ownerEmail, run.database.ownerEmail),
                eq(schema.documents.parentId, run.database.documentId),
              ),
            );
          const [maxItem] = await tx
            .select({ max: sql<unknown>`COALESCE(MAX(position), -1)` })
            .from(schema.contentDatabaseItems)
            .where(eq(schema.contentDatabaseItems.databaseId, run.database.id));
          await tx.insert(schema.documents).values({
            id: documentId,
            spaceId: run.database.spaceId ?? run.databaseDocument.spaceId,
            ownerEmail: run.database.ownerEmail,
            orgId: run.database.orgId,
            parentId: run.database.documentId,
            title: page.title,
            content: page.content,
            description: page.description ?? "",
            icon: page.icon,
            position: nextAppendPosition(maxDocument?.max),
            isFavorite: 0,
            hideFromSearch: run.databaseDocument.hideFromSearch ?? 0,
            visibility: run.databaseDocument.visibility ?? "private",
            sourceMode: "github",
            sourceKind: "file",
            sourcePath: file.repoPath,
            sourceRootPath: run.sourceTable,
            sourceUpdatedAt: run.now,
            createdBy: run.actor,
            updatedBy: run.actor,
            createdAt: run.now,
            updatedAt: run.now,
          });
          await tx.insert(schema.contentDatabaseItems).values({
            id: itemId,
            ownerEmail: run.database.ownerEmail,
            orgId: run.database.orgId,
            databaseId: run.database.id,
            documentId,
            position: nextAppendPosition(maxItem?.max),
            createdAt: run.now,
            updatedAt: run.now,
          });
          const shares = await tx
            .select({
              principalType: schema.documentShares.principalType,
              principalId: schema.documentShares.principalId,
              role: schema.documentShares.role,
            })
            .from(schema.documentShares)
            .where(
              eq(schema.documentShares.resourceId, run.database.documentId),
            );
          if (shares.length > 0) {
            await tx.insert(schema.documentShares).values(
              shares.map((share) => ({
                id: nanoid(),
                resourceId: documentId,
                principalType: share.principalType,
                principalId: share.principalId,
                role: share.role,
                createdBy: run.actor,
                createdAt: run.now,
              })),
            );
          }
          await ensureDocumentsFilesMembership(
            tx,
            [documentId],
            run.now,
            run.database.ownerEmail,
          );
          const created = { title: page.title, content: page.content };
          await recordDocumentHistoryTransition({
            db: tx,
            ownerEmail: run.database.ownerEmail,
            documentId,
            before: created,
            after: created,
            cause: {
              groupId: `github:${run.sourceId}:${run.commitSha}:${documentId}`,
              groupKind: "operation",
              actorKind: "source",
              actorEmail: null,
              origin: "github",
              skipBeforeCheckpoint: true,
              operation: GITHUB_SYNC_OPERATION,
            },
            now: run.now,
          });
          await writePropertyValues(tx, run, documentId, values);
          await upsertSourceRow(tx, run, {
            rowId: opaqueId(
              "content_source_row",
              `${run.sourceId}:${documentId}`,
            ),
            itemId,
            documentId,
            state: nextState,
            values,
          });
          return "created";
        }),
      ),
  );
}

/**
 * Takes the lock disconnect takes, then confirms the link still exists. A
 * disconnect that lands while this sync reads GitHub has made the pages
 * ordinary again, so the sync stops instead of writing to them.
 */
async function lockLinkedCollection(tx: Db, run: SyncRun) {
  await lockContentDatabaseMutation(tx, run.database.id);
  const [source] = await tx
    .select({ id: schema.contentDatabaseSources.id })
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, run.sourceId));
  if (!source) {
    throw new ActionContractError(
      "This collection isn't linked to a GitHub folder.",
      { errorCode: "SOURCE_NOT_FOUND", statusCode: 404 },
    );
  }
}

async function trashRow(run: SyncRun, row: SourceRow) {
  await run.db.transaction(async (tx: Db) => {
    await lockLinkedCollection(tx, run);
    const [document] = await tx
      .select({
        ownerEmail: schema.documents.ownerEmail,
        trashedAt: schema.documents.trashedAt,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, row.documentId));
    if (document && !document.trashedAt) {
      await trashDocumentSubtree(
        tx,
        row.documentId,
        document.ownerEmail,
        run.now,
        undefined,
        "github",
      );
    }
    await tx
      .delete(schema.contentDatabaseSourceRows)
      .where(eq(schema.contentDatabaseSourceRows.id, row.id));
  });
}

/**
 * Pairs files that left the folder with files that arrived, so a renamed
 * file keeps its page, comments and History. Git's own rename detection
 * comes first, then identical contents.
 */
async function matchRenames(
  run: SyncRun,
  added: PlannedFile[],
  gone: Map<string, SourceRow>,
) {
  if (added.length === 0 || gone.size === 0) return;
  const claim = (file: PlannedFile, row: SourceRow, from: string) => {
    file.renamedFrom = row;
    gone.delete(from);
  };
  const addedByPath = new Map(added.map((file) => [file.repoPath, file]));
  if (run.state.syncedCommitSha) {
    const renames = await asLinker(run.state, run.database.orgId, () =>
      readGitHubRenames({
        owner: run.state.owner,
        repo: run.state.repo,
        connectionId: run.state.connectionId,
        base: run.state.syncedCommitSha!,
        head: run.commitSha,
        signal: run.signal,
      }),
    );
    for (const rename of renames ?? []) {
      const file = addedByPath.get(rename.to);
      const row = gone.get(rename.from);
      if (file && row && !file.renamedFrom) claim(file, row, rename.from);
    }
  }
  for (const file of added) {
    if (file.renamedFrom) continue;
    for (const [path, row] of gone) {
      if (rowState(row)?.blobSha === file.entry.sha) {
        claim(file, row, path);
        break;
      }
    }
  }
}

export interface SyncGitHubSourceOptions {
  sourceId: string;
  /**
   * Stop starting new files after this long, and end any GitHub request
   * still waiting then; the next sync resumes.
   */
  budgetMs: number;
  /** Compare against GitHub even when the branch's ETag says nothing moved. */
  force?: boolean;
  /** Rethrow a missing GitHub connection so an interactive caller can offer to connect. */
  throwConnectionErrors?: boolean;
}

/**
 * Brings a linked collection up to its branch's latest commit. Each call does
 * as many files as its time budget allows and records how far it got; rows
 * remember the blob each was built from, so the next call skips them.
 */
export async function syncGitHubSource(
  options: SyncGitHubSourceOptions,
): Promise<GitHubSyncResult> {
  const startedAt = Date.now();
  const deadline = startedAt + options.budgetMs;
  const now = new Date(startedAt).toISOString();
  const loaded = await readSource(options.sourceId);
  if (!loaded) {
    throw new ActionContractError(
      "This collection isn't linked to a GitHub folder.",
      {
        errorCode: "SOURCE_NOT_FOUND",
        statusCode: 404,
      },
    );
  }
  const claimId = await claimSync(options.sourceId, now);
  if (!claimId) return emptyResult("busy", loaded.state.pendingCommitSha);

  const { database, source } = loaded;
  let state = loaded.state;
  const release = (
    change: (state: GitHubSourceState) => GitHubSourceState,
    columns: Parameters<typeof updateState>[3],
  ) =>
    updateState(
      options.sourceId,
      new Date().toISOString(),
      (current) =>
        current.claim?.id === claimId
          ? { ...change(current), claim: null }
          : null,
      columns,
    );

  const budget = new AbortController();
  const budgetTimer = setTimeout(
    () => budget.abort(),
    Math.max(0, deadline - Date.now()),
  );
  try {
    // Pages left without images get rebuilt once storage is set up, even
    // when the branch hasn't moved.
    const retryImages =
      state.imagesWaiting > 0 &&
      Boolean(
        await asLinker(state, database.orgId, () =>
          getActiveFileUploadProviderForRequest(),
        ),
      );
    const canSkip =
      !options.force &&
      !retryImages &&
      !!state.syncedCommitSha &&
      !state.pendingCommitSha;
    const head = await asLinker(state, database.orgId, () =>
      readGitHubBranchHead(
        {
          owner: state.owner,
          repo: state.repo,
          branch: state.branch,
          connectionId: state.connectionId,
          signal: budget.signal,
        },
        canSkip ? state.headEtag : null,
      ),
    );
    if (
      head.status === "not-modified" ||
      (canSkip && head.sha === state.syncedCommitSha)
    ) {
      await release(
        (current) => ({
          ...current,
          checkedAt: now,
          headEtag: head.status === "ok" ? head.etag : current.headEtag,
          problem: storageProblem(current.imagesWaiting, now),
        }),
        () => ({
          syncState: "linked",
          freshness: "fresh",
          lastRefreshedAt: now,
          lastError: null,
        }),
      );
      return {
        ...emptyResult(
          "unchanged",
          state.syncedCommitSha,
          storageProblem(state.imagesWaiting, now),
        ),
        imagesWaiting: state.imagesWaiting,
      };
    }

    const db = getDb();
    const [databaseDocument] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, database.documentId));
    if (!databaseDocument) {
      throw new ActionContractError("Collection page not found.", {
        errorCode: "DATABASE_NOT_FOUND",
        statusCode: 404,
      });
    }
    const files = classifyFolder(
      await asLinker(state, database.orgId, () =>
        readGitHubFolderTree({
          owner: state.owner,
          repo: state.repo,
          connectionId: state.connectionId,
          commitSha: head.sha,
          path: state.path,
          signal: budget.signal,
        }),
      ),
    );
    if (files.markdown.length > GITHUB_SOURCE_MAX_FILES) {
      throw tooManyFiles(files.markdown.length);
    }
    const storedRows = (await db
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(
        eq(schema.contentDatabaseSourceRows.sourceId, options.sourceId),
      )) as SourceRow[];
    const rowByPath = new Map<string, SourceRow>();
    const assetUrlBySha = new Map<string, string>();
    for (const row of storedRows) {
      const rowValues = rowState(row);
      if (!rowValues) continue;
      rowByPath.set(rowValues.path, row);
      for (const asset of Object.values(rowValues.assets)) {
        assetUrlBySha.set(asset.sha, asset.url);
      }
    }
    const { columns, removed } = await loadColumns(db, options.sourceId);
    const run: SyncRun = {
      db,
      database,
      databaseDocument,
      sourceId: options.sourceId,
      sourceTable: source.sourceTable,
      state,
      commitSha: head.sha,
      files,
      columns,
      removedKeys: removed,
      documentIdByPath: new Map(),
      assetUrlBySha,
      storageMissing: false,
      now,
      actor: state.linkedBy,
      signal: budget.signal,
    };

    const planned: PlannedFile[] = [];
    const seen = new Set<string>();
    for (const entry of files.markdown) {
      const repoPath = githubRepoPath(state.path, entry.path);
      seen.add(repoPath);
      const row = rowByPath.get(repoPath) ?? null;
      planned.push({ entry, repoPath, row, renamedFrom: null });
    }
    const gone = new Map([...rowByPath].filter(([path]) => !seen.has(path)));
    const added = planned.filter((file) => !file.row);
    await matchRenames(run, added, gone);

    // Frontmatter ids follow a file across a rename Git didn't pair up.
    const goneById = new Map<string, [string, SourceRow]>();
    for (const [path, row] of gone) {
      const id = rowState(row)?.frontmatterId;
      if (id) goneById.set(id, [path, row]);
    }

    for (const file of planned) {
      const relative = folderRelative(run, file.repoPath);
      const linked = file.row ?? file.renamedFrom;
      run.documentIdByPath.set(
        relative,
        linked?.documentId ?? documentIdForNewFile(run, file.repoPath),
      );
    }
    for (const [path, row] of gone) {
      run.documentIdByPath.set(folderRelative(run, path), row.documentId);
    }

    const work = planned.filter((file) => {
      const previous = file.row ? rowState(file.row) : null;
      return (
        !previous ||
        previous.blobSha !== file.entry.sha ||
        (retryImages && (previous.imagesWaiting ?? 0) > 0)
      );
    });
    const result = emptyResult("synced", head.sha);
    result.unchanged = planned.length - work.length;
    const skippedFiles = [...files.skipped];
    let done = 0;
    for (const file of work) {
      if (Date.now() >= deadline) break;
      let outcome: Awaited<ReturnType<typeof applyFile>>;
      try {
        if (!file.row && !file.renamedFrom && goneById.size > 0) {
          // Only a read shows the id, so the claim waits until the file is read.
          const text = await readFileText(run, file);
          const draft = text
            ? parseMarkdownImport({
                sourcePath: file.entry.path,
                text,
                tablePadding: newTablePaddingBudget(),
              })
            : null;
          const id = draft ? frontmatterId(frontmatterValues(draft)) : null;
          const match = id ? goneById.get(id) : undefined;
          if (match && gone.has(match[0])) {
            file.renamedFrom = match[1];
            gone.delete(match[0]);
            goneById.delete(id!);
            run.documentIdByPath.set(
              folderRelative(run, file.repoPath),
              match[1].documentId,
            );
          }
        }
        outcome = await applyFile(run, file);
      } catch (error) {
        // A read the deadline cut short leaves this file for the next sync.
        if (error instanceof GitHubSourceDeadlineError) break;
        throw error;
      }
      if (typeof outcome === "string") result[outcome] += 1;
      else
        skippedFiles.push({ path: file.entry.path, reason: outcome.skipped });
      done += 1;
    }
    const remainingFiles = work.length - done;
    if (remainingFiles === 0) {
      for (const [, row] of gone) {
        if (Date.now() >= deadline) break;
        await trashRow(run, row);
        gone.delete(rowState(row)?.path ?? "");
        result.trashed += 1;
      }
    }
    result.remaining = remainingFiles + gone.size;
    result.imagesWaiting = planned.reduce((total, file) => {
      const linked = file.row ?? file.renamedFrom;
      return (
        total +
        (file.imagesWaiting ??
          (linked ? (rowState(linked)?.imagesWaiting ?? 0) : 0))
      );
    }, 0);
    // Storage that just worked isn't missing, even if the time budget left
    // some pages for the next sync to fill in.
    const storageReady = retryImages && !run.storageMissing;
    result.problem = storageReady
      ? null
      : storageProblem(result.imagesWaiting, now);
    const complete = result.remaining === 0;
    result.state = complete ? "synced" : "partial";
    // A run that got through some files isn't a finished check: the next read
    // or background sync carries on at once. One that got nowhere waits its
    // turn, as a failed check does.
    const countsAsCheck = complete || (done === 0 && result.trashed === 0);
    const skipped = rememberedSkips(
      skippedFiles.sort((a, b) => (a.path < b.path ? -1 : 1)),
    );
    await release(
      (current) => {
        // A commit's files don't change, so a run that carries on a push keeps
        // the total the push started with and counts what's left. Its own
        // list is shorter, and still holds skipped files, which have no row
        // and are read again every run. The count never goes back.
        const before =
          current.pendingCommitSha === head.sha ? current.progress : null;
        const total = before?.total ?? work.length + result.trashed + gone.size;
        const progress = {
          done: Math.min(
            total,
            Math.max(before?.done ?? 0, total - result.remaining),
          ),
          total,
        };
        return {
          ...current,
          checkedAt: now,
          problem: result.problem,
          files: files.markdown.length,
          skipped,
          imagesWaiting: result.imagesWaiting,
          ...(complete
            ? {
                syncedCommitSha: head.sha,
                syncedAt: new Date().toISOString(),
                headEtag: head.etag,
                pendingCommitSha: null,
                progress: null,
              }
            : {
                pendingCommitSha: head.sha,
                progress,
              }),
        };
      },
      () => ({
        syncState: complete ? "linked" : "refreshing",
        freshness: complete ? "fresh" : "stale",
        ...(countsAsCheck ? { lastRefreshedAt: now } : {}),
        ...(complete ? { lastSourceUpdatedAt: now } : {}),
        lastError: null,
      }),
    );
    return result;
  } catch (error) {
    if (error instanceof GitHubSourceDeadlineError) {
      // Only this run failed: a sync with more time, like the background one,
      // may well finish, so the link shows no problem and waits its turn.
      await release(
        (current) => current,
        (next) => ({
          syncState: next.pendingCommitSha
            ? "refreshing"
            : next.problem
              ? "error"
              : "linked",
          lastRefreshedAt: now,
        }),
      ).catch(() => {});
      return emptyResult("error", state.pendingCommitSha, {
        code: "unavailable",
        message:
          "GitHub didn't answer in time. The background sync tries again.",
        at: now,
      });
    }
    // A contract error, like the link going away mid-sync, is the caller's to
    // see. Anything else the sync can't name is still a failed check: the
    // status line shows it and the next sync tries again.
    const named = problemFrom(error, now);
    const problem =
      named ??
      (error instanceof ActionContractError ? null : unexpectedProblem(now));
    if (!named && problem) {
      console.warn(
        "[github-source] sync failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
    await release(
      (current) => ({ ...current, checkedAt: now, problem }),
      () => ({
        syncState: "error",
        freshness: "stale",
        lastRefreshedAt: now,
        lastError: problem?.message ?? "GitHub sync failed.",
      }),
    ).catch(() => {});
    if (!problem) throw error;
    if (problem.code === "connection" && options.throwConnectionErrors) {
      throw error;
    }
    return emptyResult("error", state.pendingCommitSha, problem);
  } finally {
    clearTimeout(budgetTimer);
  }
}

/**
 * Creates the link: the source row, a read-only Title mapping, and the
 * columns the preview found. Rows arrive with the first sync.
 */
export async function createGitHubSourceLink(args: {
  database: DatabaseRow;
  resolved: ResolvedGitHubFolder;
  preview: GitHubFolderPreview;
  connectionId: string | null;
  userEmail: string;
  /** Throws if the collection can no longer be linked; runs under its lock. */
  assertLinkable: (tx: Db) => Promise<void>;
}): Promise<string> {
  const { database, resolved, preview } = args;
  const sourceTable = githubSourceTable(resolved.location);
  const sourceId = githubSourceId(database.id, sourceTable);
  const now = new Date().toISOString();
  const state: GitHubSourceState = {
    ...resolved.location,
    connectionId: args.connectionId,
    linkedBy: args.userEmail,
    linkedAt: now,
    mode: "view_only",
    headEtag: null,
    syncedCommitSha: null,
    syncedAt: null,
    checkedAt: null,
    pendingCommitSha: resolved.commitSha,
    imagesWaiting: 0,
    progress: { done: 0, total: preview.markdownFiles },
    files: preview.markdownFiles,
    skipped: rememberedSkips(preview.skipped),
    problem: null,
    claim: null,
  };
  const db = getDb();
  await db.transaction(async (tx: Db) => {
    await lockContentDatabaseMutation(tx, database.id);
    await args.assertLinkable(tx);
    await tx.insert(schema.contentDatabaseSources).values({
      id: sourceId,
      ownerEmail: database.ownerEmail,
      orgId: database.orgId,
      databaseId: database.id,
      sourceType: GITHUB_SOURCE_TYPE,
      sourceName: preview.label,
      sourceTable,
      syncState: "refreshing",
      freshness: "unknown",
      capabilitiesJson: JSON.stringify(githubSourceCapabilities()),
      metadataJson: JSON.stringify(githubSourceMetadataRecord(state)),
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(schema.contentDatabaseSourceFields).values({
      id: githubFieldRowId(sourceId, "title"),
      ownerEmail: database.ownerEmail,
      sourceId,
      propertyId: null,
      localFieldKey: "title",
      sourceFieldKey: "title",
      sourceFieldLabel: "Title",
      sourceFieldType: "string",
      mappingType: "title",
      writeOwner: "source",
      readOnly: 1,
      provenance: "github frontmatter title, first heading, or file name",
      freshness: "fresh",
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    for (const field of preview.fields) {
      await insertColumn(tx, {
        database,
        sourceId,
        key: field.key,
        type: field.type,
        now,
      });
    }
  });
  return sourceId;
}

/** One line on what a sync did, for refresh results and agents. */
const SKIP_REASON_TEXT: Record<GitHubSourceSkipReason, string> = {
  mdx: "MDX isn't supported",
  "too-large": "too large to import",
  "not-text": "not UTF-8 text",
};

/** Most columns and skipped files a preview summary names one by one. */
const PREVIEW_SUMMARY_LIST = 12;

function listWithMore(items: string[]) {
  const shown = items.slice(0, PREVIEW_SUMMARY_LIST).join(", ");
  return items.length > PREVIEW_SUMMARY_LIST
    ? `${shown}, and ${items.length - PREVIEW_SUMMARY_LIST} more`
    : shown;
}

/**
 * The preview in one paragraph. MCP clients read a mutating tool's summary
 * rather than its fields, so it names the columns and the skipped files.
 */
export function githubPreviewSummary(preview: GitHubFolderPreview) {
  const columns = preview.fields.length
    ? ` Its frontmatter becomes ${preview.fields.length} columns: ${listWithMore(
        preview.fields.map(
          (field) => `${field.key} (${field.type.replace("_", " ")})`,
        ),
      )}.`
    : " It has no frontmatter columns.";
  const skipped = preview.skipped.length
    ? ` ${preview.skipped.length} skipped: ${listWithMore(
        preview.skipped.map(
          (skip) => `${skip.path} (${SKIP_REASON_TEXT[skip.reason]})`,
        ),
      )}.`
    : "";
  const images =
    preview.images > 0 && !preview.storageReady
      ? ` Its ${preview.images === 1 ? "image won't" : `${preview.images} images won't`} show until file storage is set up in Settings → File uploads.`
      : "";
  return `${preview.label} at ${preview.commitSha.slice(0, 7)} has ${preview.markdownFiles} Markdown ${preview.markdownFiles === 1 ? "file" : "files"}.${columns}${skipped}${images}`;
}

export function githubSyncSummary(label: string, result: GitHubSyncResult) {
  const commit = result.commitSha?.slice(0, 7) ?? "unknown";
  if (result.state === "error") {
    return `${label} couldn't sync: ${result.problem?.message ?? "GitHub sync failed."}`;
  }
  if (result.state === "busy") {
    return `${label} is already syncing; its rows update when that sync finishes.`;
  }
  const waiting =
    result.problem?.code === "storage_unavailable"
      ? ` ${result.problem.message}`
      : "";
  if (result.state === "unchanged") {
    return `${label} is up to date with GitHub at ${commit}.${waiting}`;
  }
  const changes = [
    result.created && `${result.created} added`,
    result.updated && `${result.updated} updated`,
    result.renamed && `${result.renamed} renamed`,
    result.trashed && `${result.trashed} moved to Trash`,
  ].filter(Boolean);
  const done = changes.length ? changes.join(", ") : "no row changes";
  return result.state === "partial"
    ? `${label} is partway to ${commit}: ${done}; ${result.remaining} files left. Sync again to continue.${waiting}`
    : `${label} synced to ${commit}: ${done}.${waiting}`;
}

/** The GitHub link on a collection, if it has one. */
export async function readLinkedGitHubSource(databaseId: string) {
  const [source] = await getDb()
    .select({
      id: schema.contentDatabaseSources.id,
      sourceName: schema.contentDatabaseSources.sourceName,
    })
    .from(schema.contentDatabaseSources)
    .where(
      and(
        eq(schema.contentDatabaseSources.databaseId, databaseId),
        eq(schema.contentDatabaseSources.sourceType, GITHUB_SOURCE_TYPE),
      ),
    )
    .limit(1);
  return source ?? null;
}
