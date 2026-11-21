import {
  getConfiguredAppBasePath,
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import {
  discoverAgentsWithDirectoryStatus,
  getBuiltinAgents,
  type DiscoveredAgent,
} from "@agent-native/core/server/agent-discovery";

import {
  listWorkspaceApps,
  type WorkspaceAppSummary,
} from "./app-creation-store.js";
import {
  projectEnvironmentUrl,
  requestEnvironmentLane,
} from "./environment-lane.js";

const CACHE_TTL_MS = 5 * 60_000;
const MAX_SCOPES = 64;

export interface DispatchMcpDegradedSource {
  source: "connected-apps" | "workspace-directory" | "workspace-mounts";
  status: "unavailable" | "forbidden";
  usingCache: boolean;
  httpStatus?: number;
}

type WorkspaceMount = Pick<WorkspaceAppSummary, "id" | "url" | "path">;
type AgentManifest = Pick<
  DiscoveredAgent,
  "id" | "name" | "description" | "url" | "color" | "source" | "aliases"
>;
type Snapshot<T> = { started: number; expiresAt: number; entries: T[] };
type Cache<T> = Map<string, Snapshot<T>>;
const manifests: Cache<AgentManifest> = new Map();
let nextRead = 0;

function scopeKey(ownerEmail: string, orgId: string | undefined) {
  const context = getRequestContext();
  if (context?.authCapability || context?.verifiedServiceIdentity) return null;
  return JSON.stringify([
    ownerEmail.toLowerCase(),
    orgId,
    context?.requestOrigin,
    context?.a2aIdentityAssurance,
    context?.credentialScope,
    requestEnvironmentLane(),
  ]);
}

function readSnapshot<T>(cache: Cache<T>, scope: string | null): T[] {
  if (!scope) return [];
  const snapshot = cache.get(scope);
  return snapshot && snapshot.expiresAt > Date.now() ? snapshot.entries : [];
}

function saveSnapshot<T>(
  cache: Cache<T>,
  scope: string | null,
  started: number,
  entries: T[],
) {
  if (!scope || (cache.get(scope)?.started ?? 0) > started) return;
  cache.delete(scope);
  cache.set(scope, { started, expiresAt: Date.now() + CACHE_TTL_MS, entries });
  if (cache.size > MAX_SCOPES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function toManifest(agent: DiscoveredAgent): AgentManifest {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    url: agent.url,
    color: agent.color,
    ...(agent.source ? { source: agent.source } : {}),
    ...(agent.aliases?.length ? { aliases: [...agent.aliases] } : {}),
  };
}

function withFallback(
  fresh: AgentManifest[],
  cached: AgentManifest[],
): AgentManifest[] {
  const known = new Set(fresh.map((agent) => agent.id.toLowerCase()));
  return [
    ...fresh,
    ...cached.filter((agent) => !known.has(agent.id.toLowerCase())),
  ];
}

function registrationUrl(value: string): URL | null {
  const projected = projectEnvironmentUrl(value);
  if (!URL.canParse(projected)) return null;
  const url = new URL(projected);
  return (url.protocol === "https:" || url.protocol === "http:") &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
    ? url
    : null;
}

function sameInstallation(agent: AgentManifest, mount: WorkspaceMount) {
  if (agent.id.toLowerCase() !== mount.id.toLowerCase() || !mount.url) {
    return false;
  }
  const manifestUrl = registrationUrl(agent.url);
  const currentUrl = registrationUrl(mount.url);
  if (!manifestUrl || !currentUrl || manifestUrl.origin !== currentUrl.origin) {
    return false;
  }

  if (
    !mount.path.startsWith("/") ||
    mount.path.startsWith("//") ||
    mount.path.includes("\\") ||
    /%(?:2f|5c)/i.test(mount.path)
  )
    return false;
  const installUrl = new URL(mount.path, currentUrl.origin);
  if (
    installUrl.pathname !== mount.path ||
    installUrl.search ||
    installUrl.hash
  ) {
    return false;
  }

  const trimTrailingSlash = (path: string) => path.replace(/\/+$/, "");
  const manifestPath = trimTrailingSlash(manifestUrl.pathname);
  const installPath = trimTrailingSlash(installUrl.pathname);
  const legacyPath = `/dispatch/apps/${encodeURIComponent(mount.id)}`;
  return (
    manifestPath === trimTrailingSlash(currentUrl.pathname) ||
    manifestPath === installPath ||
    manifestPath === legacyPath ||
    manifestPath === `${getConfiguredAppBasePath()}${legacyPath}`
  );
}

type MountRead = Awaited<ReturnType<typeof readMounts>>;

async function recheckCachedInstallations(
  readCached: () => AgentManifest[],
  mountRead: Promise<MountRead>,
) {
  const { mounts, degraded } = await mountRead;
  if (degraded) return [];
  const byId = new Map(mounts.map((mount) => [mount.id.toLowerCase(), mount]));
  return readCached().filter((agent) => {
    const mount = byId.get(agent.id.toLowerCase());
    return mount !== undefined && sameInstallation(agent, mount);
  });
}

const TRANSIENT_DIRECTORY_REASONS = new Set([
  "network",
  "server-error",
  "timeout",
]);

async function readAgents(
  scope: string | null,
  started: number,
  mountRead: Promise<MountRead>,
) {
  let result: Awaited<ReturnType<typeof discoverAgentsWithDirectoryStatus>>;
  try {
    result = await discoverAgentsWithDirectoryStatus("dispatch", {
      requireReadableAgentSources: true,
    });
  } catch (error) {
    const httpStatus = statusFromError(error);
    const forbidden = httpStatus === 401 || httpStatus === 403;
    if (forbidden) saveSnapshot(manifests, scope, started, []);
    const cached = forbidden
      ? []
      : await recheckCachedInstallations(
          () =>
            readSnapshot(manifests, scope).filter(
              (agent) =>
                agent.source !== "builtin" && agent.source !== "org-directory",
            ),
          mountRead,
        );
    return {
      agents: withFallback(
        getBuiltinAgents("dispatch").map(toManifest),
        cached,
      ),
      degraded: {
        source: "connected-apps",
        status: forbidden ? "forbidden" : "unavailable",
        usingCache: cached.length > 0,
        ...(httpStatus ? { httpStatus } : {}),
      } satisfies DispatchMcpDegradedSource,
    };
  }

  const agents = result.agents.map(toManifest);
  const directory = result.directory;
  if (directory.status === "unavailable" || directory.status === "forbidden") {
    const reason =
      directory.status === "unavailable" ? directory.reason : "authorization";
    const forbidden =
      reason === "authentication" ||
      reason === "unauthorized" ||
      reason === "authorization";
    const transient = TRANSIENT_DIRECTORY_REASONS.has(reason);
    const current = agents.filter((agent) => agent.source !== "org-directory");
    const cached = transient
      ? await recheckCachedInstallations(
          () =>
            readSnapshot(manifests, scope).filter(
              (agent) => agent.source === "org-directory",
            ),
          mountRead,
        )
      : [];
    if (!transient) saveSnapshot(manifests, scope, started, current);
    return {
      agents: withFallback(current, cached),
      degraded: {
        source: "workspace-directory",
        status: forbidden ? "forbidden" : "unavailable",
        usingCache: cached.length > 0,
      } satisfies DispatchMcpDegradedSource,
    };
  }

  const available =
    directory.status === "available"
      ? agents
      : agents.filter((agent) => agent.source !== "org-directory");
  saveSnapshot(manifests, scope, started, available);
  return { agents: available, degraded: undefined };
}

function statusFromError(error: unknown): number | undefined {
  const seen = new Set<object>();
  let current: unknown = error;
  let firstStatus: number | undefined;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    for (const key of ["statusCode", "status", "code"] as const) {
      const status = (current as Record<string, unknown>)[key];
      if (status === 401 || status === 403) return status;
      if (
        firstStatus === undefined &&
        typeof status === "number" &&
        status >= 400 &&
        status <= 599
      ) {
        firstStatus = status;
      }
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return firstStatus;
}

async function readMounts() {
  try {
    const apps = await listWorkspaceApps({ includeAgentCards: false });
    return {
      mounts: apps
        .filter((app) => app.status !== "pending")
        .map(({ id, url, path }) => ({ id, url, path })),
    };
  } catch (error) {
    const httpStatus = statusFromError(error);
    return {
      mounts: [],
      degraded: {
        source: "workspace-mounts",
        status:
          httpStatus === 401 || httpStatus === 403
            ? "forbidden"
            : "unavailable",
        usingCache: false,
        ...(httpStatus ? { httpStatus } : {}),
      } satisfies DispatchMcpDegradedSource,
    };
  }
}

export async function discoverDispatchMcpApps(): Promise<{
  agents: AgentManifest[];
  mountedApps: WorkspaceMount[];
  degradedSources: DispatchMcpDegradedSource[];
}> {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) throw new Error("no authenticated user");
  const orgId = getRequestOrgId();
  const scope = scopeKey(ownerEmail, orgId);
  const started = ++nextRead;
  const mountRead = readMounts();
  const [agents, mounts] = await Promise.all([
    readAgents(scope, started, mountRead),
    mountRead,
  ]);
  const degradedSources = [agents.degraded, mounts.degraded].filter(
    (source) => source !== undefined,
  );
  for (const source of degradedSources) {
    console.warn("[dispatch] MCP app discovery degraded", source);
  }
  return { agents: agents.agents, mountedApps: mounts.mounts, degradedSources };
}
