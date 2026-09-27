import crypto from "crypto";

import { getDbExec, type DbExec } from "../db/client.js";
import {
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
} from "../db/ddl-guard.js";
import { widenIntColumnsToBigInt } from "../db/widen-columns.js";
import {
  canUseLocalWorkspaceResourcePath,
  deleteLocalWorkspaceResource,
  deleteLocalWorkspaceResourceIfCurrent,
  isLocalWorkspaceResourceId,
  isLocalWorkspaceResourcesEnabled,
  listLocalWorkspaceResources,
  localWorkspaceResourcePathFromId,
  readLocalWorkspaceResource,
  writeLocalWorkspaceResourceIfAbsentAtPath,
  writeLocalWorkspaceResourceIfCurrent,
  writeLocalWorkspaceResource,
  type LocalWorkspaceResourceFile,
  type LocalWorkspaceResourceMeta,
} from "../local-artifacts/index.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../server/request-context.js";
import {
  getSetting,
  putSetting,
  type StoreWriteOptions,
} from "../settings/store.js";
import { emitResourceChange, emitResourceDelete } from "./emitter.js";

export const SHARED_OWNER = "__shared__";
export const WORKSPACE_OWNER = "__workspace__";
const ORGANIZATION_OWNER_PREFIX = "__organization__:";
const WORKSPACE_ORGANIZATION_OWNER_PREFIX = `${WORKSPACE_OWNER}:`;

export function organizationResourceOwner(orgId: string): string {
  const normalized = orgId.trim();
  if (!normalized) {
    throw new Error("organizationResourceOwner requires a non-empty orgId");
  }
  return `${ORGANIZATION_OWNER_PREFIX}${encodeURIComponent(normalized)}`;
}

export function organizationIdFromResourceOwner(owner: string): string | null {
  if (!owner.startsWith(ORGANIZATION_OWNER_PREFIX)) return null;
  const encoded = owner.slice(ORGANIZATION_OWNER_PREFIX.length);
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export function sharedResourceOwner(orgId?: string | null): string {
  const activeOrgId = orgId === undefined ? (getRequestOrgId() ?? null) : orgId;
  return activeOrgId ? organizationResourceOwner(activeOrgId) : SHARED_OWNER;
}

export function workspaceResourceOwner(orgId?: string | null): string {
  const activeOrgId = orgId === undefined ? (getRequestOrgId() ?? null) : orgId;
  return activeOrgId
    ? `${WORKSPACE_ORGANIZATION_OWNER_PREFIX}${organizationResourceOwner(activeOrgId)}`
    : WORKSPACE_OWNER;
}

export function isWorkspaceResourceOwner(owner: string): boolean {
  return (
    owner === WORKSPACE_OWNER ||
    owner.startsWith(WORKSPACE_ORGANIZATION_OWNER_PREFIX)
  );
}

function isBareWorkspaceResourceOwner(owner: string): boolean {
  return owner === WORKSPACE_OWNER;
}

export function organizationIdFromWorkspaceResourceOwner(
  owner: string,
): string | null {
  if (!owner.startsWith(WORKSPACE_ORGANIZATION_OWNER_PREFIX)) return null;
  return organizationIdFromResourceOwner(
    owner.slice(WORKSPACE_ORGANIZATION_OWNER_PREFIX.length),
  );
}

function isOrganizationWorkspaceResourceVisibleToOrganization(
  owner: string,
  orgId: string | null,
): boolean {
  if (!owner.startsWith(WORKSPACE_ORGANIZATION_OWNER_PREFIX)) return true;
  const ownerOrgId = organizationIdFromWorkspaceResourceOwner(owner);
  return ownerOrgId !== null && ownerOrgId === orgId;
}

function workspaceReadOwners(owner: string, orgId?: string | null): string[] {
  const resolved =
    owner === WORKSPACE_OWNER
      ? workspaceResourceOwner(resourceOrganizationId(orgId))
      : owner;
  return resolved === WORKSPACE_OWNER
    ? [resolved]
    : [resolved, WORKSPACE_OWNER];
}

export function isLegacySharedResourceVisibleToOrganization(
  resource: Pick<ResourceMeta, "owner" | "metadata">,
  orgId?: string | null,
): boolean {
  if (resource.owner !== SHARED_OWNER || resource.metadata === null)
    return true;

  const legacy = legacyOrganizationMetadata(resource.metadata);
  return legacy.kind !== "organization" || legacy.orgId === orgId;
}

type LegacyOrganizationMetadata =
  | { kind: "organization"; orgId: string }
  | { kind: "other" }
  | { kind: "malformed" };

function legacyOrganizationMetadata(
  metadata: string,
): LegacyOrganizationMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch (error) {
    if (error instanceof SyntaxError) return { kind: "malformed" };
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "other" };
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.source !== "workspace-files" ||
    candidate.scope !== "org" ||
    typeof candidate.scopeId !== "string" ||
    !candidate.scopeId
  ) {
    return { kind: "other" };
  }
  return { kind: "organization", orgId: candidate.scopeId };
}

export function isLegacyOrganizationWorkspaceFile(
  resource: Pick<ResourceMeta, "owner" | "metadata">,
  orgId?: string | null,
): boolean {
  if (resource.owner !== SHARED_OWNER || resource.metadata === null)
    return false;
  const legacy = legacyOrganizationMetadata(resource.metadata);
  return legacy.kind === "organization" && legacy.orgId === orgId;
}

function resourceOrganizationId(orgId?: string | null): string | null {
  return orgId === undefined ? (getRequestOrgId() ?? null) : orgId;
}

function legacyDispatchWorkspaceResourceId(
  resource: Pick<ResourceMeta, "owner" | "metadata">,
): string | null {
  if (resource.owner !== WORKSPACE_OWNER || resource.metadata === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(resource.metadata);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  return candidate.source === DISPATCH_WORKSPACE_RESOURCE_METADATA_SOURCE &&
    typeof candidate.resourceId === "string" &&
    candidate.resourceId
    ? candidate.resourceId
    : null;
}

async function filterLegacyDispatchWorkspaceRows<
  T extends Pick<ResourceMeta, "owner" | "metadata">,
>(resources: T[], orgId: string | null): Promise<T[]> {
  const legacyIds = new Set<string>();
  for (const resource of resources) {
    const resourceId = legacyDispatchWorkspaceResourceId(resource);
    if (resourceId) legacyIds.add(resourceId);
  }
  if (legacyIds.size === 0) return resources;

  const ids = [...legacyIds];
  let rows: Awaited<ReturnType<DbExec["execute"]>>["rows"];
  try {
    ({ rows } = await getDbExec().execute({
      sql: `SELECT id, org_id FROM workspace_resources WHERE id IN (${ids.map(() => "?").join(", ")})`,
      args: ids,
    }));
  } catch (error) {
    if (!isMissingResourceSchemaError(error)) throw error;
    return resources.filter(
      (resource) => legacyDispatchWorkspaceResourceId(resource) === null,
    );
  }
  const organizationByResourceId = new Map(
    rows.map((row) => [String(row.id), nullableString(row.org_id)]),
  );
  return resources.filter((resource) => {
    const resourceId = legacyDispatchWorkspaceResourceId(resource);
    if (!resourceId) return true;
    return (
      organizationByResourceId.has(resourceId) &&
      organizationByResourceId.get(resourceId) === orgId
    );
  });
}

function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (char) => `!${char}`);
}

function prefixLike(value: string): string {
  return `${escapeLike(value)}%`;
}

function isMissingResourceSchemaError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate?.code === "42P01" || candidate?.code === "42703") return true;
  const message =
    typeof candidate?.message === "string"
      ? candidate.message.toLowerCase()
      : "";
  return (
    message.includes('relation "resources" does not exist') ||
    (message.includes("column") && message.includes("does not exist"))
  );
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

export interface ResourceContentProjection {
  id: string;
  path: string;
  owner: string;
  content: string;
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

export interface ResourceConditionalWrite {
  owner: string;
  path: string;
  content: string;
  expectedId: string;
  expectedUpdatedAt: number;
  expectedContent: string;
  mimeType?: string;
}

export interface ResourceSnapshotWrite {
  previous: Resource | null;
  owner: string;
  path: string;
  content: string;
  mimeType?: string;
  options?: Pick<
    ResourceWriteOptions,
    "createdBy" | "metadata" | "requestSource"
  >;
}

export interface ResourceSnapshotWriteResult {
  before: Resource | null;
  resource: Resource;
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

async function readProjectRootLearningsSeed(): Promise<string | null> {
  try {
    const [fs, path] = await Promise.all([import("fs"), import("path")]);
    for (const name of ["learnings.md", "learnings.defaults.md"]) {
      const filePath = path.resolve(process.cwd(), name);
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, "utf-8");
      if (content.trim()) return content;
    }
    return null;
  } catch {
    return null;
  }
}

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
  const orgId = resourceOrganizationId(options?.orgId);
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
  const contentLoaded = Object.prototype.hasOwnProperty.call(row, "content");
  const content = String(row.content ?? "");
  const path = String(row.path ?? "");
  const size = contentLoaded
    ? Buffer.byteLength(content, "utf8")
    : Number(row.content_size ?? 0);
  return {
    id: syntheticWorkspaceResourceId(String(row.id)),
    path,
    owner: WORKSPACE_OWNER,
    content,
    mimeType: workspaceResourceMimeType(path),
    size: Number.isFinite(size) ? size : 0,
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

function localWorkspaceResourceMetadataFromResource(
  resource: Pick<Resource, "metadata">,
): { absolutePath: string; hash: string } | null {
  if (!resource.metadata) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(resource.metadata);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  return candidate.source === LOCAL_WORKSPACE_RESOURCE_METADATA_SOURCE &&
    typeof candidate.absolutePath === "string" &&
    typeof candidate.hash === "string"
    ? { absolutePath: candidate.absolutePath, hash: candidate.hash }
    : null;
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

async function selectGrantedWorkspaceResourceRows(
  input: {
    resourceId?: string;
    path?: string;
    pathPrefix?: string;
    workspaceAppId?: string | null;
    userEmail?: string | null;
    orgId?: string | null;
  },
  options: { includeContent?: boolean } = {},
): Promise<any[]> {
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
    conditions.push("wr.path LIKE ? ESCAPE '!'");
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

  const contentSelect =
    options.includeContent === false
      ? `${"octet_length(wr.content)"} AS content_size`
      : "wr.content";
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `
      SELECT
        wr.id,
        wr.kind,
        wr.name,
        wr.description,
        wr.path,
        ${contentSelect},
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
    const rows = await selectGrantedWorkspaceResourceRows(input, {
      includeContent: false,
    });
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

/**
 * Expire agent scratch resources, WITHOUT blocking the read that triggered it.
 *
 * This is garbage collection, not part of any read's answer: a caller asking for
 * one resource does not need yesterday's expired scratch rows gone first. Awaiting
 * it made every read path issue a `DELETE` before its own `SELECT` — double the
 * round trips, unservable by a replica, taking row locks inside a request a user
 * is waiting on, and (since nothing caught it) able to fail the read outright.
 *
 * The throttle is a module-scope timestamp, so it starts at 0 in a fresh isolate
 * and the first resource read after every cold start still triggers one sweep.
 * That is why the index below exists, and why this must not be awaited.
 */
function scheduleExpiredAgentScratchCleanup(client: DbExec): void {
  const now = Date.now();
  if (now - _lastScratchCleanupAt < SCRATCH_CLEANUP_INTERVAL_MS) return;
  _lastScratchCleanupAt = now;
  void client
    .execute({
      sql: `DELETE FROM resources WHERE visibility = ? AND expires_at IS NOT NULL AND expires_at <= ?`,
      args: ["agent_scratch", now],
    })
    .catch((err) => {
      // Say so rather than swallowing: scratch rows accumulating forever is a
      // slow leak nobody would otherwise notice.
      // coercion-ok: failed GC degrades storage over time, never read correctness
      console.warn(
        "[resources] expired agent-scratch cleanup failed; will retry on a later read:",
        (err as Error)?.message ?? err,
      );
    });
}

export async function ensureTable(): Promise<void> {
  if (!_initPromise) {
    _initPromise = _doEnsureTable().catch((err) => {
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
      size BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      -- guard:allow-identity-column - immutable resource creator snapshot
      created_by TEXT NOT NULL DEFAULT 'user',
      visibility TEXT NOT NULL DEFAULT 'workspace',
      thread_id TEXT,
      run_id TEXT,
      expires_at BIGINT,
      metadata TEXT,
      UNIQUE(path, owner)
    )
  `;

  {
    await ensureTableExists("resources", createSql);
    const pgColumns: Array<[string, string]> = [
      ["created_by", "TEXT NOT NULL DEFAULT 'user'"],
      ["visibility", "TEXT NOT NULL DEFAULT 'workspace'"],
      ["thread_id", "TEXT"],
      ["run_id", "TEXT"],
      ["expires_at", "BIGINT"],
      ["metadata", "TEXT"],
    ];
    for (const [col, def] of pgColumns) {
      await ensureColumnExists(
        "resources",
        col,
        `ALTER TABLE resources ADD COLUMN IF NOT EXISTS ${col} ${def}`,
      );
    }
  }

  await widenIntColumnsToBigInt("resources", [
    "created_at",
    "updated_at",
    "expires_at",
  ]);

  await ensureIndexExists(
    "resources_visibility_expires_idx",
    `CREATE INDEX IF NOT EXISTS resources_visibility_expires_idx ON resources (visibility, expires_at)`,
  ).catch((err) => {
    // An index is an optimization, not a correctness requirement: a
    // concurrent creator or a permissions edge must not fail table init and
    // take the app down with it. The scan it avoids is slow, not wrong — but
    // say so, because "silently slow forever" is the outcome nobody notices.
    // coercion-ok: absence of an index degrades latency, never correctness
    console.warn(
      "[resources] could not ensure resources_visibility_expires_idx; scratch cleanup will full-scan:",
      (err as Error)?.message ?? err,
    );
  });

  // Seed default shared resources if they don't exist (INSERT OR IGNORE to avoid
  // race conditions).
  //
  // Guarded by a durable marker: `_doEnsureTable` runs once per PROCESS, which on
  // serverless is once per cold start, so this block was issuing ~10 writes and
  // 2 migration scans per container to insert rows that had existed since day
  // one (53,785 of them in one production sample). The marker makes it once per
  // database, matching what the comments here already assumed.
  //
  // Consequence worth knowing: a default resource the user DELETES is no longer
  // recreated on the next cold start. That silent resurrection was never
  // intended — see `RESOURCE_SEED_VERSION` to force a re-seed.
  if (await alreadySeeded(SHARED_SEED_KEY)) return;

  const now = Date.now();
  const seedSql = `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO NOTHING`;

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

  const learningsSeedContent =
    (await readProjectRootLearningsSeed()) ?? DEFAULT_LEARNINGS_SHARED_MD;
  const learningsSize = Buffer.byteLength(learningsSeedContent, "utf8");
  await client.execute({
    sql: seedSql,
    args: [
      crypto.randomUUID(),
      "LEARNINGS.md",
      SHARED_OWNER,
      learningsSeedContent,
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

  try {
    const { getBuiltinAgents, BUILTIN_AGENTS_FOR_SEEDING } =
      await import("../server/agent-discovery.js");
    void getBuiltinAgents;
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

  await markSeeded(SHARED_SEED_KEY);
}

const RESOURCE_SEED_VERSION = 1;

const _personalSeeded = new Set<string>();

function personalSeedKey(owner: string): string {
  return `resources-seeded:personal:v${RESOURCE_SEED_VERSION}:${owner.toLowerCase()}`;
}

const SHARED_SEED_KEY = `resources-seeded:shared:v${RESOURCE_SEED_VERSION}`;

async function alreadySeeded(key: string): Promise<boolean> {
  try {
    const row = await getSetting(key);
    return row?.at !== undefined;
  } catch {
    // coercion-ok: "not seeded" is the SAFE answer, and it is not indistinguishable from success — it re-runs an idempotent ON CONFLICT DO NOTHING seed, exactly the pre-marker behaviour. Guessing "already seeded" would leave a fresh database permanently without its default AGENTS.md / LEARNINGS.md, which no retry recovers.
    return false;
  }
}

async function markSeeded(key: string): Promise<void> {
  try {
    await putSetting(key, { at: Date.now() });
  } catch {
    // coercion-ok: the marker is an optimization, not state anything reads for correctness. Failing to write it costs one repeat idempotent seed on the next cold start — the pre-marker behaviour — and the seed itself already succeeded, so there is no failure to report to the caller.
  }
}

export async function ensurePersonalDefaults(owner: string): Promise<void> {
  if (
    owner === SHARED_OWNER ||
    isWorkspaceResourceOwner(owner) ||
    _personalSeeded.has(owner)
  ) {
    return;
  }
  await ensureTable();

  const seedKey = personalSeedKey(owner);
  if (await alreadySeeded(seedKey)) {
    _personalSeeded.add(owner);
    return;
  }

  const client = getDbExec();
  const now = Date.now();
  const seedSql = `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO NOTHING`;

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

  _personalSeeded.add(owner);
  await markSeeded(seedKey);
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
  scheduleExpiredAgentScratchCleanup(client);
  const { rows } = await client.execute({
    sql: `SELECT * FROM resources WHERE id = ?`,
    args: [id],
  });
  if (rows.length === 0) return grantedWorkspaceResourceById(id, options);
  const resource = rowToResource(rows[0]);
  const orgId = resourceOrganizationId(options?.orgId);
  if (
    !isOrganizationWorkspaceResourceVisibleToOrganization(resource.owner, orgId)
  ) {
    return null;
  }
  if (!isLegacySharedResourceVisibleToOrganization(resource, orgId)) {
    return null;
  }
  const [visible] = await filterLegacyDispatchWorkspaceRows([resource], orgId);
  return visible ?? null;
}

export async function resourceGetByPath(
  owner: string,
  path: string,
  options?: ResourceResolutionOptions,
): Promise<Resource | null> {
  await ensureTable();
  const orgId = resourceOrganizationId(options?.orgId);
  if (!isOrganizationWorkspaceResourceVisibleToOrganization(owner, orgId)) {
    return null;
  }
  const workspace = isWorkspaceResourceOwner(owner);
  const owners = workspace
    ? workspaceReadOwners(owner, options?.orgId)
    : [owner];
  if (isBareWorkspaceResourceOwner(owners[0])) {
    const local = await localWorkspaceResourceByPath(path);
    if (local) return local;
  }
  const client = getDbExec();
  scheduleExpiredAgentScratchCleanup(client);
  const { rows } = await client.execute({
    sql: `SELECT * FROM resources WHERE owner IN (${owners.map(() => "?").join(", ")}) AND path = ?`,
    args: [...owners, path],
  });
  const ownerRank = new Map(
    owners.map((candidate, index) => [candidate, index]),
  );
  const resources = await filterLegacyDispatchWorkspaceRows(
    rows
      .map(rowToResource)
      .filter((candidate) =>
        isLegacySharedResourceVisibleToOrganization(candidate, orgId),
      )
      .sort(
        (a, b) =>
          (ownerRank.get(a.owner) ?? owners.length) -
          (ownerRank.get(b.owner) ?? owners.length),
      ),
    orgId,
  );
  if (!workspace || isBareWorkspaceResourceOwner(owners[0])) {
    if (resources[0]) return resources[0];
  } else {
    const organizationResource = resources.find(
      (resource) => resource.owner === owners[0],
    );
    if (organizationResource) return organizationResource;
    const local = await localWorkspaceResourceByPath(path);
    if (local) return local;
    if (resources[0]) return resources[0];
  }
  return workspace ? grantedWorkspaceResourceByPath(path, options) : null;
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
    isBareWorkspaceResourceOwner(owner) &&
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
  if (isBareWorkspaceResourceOwner(owner)) {
    await assertWritableWorkspaceResourcePath(path);
  }
  const client = getDbExec();
  const now = Date.now();
  const size = Buffer.byteLength(content, "utf8");
  const mime = mimeType || "text/markdown";

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
    sql: `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at, created_by, visibility, thread_id, run_id, expires_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO UPDATE SET id=EXCLUDED.id, content=EXCLUDED.content, mime_type=EXCLUDED.mime_type, size=EXCLUDED.size, updated_at=EXCLUDED.updated_at, created_by=EXCLUDED.created_by, visibility=EXCLUDED.visibility, thread_id=EXCLUDED.thread_id, run_id=EXCLUDED.run_id, expires_at=EXCLUDED.expires_at, metadata=EXCLUDED.metadata`,
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

export async function resourcePutIfAbsent(
  owner: string,
  path: string,
  content: string,
  mimeType?: string,
  options?: ResourceWriteOptions,
): Promise<Resource | null> {
  return resourcePutIfAbsentInternal(
    owner,
    path,
    content,
    mimeType,
    options,
    true,
  );
}

async function resourcePutIfAbsentInternal(
  owner: string,
  path: string,
  content: string,
  mimeType: string | undefined,
  options: ResourceWriteOptions | undefined,
  emitChange: boolean,
  clientOverride?: DbExec,
): Promise<Resource | null> {
  await ensureTable();
  if (
    isBareWorkspaceResourceOwner(owner) &&
    (await shouldHandleWorkspaceResourceAsLocal(path))
  ) {
    return null;
  }
  if (isBareWorkspaceResourceOwner(owner)) {
    await assertWritableWorkspaceResourcePath(path);
  }

  const client = clientOverride ?? getDbExec();
  const now = Date.now();
  const size = Buffer.byteLength(content, "utf8");
  const mime = mimeType || "text/markdown";
  const id = crypto.randomUUID();
  const createdBy = normalizeCreatedBy(options?.createdBy);
  const visibility = normalizeVisibility(options?.visibility);
  const threadId = hasOption(options, "threadId")
    ? (options?.threadId ?? null)
    : null;
  const runId = hasOption(options, "runId") ? (options?.runId ?? null) : null;
  let expiresAt = hasOption(options, "expiresAt")
    ? (options?.expiresAt ?? null)
    : null;
  if (visibility === "agent_scratch" && expiresAt === null) {
    expiresAt = now + AGENT_SCRATCH_TTL_MS;
  }
  if (visibility === "workspace" && !hasOption(options, "expiresAt")) {
    expiresAt = null;
  }
  const metadata = serializeMetadata(options?.metadata) ?? null;
  const result = await client.execute({
    sql: `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at, created_by, visibility, thread_id, run_id, expires_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO NOTHING`,
    args: [
      id,
      path,
      owner,
      content,
      mime,
      size,
      now,
      now,
      createdBy,
      visibility,
      threadId,
      runId,
      expiresAt,
      metadata,
    ],
  });
  if (result.rowsAffected !== 1) return null;

  if (emitChange) emitResourceChange(id, path, owner, options?.requestSource);

  return {
    id,
    path,
    owner,
    content,
    mimeType: mime,
    size,
    createdAt: now,
    updatedAt: now,
    createdBy,
    visibility,
    threadId,
    runId,
    expiresAt,
    metadata,
  };
}

export async function resourcePutIfCurrent(
  input: ResourceConditionalWrite,
): Promise<Resource | null> {
  await ensureTable();
  if (
    isBareWorkspaceResourceOwner(input.owner) &&
    (await shouldHandleWorkspaceResourceAsLocal(input.path))
  ) {
    return null;
  }
  if (isBareWorkspaceResourceOwner(input.owner)) {
    await assertWritableWorkspaceResourcePath(input.path);
  }

  const client = getDbExec();
  const now = Math.max(Date.now(), input.expectedUpdatedAt + 1);
  const size = Buffer.byteLength(input.content, "utf8");
  const mime = input.mimeType || "text/markdown";
  const result = await client.execute({
    sql: `UPDATE resources SET content = ?, mime_type = ?, size = ?, updated_at = ? WHERE owner = ? AND path = ? AND id = ? AND updated_at = ? AND content = ?`,
    args: [
      input.content,
      mime,
      size,
      now,
      input.owner,
      input.path,
      input.expectedId,
      input.expectedUpdatedAt,
      input.expectedContent,
    ],
  });
  const rowsAffected = (result as unknown as { rowsAffected?: number })
    .rowsAffected;
  if (typeof rowsAffected !== "number" || rowsAffected !== 1) return null;

  const { rows } = await client.execute({
    sql: `SELECT * FROM resources WHERE owner = ? AND path = ? AND id = ?`,
    args: [input.owner, input.path, input.expectedId],
  });
  if (rows.length === 0) return null;
  const resource = rowToResource(rows[0]);
  emitResourceChange(resource.id, resource.path, resource.owner);
  return resource;
}

function resourceSnapshotMatch(resource: Resource) {
  return {
    sql: `owner = ? AND path = ? AND id = ? AND updated_at = ? AND content = ? AND mime_type = ? AND size = ? AND created_at = ? AND created_by = ? AND visibility = ? AND thread_id IS NOT DISTINCT FROM ? AND run_id IS NOT DISTINCT FROM ? AND expires_at IS NOT DISTINCT FROM ? AND metadata IS NOT DISTINCT FROM ?`,
    args: [
      resource.owner,
      resource.path,
      resource.id,
      resource.updatedAt,
      resource.content,
      resource.mimeType,
      resource.size,
      resource.createdAt,
      resource.createdBy,
      resource.visibility,
      resource.threadId,
      resource.runId,
      resource.expiresAt,
      resource.metadata,
    ],
  };
}

function localWorkspaceResourceSnapshot(resource: Resource) {
  return isLocalWorkspaceResourceId(resource.id)
    ? localWorkspaceResourceMetadataFromResource(resource)
    : null;
}

export async function resourcePutIfSnapshot(
  input: ResourceSnapshotWrite,
): Promise<ResourceSnapshotWriteResult | null> {
  return resourcePutIfSnapshotInternal(input, true);
}

async function resourcePutIfSnapshotInternal(
  input: ResourceSnapshotWrite,
  emitChange: boolean,
  clientOverride?: DbExec,
): Promise<ResourceSnapshotWriteResult | null> {
  await ensureTable();
  let previous = input.previous;
  if (
    previous &&
    (previous.owner !== input.owner || previous.path !== input.path)
  ) {
    return null;
  }
  const localPrevious = previous
    ? localWorkspaceResourceSnapshot(previous)
    : null;
  const localPath =
    isBareWorkspaceResourceOwner(input.owner) &&
    (await shouldHandleWorkspaceResourceAsLocal(input.path));
  if (localPath && previous && !localPrevious) {
    previous = null;
  }
  if (localPath && (!previous || localPrevious)) {
    const written = previous
      ? await writeLocalWorkspaceResourceIfCurrent({
          path: input.path,
          content: input.content,
          expectedHash: localPrevious!.hash,
          expectedAbsolutePath: localPrevious!.absolutePath,
        })
      : await (async () => {
          if (await localWorkspaceResourceByPath(input.path)) return null;
          return writeLocalWorkspaceResource({
            path: input.path,
            content: input.content,
            ifNotExists: true,
          });
        })();
    if (!written) return null;
    const resource = localWorkspaceResourceToResource({
      ...written,
      content: input.content,
    });
    emitResourceChange(
      resource.id,
      resource.path,
      resource.owner,
      input.options?.requestSource,
    );
    return {
      before: input.previous && localPrevious ? input.previous : null,
      resource,
    };
  }
  if (isBareWorkspaceResourceOwner(input.owner)) {
    await assertWritableWorkspaceResourcePath(input.path);
  }

  if (!previous) {
    const resource = await resourcePutIfAbsentInternal(
      input.owner,
      input.path,
      input.content,
      input.mimeType,
      input.options,
      emitChange,
      clientOverride,
    );
    return resource ? { before: null, resource } : null;
  }
  const serializedMetadata = serializeMetadata(input.options?.metadata);
  const metadata =
    serializedMetadata !== undefined ? serializedMetadata : previous.metadata;
  const createdBy = normalizeCreatedBy(
    hasOption(input.options, "createdBy")
      ? input.options?.createdBy
      : previous.createdBy,
  );
  const client = clientOverride ?? getDbExec();
  const updatedAt = Math.max(Date.now(), previous.updatedAt + 1);
  const size = Buffer.byteLength(input.content, "utf8");
  const mimeType = input.mimeType || "text/markdown";
  const match = resourceSnapshotMatch(previous);
  const { rows } = await client.execute({
    sql: `UPDATE resources SET content = ?, mime_type = ?, size = ?, updated_at = ?, created_by = ?, metadata = ? WHERE ${match.sql} RETURNING *`,
    args: [
      input.content,
      mimeType,
      size,
      updatedAt,
      createdBy,
      metadata,
      ...match.args,
    ],
  });
  if (rows.length !== 1) return null;
  const resource = rowToResource(rows[0]);
  if (emitChange) {
    emitResourceChange(
      resource.id,
      resource.path,
      resource.owner,
      input.options?.requestSource,
    );
  }
  return { before: previous, resource };
}

const SNAPSHOT_WRITE_CONFLICT = Symbol("resource snapshot write conflict");

export type ResourceSnapshotWriteOptions = {
  beforeWrite?: (tx: DbExec) => Promise<void>;
};
export type ResourceSnapshotPairOptions = ResourceSnapshotWriteOptions;

export async function resourcePutSnapshotBatchIfCurrent(
  writes: readonly ResourceSnapshotWrite[],
  options?: ResourceSnapshotWriteOptions,
): Promise<readonly ResourceSnapshotWriteResult[] | null> {
  const owner = writes[0]?.owner;
  if (
    writes.length < 2 ||
    writes.some((write) => write.owner !== owner) ||
    new Set(writes.map((write) => write.path)).size !== writes.length ||
    owner === WORKSPACE_OWNER
  ) {
    throw new Error(
      "Resource snapshot batches require one SQL-backed owner and distinct paths.",
    );
  }

  await ensureTable();
  const client = getDbExec();
  if (!client.transaction) {
    throw new Error("Resource snapshot batches require database transactions.");
  }

  let result: readonly ResourceSnapshotWriteResult[];
  try {
    result = await client.transaction(async (tx) => {
      await options?.beforeWrite?.(tx);
      const written: ResourceSnapshotWriteResult[] = [];
      for (const write of writes) {
        const result = await resourcePutIfSnapshotInternal(write, false, tx);
        if (!result) throw SNAPSHOT_WRITE_CONFLICT;
        written.push(result);
      }
      return written;
    });
  } catch (error) {
    if (error === SNAPSHOT_WRITE_CONFLICT) return null;
    throw error;
  }

  for (const [index, { resource }] of result.entries()) {
    emitResourceChange(
      resource.id,
      resource.path,
      resource.owner,
      writes[index]?.options?.requestSource,
    );
  }
  return result;
}

export async function resourcePutSnapshotPairIfCurrent(
  writes: readonly [ResourceSnapshotWrite, ResourceSnapshotWrite],
  options?: ResourceSnapshotWriteOptions,
): Promise<
  readonly [ResourceSnapshotWriteResult, ResourceSnapshotWriteResult] | null
> {
  const result = await resourcePutSnapshotBatchIfCurrent(writes, options);
  return result as
    | readonly [ResourceSnapshotWriteResult, ResourceSnapshotWriteResult]
    | null;
}

export async function resourceRestoreSnapshotIfCurrent(
  snapshot: Resource,
  current: Resource | null,
): Promise<boolean> {
  await ensureTable();
  const snapshotLocal = localWorkspaceResourceSnapshot(snapshot);
  if (snapshotLocal) {
    if (current) {
      const currentLocal = localWorkspaceResourceSnapshot(current);
      if (
        !currentLocal ||
        current.owner !== snapshot.owner ||
        current.path !== snapshot.path ||
        currentLocal.absolutePath !== snapshotLocal.absolutePath
      ) {
        return false;
      }
      const restored = await writeLocalWorkspaceResourceIfCurrent({
        path: snapshot.path,
        content: snapshot.content,
        expectedHash: currentLocal.hash,
        expectedAbsolutePath: currentLocal.absolutePath,
      });
      if (!restored) return false;
      emitResourceChange(snapshot.id, snapshot.path, snapshot.owner);
      return true;
    }
    const restored = await writeLocalWorkspaceResourceIfAbsentAtPath({
      path: snapshot.path,
      content: snapshot.content,
      expectedAbsolutePath: snapshotLocal.absolutePath,
    });
    if (!restored) return false;
    emitResourceChange(snapshot.id, snapshot.path, snapshot.owner);
    return true;
  }
  if (
    current &&
    (current.owner !== snapshot.owner || current.path !== snapshot.path)
  ) {
    return false;
  }
  const client = getDbExec();
  const restoredAt = Math.max(
    Date.now(),
    (current?.updatedAt ?? snapshot.updatedAt) + 1,
  );
  if (!current) {
    const { rows } = await client.execute({
      sql: `INSERT INTO resources (id, path, owner, content, mime_type, size, created_at, updated_at, created_by, visibility, thread_id, run_id, expires_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path, owner) DO NOTHING RETURNING *`,
      args: [
        snapshot.id,
        snapshot.path,
        snapshot.owner,
        snapshot.content,
        snapshot.mimeType,
        snapshot.size,
        snapshot.createdAt,
        restoredAt,
        snapshot.createdBy,
        snapshot.visibility,
        snapshot.threadId,
        snapshot.runId,
        snapshot.expiresAt,
        snapshot.metadata,
      ],
    });
    if (rows.length !== 1) return false;
    emitResourceChange(snapshot.id, snapshot.path, snapshot.owner);
    return true;
  }
  const match = resourceSnapshotMatch(current);
  const { rows } = await client.execute({
    sql: `UPDATE resources SET content = ?, mime_type = ?, size = ?, created_at = ?, updated_at = ?, created_by = ?, visibility = ?, thread_id = ?, run_id = ?, expires_at = ?, metadata = ? WHERE ${match.sql} RETURNING *`,
    args: [
      snapshot.content,
      snapshot.mimeType,
      snapshot.size,
      snapshot.createdAt,
      restoredAt,
      snapshot.createdBy,
      snapshot.visibility,
      snapshot.threadId,
      snapshot.runId,
      snapshot.expiresAt,
      snapshot.metadata,
      ...match.args,
    ],
  });
  if (rows.length !== 1) return false;
  emitResourceChange(snapshot.id, snapshot.path, snapshot.owner);
  return true;
}

export async function resourceDeleteIfCurrent(
  resource: Resource,
): Promise<boolean> {
  await ensureTable();
  if (isLocalWorkspaceResourceId(resource.id)) {
    const resourcePath = localWorkspaceResourcePathFromId(resource.id);
    const metadata = localWorkspaceResourceMetadataFromResource(resource);
    if (!resourcePath || !metadata) return false;
    const deleted = await deleteLocalWorkspaceResourceIfCurrent({
      path: resourcePath,
      expectedHash: metadata.hash,
      expectedAbsolutePath: metadata.absolutePath,
    });
    if (deleted) {
      emitResourceDelete(resource.id, resource.path, resource.owner);
    }
    return deleted;
  }

  const client = getDbExec();
  const result = await client.execute({
    sql: `DELETE FROM resources WHERE owner = ? AND path = ? AND id = ? AND updated_at = ? AND content = ? AND mime_type = ? AND size = ? AND created_at = ? AND created_by = ? AND visibility = ? AND thread_id IS NOT DISTINCT FROM ? AND run_id IS NOT DISTINCT FROM ? AND expires_at IS NOT DISTINCT FROM ? AND metadata IS NOT DISTINCT FROM ?`,
    args: [
      resource.owner,
      resource.path,
      resource.id,
      resource.updatedAt,
      resource.content,
      resource.mimeType,
      resource.size,
      resource.createdAt,
      resource.createdBy,
      resource.visibility,
      resource.threadId,
      resource.runId,
      resource.expiresAt,
      resource.metadata,
    ],
  });
  const deleted = result.rowsAffected === 1;
  if (deleted) {
    emitResourceDelete(resource.id, resource.path, resource.owner);
  }
  return deleted;
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
    isBareWorkspaceResourceOwner(owner) &&
    (await shouldHandleWorkspaceResourceAsLocal(path))
  ) {
    const existing = await localWorkspaceResourceByPath(path);
    const deleted = await deleteLocalWorkspaceResource({ path });
    if (deleted) {
      emitResourceDelete(existing?.id ?? "", path, WORKSPACE_OWNER);
      return true;
    }
  }
  if (isBareWorkspaceResourceOwner(owner)) {
    await assertWritableWorkspaceResourcePath(path);
  }
  const client = getDbExec();

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
  const orgId = resourceOrganizationId(options?.orgId);
  if (!isOrganizationWorkspaceResourceVisibleToOrganization(owner, orgId)) {
    return [];
  }
  const client = getDbExec();
  scheduleExpiredAgentScratchCleanup(client);
  const visibilitySql = scratchFilterSql(options);
  const workspace = isWorkspaceResourceOwner(owner);
  const owners = workspace
    ? workspaceReadOwners(owner, options?.orgId)
    : [owner];
  const listOwner = async (candidate: string): Promise<ResourceMeta[]> => {
    const { rows } = await client.execute(
      pathPrefix
        ? {
            sql: `SELECT ${RESOURCE_META_SELECT} FROM resources WHERE owner = ? AND path LIKE ? ESCAPE '!'${visibilitySql}`,
            args: [candidate, prefixLike(pathPrefix)],
          }
        : {
            sql: `SELECT ${RESOURCE_META_SELECT} FROM resources WHERE owner = ?${visibilitySql}`,
            args: [candidate],
          },
    );
    return filterLegacyDispatchWorkspaceRows(
      rows
        .map(rowToMeta)
        .filter((resource) =>
          isLegacySharedResourceVisibleToOrganization(resource, orgId),
        ),
      orgId,
    );
  };
  const ownerResources = await Promise.all(owners.map(listOwner));
  const resources = ownerResources.reduce((merged, candidate) =>
    mergeResourceMetas(merged, candidate),
  );
  if (!workspace) return resources;

  const local = await localWorkspaceResourceMetas(pathPrefix);
  const primaryResources = ownerResources[0] ?? [];
  const inheritedResources = ownerResources[1] ?? [];
  const workspaceResources = isBareWorkspaceResourceOwner(owners[0])
    ? mergeResourceMetas(local, resources)
    : mergeResourceMetas(
        primaryResources,
        mergeResourceMetas(local, inheritedResources),
      );
  const granted = await grantedWorkspaceResources({
    pathPrefix,
    workspaceAppId: options?.workspaceAppId,
    userEmail: options?.userEmail,
    orgId: options?.orgId,
  });
  return mergeResourceMetas(workspaceResources, granted.map(resourceToMeta));
}

export async function resourceListContentByOwnersAndPrefixes(
  owners: readonly string[],
  pathPrefixes: readonly string[],
  options?: Pick<ResourceListOptions, "orgId">,
): Promise<ResourceContentProjection[]> {
  const uniqueOwners = [...new Set(owners.filter(Boolean))];
  const uniquePrefixes = [...new Set(pathPrefixes.filter(Boolean))];
  if (uniqueOwners.length === 0 || uniquePrefixes.length === 0) return [];

  const orgId = resourceOrganizationId(options?.orgId);
  const visibleOwners = uniqueOwners.filter((owner) =>
    isOrganizationWorkspaceResourceVisibleToOrganization(owner, orgId),
  );
  if (visibleOwners.length === 0) return [];

  const client = getDbExec();
  const ownerSql = visibleOwners.map(() => "?").join(", ");
  const prefixSql = uniquePrefixes
    .map(() => "path LIKE ? ESCAPE '!'")
    .join(" OR ");
  const query = {
    sql: `SELECT id, path, owner, content, metadata FROM resources WHERE owner IN (${ownerSql}) AND (${prefixSql})${scratchFilterSql()}`,
    args: [
      ...visibleOwners,
      ...uniquePrefixes.map((prefix) => prefixLike(prefix)),
    ],
  };
  let rows: Awaited<ReturnType<DbExec["execute"]>>["rows"];
  try {
    ({ rows } = await client.execute(query));
  } catch (error) {
    if (!isMissingResourceSchemaError(error)) throw error;
    await ensureTable();
    ({ rows } = await client.execute(query));
  }
  scheduleExpiredAgentScratchCleanup(client);
  const visible = await filterLegacyDispatchWorkspaceRows(
    rows
      .map((row) => ({
        id: String(row.id),
        path: String(row.path),
        owner: String(row.owner),
        content: String(row.content),
        metadata: nullableString(row.metadata),
      }))
      .filter((resource) =>
        isLegacySharedResourceVisibleToOrganization(resource, orgId),
      ),
    orgId,
  );
  return visible.map(({ metadata: _metadata, ...resource }) => resource);
}

export async function resourceListAccessible(
  userEmail: string,
  pathPrefix?: string,
  options?: ResourceListOptions,
): Promise<ResourceMeta[]> {
  const organizationOwner = sharedResourceOwner(options?.orgId);
  const [personal, organization, legacyShared, workspace] = await Promise.all([
    resourceList(userEmail, pathPrefix, options),
    organizationOwner === SHARED_OWNER
      ? Promise.resolve([])
      : resourceList(organizationOwner, pathPrefix, options),
    resourceList(SHARED_OWNER, pathPrefix, options),
    resourceList(WORKSPACE_OWNER, pathPrefix, {
      ...options,
      userEmail,
    }),
  ]);

  return mergeResourceMetas(
    personal,
    mergeResourceMetas(
      organization,
      mergeResourceMetas(legacyShared, workspace),
    ),
  );
}

export async function resourceEffectiveContext(
  userEmail: string,
  path: string,
  options?: ResourceResolutionOptions,
): Promise<EffectiveResourceContext> {
  await ensureTable();

  const organizationOwner = sharedResourceOwner(options?.orgId);
  const workspaceOwner = workspaceResourceOwner(options?.orgId);
  const [workspace, organization, legacyShared, personal] = await Promise.all([
    resourceGetByPath(workspaceOwner, path, { ...options, userEmail }),
    organizationOwner === SHARED_OWNER
      ? Promise.resolve(null)
      : resourceGetByPath(organizationOwner, path, { ...options, userEmail }),
    resourceGetByPath(SHARED_OWNER, path, options),
    resourceGetByPath(userEmail, path),
  ]);
  const shared = organization ?? legacyShared;
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
      owner: workspaceOwner,
      resource: workspace,
      canWrite: workspace ? isLocalWorkspaceResourceId(workspace.id) : false,
    },
    {
      scope: "shared",
      label: "Organization/app override",
      owner: organizationOwner,
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

export async function resourceListAllOwners(
  pathPrefix: string,
  options: { includeShadowedWorkspaceRows?: boolean } = {},
): Promise<Resource[]> {
  await ensureTable();
  const client = getDbExec();
  const { rows } = await client.execute({
    sql: `SELECT * FROM resources WHERE path LIKE ? ESCAPE '!'`,
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
      .filter(
        (resource) =>
          options.includeShadowedWorkspaceRows ||
          resource.owner !== WORKSPACE_OWNER ||
          !localPaths.has(resource.path),
      ),
  ];
}

export async function resourceMove(
  id: string,
  newPath: string,
): Promise<boolean> {
  await ensureTable();
  const client = getDbExec();
  const now = Date.now();

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
