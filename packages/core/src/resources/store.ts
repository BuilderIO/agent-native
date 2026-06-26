import crypto from "crypto";

import {
  getDbExec,
  isPostgres,
  intType,
  retryOnDdlRace,
  type DbExec,
} from "../db/client.js";
import { ensureColumnExists, ensureTableExists } from "../db/ddl-guard.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";
import {
  canUseLocalWorkspaceResourcePath,
  deleteLocalWorkspaceResource,
  isLocalWorkspaceResourceId,
  isLocalWorkspaceResourcesEnabled,
  listLocalWorkspaceResources,
  localWorkspaceResourcePathFromId,
  readLocalWorkspaceResource,
  writeLocalWorkspaceResource,
  type LocalWorkspaceResourceFile,
  type LocalWorkspaceResourceMeta,
} from "../local-artifacts/index.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import type { StoreWriteOptions } from "../settings/store.js";
import { emitResourceChange, emitResourceDelete } from "./emitter.js";

export const SHARED_OWNER = "__shared__";
export const WORKSPACE_OWNER = "__workspace__";

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function prefixLike(value: string): string {
  return `${escapeLike(value)}%`;
}

export interface Resource {
  id: string;
  path: string;
  owner: string;
  content: string;
  mimeType: string;
  size: number;
  createdAt: number;
  updatedAt: number;
  createdBy: ResourceCreatedBy;
  visibility: ResourceVisibility;
  threadId: string | null;
  runId: string | null;
  expiresAt: number | null;
  metadata: string | null;
}

export interface ResourceMeta {
  id: string;
  path: string;
  owner: string;
  mimeType: string;
  size: number;
  createdAt: number;
  updatedAt: number;
  createdBy: ResourceCreatedBy;
  visibility: ResourceVisibility;
  threadId: string | null;
  runId: string | null;
  expiresAt: number | null;
  metadata: string | null;
}

export type ResourceCreatedBy = "user" | "agent" | "system";
export type ResourceVisibility = "workspace" | "agent_scratch";

export interface ResourceWriteOptions extends StoreWriteOptions {
  createdBy?: ResourceCreatedBy;
  visibility?: ResourceVisibility;
  threadId?: string | null;
  runId?: string | null;
  expiresAt?: number | null;
  metadata?: string | Record<string, unknown> | null;
}

export interface ResourceListOptions {
  includeAgentScratch?: boolean;
  workspaceAppId?: string | null;
  userEmail?: string | null;
  orgId?: string | null;
}

export interface ResourceResolutionOptions {
  workspaceAppId?: string | null;
  userEmail?: string | null;
  orgId?: string | null;
}

export type ResourceInheritanceScope = "workspace" | "shared" | "personal";

export interface EffectiveResourceLayer {
  scope: ResourceInheritanceScope;
  label: string;
  owner: string;
  resource: ResourceMeta | null;
  exists: boolean;
  effective: boolean;
  overridden: boolean;
  canWrite: boolean;
}

export interface EffectiveResourceContext {
  path: string;
  effectiveResource: ResourceMeta | null;
  effectiveScope: ResourceInheritanceScope | null;
  layers: EffectiveResourceLayer[];
}

let _initPromise: Promise<void> | undefined;
let _lastScratchCleanupAt = 0;

const AGENT_SCRATCH_TTL_MS = 24 * 60 * 60 * 1000;
const SCRATCH_CLEANUP_INTERVAL_MS = 60 * 1000;
const RESOURCE_META_SELECT =
  "id, path, owner, mime_type, size, created_at, updated_at, created_by, visibility, thread_id, run_id, expires_at, metadata";
const DISPATCH_WORKSPACE_RESOURCE_ID_PREFIX = "dispatch-workspace-resource:";
const DISPATCH_WORKSPACE_RESOURCE_METADATA_SOURCE =
  "dispatch-workspace-resource";
export const LOCAL_WORKSPACE_RESOURCE_METADATA_SOURCE =
  "local-workspace-resource";

const DEFAULT_LEARNINGS_SHARED_MD = `# Learnings

User preferences, corrections, and patterns. The agent reads this at the start of every conversation.

Keep this file tidy — revise, consolidate, and remove outdated entries. Don't just append forever.

## Preferences

## Corrections

## Patterns
`;

const DEFAULT_LEARNINGS_PERSONAL_MD = `# My Learnings

Personal preferences, corrections, and patterns — only visible to you.

## Preferences

## Corrections

## Patterns
`;

const DEFAULT_SKILL_LEARN_MD = `---
name: learn
description: >-
  Review the conversation and save structured memories for future sessions.
user-invocable: true
---

# Learn

Review the current conversation and save anything worth remembering using the structured memory system.

## Memory types

- **user** — Preferences, role, personal context, contacts
- **feedback** — Corrections ("don't do X, do Y instead"), confirmed approaches
- **project** — Ongoing work context, decisions, status
- **reference** — Pointers to external systems, URLs, API details

## Steps

1. Review the conversation for new insights
2. Check your memory index with the \`resources\` tool: \`action: "read"\`, \`path: "memory/MEMORY.md"\`
3. For each new insight, use \`save-memory\` with a descriptive name, type, and content
4. If updating an existing memory, read it first with the \`resources\` tool (\`action: "read"\`, \`path: "memory/<name>.md"\`), then save with merged content

## What NOT to capture

- Things obvious from reading the code
- Standard language/framework behavior
- Temporary debugging notes
- Anything already in AGENTS.md or other skills

Keep one memory per logical topic. Descriptions should be concise — the index is loaded every conversation.
`;

const DEFAULT_SKILL_LEARN_SHARED_MD = `---
name: learn-shared
description: >-
  Update the shared LEARNINGS.md with team-wide preferences, corrections, and
  patterns from this session.
user-invocable: true
---

# Learn (Shared)

Review the current conversation and update the shared \`LEARNINGS.md\` resource with anything the whole team should know.

## What to capture

- **Team conventions** — agreed-upon approaches, code style decisions
- **Technical learnings** — API quirks, library gotchas, surprising behavior
- **Architectural decisions** — why something is done a certain way
- **Corrections** — mistakes that any team member's agent should avoid

## What NOT to capture

- Personal preferences (use \`/learn\` for those)
- Things obvious from reading the code
- Standard language/framework behavior

## Steps

1. Read shared learnings with the \`resources\` tool: \`action: "read"\`, \`path: "LEARNINGS.md"\`, \`scope: "shared"\`
2. Review the conversation for team-relevant insights
3. Merge new learnings with existing ones — don't duplicate, refine existing entries
4. Write back with the \`resources\` tool: \`action: "write"\`, \`path: "LEARNINGS.md"\`, \`scope: "shared"\`, \`content: "..."\`

Keep entries concise — one line per learning, grouped by category (Conventions, Technical, Patterns).
`;

const DEFAULT_AGENTS_SHARED_MD = `# Agent Instructions

This file customizes how the AI agent behaves in this app. Edit it to add your own instructions, preferences, and context.

Workspace-level resources managed from Dispatch are inherited before this file.
Use this shared app/organization file to override or narrow those defaults for
this app or team.

## What to put here

- **Preferences** — Tone, style, verbosity, response format
- **Context** — Domain knowledge, terminology, team conventions
- **Rules** — Things the agent should always/never do
- **Skills** — Reference skill files for specialized tasks (create them in the \`skills/\` folder)

## Skills

You can create skill files to give the agent specialized knowledge for specific tasks. Create resources under \`skills/<name>/SKILL.md\` (e.g., \`skills/data-analysis/SKILL.md\`, \`skills/code-review/SKILL.md\`) and reference them here:

| Skill | Path | Description |
|-------|------|-------------|
| *(add your skills here)* | \`skills/example/SKILL.md\` | What this skill teaches the agent |

The agent will read the relevant skill file when performing that type of task.

## Global instructions

Put always-on guardrails in this shared \`AGENTS.md\`. For separate policy files that should also apply every turn, create shared resources under \`instructions/<name>.md\`. These are loaded automatically with this file.

## Shared reference resources

Put company, brand, positioning, persona, product, or messaging context in shared resources under paths like \`context/core-positioning.md\` or \`context/brand-guidelines.md\`. The agent sees an index of shared reference resources and reads the relevant files when a task may depend on them.

## Workspace files

Workspace resources are for files users intentionally add, edit, or manage. Agents may create hidden \`agent_scratch\` resources for temporary working notes, scripts, or intermediate results; only promote those files into workspace visibility when a user explicitly asks to keep them.

## Example

\`\`\`markdown
## Tone
Be concise. Lead with the answer. Skip filler.

## Code style
- Use TypeScript, never JavaScript
- Prefer named exports
- Use early returns

## Domain context
We sell B2B SaaS. Our customers are enterprise engineering teams.
\`\`\`
`;

const DEFAULT_AGENTS_PERSONAL_MD = `# My Agent Instructions

Personal agent instructions — only visible to you. Use this for your own contacts, preferences, and context.

## Contacts

Add people you frequently interact with so the agent can resolve names like "email my wife" or "message John":

| Name | Email | Notes |
|------|-------|-------|
| *(add your contacts here)* | | |

## Preferences

## Context

## Workspace files

Files you create here are user-facing. Temporary agent working files should stay hidden as \`agent_scratch\` unless you ask the agent to keep them.
`;

async function migrateDefaultResourcePath({
  client,
  owner,
  fromPath,
  toPath,
  defaultContent,
}: {
  client: DbExec;
  owner: string;
  fromPath: string;
  toPath: string;
  defaultContent: string;
}): Promise<void> {
  try {
    const existing = await client.execute({
      sql: `SELECT id, content FROM resources WHERE owner = ? AND path = ?`,
      args: [owner, fromPath],
    });
    const row = existing.rows?.[0] as
      | { id: string; content: string }
      | undefined;
    if (!row || row.content !== defaultContent) return;

    const destination = await client.execute({
      sql: `SELECT id FROM resources WHERE owner = ? AND path = ?`,
      args: [owner, toPath],
    });
    if ((destination.rows?.length ?? 0) > 0) return;

    await client.execute({
      sql: `UPDATE resources SET path = ?, updated_at = ? WHERE id = ?`,
      args: [toPath, Date.now(), row.id],
    });
  } catch {
    // Best-effort compatibility migration; seeding below still works if it fails.
  }
}

function isDuplicateColumnError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const message = String((err as { message?: unknown })?.message ?? err)
    .toLowerCase()
    .trim();
  return (
    code === "42701" ||
    message.includes("duplicate column") ||
    message.includes("already exists")
  );
}

async function ensureResourceColumn(
  client: DbExec,
  definition: string,
): Promise<void> {
  try {
    await retryOnDdlRace(() =>
      client.execute(`ALTER TABLE resources ADD COLUMN ${definition}`),
    );
  } catch (err) {
    if (!isDuplicateColumnError(err)) throw err;
  }
}

function normalizeCreatedBy(value: unknown): ResourceCreatedBy {
  return value === "agent" || value === "system" || value === "user"
    ? value
    : "user";
}

function normalizeVisibility(value: unknown): ResourceVisibility {
  return value === "agent_scratch" ? "agent_scratch" : "workspace";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasOption<K extends keyof ResourceWriteOptions>(
  options: ResourceWriteOptions | undefined,
  key: K,
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(options ?? {}, key) &&
    options?.[key] !== undefined
  );
}

function serializeMetadata(
  value: ResourceWriteOptions["metadata"] | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function scratchFilterSql(options?: ResourceListOptions): string {
  return options?.includeAgentScratch === true
    ? ""
    : " AND (visibility IS NULL OR visibility != 'agent_scratch')";
}

function normalizeWorkspaceAppId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = trimmed.replace(/^\/+/, "").split("/")[0] ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(candidate)) return null;
  return candidate;
}

function workspaceAppIdFromBasePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return normalizeWorkspaceAppId(value);
}

function currentWorkspaceAppId(explicit?: string | null): string | null {
  return (
    normalizeWorkspaceAppId(explicit) ??
    normalizeWorkspaceAppId(process.env.AGENT_NATIVE_WORKSPACE_APP_ID) ??
    normalizeWorkspaceAppId(process.env.APP_NAME) ??
    normalizeWorkspaceAppId(process.env.AGENT_APP) ??
    workspaceAppIdFromBasePath(process.env.APP_BASE_PATH) ??
    workspaceAppIdFromBasePath(process.env.VITE_APP_BASE_PATH)
  );
}

function requestScopedResourceIdentity(options?: ResourceResolutionOptions): {
  userEmail: string | null;
  orgId: string | null;
} {
  const userEmail = options?.userEmail ?? getRequestUserEmail() ?? null;
  const orgId = options?.orgId ?? getRequestOrgId() ?? null;
  return { userEmail, orgId };
}

function workspaceResourceMimeType(path: string): string {
  return path.endsWith(".json") ? "application/json" : "text/markdown";
}

function syntheticWorkspaceResourceId(resourceId: string): string {
  return `${DISPATCH_WORKSPACE_RESOURCE_ID_PREFIX}${resourceId}`;
}

function physicalWorkspaceResourceId(id: string): string | null {
  return id.startsWith(DISPATCH_WORKSPACE_RESOURCE_ID_PREFIX)
    ? id.slice(DISPATCH_WORKSPACE_RESOURCE_ID_PREFIX.length)
    : null;
}

function rowToGrantedWorkspaceResource(row: any): Resource {
  const content = String(row.content ?? "");
  const path = String(row.path ?? "");
  return {
    id: syntheticWorkspaceResourceId(String(row.id)),
    path,
    owner: WORKSPACE_OWNER,
    content,
    mimeType: workspaceResourceMimeType(path),
    size: Buffer.byteLength(content, "utf8"),
    createdAt: Number(row.created_at ?? Date.now()),
    updatedAt: Number(row.updated_at ?? Date.now()),
    createdBy: "system",
    visibility: "workspace",
    threadId: null,
    runId: null,
    expiresAt: null,
    metadata: JSON.stringify({
      source: DISPATCH_WORKSPACE_RESOURCE_METADATA_SOURCE,
      resourceId: String(row.id),
      grantId: row.grant_id ? String(row.grant_id) : null,
      kind: row.kind ?? null,
      name: row.name ?? null,
      description: row.description ?? null,
      scope: "selected",
      appId: row.app_id ?? null,
      updatedAt: Number(row.updated_at ?? Date.now()),
    }),
  };
}

function localResourceTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function localWorkspaceResourceMetadata(
  resource: LocalWorkspaceResourceMeta,
): string {
  return JSON.stringify({
    source: LOCAL_WORKSPACE_RESOURCE_METADATA_SOURCE,
    absolutePath: resource.absolutePath,
    hash: resource.hash,
    mtimeMs: resource.mtimeMs,
  });
}

function localWorkspaceResourceToResource(
  resource: LocalWorkspaceResourceFile,
): Resource {
  return {
    id: resource.id,
    path: resource.path,
    owner: WORKSPACE_OWNER,
    content: resource.content,
    mimeType: resource.mimeType,
    size: resource.sizeBytes,
    createdAt: localResourceTimestamp(resource.createdAt),
    updatedAt: localResourceTimestamp(resource.updatedAt),
    createdBy: "system",
    visibility: "workspace",
    threadId: null,
    runId: null,
    expiresAt: null,
    metadata: localWorkspaceResourceMetadata(resource),
  };
}

function localWorkspaceResourceToMeta(
  resource: LocalWorkspaceResourceMeta,
): ResourceMeta {
  return {
    id: resource.id,
    path: resource.path,
    owner: WORKSPACE_OWNER,
    mimeType: resource.mimeType,
    size: resource.sizeBytes,
    createdAt: localResourceTimestamp(resource.createdAt),
    updatedAt: localResourceTimestamp(resource.updatedAt),
    createdBy: "system",
    visibility: "workspace",
    threadId: null,
    runId: null,
    expiresAt: null,
    metadata: localWorkspaceResourceMetadata(resource),
  };
}

async function localWorkspaceResourceById(
  id: string,
): Promise<Resource | null> {
  const resourcePath = localWorkspaceResourcePathFromId(id);
  if (!resourcePath) return null;
  const resource = await readLocalWorkspaceResource({ path: resourcePath });
  return resource ? localWorkspaceResourceToResource(resource) : null;
}

async function localWorkspaceResourceByPath(
  resourcePath: string,
): Promise<Resource | null> {
  if (!canUseLocalWorkspaceResourcePath(resourcePath)) return null;
  const resource = await readLocalWorkspaceResource({ path: resourcePath });
  return resource ? localWorkspaceResourceToResource(resource) : null;
}

async function localWorkspaceResourceMetas(
  pathPrefix?: string,
): Promise<ResourceMeta[]> {
  const resources = (await listLocalWorkspaceResources()).map(
    localWorkspaceResourceToMeta,
  );
  if (!pathPrefix) return resources;
  return resources.filter((resource) => resource.path.startsWith(pathPrefix));
}

export async function canWriteLocalWorkspaceResourcePath(
  resourcePath: string,
): Promise<boolean> {
  return (
    canUseLocalWorkspaceResourcePath(resourcePath) &&
    (await isLocalWorkspaceResourcesEnabled())
  );
}

async function shouldHandleWorkspaceResourceAsLocal(resourcePath: string) {
  return (
    (await isLocalWorkspaceResourcesEnabled()) &&
    canUseLocalWorkspaceResourcePath(resourcePath)
  );
}

async function assertWritableWorkspaceResourcePath(resourcePath: string) {
  if (
    (await isLocalWorkspaceResourcesEnabled()) &&
    !canUseLocalWorkspaceResourcePath(resourcePath)
  ) {
    throw new Error(
      "Workspace resources in local file mode must be AGENTS.md, agent-native.json, mcp.config.json, .mcp.json, or under skills/.",
    );
  }
}

export { isLocalWorkspaceResourceId };

function mergeResourceMetas(
  primary: ResourceMeta[],
  inherited: ResourceMeta[],
): ResourceMeta[] {
  const seen = new Set(primary.map((resource) => resource.path));
  const merged = [...primary];
  for (const resource of inherited) {
    if (seen.has(resource.path)) continue;
    seen.add(resource.path);
    merged.push(resource);
  }
  return merged;
}

async function selectGrantedWorkspaceResourceRows(input: {
  resourceId?: string;
  path?: string;
  pathPrefix?: string;
  workspaceAppId?: string | null;
  userEmail?: string | null;
  orgId?: string | null;
}): Promise<any[]> {
  const appId = currentWorkspaceAppId(input.workspaceAppId);
  const { userEmail, orgId } = requestScopedResourceIdentity(input);
  if (!appId || (!userEmail && !orgId)) return [];

  const conditions = ["wr.scope = ?", "wg.status = ?", "wg.app_id = ?"];
  const args: unknown[] = ["selected", "active", appId];

  if (input.resourceId) {
    conditions.push("wr.id = ?");
    args.push(input.resourceId);
  }
  if (input.path) {
    conditions.push("wr.path = ?");
    args.push(input.path);
  }
  if (input.pathPrefix) {
    conditions.push("wr.path LIKE ? ESCAPE '\\'");
    args.push(prefixLike(input.pathPrefix));
  }

  if (orgId) {
    conditions.push("wr.org_id = ?", "wg.org_id = ?");
    args.push(orgId, orgId);
  } else if (userEmail) {
    conditions.push(
      "wr.owner_email = ?",
      "wr.org_id IS NULL",
      "wg.owner_email = ?",
      "wg.org_id IS NULL",
    );
    args.push(userEmail, userEmail);
  }

  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `
      SELECT
        wr.id,
        wr.kind,
        wr.name,
        wr.description,
        wr.path,
        wr.content,
        wr.created_at,
        wr.updated_at,
        wg.id AS grant_id,
        wg.app_id AS app_id
      FROM workspace_resources wr
      INNER JOIN workspace_resource_grants wg ON wg.resource_id = wr.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY wr.updated_at DESC
    `,
    args,
  });
  return rows;
}

async function grantedWorkspaceResources(input: {
  pathPrefix?: string;
  workspaceAppId?: string | null;
  userEmail?: string | null;
  orgId?: string | null;
}): Promise<Resource[]> {
  try {
    const rows = await selectGrantedWorkspaceResourceRows(input);
    return rows.map(rowToGrantedWorkspaceResource);
  } catch {
    // Dispatch workspace-resource tables are optional for standalone apps.
    return [];
  }
}

async function grantedWorkspaceResourceById(
  id: string,
  options?: ResourceResolutionOptions,
): Promise<Resource | null> {
  const resourceId = physicalWorkspaceResourceId(id);
  if (!resourceId) return null;
  try {
    const rows = await selectGrantedWorkspaceResourceRows({
      resourceId,
      workspaceAppId: options?.workspaceAppId,
      userEmail: options?.userEmail,
      orgId: options?.orgId,
    });
    return rows[0] ? rowToGrantedWorkspaceResource(rows[0]) : null;
  } catch {
    return null;
  }
}

async function grantedWorkspaceResourceByPath(
  path: string,
  options?: ResourceResolutionOptions,
): Promise<Resource | null> {
  try {
    const rows = await selectGrantedWorkspaceResourceRows({
      path,
      workspaceAppId: options?.workspaceAppId,
      userEmail: options?.userEmail,
      orgId: options?.orgId,
    });
    return rows[0] ? rowToGrantedWorkspaceResource(rows[0]) : null;
  } catch {
    return null;
  }
}

async function cleanupExpiredAgentScratchResources(
  client: DbExec,
): Promise<void> {
  const now = Date.now();
  if (now - _lastScratchCleanupAt < SCRATCH_CLEANUP_INTERVAL_MS) return;
  _lastScratchCleanupAt = now;
  await client.execute({
    sql: `DELETE FROM resources WHERE visibility = ? AND expires_at IS NOT NULL AND expires_at <= ?`,
    args: ["agent_scratch", now],
  });
}

async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = _doEnsureTable().catch((err) => {
      // Don't cache the rejection — let the next caller retry a fresh init.
      _initPromise = undefined;
      throw err;
    });
  }
  return _initPromise;
}

async function _doEnsureTable(): Promise<void> {
  const client = getDbExec();
  const createSql = `
    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      owner TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT 'text/markdown',
      size ${intType()} NOT NULL DEFAULT 0,
      created_at ${intType()} NOT NULL,
      updated_at ${intType()} NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'user',
      visibility TEXT NOT NULL DEFAULT 'workspace',
      thread_id TEXT,
      run_id TEXT,
      expires_at ${intType()},
      metadata TEXT,
      UNIQUE(path, owner)
    )
  `;

  if (isPostgres()) {
    // Hot path: the `resources` table and its additive columns are virtually
    // always already present in production. Issuing `CREATE TABLE`/`ALTER
    // TABLE` still takes an ACCESS EXCLUSIVE lock that, in a fresh
    // background-worker process behind a concurrent connection on the shared
    // Neon DB, can block ~indefinitely. The ensure* wrappers probe
    // `information_schema` first (plain reads, no lock) and run DDL ONLY for
    // what is actually missing, bounded by a transaction-scoped `lock_timeout`.
    // If a swallowed lock-timeout leaves the schema still missing they RE-PROBE
    // and THROW rather than letting init memoize success against absent schema.
    await ensureTableExists("resources", createSql);
    // Additive columns — guarded so the hot path (columns already present)
    // skips the ACCESS EXCLUSIVE ALTER entirely.
    const pgColumns: Array<[string, string]> = [
      ["created_by", "TEXT NOT NULL DEFAULT 'user'"],
      ["visibility", "TEXT NOT NULL DEFAULT 'workspace'"],
      ["thread_id", "TEXT"],
      ["run_id", "TEXT"],
      ["expires_at", intType()],
      ["metadata", "TEXT"],
    ];
    for (const [col, def] of pgColumns) {
      await ensureColumnExists(
        "resources",
        col,
        `ALTER TABLE resources ADD COLUMN IF NOT EXISTS ${col} ${def}`,
      );
    }
  } else {
    // SQLite (local dev): no lock problem — keep the original behaviour using
    // `retryOnDdlRace` + `ensureResourceColumn` (duplicate-column catch).
    await retryOnDdlRace(() => client.execute(createSql));
    await ensureResourceColumn(
      client,
      "created_by TEXT NOT NULL DEFAULT 'user'",
    );
    await ensureResourceColumn(
      client,
      "visibility TEXT NOT NULL DEFAULT 'workspace'",
    );
    await ensureResourceColumn(client, "thread_id TEXT");
    await ensureResourceColumn(client, "run_id TEXT");
    await ensureResourceColumn(client, `expires_at ${intType()}`);
    await ensureResourceColumn(client, "metadata TEXT");
  }

  // Older deployments have 32-bit timestamp columns; on Postgres the
  // `Date.now()` written on insert/update overflows int4. Widen in place
  // (no-op once done / on fresh DBs).
  await widenIntColumnsToBigInt("resources", [
    "created_at",
    "updated_at",
    "expires_at",
  ]);

  // Seed default shared resources if they don't exist (INSERT OR IGNORE to avoid race conditions)
  const now = Date.now();
  const seedSql = isPostgres()
    ? `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO NOTHING`
    : `INSERT OR IGNORE INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  // AGENTS.md — shared agent instructions
  const agentsSize = Buffer.byteLength(DEFAULT_AGENTS_SHARED_MD, "utf8");
  await client.execute({
    sql: seedSql,
    args: [
      crypto.randomUUID(),
      "AGENTS.md",
      SHARED_OWNER,
      DEFAULT_AGENTS_SHARED_MD,
      "text/markdown",
      agentsSize,
      now,
      now,
    ],
  });

  // LEARNINGS.md — shared learnings (preferences, corrections, patterns)
  const learningsSize = Buffer.byteLength(DEFAULT_LEARNINGS_SHARED_MD, "utf8");
  await client.execute({
    sql: seedSql,
    args: [
      crypto.randomUUID(),
      "LEARNINGS.md",
      SHARED_OWNER,
      DEFAULT_LEARNINGS_SHARED_MD,
      "text/markdown",
      learningsSize,
      now,
      now,
    ],
  });

  await migrateDefaultResourcePath({
    client,
    owner: SHARED_OWNER,
    fromPath: "skills/learn-shared.md",
    toPath: "skills/learn-shared/SKILL.md",
    defaultContent: DEFAULT_SKILL_LEARN_SHARED_MD,
  });

  // skills/learn-shared/SKILL.md — shared skill for updating shared LEARNINGS.md
  const learnSharedSize = Buffer.byteLength(
    DEFAULT_SKILL_LEARN_SHARED_MD,
    "utf8",
  );
  await client.execute({
    sql: seedSql,
    args: [
      crypto.randomUUID(),
      "skills/learn-shared/SKILL.md",
      SHARED_OWNER,
      DEFAULT_SKILL_LEARN_SHARED_MD,
      "text/markdown",
      learnSharedSize,
      now,
      now,
    ],
  });

  // Seed built-in agents as shared resources under remote-agents/. ALWAYS
  // use the production URL here, never the env-resolved devUrl. The seed
  // runs once per DB (ON CONFLICT DO NOTHING), so a localhost URL written
  // during a dev run sticks forever — including when that DB is later used
  // by a prod deploy and the override wins over the built-in's prod URL.
  // (Verified problem: `dispatch.agent-native.com` had every remote-agents
  // entry pointing at localhost from an early-seed run, breaking call-agent
  // outbound from Lambda for ~12h before this was caught.)
  try {
    const { getBuiltinAgents, BUILTIN_AGENTS_FOR_SEEDING } =
      await import("../server/agent-discovery.js");
    void getBuiltinAgents; // referenced to keep type-only import alive
    const builtins = BUILTIN_AGENTS_FOR_SEEDING;
    for (const agent of builtins) {
      const agentJson = JSON.stringify(
        {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          url: agent.url, // always prod
          color: agent.color,
        },
        null,
        2,
      );
      const agentSize = Buffer.byteLength(agentJson, "utf8");
      await client.execute({
        sql: seedSql,
        args: [
          crypto.randomUUID(),
          `remote-agents/${agent.id}.json`,
          SHARED_OWNER,
          agentJson,
          "application/json",
          agentSize,
          now,
          now,
        ],
      });
    }
  } catch {
    // Agent discovery not available — skip seeding
  }

  // One-time migration: rename legacy agents/*.json (A2A manifests) to
  // remote-agents/*.json so they live in their own folder, separate from
  // custom agents (agents/*.md).
  try {
    const legacy = await client.execute({
      sql: `SELECT id, path FROM resources WHERE path LIKE ? AND path LIKE ?`,
      args: ["agents/%", "%.json"],
    });
    const rows = (legacy.rows ?? []) as Array<{ id: string; path: string }>;
    for (const row of rows) {
      const newPath = row.path.replace(/^agents\//, "remote-agents/");
      try {
        await client.execute({
          sql: `UPDATE resources SET path = ?, updated_at = ? WHERE id = ?`,
          args: [newPath, Date.now(), row.id],
        });
      } catch {
        // Skip if destination path already exists (unique constraint) —
        // we'll leave the old row in place; readers accept both paths and
        // canonical remote-agents/ entries win when both exist.
      }
    }
  } catch {
    // Migration best-effort
  }
}

const _personalSeeded = new Set<string>();

/**
 * Seed personal AGENTS.md and LEARNINGS.md for a user if they don't exist.
 * Called when listing resources or from the agent chat plugin.
 */
export async function ensurePersonalDefaults(owner: string): Promise<void> {
  if (
    owner === SHARED_OWNER ||
    owner === WORKSPACE_OWNER ||
    _personalSeeded.has(owner)
  ) {
    return;
  }
  await ensureTable();

  const client = getDbExec();
  const now = Date.now();
  const seedSql = isPostgres()
    ? `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO NOTHING`
    : `INSERT OR IGNORE INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  const agentsSize = Buffer.byteLength(DEFAULT_AGENTS_PERSONAL_MD, "utf8");
  await client.execute({
    sql: seedSql,
    args: [
      crypto.randomUUID(),
      "AGENTS.md",
      owner,
      DEFAULT_AGENTS_PERSONAL_MD,
      "text/markdown",
      agentsSize,
      now,
      now,
    ],
  });

  const learningsSize = Buffer.byteLength(
    DEFAULT_LEARNINGS_PERSONAL_MD,
    "utf8",
  );
  await client.execute({
    sql: seedSql,
    args: [
      crypto.randomUUID(),
      "LEARNINGS.md",
      owner,
      DEFAULT_LEARNINGS_PERSONAL_MD,
      "text/markdown",
      learningsSize,
      now,
      now,
    ],
  });

  // memory/MEMORY.md — personal structured memory index
  const memoryIndexContent = "# Memory Index\n";
  const memoryIndexSize = Buffer.byteLength(memoryIndexContent, "utf8");
  await client.execute({
    sql: seedSql,
    args: [
      crypto.randomUUID(),
      "memory/MEMORY.md",
      owner,
      memoryIndexContent,
      "text/markdown",
      memoryIndexSize,
      now,
      now,
    ],
  });

  await migrateDefaultResourcePath({
    client,
    owner,
    fromPath: "skills/learn.md",
    toPath: "skills/learn/SKILL.md",
    defaultContent: DEFAULT_SKILL_LEARN_MD,
  });

  // skills/learn/SKILL.md — personal skill for updating memory
  const learnSize = Buffer.byteLength(DEFAULT_SKILL_LEARN_MD, "utf8");
  await client.execute({
    sql: seedSql,
    args: [
      crypto.randomUUID(),
      "skills/learn/SKILL.md",
      owner,
      DEFAULT_SKILL_LEARN_MD,
      "text/markdown",
      learnSize,
      now,
      now,
    ],
  });

  // Mark seeded only after all seeds succeed. If any await above throws (e.g. a
  // transient DB error), the owner is NOT cached as seeded, so the next request
  // retries instead of permanently skipping seeding. Seeds use INSERT OR IGNORE
  // / ON CONFLICT DO NOTHING, so a concurrent re-run is harmless.
  _personalSeeded.add(owner);
}

function rowToResource(row: any): Resource {
  return {
    id: row.id as string,
    path: row.path as string,
    owner: row.owner as string,
    content: row.content as string,
    mimeType: row.mime_type as string,
    size: Number(row.size),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    createdBy: normalizeCreatedBy(row.created_by),
    visibility: normalizeVisibility(row.visibility),
    threadId: nullableString(row.thread_id),
    runId: nullableString(row.run_id),
    expiresAt: nullableNumber(row.expires_at),
    metadata: nullableString(row.metadata),
  };
}

function rowToMeta(row: any): ResourceMeta {
  return {
    id: row.id as string,
    path: row.path as string,
    owner: row.owner as string,
    mimeType: row.mime_type as string,
    size: Number(row.size),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    createdBy: normalizeCreatedBy(row.created_by),
    visibility: normalizeVisibility(row.visibility),
    threadId: nullableString(row.thread_id),
    runId: nullableString(row.run_id),
    expiresAt: nullableNumber(row.expires_at),
    metadata: nullableString(row.metadata),
  };
}

function resourceToMeta(resource: Resource): ResourceMeta {
  const { content: _content, ...meta } = resource;
  return meta;
}

export async function resourceGet(
  id: string,
  options?: ResourceResolutionOptions,
): Promise<Resource | null> {
  await ensureTable();
  if (isLocalWorkspaceResourceId(id)) {
    return localWorkspaceResourceById(id);
  }
  const client = getDbExec();
  await cleanupExpiredAgentScratchResources(client);
  const { rows } = await client.execute({
    sql: `SELECT * FROM resources WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return grantedWorkspaceResourceById(id, options);
  return rowToResource(rows[0]);
}

export async function resourceGetByPath(
  owner: string,
  path: string,
  options?: ResourceResolutionOptions,
): Promise<Resource | null> {
  await ensureTable();
  if (owner === WORKSPACE_OWNER) {
    const local = await localWorkspaceResourceByPath(path);
    if (local) return local;
  }
  const client = getDbExec();
  await cleanupExpiredAgentScratchResources(client);
  const { rows } = await client.execute({
    sql: `SELECT * FROM resources WHERE owner = ? AND path = ?`,
    args: [owner, path],
  });
  if (rows.length === 0 && owner === WORKSPACE_OWNER) {
    return grantedWorkspaceResourceByPath(path, options);
  }
  if (rows.length === 0) return null;
  return rowToResource(rows[0]);
}

export async function resourcePut(
  owner: string,
  path: string,
  content: string,
  mimeType?: string,
  options?: ResourceWriteOptions,
): Promise<Resource> {
  await ensureTable();
  if (
    owner === WORKSPACE_OWNER &&
    (await shouldHandleWorkspaceResourceAsLocal(path))
  ) {
    const written = await writeLocalWorkspaceResource({ path, content });
    const resource = localWorkspaceResourceToResource({
      ...written,
      content,
    });
    emitResourceChange(
      resource.id,
      resource.path,
      resource.owner,
      options?.requestSource,
    );
    return resource;
  }
  if (owner === WORKSPACE_OWNER) {
    await assertWritableWorkspaceResourcePath(path);
  }
  const client = getDbExec();
  const now = Date.now();
  const size = Buffer.byteLength(content, "utf8");
  const mime = mimeType || "text/markdown";

  // Check for existing resource to preserve ID on upsert
  const { rows: existing } = await client.execute({
    sql: `SELECT id, created_at, created_by, visibility, thread_id, run_id, expires_at, metadata FROM resources WHERE owner = ? AND path = ?`,
    args: [owner, path],
  });
  const existingRow = existing[0] as
    | {
        id: string;
        created_at: number;
        created_by?: string | null;
        visibility?: string | null;
        thread_id?: string | null;
        run_id?: string | null;
        expires_at?: number | null;
        metadata?: string | null;
      }
    | undefined;

  const id =
    existing.length > 0 ? (existingRow?.id as string) : crypto.randomUUID();
  const createdAt = existingRow ? Number(existingRow.created_at) : now;
  const createdBy = normalizeCreatedBy(
    hasOption(options, "createdBy")
      ? options?.createdBy
      : existingRow?.created_by,
  );
  const visibility = normalizeVisibility(
    hasOption(options, "visibility")
      ? options?.visibility
      : existingRow?.visibility,
  );
  const threadId = hasOption(options, "threadId")
    ? (options?.threadId ?? null)
    : nullableString(existingRow?.thread_id);
  const runId = hasOption(options, "runId")
    ? (options?.runId ?? null)
    : nullableString(existingRow?.run_id);
  let expiresAt = hasOption(options, "expiresAt")
    ? (options?.expiresAt ?? null)
    : nullableNumber(existingRow?.expires_at);
  if (visibility === "agent_scratch" && expiresAt === null) {
    expiresAt = now + AGENT_SCRATCH_TTL_MS;
  }
  if (visibility === "workspace" && !hasOption(options, "expiresAt")) {
    expiresAt = null;
  }
  const serializedMetadata = serializeMetadata(options?.metadata);
  const metadata =
    serializedMetadata !== undefined
      ? serializedMetadata
      : nullableString(existingRow?.metadata);

  await client.execute({
    sql: isPostgres()
      ? `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at, created_by, visibility, thread_id, run_id, expires_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO UPDATE SET id=EXCLUDED.id, content=EXCLUDED.content, mime_type=EXCLUDED.mime_type, size=EXCLUDED.size, updated_at=EXCLUDED.updated_at, created_by=EXCLUDED.created_by, visibility=EXCLUDED.visibility, thread_id=EXCLUDED.thread_id, run_id=EXCLUDED.run_id, expires_at=EXCLUDED.expires_at, metadata=EXCLUDED.metadata`
      : `INSERT OR REPLACE INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at, created_by, visibility, thread_id, run_id, expires_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      path,
      owner,
      content,
      mime,
      size,
      createdAt,
      now,
      createdBy,
      visibility,
      threadId,
      runId,
      expiresAt,
      metadata,
    ],
  });

  emitResourceChange(id, path, owner, options?.requestSource);

  return {
    id,
    path,
    owner,
    content,
    mimeType: mime,
    size,
    createdAt,
    updatedAt: now,
    createdBy,
    visibility,
    threadId,
    runId,
    expiresAt,
    metadata,
  };
}

export async function resourceDelete(id: string): Promise<boolean> {
  await ensureTable();
  if (isLocalWorkspaceResourceId(id)) {
    const resourcePath = localWorkspaceResourcePathFromId(id);
    if (!resourcePath) return false;
    const deleted = await deleteLocalWorkspaceResource({ path: resourcePath });
    if (deleted) {
      emitResourceDelete(id, resourcePath, WORKSPACE_OWNER);
    }
    return deleted;
  }
  const client = getDbExec();

  // Get resource info for emitter before deleting
  const { rows } = await client.execute({
    sql: `SELECT path, owner FROM resources WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return false;

  const result = await client.execute({
    sql: `DELETE FROM resources WHERE id = ?`,
    args: [id],
  });
  const deleted = result.rowsAffected > 0;
  if (deleted) {
    emitResourceDelete(id, rows[0].path as string, rows[0].owner as string);
  }
  return deleted;
}

export async function resourceDeleteByPath(
  owner: string,
  path: string,
): Promise<boolean> {
  await ensureTable();
  if (
    owner === WORKSPACE_OWNER &&
    (await shouldHandleWorkspaceResourceAsLocal(path))
  ) {
    const existing = await localWorkspaceResourceByPath(path);
    const deleted = await deleteLocalWorkspaceResource({ path });
    if (deleted) {
      emitResourceDelete(existing?.id ?? "", path, WORKSPACE_OWNER);
      return true;
    }
  }
  if (owner === WORKSPACE_OWNER) {
    await assertWritableWorkspaceResourcePath(path);
  }
  const client = getDbExec();

  // Get resource info for emitter before deleting
  const { rows } = await client.execute({
    sql: `SELECT id FROM resources WHERE owner = ? AND path = ?`,
    args: [owner, path],
  });
  if (rows.length === 0) return false;

  const result = await client.execute({
    sql: `DELETE FROM resources WHERE owner = ? AND path = ?`,
    args: [owner, path],
  });
  const deleted = result.rowsAffected > 0;
  if (deleted) {
    emitResourceDelete(rows[0].id as string, path, owner);
  }
  return deleted;
}

export async function resourceList(
  owner: string,
  pathPrefix?: string,
  options?: ResourceListOptions,
): Promise<ResourceMeta[]> {
  await ensureTable();
  const client = getDbExec();
  await cleanupExpiredAgentScratchResources(client);
  const visibilitySql = scratchFilterSql(options);

  if (pathPrefix) {
    const { rows } = await client.execute({
      sql: `SELECT ${RESOURCE_META_SELECT} FROM resources WHERE owner = ? AND path LIKE ? ESCAPE '\\'${visibilitySql}`,
      args: [owner, prefixLike(pathPrefix)],
    });
    const resources = rows.map(rowToMeta);
    if (owner !== WORKSPACE_OWNER) return resources;
    const local = await localWorkspaceResourceMetas(pathPrefix);
    const granted = await grantedWorkspaceResources({
      pathPrefix,
      workspaceAppId: options?.workspaceAppId,
      userEmail: options?.userEmail,
      orgId: options?.orgId,
    });
    return mergeResourceMetas(
      local,
      mergeResourceMetas(resources, granted.map(resourceToMeta)),
    );
  }

  const { rows } = await client.execute({
    sql: `SELECT ${RESOURCE_META_SELECT} FROM resources WHERE owner = ?${visibilitySql}`,
    args: [owner],
  });
  const resources = rows.map(rowToMeta);
  if (owner !== WORKSPACE_OWNER) return resources;
  const local = await localWorkspaceResourceMetas();
  const granted = await grantedWorkspaceResources({
    workspaceAppId: options?.workspaceAppId,
    userEmail: options?.userEmail,
    orgId: options?.orgId,
  });
  return mergeResourceMetas(
    local,
    mergeResourceMetas(resources, granted.map(resourceToMeta)),
  );
}

export async function resourceListAccessible(
  userEmail: string,
  pathPrefix?: string,
  options?: ResourceListOptions,
): Promise<ResourceMeta[]> {
  await ensureTable();
  const client = getDbExec();
  await cleanupExpiredAgentScratchResources(client);
  const visibilitySql = scratchFilterSql(options);

  if (pathPrefix) {
    const { rows } = await client.execute({
      sql: `SELECT ${RESOURCE_META_SELECT} FROM resources WHERE owner = ? AND path LIKE ? ESCAPE '\\'${visibilitySql}
            UNION
            SELECT ${RESOURCE_META_SELECT} FROM resources WHERE owner = ? AND path LIKE ? ESCAPE '\\'${visibilitySql}
            UNION
            SELECT ${RESOURCE_META_SELECT} FROM resources WHERE owner = ? AND path LIKE ? ESCAPE '\\'${visibilitySql}`,
      args: [
        userEmail,
        prefixLike(pathPrefix),
        SHARED_OWNER,
        prefixLike(pathPrefix),
        WORKSPACE_OWNER,
        prefixLike(pathPrefix),
      ],
    });
    const resources = rows.map(rowToMeta);
    const local = await localWorkspaceResourceMetas(pathPrefix);
    const granted = await grantedWorkspaceResources({
      pathPrefix,
      workspaceAppId: options?.workspaceAppId,
      userEmail,
      orgId: options?.orgId,
    });
    return mergeResourceMetas(
      local,
      mergeResourceMetas(resources, granted.map(resourceToMeta)),
    );
  }

  const { rows } = await client.execute({
    sql: `SELECT ${RESOURCE_META_SELECT} FROM resources WHERE owner = ?${visibilitySql}
          UNION
          SELECT ${RESOURCE_META_SELECT} FROM resources WHERE owner = ?${visibilitySql}
          UNION
          SELECT ${RESOURCE_META_SELECT} FROM resources WHERE owner = ?${visibilitySql}`,
    args: [userEmail, SHARED_OWNER, WORKSPACE_OWNER],
  });
  const resources = rows.map(rowToMeta);
  const local = await localWorkspaceResourceMetas();
  const granted = await grantedWorkspaceResources({
    workspaceAppId: options?.workspaceAppId,
    userEmail,
    orgId: options?.orgId,
  });
  return mergeResourceMetas(
    local,
    mergeResourceMetas(resources, granted.map(resourceToMeta)),
  );
}

export async function resourceEffectiveContext(
  userEmail: string,
  path: string,
  options?: ResourceResolutionOptions,
): Promise<EffectiveResourceContext> {
  await ensureTable();

  const workspace = await resourceGetByPath(WORKSPACE_OWNER, path, {
    ...options,
    userEmail,
  });
  const shared = await resourceGetByPath(SHARED_OWNER, path);
  const personal = await resourceGetByPath(userEmail, path);
  const effective = personal ?? shared ?? workspace ?? null;
  const effectiveScope: ResourceInheritanceScope | null = personal
    ? "personal"
    : shared
      ? "shared"
      : workspace
        ? "workspace"
        : null;

  const layerDefs: Array<{
    scope: ResourceInheritanceScope;
    label: string;
    owner: string;
    resource: Resource | null;
    canWrite: boolean;
  }> = [
    {
      scope: "workspace",
      label: "Workspace default",
      owner: WORKSPACE_OWNER,
      resource: workspace,
      canWrite: workspace ? isLocalWorkspaceResourceId(workspace.id) : false,
    },
    {
      scope: "shared",
      label: "Organization/app override",
      owner: SHARED_OWNER,
      resource: shared,
      canWrite: true,
    },
    {
      scope: "personal",
      label: "Personal override",
      owner: userEmail,
      resource: personal,
      canWrite: true,
    },
  ];

  return {
    path,
    effectiveResource: effective ? resourceToMeta(effective) : null,
    effectiveScope,
    layers: layerDefs.map((layer) => ({
      scope: layer.scope,
      label: layer.label,
      owner: layer.owner,
      resource: layer.resource ? resourceToMeta(layer.resource) : null,
      exists: !!layer.resource,
      effective: !!layer.resource && layer.resource.id === effective?.id,
      overridden: !!layer.resource && layer.resource.id !== effective?.id,
      canWrite: layer.canWrite,
    })),
  };
}

/**
 * List all resources matching a path prefix across ALL owners.
 * Used by the recurring jobs scheduler to find all job resources.
 */
export async function resourceListAllOwners(
  pathPrefix: string,
): Promise<Resource[]> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM resources WHERE path LIKE ? ESCAPE '\\'`,
    args: [prefixLike(pathPrefix)],
  });
  const localResources = (
    await Promise.all(
      (
        await localWorkspaceResourceMetas(pathPrefix)
      ).map((resource) => resourceGet(resource.id)),
    )
  ).filter((resource): resource is Resource => !!resource);
  const localPaths = new Set(localResources.map((resource) => resource.path));
  return [
    ...localResources,
    ...rows
      .map(rowToResource)
      .filter((resource) => !localPaths.has(resource.path)),
  ];
}

export async function resourceMove(
  id: string,
  newPath: string,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();

  // Get current resource info
  const { rows } = await client.execute({
    sql: `SELECT path, owner FROM resources WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return false;

  const result = await client.execute({
    sql: `UPDATE resources SET path = ?, updated_at = ? WHERE id = ?`,
    args: [newPath, now, id],
  });
  const moved = result.rowsAffected > 0;
  if (moved) {
    emitResourceChange(id, newPath, rows[0].owner as string);
  }
  return moved;
}
