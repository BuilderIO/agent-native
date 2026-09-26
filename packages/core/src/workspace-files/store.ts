import { getOrgRoleForEmail } from "../mcp/actions/service-token-access.js";
import { canManageOrg } from "../org/permissions.js";
import {
  SHARED_OWNER,
  isLegacyOrganizationWorkspaceFile,
  sharedResourceOwner,
  resourceDeleteIfCurrent,
  resourceGetByPath,
  resourceList,
  resourcePut,
  type Resource,
  type ResourceMeta,
  type ResourceVisibility,
} from "../resources/store.js";
import { getRequestUserEmail } from "../server/request-context.js";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export const MAX_SCOPE_BYTES = 200 * 1024 * 1024;

export const SAVE_TO_FILE_MAX_BYTES = 20 * 1024 * 1024;

export interface WorkspaceFilesScope {
  scope: "user" | "org";
  scopeId: string;
}

function ownerForScope(scope: WorkspaceFilesScope): string {
  return scope.scope === "org"
    ? sharedResourceOwner(scope.scopeId)
    : scope.scopeId;
}

function optionsForScope(scope: WorkspaceFilesScope) {
  return scope.scope === "org" ? { orgId: scope.scopeId } : undefined;
}

async function resolveResourceForScope(
  scope: WorkspaceFilesScope,
  path: string,
): Promise<{ resource: Resource; owner: string } | null> {
  const owner = ownerForScope(scope);
  const options = optionsForScope(scope);
  const resource = await resourceGetByPath(owner, path, options);
  if (resource) return { resource, owner };
  if (scope.scope !== "org") return null;

  const legacy = await resourceGetByPath(SHARED_OWNER, path, options);
  return legacy && isLegacyOrganizationWorkspaceFile(legacy, scope.scopeId)
    ? { resource: legacy, owner: SHARED_OWNER }
    : null;
}

export function isScratchWorkspacePath(path: string): boolean {
  return path === "scratch" || path.startsWith("scratch/");
}

function visibilityForPath(path: string): ResourceVisibility {
  return isScratchWorkspacePath(path) ? "agent_scratch" : "workspace";
}

function workspaceFileMetadata(scope: WorkspaceFilesScope) {
  return {
    source: "workspace-files",
    scope: scope.scope,
    scopeId: scope.scopeId,
  };
}

async function assertCanMutateWorkspaceFile(
  scope: WorkspaceFilesScope,
  path: string,
): Promise<void> {
  if (scope.scope !== "org" || isScratchWorkspacePath(path)) return;
  const email = getRequestUserEmail()?.trim();
  const role = email ? await getOrgRoleForEmail(scope.scopeId, email) : null;
  if (!email || !canManageOrg(role)) {
    throw new Error(
      "Only organization owners and admins can edit organization files",
    );
  }
}

export function validatePath(path: string): string | null {
  if (!path || typeof path !== "string") return "path is required";
  if (path.startsWith("/")) return 'path must not start with "/"';
  if (path.includes("\0")) return "path must not contain null bytes";
  const parts = path.split("/");
  for (const part of parts) {
    if (part === "..") return 'path must not contain ".." components';
    if (part === "")
      return 'path must not contain empty segments ("//" or trailing "/")';
  }
  return null;
}

export interface WorkspaceFile {
  id: string;
  scope: string;
  scopeId: string;
  path: string;
  content: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceFileMeta {
  id: string;
  path: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export function fileNameFromPath(path: string): string {
  return path.split("/").at(-1) || path;
}

export interface WorkspaceFileCard {
  resourceId: string;
  path: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  updatedAt: string;
}

export function toWorkspaceFileCard(
  meta: WorkspaceFileMeta,
): WorkspaceFileCard {
  return {
    resourceId: meta.id,
    path: meta.path,
    name: fileNameFromPath(meta.path),
    contentType: meta.contentType,
    sizeBytes: meta.sizeBytes,
    updatedAt: meta.updatedAt,
  };
}

export async function writeWorkspaceFile(
  scope: WorkspaceFilesScope,
  path: string,
  content: string,
  contentType = "text/plain",
  opts?: { maxFileBytes?: number },
): Promise<WorkspaceFileMeta> {
  const pathErr = validatePath(path);
  if (pathErr) throw new Error(`Invalid path: ${pathErr}`);
  await assertCanMutateWorkspaceFile(scope, path);

  const legacy =
    scope.scope === "org"
      ? await resourceGetByPath(SHARED_OWNER, path, optionsForScope(scope))
      : null;
  const legacyOrganizationResource =
    scope.scope === "org" &&
    legacy &&
    isLegacyOrganizationWorkspaceFile(legacy, scope.scopeId)
      ? legacy
      : null;

  const maxFileBytes = Math.min(
    opts?.maxFileBytes ?? MAX_FILE_BYTES,
    SAVE_TO_FILE_MAX_BYTES,
  );
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > maxFileBytes) {
    throw new Error(
      `File "${path}" would be ${(bytes / 1024 / 1024).toFixed(2)} MB, which exceeds the ${(maxFileBytes / 1024 / 1024).toFixed(0)} MB per-file limit.`,
    );
  }

  const resource = await resourcePut(
    ownerForScope(scope),
    path,
    content,
    contentType,
    {
      createdBy: legacyOrganizationResource?.createdBy ?? "agent",
      visibility: legacyOrganizationResource
        ? legacyOrganizationResource.visibility
        : visibilityForPath(path),
      ...(legacyOrganizationResource
        ? {
            threadId: legacyOrganizationResource.threadId,
            runId: legacyOrganizationResource.runId,
            expiresAt: legacyOrganizationResource.expiresAt,
          }
        : {}),
      metadata: workspaceFileMetadata(scope),
    },
  );

  if (
    scope.scope === "org" &&
    legacyOrganizationResource &&
    typeof legacyOrganizationResource.metadata === "string"
  ) {
    await resourceDeleteIfCurrent(legacyOrganizationResource);
  }

  return resourceToMeta(resource);
}

export async function appendWorkspaceFile(
  scope: WorkspaceFilesScope,
  path: string,
  text: string,
  contentType = "text/plain",
): Promise<WorkspaceFileMeta> {
  const pathErr = validatePath(path);
  if (pathErr) throw new Error(`Invalid path: ${pathErr}`);

  const existing = await resolveResourceForScope(scope, path);
  const newContent = existing ? existing.resource.content + text : text;
  return writeWorkspaceFile(scope, path, newContent, contentType);
}

export async function readWorkspaceFile(
  scope: WorkspaceFilesScope,
  path: string,
  opts?: { offset?: number; maxChars?: number },
): Promise<WorkspaceFile | null> {
  const pathErr = validatePath(path);
  if (pathErr) throw new Error(`Invalid path: ${pathErr}`);

  const resolved = await resolveResourceForScope(scope, path);
  if (!resolved) return null;

  let content = resolved.resource.content;
  if (opts?.offset || opts?.maxChars) {
    const off = opts.offset ?? 0;
    content = content.slice(
      off,
      opts.maxChars !== undefined ? off + opts.maxChars : undefined,
    );
  }

  return resourceToFile(resolved.resource, scope, content);
}

export async function getWorkspaceFileMeta(
  scope: WorkspaceFilesScope,
  path: string,
): Promise<WorkspaceFileMeta | null> {
  const pathErr = validatePath(path);
  if (pathErr) throw new Error(`Invalid path: ${pathErr}`);

  const resolved = await resolveResourceForScope(scope, path);
  return resolved ? resourceToMeta(resolved.resource) : null;
}

export async function listWorkspaceFiles(
  scope: WorkspaceFilesScope,
  prefix?: string,
): Promise<WorkspaceFileMeta[]> {
  const owner = ownerForScope(scope);
  const normalizedPrefix = normalizePrefix(prefix);
  const resources = await resourceList(owner, normalizedPrefix, {
    includeAgentScratch: true,
    ...optionsForScope(scope),
  });
  const allResources =
    scope.scope === "org"
      ? [
          ...resources,
          ...(
            await resourceList(SHARED_OWNER, normalizedPrefix, {
              includeAgentScratch: true,
              ...optionsForScope(scope),
            })
          ).filter(
            (resource) =>
              isLegacyOrganizationWorkspaceFile(resource, scope.scopeId) &&
              !resources.some((current) => current.path === resource.path),
          ),
        ]
      : resources;
  const filtered = normalizedPrefix
    ? allResources.filter(
        (resource) =>
          resource.path === normalizedPrefix ||
          resource.path.startsWith(`${normalizedPrefix}/`),
      )
    : allResources;

  return filtered
    .map(resourceToMeta)
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function deleteWorkspaceFile(
  scope: WorkspaceFilesScope,
  path: string,
): Promise<boolean> {
  const pathErr = validatePath(path);
  if (pathErr) throw new Error(`Invalid path: ${pathErr}`);
  await assertCanMutateWorkspaceFile(scope, path);

  const resolved = await resolveResourceForScope(scope, path);
  if (!resolved) return false;

  const deleted = await resourceDeleteIfCurrent(resolved.resource);
  if (deleted && scope.scope === "org" && resolved.owner !== SHARED_OWNER) {
    const legacy = await resourceGetByPath(
      SHARED_OWNER,
      path,
      optionsForScope(scope),
    );
    if (
      legacy &&
      isLegacyOrganizationWorkspaceFile(legacy, scope.scopeId) &&
      typeof legacy.metadata === "string"
    ) {
      await resourceDeleteIfCurrent(legacy);
    }
  }
  return deleted;
}

export async function grepWorkspaceFiles(
  scope: WorkspaceFilesScope,
  pattern: string,
  opts?: {
    pathPrefix?: string;
    useRegex?: boolean;
    maxMatchesPerFile?: number;
    maxFiles?: number;
  },
): Promise<Array<{ path: string; lineNumber: number; line: string }>> {
  const files = await listWorkspaceFiles(scope, opts?.pathPrefix);
  const limited = files.slice(0, opts?.maxFiles ?? 50);

  let regex: RegExp;
  try {
    regex = opts?.useRegex
      ? new RegExp(pattern, "i")
      : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  } catch {
    throw new Error(`Invalid regex pattern: ${pattern}`);
  }

  const results: Array<{ path: string; lineNumber: number; line: string }> = [];
  const maxPerFile = opts?.maxMatchesPerFile ?? 20;

  for (const meta of limited) {
    const file = await readWorkspaceFile(scope, meta.path);
    if (!file) continue;
    const lines = file.content.split("\n");
    let matchCount = 0;
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        results.push({ path: meta.path, lineNumber: i + 1, line: lines[i] });
        matchCount++;
        if (matchCount >= maxPerFile) break;
      }
    }
  }

  return results;
}

function normalizePrefix(prefix?: string): string | undefined {
  if (!prefix) return undefined;
  const normalized = prefix.replace(/\/+$/, "");
  if (!normalized) return undefined;
  const pathErr = validatePath(normalized);
  if (pathErr) throw new Error(pathErr);
  return normalized;
}

function isoTime(value: number): string {
  return new Date(value).toISOString();
}

function resourceToMeta(resource: ResourceMeta): WorkspaceFileMeta {
  return {
    id: resource.id,
    path: resource.path,
    contentType: resource.mimeType,
    sizeBytes: resource.size,
    createdAt: isoTime(resource.createdAt),
    updatedAt: isoTime(resource.updatedAt),
  };
}

function resourceToFile(
  resource: Resource,
  scope: WorkspaceFilesScope,
  content: string,
): WorkspaceFile {
  return {
    id: resource.id,
    scope: scope.scope,
    scopeId: scope.scopeId,
    path: resource.path,
    content,
    contentType: resource.mimeType,
    sizeBytes: resource.size,
    createdAt: isoTime(resource.createdAt),
    updatedAt: isoTime(resource.updatedAt),
  };
}
