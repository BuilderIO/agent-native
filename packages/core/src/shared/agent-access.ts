export const AGENT_ACCESS_PARAM = "agent_access";
export const DEFAULT_AGENT_ACCESS_TTL_SECONDS = 2 * 60 * 60;

export interface AgentAccessResourceScope {
  resourceKind: string;
  resourceId: string;
}

export interface AgentAccessUrlOptions {
  origin?: string;
  basePath?: string;
  tokenParam?: string;
}

export interface AgentAccessApiUrlOptions extends AgentAccessUrlOptions {
  endpoint: string;
  resourceId: string;
  idParam?: string;
  token?: string | null;
  extraParams?: Array<[string, string | number | boolean | null | undefined]>;
}

function normalizeResourcePart(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
}

export function scopedAgentAccessResourceId(
  resourceKind: string,
  resourceId: string,
): string {
  return `${normalizeResourcePart(resourceKind, "resourceKind")}:${normalizeResourcePart(resourceId, "resourceId")}`;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

export function normalizeAgentAccessBasePath(basePath?: string): string {
  const trimmed = trimSlashes(basePath ?? "");
  return trimmed ? `/${trimmed}` : "";
}

export function normalizeAgentAccessOrigin(origin?: string): string {
  if (!origin) return "";
  return origin.replace(/\/+$/g, "");
}

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

export function toAgentAccessUrl(
  pathOrUrl: string,
  options: Pick<AgentAccessUrlOptions, "origin" | "basePath"> = {},
): string {
  if (isAbsoluteUrl(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${normalizeAgentAccessOrigin(options.origin)}${normalizeAgentAccessBasePath(options.basePath)}${path}`;
}

export function appendAgentAccessParam(
  urlOrPath: string,
  token: string,
  param = AGENT_ACCESS_PARAM,
): string {
  const hashIndex = urlOrPath.indexOf("#");
  const base = hashIndex >= 0 ? urlOrPath.slice(0, hashIndex) : urlOrPath;
  const hash = hashIndex >= 0 ? urlOrPath.slice(hashIndex) : "";
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${encodeURIComponent(param)}=${encodeURIComponent(token)}${hash}`;
}

export function buildAgentAccessUrl({
  path,
  token,
  origin,
  basePath,
  tokenParam = AGENT_ACCESS_PARAM,
}: AgentAccessUrlOptions & {
  path: string;
  token: string;
}): string {
  return appendAgentAccessParam(
    toAgentAccessUrl(path, { origin, basePath }),
    token,
    tokenParam,
  );
}

export function buildAgentAccessApiUrl({
  endpoint,
  resourceId,
  idParam = "id",
  token,
  tokenParam = AGENT_ACCESS_PARAM,
  extraParams,
  origin,
  basePath,
}: AgentAccessApiUrlOptions): string {
  const params = new URLSearchParams({ [idParam]: resourceId });
  if (token) params.set(tokenParam, token);
  for (const [key, value] of extraParams ?? []) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  return toAgentAccessUrl(`${endpoint}?${params.toString()}`, {
    origin,
    basePath,
  });
}
