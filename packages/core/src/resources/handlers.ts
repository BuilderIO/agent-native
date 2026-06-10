import {
  getQuery,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
  readMultipartFormData,
} from "h3";
import {
  resourceGet,
  resourceGetByPath,
  resourcePut,
  resourceDelete,
  resourceList,
  resourceListAccessible,
  resourceMove,
  resourceEffectiveContext,
  ensurePersonalDefaults,
  SHARED_OWNER,
  WORKSPACE_OWNER,
  type ResourceMeta,
} from "./store.js";
import {
  getResourceKind,
  isRemoteAgentPath,
  parseCustomAgentProfile,
  parseRemoteAgentManifest,
  parseSkillMetadata,
  type CustomAgentProfile,
  type RemoteAgentManifest,
  type SkillMetadata,
} from "./metadata.js";
import { getSession } from "../server/auth.js";
import {
  readBody,
  DEFAULT_UPLOAD_MAX_FILE_BYTES,
  isAllowedUploadMimeType,
} from "../server/h3-helpers.js";
import { uploadFile } from "../file-upload/index.js";
import { runWithRequestContext } from "../server/request-context.js";
import { getOrgContext } from "../org/context.js";
import { createError } from "h3";

// ---------------------------------------------------------------------------
// Owner resolution
// ---------------------------------------------------------------------------

async function resolveOwner(event: any, shared?: boolean): Promise<string> {
  if (shared) return SHARED_OWNER;
  const session = await getSession(event);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  return session.email;
}

function canReadOwner(owner: string, email: string): boolean {
  return owner === email || owner === SHARED_OWNER || owner === WORKSPACE_OWNER;
}

async function resolveEmail(event: any): Promise<string> {
  const session = await getSession(event);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  return session.email;
}

async function resolveOrgId(event: any): Promise<string | null> {
  try {
    const ctx = await getOrgContext(event);
    return ctx.orgId ?? null;
  } catch {
    return null;
  }
}

/**
 * Reject writes to organization-wide resources unless the user is the
 * organization owner/admin (or the deployment is solo — no org membership).
 * Read access remains open to every org member.
 */
async function assertCanEditShared(event: any): Promise<void> {
  const session = await getSession(event);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  const ctx = await getOrgContext(event);
  if (!ctx.orgId) return; // solo / dev mode — no org, treat as owner
  if (ctx.role === "owner" || ctx.role === "admin") return;
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

// ---------------------------------------------------------------------------
// Tree building
// ---------------------------------------------------------------------------

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

function buildTree(resources: ResourceMeta[]): TreeNode[] {
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
          resource: res,
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

/** Sort tree nodes: folders first, then files, alphabetically within each group */
function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  for (const node of nodes) {
    if (node.children) sortTree(node.children);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** GET /_agent-native/resources — list resources */
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

  // Seed personal AGENTS.md + LEARNINGS.md on first access
  await ensurePersonalDefaults(email);

  let resources: ResourceMeta[];

  if (scope === "personal") {
    resources = localListOptions
      ? await resourceList(email, prefix, localListOptions)
      : await resourceList(email, prefix);
  } else if (scope === "workspace") {
    resources = await resourceList(WORKSPACE_OWNER, prefix, scopedListOptions);
  } else if (scope === "shared") {
    resources = localListOptions
      ? await resourceList(SHARED_OWNER, prefix, localListOptions)
      : await resourceList(SHARED_OWNER, prefix);
  } else {
    // "all" — personal + organization/shared + inherited workspace
    resources = await resourceListAccessible(email, prefix, scopedListOptions);
  }

  return { resources };
}

/** GET /_agent-native/resources/tree — build nested tree */
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

  // Seed personal AGENTS.md + LEARNINGS.md on first access
  await ensurePersonalDefaults(email);

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
    resources = localListOptions
      ? await resourceList(SHARED_OWNER, undefined, localListOptions)
      : await resourceList(SHARED_OWNER);
  } else {
    resources = await resourceListAccessible(
      email,
      undefined,
      scopedListOptions,
    );
  }

  const tree = buildTree(resources);

  // Enrich typed resources with parsed metadata for richer UI
  await enrichTreeNodes(tree);

  return { tree };
}

/** GET /_agent-native/resources/effective?path=... — show inheritance stack */
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

/**
 * Walk the tree and add typed metadata for jobs, skills, and agents.
 */
async function enrichTreeNodes(nodes: TreeNode[]): Promise<void> {
  let parseFn: typeof import("../jobs/scheduler.js").parseJobFrontmatter;
  let describeFn: typeof import("../jobs/cron.js").describeCron;
  try {
    const scheduler = await import("../jobs/scheduler.js");
    const cron = await import("../jobs/cron.js");
    parseFn = scheduler.parseJobFrontmatter;
    describeFn = cron.describeCron;
  } catch {
    return; // Jobs module not available
  }

  for (const node of nodes) {
    if (node.type === "folder" && node.children) {
      await enrichTreeNodes(node.children);
    }
    if (node.type === "file" && node.resource) {
      try {
        const full = await resourceGet(node.resource.id);
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

/** GET /_agent-native/resources/:id — get single resource with content.
 *  If the request comes from an <img>/<video>/etc tag (Accept includes the
 *  resource's mime type, or query param `?raw` is set), return the raw binary
 *  with the correct Content-Type so the browser can render it inline. */
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

  if (!canReadOwner(resource.owner, email)) {
    setResponseStatus(event, 404);
    return { error: "Resource not found" };
  }

  // Serve raw binary when ?raw query param is set (used by <img> tags etc.)
  const query = getQuery(event);
  const wantsRaw = query.raw !== undefined;

  if (wantsRaw && resource.content) {
    const isText =
      resource.mimeType.startsWith("text/") ||
      resource.mimeType === "application/json";
    const buf = isText
      ? Buffer.from(resource.content, "utf-8")
      : Buffer.from(resource.content, "base64");

    setResponseHeader(event, "Content-Type", resource.mimeType);
    setResponseHeader(event, "Content-Length", String(buf.length));
    return new Response(buf);
  }

  // For binary resources (images, audio, video), omit the content field from
  // the JSON response — it can be megabytes of base64. The client fetches
  // the actual bytes via ?raw when it needs to display them.
  const isBinary =
    resource.mimeType.startsWith("image/") ||
    resource.mimeType.startsWith("audio/") ||
    resource.mimeType.startsWith("video/") ||
    resource.mimeType === "application/octet-stream";

  if (isBinary) {
    const { content: _content, ...meta } = resource;
    return { ...meta, content: "" };
  }

  return resource;
}

/** POST /_agent-native/resources — create a resource */
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

  // If ifNotExists is set, skip if the resource already exists
  if (body.ifNotExists) {
    const existing = await resourceGetByPath(owner, body.path);
    if (existing) {
      return existing;
    }
  }

  const writeOptions =
    body.metadata !== undefined ? { metadata: body.metadata } : undefined;
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
  return resource;
}

/** PUT /_agent-native/resources/:id — update an existing resource */
export async function handleUpdateResource(event: any) {
  const id = getRouterParam(event, "id") || event.context.params?.id;
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Resource ID is required" };
  }

  const existing = await resourceGet(id);
  if (!existing) {
    setResponseStatus(event, 404);
    return { error: "Resource not found" };
  }

  // Ownership check: only the owner (or shared resource editors) can update
  const email = await resolveEmail(event);
  if (!canReadOwner(existing.owner, email)) {
    setResponseStatus(event, 404);
    return { error: "Resource not found" };
  }
  if (existing.owner === WORKSPACE_OWNER) {
    setResponseStatus(event, 403);
    return { error: "Workspace resources are managed from Dispatch" };
  }
  if (existing.owner === SHARED_OWNER) {
    await assertCanEditShared(event);
  }

  const body = await readBody(event);

  // If path changed, move it
  if (body.path && body.path !== existing.path) {
    await resourceMove(id, body.path);
  }

  // Update content/mimeType by re-putting
  const writeOptions =
    body.metadata !== undefined ? { metadata: body.metadata } : undefined;
  const resource = writeOptions
    ? await resourcePut(
        existing.owner,
        body.path ?? existing.path,
        body.content ?? existing.content,
        body.mimeType ?? existing.mimeType,
        writeOptions,
      )
    : await resourcePut(
        existing.owner,
        body.path ?? existing.path,
        body.content ?? existing.content,
        body.mimeType ?? existing.mimeType,
      );

  return resource;
}

/** DELETE /_agent-native/resources/:id — delete a resource */
export async function handleDeleteResource(event: any) {
  const id = getRouterParam(event, "id") || event.context.params?.id;
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Resource ID is required" };
  }

  const existing = await resourceGet(id);
  if (!existing) {
    setResponseStatus(event, 404);
    return { error: "Resource not found" };
  }

  // Ownership check: only the owner (or shared resource editors) can delete
  const email = await resolveEmail(event);
  if (!canReadOwner(existing.owner, email)) {
    setResponseStatus(event, 404);
    return { error: "Resource not found" };
  }
  if (existing.owner === WORKSPACE_OWNER) {
    setResponseStatus(event, 403);
    return { error: "Workspace resources are managed from Dispatch" };
  }
  if (existing.owner === SHARED_OWNER) {
    await assertCanEditShared(event);
  }

  await resourceDelete(id);
  return { ok: true };
}

/** POST /_agent-native/resources/upload — upload a file as a resource */
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

  // Reject oversized uploads before touching any storage.
  if (filePart.data.length > DEFAULT_UPLOAD_MAX_FILE_BYTES) {
    setResponseStatus(event, 413);
    return {
      error: `File too large (max ${Math.round(DEFAULT_UPLOAD_MAX_FILE_BYTES / 1024 / 1024)} MB)`,
    };
  }

  const fileName = filePart.filename || "upload";
  const path = pathPart?.data?.toString() || `/${fileName}`;
  const shared = sharedPart?.data?.toString() === "true";
  const mimeType = filePart.type || "application/octet-stream";

  // Reject executable / script MIME types.
  if (filePart.type && !isAllowedUploadMimeType(filePart.type)) {
    setResponseStatus(event, 415);
    return { error: `Unsupported file type: ${filePart.type}` };
  }
  if (shared) {
    await assertCanEditShared(event);
  }
  const owner = await resolveOwner(event, shared);

  // Prefer a registered file upload provider (e.g. Builder.io) for binary
  // assets so we get a real CDN URL instead of a base64 blob in SQL.
  // Text resources still live in SQL — they're edited inline and benefit
  // from the resource store's metadata/search features.
  const isText =
    mimeType.startsWith("text/") || mimeType === "application/json";

  if (!isText) {
    // Use the actual session user email for credential resolution — not `owner`,
    // which is "__shared__" for org-wide resources and would break the per-user
    // DB credential lookup (resolveBuilderCredential refuses env fallback for any
    // non-null non-local email, including the sentinel value).
    const credentialEmail =
      owner !== SHARED_OWNER
        ? owner
        : (await getSession(event).catch(() => null))?.email;
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
      const resource = await resourcePut(owner, path, uploaded.url, mimeType);
      setResponseStatus(event, 201);
      return { ...resource, url: uploaded.url, provider: uploaded.provider };
    }
  }

  // Fallback: store contents in SQL (base64 for binary, text as-is).
  const content = isText
    ? Buffer.from(filePart.data).toString("utf-8")
    : Buffer.from(filePart.data).toString("base64");

  const resource = await resourcePut(owner, path, content, mimeType);

  setResponseStatus(event, 201);
  return resource;
}
