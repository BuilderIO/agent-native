import {
  getQuery,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
  readMultipartFormData,
} from "h3";
import { createError, type H3Event } from "h3";

import { fail, isActionContractError } from "../action.js";
import { canUpdateAutomationResource } from "../automations/service.js";
import { isUniqueViolation } from "../db/client.js";
import { uploadFile } from "../file-upload/index.js";
import { nameTaken, nextFreeName } from "../free-name/server.js";
import { parseJobResource } from "../jobs/frontmatter.js";
import { getOrgContext } from "../org/context.js";
import { canManageDeploymentWithoutOrg } from "../org/orgless-access.js";
import { saveConflict, saveIfCurrent } from "../save-conflict/server.js";
import { getSession } from "../server/auth.js";
import {
  readBody,
  readBodyWithSizeLimit,
  DEFAULT_UPLOAD_MAX_FILE_BYTES,
  isAllowedUploadMimeType,
} from "../server/h3-helpers.js";
import { runWithRequestContext } from "../server/request-context.js";
import {
  exportResourcePackSchema,
  default as exportResourcePack,
} from "./actions/export-resource-pack.js";
import {
  importResourcePackSchema,
  default as importResourcePack,
} from "./actions/import-resource-pack.js";
import {
  getFrontmatterValue,
  getResourceKind,
  isRemoteAgentPath,
  isSkillPath,
  restorePathForTrashedSkill,
  SKILL_TRASH_PREFIX,
  parseFrontmatter,
  parseCustomAgentProfile,
  parseRemoteAgentManifest,
  parseSkillMetadata,
  type CustomAgentProfile,
  type RemoteAgentManifest,
  type SkillMetadata,
} from "./metadata.js";
import { RESOURCE_PACK_MAX_BODY_BYTES } from "./pack.js";
import { canonicalResourcePath } from "./path-form.js";
import {
  RESOURCE_CONTENT_RECORD,
  resourceContentRevision,
} from "./revision.js";
import {
  resourceGet,
  resourceGetByPath,
  resourcePut,
  resourcePutIfAbsent,
  resourcePutIfCurrent,
  resourcePutIfSnapshot,
  resourceDelete,
  resourceDeleteIfCurrent,
  resourceList,
  resourceListAccessible,
  resourceListOrganization,
  resourceMove,
  resourceMoveIfCurrent,
  resourceStoredPathsTaken,
  resourceStoredSpellings,
  resourceEffectiveContext,
  ensurePersonalDefaults,
  canWriteLocalWorkspaceResourcePath,
  isLocalWorkspaceResourceId,
  isSameLocalWorkspaceFile,
  isLegacyOrganizationWorkspaceFile,
  isLegacySharedResourceVisibleToOrganization,
  isWorkspaceResourceOwner,
  organizationIdFromResourceOwner,
  organizationIdFromWorkspaceResourceOwner,
  sharedResourceOwner,
  SHARED_OWNER,
  WORKSPACE_OWNER,
  ResourcePathTakenError,
  type Resource,
  type ResourceMeta,
  type ResourceWriteOptions,
} from "./store.js";

function isSameSkillUpload(
  incomingContent: string,
  existingContent: string,
  path: string,
): boolean {
  const incomingSkill = parseSkillMetadata(incomingContent, path);
  const existingSkill = parseSkillMetadata(existingContent, path);
  if (!incomingSkill || !existingSkill) return false;

  const incomingName = incomingSkill.name.trim();
  if (incomingName !== existingSkill.name.trim()) return false;

  const incomingDeclaredName = getFrontmatterValue(
    parseFrontmatter(incomingContent),
    "name",
  )?.trim();
  const existingDeclaredName = getFrontmatterValue(
    parseFrontmatter(existingContent),
    "name",
  )?.trim();

  return Boolean(incomingDeclaredName) === Boolean(existingDeclaredName);
}

async function resolveOwner(event: any, shared?: boolean): Promise<string> {
  if (shared) return sharedResourceOwner(await resolveOrgId(event));
  const session = await getSession(event);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  return session.email;
}

function canReadOwner(
  owner: string,
  email: string,
  orgId?: string | null,
): boolean {
  const ownerOrgId =
    organizationIdFromResourceOwner(owner) ??
    organizationIdFromWorkspaceResourceOwner(owner);
  return (
    owner === email ||
    owner === SHARED_OWNER ||
    owner === WORKSPACE_OWNER ||
    (!!ownerOrgId && ownerOrgId === orgId)
  );
}

function withContentRevision<R extends Pick<Resource, "content">>(resource: R) {
  return { ...resource, revision: resourceContentRevision(resource) };
}

function isInheritedAppDefault(resource: ResourceMeta, orgId: string | null) {
  return (
    resource.owner === SHARED_OWNER &&
    sharedResourceOwner(orgId) !== SHARED_OWNER &&
    !isLegacyOrganizationWorkspaceFile(resource, orgId)
  );
}

function withResourceInheritance<R extends ResourceMeta>(
  resource: R,
  orgId: string | null,
) {
  return isInheritedAppDefault(resource, orgId)
    ? { ...resource, inheritedFromAppDefault: true as const }
    : resource;
}

function resourceDownloadDisposition(path: string): string {
  const basename = path.replaceAll("\\", "/").split("/").pop()?.trim() || "";
  const filename = Array.from(basename)
    .slice(0, 180)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 ? "_" : character;
    })
    .join("");
  const safeFilename =
    filename && filename !== "." && filename !== ".." ? filename : "download";
  const asciiFilename = safeFilename
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  const encodedFilename = encodeURIComponent(safeFilename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
}

async function resolveEmail(event: any): Promise<string> {
  const session = await getSession(event);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  return session.email;
}

async function resolveOrgId(event: any): Promise<string | null> {
  const ctx = await getOrgContext(event);
  return ctx.orgId ?? null;
}

async function assertCanEditShared(event: any): Promise<void> {
  const session = await getSession(event);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  const ctx = await getOrgContext(event);
  if (!ctx.orgId) {
    if (canManageDeploymentWithoutOrg(session.email)) return;
  } else if (ctx.role === "owner" || ctx.role === "admin") {
    return;
  }
  throw createError({
    statusCode: 403,
    message: "Only organization admins can edit organization files",
  });
}

function shouldIncludeAgentScratch(query: Record<string, unknown>): boolean {
  return (
    query.includeAgentScratch === "true" ||
    query.includeScratch === "true" ||
    query.includeAgentScratch === true ||
    query.includeScratch === true
  );
}

interface JobMetadata {
  schedule?: string;
  scheduleDescription?: string;
  enabled?: boolean;
  lastStatus?: string;
  lastRun?: string;
  nextRun?: string;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  kind?: "file" | "skill" | "job" | "agent" | "remote-agent";
  children?: TreeNode[];
  resource?: ResourceMeta;
  jobMeta?: JobMetadata;
  skillMeta?: SkillMetadata;
  agentMeta?: CustomAgentProfile;
  remoteAgentMeta?: RemoteAgentManifest;
}

function buildTree(
  resources: ResourceMeta[],
  orgId: string | null,
): TreeNode[] {
  const root: TreeNode[] = [];

  for (const res of resources) {
    const parts = res.path.split("/").filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const currentPath = "/" + parts.slice(0, i + 1).join("/");

      if (isLast) {
        current.push({
          name: part,
          path: currentPath,
          type: "file",
          kind: getResourceKind(res.path),
          resource: withResourceInheritance(res, orgId),
        });
      } else {
        let folder = current.find(
          (n) => n.name === part && n.type === "folder",
        );
        if (!folder) {
          folder = {
            name: part,
            path: currentPath,
            type: "folder",
            children: [],
          };
          current.push(folder);
        }
        current = folder.children!;
      }
    }
  }

  sortTree(root);
  return root;
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  for (const node of nodes) {
    if (node.children) sortTree(node.children);
  }
}

export async function handleListResources(event: any) {
  const query = getQuery(event);
  const prefix = (query.prefix as string) || undefined;
  const scope = (query.scope as string) || "all";
  const email = await resolveEmail(event);
  const orgId = await resolveOrgId(event);
  const includeAgentScratch = shouldIncludeAgentScratch(query);
  const localListOptions = includeAgentScratch
    ? { includeAgentScratch: true }
    : undefined;
  const scopedListOptions = includeAgentScratch
    ? { includeAgentScratch: true, userEmail: email, orgId }
    : { userEmail: email, orgId };

  if (prefix !== SKILL_TRASH_PREFIX) await ensurePersonalDefaults(email);

  let resources: ResourceMeta[];

  if (scope === "personal") {
    resources = localListOptions
      ? await resourceList(email, prefix, localListOptions)
      : await resourceList(email, prefix);
  } else if (scope === "workspace") {
    resources = await resourceList(WORKSPACE_OWNER, prefix, scopedListOptions);
  } else if (scope === "shared") {
    resources = await resourceListOrganization(orgId, prefix, localListOptions);
  } else {
    resources = await resourceListAccessible(email, prefix, scopedListOptions);
  }

  return { resources };
}

export async function handleGetResourceTree(event: any) {
  const query = getQuery(event);
  const scope = (query.scope as string) || "all";
  const email = await resolveEmail(event);
  const orgId = await resolveOrgId(event);
  const includeAgentScratch = shouldIncludeAgentScratch(query);
  const localListOptions = includeAgentScratch
    ? { includeAgentScratch: true }
    : undefined;
  const scopedListOptions = includeAgentScratch
    ? { includeAgentScratch: true, userEmail: email, orgId }
    : { userEmail: email, orgId };

  if (query.seedDefaults !== "false") await ensurePersonalDefaults(email);

  let resources: ResourceMeta[];

  if (scope === "personal") {
    resources = localListOptions
      ? await resourceList(email, undefined, localListOptions)
      : await resourceList(email);
  } else if (scope === "workspace") {
    resources = await resourceList(
      WORKSPACE_OWNER,
      undefined,
      scopedListOptions,
    );
  } else if (scope === "shared") {
    resources = await resourceListOrganization(
      orgId,
      undefined,
      localListOptions,
    );
  } else {
    resources = await resourceListAccessible(
      email,
      undefined,
      scopedListOptions,
    );
  }

  const tree = buildTree(resources, orgId);

  await enrichTreeNodes(tree, orgId);

  return { tree };
}

export async function handleGetEffectiveResourceContext(event: any) {
  const query = getQuery(event);
  const path = query.path;
  if (typeof path !== "string" || path.trim().length === 0) {
    setResponseStatus(event, 400);
    return { error: "path is required" };
  }

  const email = await resolveEmail(event);
  const orgId = await resolveOrgId(event);
  await ensurePersonalDefaults(email);
  return resourceEffectiveContext(email, path, { userEmail: email, orgId });
}

async function enrichTreeNodes(
  nodes: TreeNode[],
  orgId: string | null,
): Promise<void> {
  let parseFn: typeof import("../jobs/scheduler.js").parseJobFrontmatter;
  let describeFn: typeof import("../jobs/cron.js").describeCron;
  try {
    const scheduler = await import("../jobs/scheduler.js");
    const cron = await import("../jobs/cron.js");
    parseFn = scheduler.parseJobFrontmatter;
    describeFn = cron.describeCron;
  } catch {
    return;
  }

  for (const node of nodes) {
    if (node.type === "folder" && node.children) {
      await enrichTreeNodes(node.children, orgId);
    }
    if (node.type === "file" && node.resource) {
      try {
        const full = await resourceGet(node.resource.id, { orgId });
        if (!full?.content) continue;

        if (
          node.resource.path.startsWith("jobs/") &&
          node.resource.path.endsWith(".md")
        ) {
          const { meta } = parseFn(full.content);
          node.jobMeta = {
            schedule: meta.schedule,
            scheduleDescription: meta.schedule
              ? describeFn(meta.schedule)
              : undefined,
            enabled: meta.enabled,
            lastStatus: meta.lastStatus,
            lastRun: meta.lastRun,
            nextRun: meta.nextRun,
          };
        }

        if (
          node.resource.path.startsWith("skills/") &&
          node.resource.path.endsWith(".md")
        ) {
          node.skillMeta =
            parseSkillMetadata(full.content, node.resource.path) ?? undefined;
        }

        if (
          node.resource.path.startsWith("agents/") &&
          node.resource.path.endsWith(".md")
        ) {
          node.agentMeta =
            parseCustomAgentProfile(full.content, node.resource.path) ??
            undefined;
        }

        if (isRemoteAgentPath(node.resource.path)) {
          node.remoteAgentMeta =
            parseRemoteAgentManifest(full.content, node.resource.path) ??
            undefined;
        }
      } catch {
        // Skip individual file errors
      }
    }
  }
}

export async function handleGetResource(event: any) {
  const id = getRouterParam(event, "id") || event.context.params?.id;
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Resource ID is required" };
  }

  const email = await resolveEmail(event);
  const orgId = await resolveOrgId(event);
  const resource = await resourceGet(id, { userEmail: email, orgId });
  if (!resource) {
    setResponseStatus(event, 404);
    return { error: "Resource not found" };
  }

  if (
    !canReadOwner(resource.owner, email, orgId) ||
    !isLegacySharedResourceVisibleToOrganization(resource, orgId)
  ) {
    setResponseStatus(event, 404);
    return { error: "Resource not found" };
  }

  if (
    resource.path.startsWith("jobs/") &&
    resource.path.endsWith(".md") &&
    /^webhookToken\s*:/m.test(resource.content)
  ) {
    let legacyWebhookMeta: ReturnType<typeof parseJobResource>["meta"];
    try {
      legacyWebhookMeta = parseJobResource(resource.content).meta;
    } catch {
      setResponseStatus(event, 404);
      return { error: "Resource not found" };
    }
    if (
      legacyWebhookMeta.webhookToken &&
      !(await canUpdateAutomationResource(
        { userEmail: email, orgId, appId: legacyWebhookMeta.appId },
        resource,
      ))
    ) {
      setResponseStatus(event, 404);
      return { error: "Resource not found" };
    }
  }

  const query = getQuery(event);
  const wantsRaw = query.raw !== undefined;
  const wantsDownload = query.download === "1";

  if ((wantsRaw || wantsDownload) && typeof resource.content === "string") {
    const isText =
      resource.mimeType.startsWith("text/") ||
      resource.mimeType === "application/json";
    const buf = isText
      ? Buffer.from(resource.content, "utf-8")
      : Buffer.from(resource.content, "base64");

    setResponseHeader(event, "Content-Type", resource.mimeType);
    setResponseHeader(event, "Content-Length", String(buf.length));
    setResponseHeader(event, "Cache-Control", "private, no-store");
    setResponseHeader(event, "X-Content-Type-Options", "nosniff");
    setResponseHeader(
      event,
      "Content-Security-Policy",
      "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
    );
    if (wantsDownload) {
      setResponseHeader(
        event,
        "Content-Disposition",
        resourceDownloadDisposition(resource.path),
      );
    }
    return new Response(buf);
  }

  const isBinary =
    resource.mimeType.startsWith("image/") ||
    resource.mimeType.startsWith("audio/") ||
    resource.mimeType.startsWith("video/") ||
    resource.mimeType === "application/octet-stream";

  if (isBinary) {
    const { content: _content, ...meta } = resource;
    return { ...withResourceInheritance(meta, orgId), content: "" };
  }

  return withContentRevision(withResourceInheritance(resource, orgId));
}

export async function handleCreateResource(event: any) {
  const body = await readBody(event);

  if (!body?.path || typeof body.path !== "string") {
    setResponseStatus(event, 400);
    return { error: "path is required" };
  }

  if (body.shared) {
    await assertCanEditShared(event);
  }

  const owner = await resolveOwner(event, body.shared);

  if (body.uniquePath) {
    const path = canonicalResourcePath(body.path);
    if (!path) {
      setResponseStatus(event, 400);
      return { error: "path is required" };
    }
    const put = await putUnderFreePath(
      owner,
      path,
      body.content ?? "",
      body.mimeType || "text/markdown",
      {
        resend: false,
        ...(body.metadata !== undefined
          ? { write: { metadata: body.metadata } }
          : {}),
      },
    );
    if (!put) return resourcePathTaken(event, owner, path, false);
    setResponseStatus(event, put.created ? 201 : 200);
    return withContentRevision(put.resource);
  }

  if (body.uniqueSkillPath) {
    const match = /^skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/.exec(
      body.path,
    );
    if (!match) {
      setResponseStatus(event, 400);
      return { error: "uniqueSkillPath requires skills/<name>/SKILL.md" };
    }

    const writeOptions =
      body.metadata !== undefined ? { metadata: body.metadata } : undefined;
    const organizationId = organizationIdFromResourceOwner(owner);
    const lookup = { orgId: organizationId };
    const uploaderEmail = organizationId
      ? (await getOrgContext(event)).email
      : undefined;
    const content = body.content ?? "";
    for (let suffix = 1; suffix <= 1000; suffix += 1) {
      const path =
        suffix === 1 ? body.path : `skills/${match[1]}-${suffix}/SKILL.md`;
      const legacySharedResource = organizationId
        ? await resourceNamed(SHARED_OWNER, path, lookup)
        : null;
      const personalResource = uploaderEmail
        ? await resourceNamed(uploaderEmail, path, lookup)
        : null;
      if (
        personalResource &&
        !isSameSkillUpload(content, personalResource.content, path)
      ) {
        continue;
      }
      if (legacySharedResource && !(await resourceNamed(owner, path, lookup))) {
        continue;
      }
      let nextPath = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!legacySharedResource) {
          const resource = await resourcePutIfAbsent(
            owner,
            path,
            content,
            body.mimeType,
            writeOptions,
          );
          if (resource) {
            setResponseStatus(event, 201);
            return withContentRevision(resource);
          }
        }

        const existing = await resourceNamed(owner, path, lookup);
        if (!existing) {
          if (legacySharedResource) {
            nextPath = true;
            break;
          }
          continue;
        }

        if (!isSameSkillUpload(content, existing.content, path)) {
          nextPath = true;
          break;
        }

        const updated = await resourcePutIfCurrent({
          owner,
          path: existing.path,
          content,
          expectedId: existing.id,
          expectedUpdatedAt: existing.updatedAt,
          expectedContent: existing.content,
          mimeType: body.mimeType,
          ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
        });
        if (updated) {
          setResponseStatus(event, 200);
          return withContentRevision(updated);
        }
      }
      if (!nextPath) {
        setResponseStatus(event, 409);
        return {
          error: "Could not update or find an available path for this skill",
        };
      }
    }

    setResponseStatus(event, 409);
    return { error: "Could not find an available path for this skill" };
  }

  const writeOptions =
    body.metadata !== undefined ? { metadata: body.metadata } : undefined;

  if (body.ifNotExists) {
    const organizationId = organizationIdFromResourceOwner(owner);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing =
        (await resourceNamed(owner, body.path)) ??
        (organizationId
          ? await resourceNamed(SHARED_OWNER, body.path, {
              orgId: organizationId,
            })
          : null);
      if (existing) {
        return withContentRevision(existing);
      }
      const created = await resourcePutIfAbsent(
        owner,
        body.path,
        body.content ?? "",
        body.mimeType,
        writeOptions,
      );
      if (created) {
        setResponseStatus(event, 201);
        return withContentRevision(created);
      }
    }
    setResponseStatus(event, 409);
    return { error: "The file kept changing while it was created" };
  }

  const resource = writeOptions
    ? await resourcePut(
        owner,
        body.path,
        body.content ?? "",
        body.mimeType,
        writeOptions,
      )
    : await resourcePut(owner, body.path, body.content ?? "", body.mimeType);

  setResponseStatus(event, 201);
  return withContentRevision(resource);
}

async function resourceNamed(
  owner: string,
  path: string,
  lookup?: { orgId: string | null },
  matches: (resource: Resource) => boolean = () => true,
): Promise<Resource | null> {
  const stored = await resourceStoredSpellings(owner, path, lookup);
  for (const spelling of [path, ...stored.filter((other) => other !== path)]) {
    const resource = await resourceGetByPath(owner, spelling, lookup);
    if (resource && matches(resource)) return resource;
  }
  return null;
}

async function claimedPathsTaken(
  owner: string,
  paths: string[],
  localFiles: boolean,
): Promise<Set<string>> {
  const taken = await resourceStoredPathsTaken(owner, paths, { localFiles });
  const orgId = organizationIdFromResourceOwner(owner);
  if (localFiles || !orgId) return taken;
  const legacy = await resourceStoredPathsTaken(SHARED_OWNER, paths, {
    orgId,
  });
  return new Set([...taken, ...legacy]);
}

/** How many numbered paths a rename refusal checks for a free one, and how many it asks the database about at once. */
const FREE_PATH_LIMIT = 1000;
const FREE_PATH_BATCH = 50;

/**
 * A free path next to `path` for a resource stored for `owner`: the file's
 * name numbered the way `nextFreeName` numbers it ("notes/todo-2.md"), or
 * for a skill its folder ("skills/review-2/SKILL.md"). Null when none of the
 * paths it checks is free, or when no numbered path could be written: a
 * local workspace file outside skills/ is one of a few fixed names
 * (AGENTS.md, .mcp.json).
 */
async function freeResourcePath(
  owner: string,
  path: string,
  localFiles: boolean,
): Promise<string | null> {
  return (await searchFreeResourcePath(owner, path, localFiles)).free;
}

async function searchFreeResourcePath(
  owner: string,
  path: string,
  localFiles: boolean,
): Promise<{ free: string | null; passed: string[] }> {
  if (localFiles && !path.startsWith("skills/")) {
    return { free: null, passed: [] };
  }
  const skillName = /^skills\/([^/]+)\/SKILL\.md$/.exec(path)?.[1];
  const folder = path.slice(0, path.lastIndexOf("/") + 1);
  const base = skillName ?? path.slice(folder.length);
  const pathFor = (name: string) =>
    skillName === undefined ? `${folder}${name}` : `skills/${name}/SKILL.md`;
  // Local files are read one at a time, so the first free one ends the search
  // before a file further on that can't be read.
  const batchSize = localFiles ? 1 : FREE_PATH_BATCH;
  const named = new Set([base]);
  const passed: string[] = [];
  for (let checked = 0; checked < FREE_PATH_LIMIT; checked += batchSize) {
    const names: string[] = [];
    while (names.length < batchSize) {
      const name = nextFreeName(base, named);
      named.add(name);
      names.push(name);
    }
    const taken = await suggestionPathsTaken(
      owner,
      names.map(pathFor),
      localFiles,
    );
    for (const name of names) {
      if (!taken.has(pathFor(name))) return { free: pathFor(name), passed };
      passed.push(pathFor(name));
    }
  }
  return { free: null, passed };
}

/**
 * Which numbered paths a suggestion leaves out. A local file that can't be
 * read at one (a folder, a link, a file too big to read) isn't suggested,
 * rather than failing the refusal the suggestion is for.
 */
async function suggestionPathsTaken(
  owner: string,
  paths: string[],
  localFiles: boolean,
): Promise<Set<string>> {
  try {
    return await claimedPathsTaken(owner, paths, localFiles);
  } catch (error) {
    if (!localFiles) throw error;
    return new Set(paths);
  }
}

/**
 * The refusal for a rename onto a path another resource already has: a 409
 * `name_taken` carrying a free path, in the shape actions send, so the
 * browser reads it with `isNameTaken` the same way. Without a free path to
 * offer, it's a plain 409. Nothing has been written.
 */
async function resourcePathTaken(
  event: H3Event,
  owner: string,
  path: string,
  localFiles: boolean,
) {
  const suggestion = await freeResourcePath(owner, path, localFiles);
  setResponseStatus(event, 409);
  if (!suggestion) {
    return {
      error: `A resource named "${path}" already exists. Rename or delete that one first.`,
    };
  }
  const refusal = nameTaken("resource", path, suggestion);
  return {
    error: refusal.message,
    errorCode: refusal.errorCode,
    details: refusal.details,
  };
}

export async function handleUpdateResource(event: any) {
  const requestedId = getRouterParam(event, "id") || event.context.params?.id;
  if (!requestedId) {
    setResponseStatus(event, 400);
    return { error: "Resource ID is required" };
  }

  const email = await resolveEmail(event);
  const orgId = await resolveOrgId(event);
  const found = await resourceGet(requestedId, { userEmail: email, orgId });
  if (!found) {
    setResponseStatus(event, 404);
    return { error: "Resource not found" };
  }

  if (
    !canReadOwner(found.owner, email, orgId) ||
    !isLegacySharedResourceVisibleToOrganization(found, orgId)
  ) {
    setResponseStatus(event, 404);
    return { error: "Resource not found" };
  }
  // A legacy shared resource's first save in an organization copies it
  // there, and from then on the copy is the resource. A save sent to the
  // shared one, from a tab opened before the copy or a resend whose response
  // was lost, goes to the copy and is checked against it.
  const activeSharedOwner = sharedResourceOwner(orgId);
  const organizationCopy =
    found.owner === SHARED_OWNER && activeSharedOwner !== SHARED_OWNER
      ? await resourceGetByPath(activeSharedOwner, found.path, { orgId })
      : null;
  const existing =
    organizationCopy && canReadOwner(organizationCopy.owner, email, orgId)
      ? organizationCopy
      : found;
  const id = existing === found ? requestedId : existing.id;
  const isLocalWorkspaceResource =
    isWorkspaceResourceOwner(existing.owner) && isLocalWorkspaceResourceId(id);
  if (isWorkspaceResourceOwner(existing.owner) && !isLocalWorkspaceResource) {
    setResponseStatus(event, 403);
    return { error: "Workspace resources are managed from Dispatch" };
  }
  const existingOrganizationId = organizationIdFromResourceOwner(
    existing.owner,
  );
  if (existing.owner === SHARED_OWNER || existingOrganizationId) {
    await assertCanEditShared(event);
  }

  const body = await readBody(event);
  if (body.restoreSkill === true) {
    const restorePath = restorePathForTrashedSkill(existing);
    if (!restorePath) {
      if (isSkillPath(existing.path)) return withContentRevision(existing);
      setResponseStatus(event, 404);
      return { error: "Trashed skill not found" };
    }
    const restored = await resourceMoveIfCurrent(existing, restorePath);
    if (!restored) {
      setResponseStatus(event, 409);
      return {
        error: "The skill changed or its restore path is already in use",
      };
    }
    return withContentRevision(restored);
  }
  const expectedRevision: unknown = body.expectedRevision;
  if (expectedRevision !== undefined && typeof expectedRevision !== "string") {
    setResponseStatus(event, 400);
    return {
      error:
        "expectedRevision must be the revision from your last read of this resource",
    };
  }
  // A content save that sends the revision it read is refused when someone
  // saved other content after that read, before anything is written or moved.
  // A save without one still writes over whatever is there. Only content is
  // checked, so a rename alone never conflicts.
  const checksRevision =
    expectedRevision !== undefined && typeof body.content === "string";
  // True when this save is already there, as when a request is resent after
  // its response was lost. Metadata is stored as sent when it's a string or
  // null, and as JSON otherwise. An empty MIME type is stored as Markdown, and
  // empty metadata reads back as null.
  const isSameSaveOver = (resource: Resource) =>
    resource.content === body.content &&
    (body.mimeType === undefined ||
      (body.mimeType || "text/markdown") === resource.mimeType) &&
    (body.metadata === undefined ||
      ((body.metadata === null || typeof body.metadata === "string"
        ? body.metadata
        : JSON.stringify(body.metadata)) || null) === resource.metadata);
  const requestedPath =
    typeof body.path === "string" ? canonicalResourcePath(body.path) : "";
  const nextPath =
    !requestedPath || requestedPath === canonicalResourcePath(existing.path)
      ? existing.path
      : requestedPath;
  // The move and the content write are separate statements, so a conflict
  // found after the move would leave the resource renamed but not saved.
  if (checksRevision && nextPath !== existing.path) {
    setResponseStatus(event, 400);
    return {
      error:
        "Rename the resource and save its content in separate updates: rename it first, then send the content with expectedRevision.",
    };
  }
  if (checksRevision) {
    const revision = resourceContentRevision(existing);
    if (expectedRevision !== revision && !isSameSaveOver(existing)) {
      return contractErrorResponse(
        event,
        saveConflict(
          RESOURCE_CONTENT_RECORD,
          { content: existing.content },
          revision,
        ),
      );
    }
  }
  const isLegacyOrganizationWorkspaceResource =
    existing.owner === SHARED_OWNER &&
    isLegacyOrganizationWorkspaceFile(existing, orgId);

  if (existing.owner === SHARED_OWNER && activeSharedOwner !== SHARED_OWNER) {
    if (
      nextPath !== existing.path &&
      (await resourceStoredPathsTaken(SHARED_OWNER, [nextPath], { orgId })).has(
        nextPath,
      )
    ) {
      return resourcePathTaken(event, activeSharedOwner, nextPath, false);
    }
    const metadata =
      body.metadata !== undefined ? body.metadata : existing.metadata;
    const writeOptions = isLegacyOrganizationWorkspaceResource
      ? {
          createdBy: existing.createdBy,
          visibility: existing.visibility,
          threadId: existing.threadId,
          runId: existing.runId,
          expiresAt: existing.expiresAt,
          metadata,
        }
      : body.metadata !== undefined || typeof existing.metadata === "string"
        ? { metadata }
        : undefined;
    const resource = await resourcePutIfAbsent(
      activeSharedOwner,
      nextPath,
      body.content ?? existing.content,
      body.mimeType ?? existing.mimeType,
      writeOptions,
    );
    if (!resource) {
      if (nextPath !== existing.path) {
        return resourcePathTaken(event, activeSharedOwner, nextPath, false);
      }
      // Another save made the copy since the look above, and the copy is the
      // resource now. If it holds this save already, as when a resend's first
      // try made it, the save is done.
      const copy = await resourceGetByPath(activeSharedOwner, nextPath, {
        orgId,
      });
      if (copy && isSameSaveOver(copy)) return withContentRevision(copy);
      if (copy && checksRevision) {
        return contractErrorResponse(
          event,
          saveConflict(
            RESOURCE_CONTENT_RECORD,
            { content: copy.content },
            resourceContentRevision(copy),
          ),
        );
      }
      setResponseStatus(event, 409);
      return { error: `A resource already exists at path "${nextPath}"` };
    }
    // The copy holds this save over the version read above. When someone
    // saved the source after that read, take the copy back, so it doesn't
    // hide their save, and refuse with what's there. If someone wrote the
    // copy first, it stays, and it's what's there.
    const takeCopyBack = async (source: Resource) => {
      let current: Resource = source;
      // The copy is deleted only if it's still as made, compared as a read
      // sees it, and a read sees empty metadata as null.
      const made =
        resource.metadata === "" ? { ...resource, metadata: null } : resource;
      if (!(await resourceDeleteIfCurrent(made))) {
        current =
          (await resourceGet(resource.id, { userEmail: email, orgId })) ??
          source;
      }
      return contractErrorResponse(
        event,
        saveConflict(
          RESOURCE_CONTENT_RECORD,
          { content: current.content },
          resourceContentRevision(current),
        ),
      );
    };
    // With the source gone, the copy is the only place this save is, so it
    // stays.
    const sourceNow = () => resourceGet(id, { userEmail: email, orgId });
    if (checksRevision) {
      const source = await sourceNow();
      if (source && source.content !== existing.content) {
        return takeCopyBack(source);
      }
    }
    if (
      isLegacyOrganizationWorkspaceResource &&
      typeof existing.metadata === "string"
    ) {
      // The source goes only if it's still the version read, so a save to it
      // after the check above is caught here.
      const sourceDeleted = await resourceDeleteIfCurrent(existing);
      if (!sourceDeleted && checksRevision) {
        const source = await sourceNow();
        if (source) return takeCopyBack(source);
      }
    }
    return withContentRevision(resource);
  }

  if (
    isLocalWorkspaceResource &&
    nextPath !== existing.path &&
    !(await canWriteLocalWorkspaceResourcePath(nextPath))
  ) {
    setResponseStatus(event, 400);
    return {
      error:
        "Local workspace resources can only be moved to AGENTS.md, agent-native.json, mcp.config.json, .mcp.json, or skills/.",
    };
  }

  const localFiles = isLocalWorkspaceResource;
  if (
    nextPath !== existing.path &&
    localFiles &&
    (await isSameLocalWorkspaceFile({
      path: existing.path,
      otherPath: nextPath,
    }))
  ) {
    // The new path is this file again: in another letter case on a
    // case-insensitive disk, or in another skill root's spelling. Writing it
    // and then deleting the old path would delete the file.
    setResponseStatus(event, 409);
    return {
      error: `"${nextPath}" names this same file, so it can't be renamed to it. To change only its letter case, rename it to another name first.`,
    };
  }
  // A rename never writes over another resource. Moving a row onto a taken
  // path trips the (path, owner) index, and for a local workspace file the
  // write below would replace the file already there.
  if (
    nextPath !== existing.path &&
    (await claimedPathsTaken(existing.owner, [nextPath], localFiles)).has(
      nextPath,
    )
  ) {
    return resourcePathTaken(event, existing.owner, nextPath, localFiles);
  }

  if (!isLocalWorkspaceResource && nextPath !== existing.path) {
    try {
      await resourceMove(id, nextPath);
    } catch (error) {
      // Another write took the path between the check and the move.
      if (
        !isUniqueViolation(error) &&
        !(error instanceof ResourcePathTakenError)
      ) {
        throw error;
      }
      return resourcePathTaken(event, existing.owner, nextPath, false);
    }
  }

  const writeOptions =
    body.metadata !== undefined ? { metadata: body.metadata } : undefined;
  if (isLocalWorkspaceResource && nextPath !== existing.path) {
    // Write the new file only if nothing is there, so a file another write
    // created after the check above is refused rather than replaced. Then
    // delete the old one.
    const moved = await resourcePutIfSnapshot({
      previous: null,
      owner: existing.owner,
      path: nextPath,
      content: body.content ?? existing.content,
      mimeType: body.mimeType ?? existing.mimeType,
      ...(writeOptions ? { options: writeOptions } : {}),
    });
    if (!moved) {
      return resourcePathTaken(event, existing.owner, nextPath, true);
    }
    // The old file goes only if it's still the version just copied. If
    // another write changed or removed it meanwhile, take the copy back, so
    // the newer version isn't lost to a copy of the older one.
    let oldDeleted: boolean;
    try {
      oldDeleted = await resourceDeleteIfCurrent(existing);
    } catch (error) {
      // The old file couldn't be deleted, so take the copy back too.
      await resourceDeleteIfCurrent(moved.resource);
      throw error;
    }
    if (!oldDeleted) {
      await resourceDeleteIfCurrent(moved.resource);
      setResponseStatus(event, 409);
      return { error: "Resource changed before it could be renamed" };
    }
    return withContentRevision(moved.resource);
  }
  if (checksRevision) {
    // Read again and write only over that same version, so a save that lands
    // between the check above and this write is caught too. `seen.read` is the
    // version saveIfCurrent read last, which it checks next.
    const seen: { read: Resource; written: Resource | null } = {
      read: existing,
      written: null,
    };
    try {
      const { current } = await saveIfCurrent({
        record: RESOURCE_CONTENT_RECORD,
        expectedRevision: expectedRevision as string,
        read: async () => {
          const resource = await resourceGet(id, { userEmail: email, orgId });
          if (!resource) {
            fail("Resource not found", {
              errorCode: "resource_not_found",
              statusCode: 404,
            });
          }
          seen.read = resource;
          return {
            value: { content: resource.content },
            revision: resourceContentRevision(resource),
            resource,
          };
        },
        write: async ({ resource }) => {
          const written = await resourcePutIfSnapshot({
            previous: resource,
            owner: resource.owner,
            path: resource.path,
            content: body.content,
            mimeType: body.mimeType ?? resource.mimeType,
            ...(writeOptions ? { options: writeOptions } : {}),
          });
          seen.written = written?.resource ?? null;
          return written !== null;
        },
        isSameSave: () => isSameSaveOver(seen.read),
      });
      return withContentRevision(seen.written ?? current.resource);
    } catch (error) {
      return contractErrorResponse(event, error);
    }
  }
  const resource = writeOptions
    ? await resourcePut(
        existing.owner,
        nextPath,
        body.content ?? existing.content,
        body.mimeType ?? existing.mimeType,
        writeOptions,
      )
    : await resourcePut(
        existing.owner,
        nextPath,
        body.content ?? existing.content,
        body.mimeType ?? existing.mimeType,
      );

  return withContentRevision(resource);
}

export async function handleDeleteResource(event: any) {
  const id = getRouterParam(event, "id") || event.context.params?.id;
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Resource ID is required" };
  }

  const email = await resolveEmail(event);
  const orgId = await resolveOrgId(event);
  const existing = await resourceGet(id, { userEmail: email, orgId });
  if (!existing) {
    setResponseStatus(event, 404);
    return { error: "Resource not found" };
  }

  if (
    !canReadOwner(existing.owner, email, orgId) ||
    !isLegacySharedResourceVisibleToOrganization(existing, orgId)
  ) {
    setResponseStatus(event, 404);
    return { error: "Resource not found" };
  }
  if (
    isWorkspaceResourceOwner(existing.owner) &&
    !isLocalWorkspaceResourceId(existing.id)
  ) {
    setResponseStatus(event, 403);
    return { error: "Workspace resources are managed from Dispatch" };
  }
  const isLocalWorkspaceResource =
    isWorkspaceResourceOwner(existing.owner) &&
    isLocalWorkspaceResourceId(existing.id);
  const existingOrganizationId = organizationIdFromResourceOwner(
    existing.owner,
  );
  if (existing.owner === SHARED_OWNER || existingOrganizationId) {
    await assertCanEditShared(event);
  }

  if (isInheritedAppDefault(existing, orgId)) {
    setResponseStatus(event, 403);
    return {
      error:
        "This is an inherited app default. Create an organization override instead of deleting it.",
    };
  }

  const trashSkill = getQuery(event).trashSkill === "true";
  if (trashSkill && restorePathForTrashedSkill(existing)) return { ok: true };
  if (trashSkill && (!isSkillPath(existing.path) || isLocalWorkspaceResource)) {
    setResponseStatus(event, 400);
    return { error: "Only stored skill files can be moved to Trash" };
  }

  const deleted = trashSkill
    ? Boolean(
        await resourceMoveIfCurrent(
          existing,
          `${SKILL_TRASH_PREFIX}${existing.id}/${existing.path}`,
        ),
      )
    : existing.owner === SHARED_OWNER &&
        sharedResourceOwner(orgId) !== SHARED_OWNER &&
        isLegacyOrganizationWorkspaceFile(existing, orgId) &&
        typeof existing.metadata === "string"
      ? await resourceDeleteIfCurrent(existing)
      : isLocalWorkspaceResource
        ? await resourceDelete(id)
        : await resourceDeleteIfCurrent(existing);
  if (deleted && existingOrganizationId === orgId) {
    const legacy = await resourceGetByPath(SHARED_OWNER, existing.path, {
      orgId,
    });
    if (
      legacy &&
      isLegacyOrganizationWorkspaceFile(legacy, orgId) &&
      typeof legacy.metadata === "string"
    ) {
      await resourceDeleteIfCurrent(legacy);
    }
  }
  if (!deleted) {
    setResponseStatus(event, 409);
    return {
      error: trashSkill
        ? "Skill changed before it could be moved to Trash"
        : "Resource changed before it could be deleted",
    };
  }
  return { ok: true };
}

export async function handleUploadResource(event: any) {
  const parts = await readMultipartFormData(event);

  if (!parts || parts.length === 0) {
    setResponseStatus(event, 400);
    return { error: "No file uploaded" };
  }

  const filePart = parts.find((p) => p.name === "file");
  const pathPart = parts.find((p) => p.name === "path");
  const sharedPart = parts.find((p) => p.name === "shared");

  if (!filePart || !filePart.data) {
    setResponseStatus(event, 400);
    return { error: "No file data found" };
  }

  if (filePart.data.length > DEFAULT_UPLOAD_MAX_FILE_BYTES) {
    setResponseStatus(event, 413);
    return {
      error: `File too large (max ${Math.round(DEFAULT_UPLOAD_MAX_FILE_BYTES / 1024 / 1024)} MB)`,
    };
  }

  const fileName = filePart.filename || "upload";
  const path = canonicalResourcePath(
    (pathPart?.data && Buffer.from(pathPart.data).toString("utf8")) || fileName,
  );
  if (!path) {
    setResponseStatus(event, 400);
    return { error: "path is required" };
  }
  const shared = sharedPart?.data
    ? Buffer.from(sharedPart.data).toString("utf8") === "true"
    : false;
  const mimeType = filePart.type || "application/octet-stream";

  if (filePart.type && !isAllowedUploadMimeType(filePart.type)) {
    setResponseStatus(event, 415);
    return { error: `Unsupported file type: ${filePart.type}` };
  }
  if (shared) {
    await assertCanEditShared(event);
    // Without an organization the shared namespace is deployment-wide.
    if (!(await getOrgContext(event)).orgId) {
      throw createError({
        statusCode: 403,
        message: "Shared uploads require an organization",
      });
    }
  }
  const owner = await resolveOwner(event, shared);

  const isText =
    mimeType.startsWith("text/") || mimeType === "application/json";

  if (!isText) {
    const credentialEmail =
      owner !== SHARED_OWNER ? owner : (await getSession(event))?.email;
    const doUpload = () =>
      uploadFile({
        data: filePart.data,
        filename: fileName,
        mimeType,
        ownerEmail: owner,
      });
    const uploaded = credentialEmail
      ? await runWithRequestContext({ userEmail: credentialEmail }, doUpload)
      : await doUpload();
    if (uploaded) {
      const put = await putUnderFreePath(owner, path, uploaded.url, mimeType, {
        resend: true,
      });
      if (!put) return resourcePathTaken(event, owner, path, false);
      setResponseStatus(event, put.created ? 201 : 200);
      return {
        ...put.resource,
        url: uploaded.url,
        provider: uploaded.provider,
      };
    }
    setResponseStatus(event, 503);
    return {
      error:
        "File storage is not configured. Use Builder.io (free tier available) or register an S3/R2/GCS file upload provider before uploading binary resources.",
      storageSetupRequired: true,
    };
  }

  const content = Buffer.from(filePart.data).toString("utf-8");

  const put = await putUnderFreePath(owner, path, content, mimeType, {
    resend: true,
  });
  if (!put) return resourcePathTaken(event, owner, path, false);
  setResponseStatus(event, put.created ? 201 : 200);
  return withContentRevision(put.resource);
}

const CLAIM_PATH_ATTEMPTS = 5;

async function putUnderFreePath(
  owner: string,
  path: string,
  content: string,
  mimeType: string,
  options: { resend: boolean; write?: ResourceWriteOptions },
): Promise<{ resource: Resource; created: boolean } | null> {
  const orgId = organizationIdFromResourceOwner(owner);
  const lookup = orgId ? { orgId } : undefined;
  let target = path;
  for (let attempt = 0; attempt < CLAIM_PATH_ATTEMPTS; attempt += 1) {
    const legacyTaken = orgId
      ? (await resourceStoredPathsTaken(SHARED_OWNER, [target], { orgId })).has(
          target,
        )
      : false;
    if (!legacyTaken) {
      const created = options.write
        ? await resourcePutIfAbsent(
            owner,
            target,
            content,
            mimeType,
            options.write,
          )
        : await resourcePutIfAbsent(owner, target, content, mimeType);
      if (created) return { resource: created, created: true };
    }
    if (options.resend) {
      const holds = (resource: Resource) =>
        resource.content === content && resource.mimeType === mimeType;
      const existing =
        (await resourceNamed(owner, target, lookup, holds)) ??
        (lookup
          ? await resourceNamed(SHARED_OWNER, target, lookup, holds)
          : null);
      if (existing) return { resource: existing, created: false };
    }
    const { free, passed } = await searchFreeResourcePath(owner, path, false);
    if (options.resend) {
      const resent = await uploadStoredAt(
        owner,
        passed,
        content,
        mimeType,
        lookup,
      );
      if (resent) return { resource: resent, created: false };
    }
    if (!free) return null;
    target = free;
  }
  return null;
}

async function uploadStoredAt(
  owner: string,
  paths: readonly string[],
  content: string,
  mimeType: string,
  lookup: { orgId: string } | undefined,
): Promise<Resource | null> {
  for (let start = 0; start < paths.length; start += FREE_PATH_BATCH) {
    const batch = paths.slice(start, start + FREE_PATH_BATCH);
    const holding = await resourceStoredPathsTaken(owner, batch, {
      holding: { content, mimeType },
    });
    for (const candidate of batch) {
      if (!holding.has(candidate)) continue;
      const earlier = await resourceNamed(
        owner,
        candidate,
        lookup,
        (resource) =>
          resource.content === content && resource.mimeType === mimeType,
      );
      if (earlier) return earlier;
    }
  }
  return null;
}

function contractErrorResponse(event: H3Event, err: unknown) {
  if (isActionContractError(err)) {
    setResponseStatus(event, err.statusCode);
    return {
      error: err.message,
      errorCode: err.errorCode,
      ...(err.details ? { details: err.details } : {}),
    };
  }
  throw err;
}

/** GET /_agent-native/resources/export-pack — same pack as export-resource-pack. */
export async function handleExportResourcePack(event: any) {
  const email = await resolveEmail(event);
  const orgId = await resolveOrgId(event);
  try {
    const parsed = exportResourcePackSchema.safeParse(getQuery(event));
    if (!parsed.success) {
      fail("Invalid resource pack export request.", {
        errorCode: "invalid_action_request_body",
        statusCode: 400,
      });
    }
    return await exportResourcePack.run(parsed.data, {
      userEmail: email,
      orgId,
      caller: "http",
    });
  } catch (err) {
    return contractErrorResponse(event, err);
  }
}

/** POST /_agent-native/resources/import-pack — same pack as import-resource-pack. */
export async function handleImportResourcePack(event: any) {
  const email = await resolveEmail(event);
  const orgId = await resolveOrgId(event);
  try {
    const body = await readBodyWithSizeLimit(
      event,
      RESOURCE_PACK_MAX_BODY_BYTES,
    );
    const parsed = importResourcePackSchema.safeParse(body);
    if (!parsed.success) {
      fail("Invalid resource pack import request.", {
        errorCode: "invalid_action_request_body",
        statusCode: 400,
      });
    }
    return await importResourcePack.run(parsed.data, {
      userEmail: email,
      orgId,
      caller: "http",
    });
  } catch (err) {
    if (err instanceof SyntaxError) {
      setResponseStatus(event, 400);
      return {
        error: "Invalid resource pack import request.",
        errorCode: "invalid_action_request_body",
      };
    }
    return contractErrorResponse(event, err);
  }
}
