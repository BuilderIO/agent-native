import {
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import {
  discoverAgentsWithDirectoryStatus,
  getBuiltinAgents,
  type DiscoveredAgent,
} from "@agent-native/core/server/agent-discovery";
import { resolveAccessMany } from "@agent-native/core/sharing";

import {
  listWorkspaceApps,
  type WorkspaceAppSummary,
} from "./app-creation-store.js";
import { requestEnvironmentLane } from "./environment-lane.js";

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
const mounts: Cache<WorkspaceMount> = new Map();
let nextRead = 0;

function scopeKey(ownerEmail: string, orgId: string | undefined) {
  const context = getRequestContext();
  // A capability session has a separate authorization scope from its owner.
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

async function readAgents(scope: string | null, started: number) {
  let result: Awaited<ReturnType<typeof discoverAgentsWithDirectoryStatus>>;
  try {
    result = await discoverAgentsWithDirectoryStatus("dispatch", {
      requireReadableAgentSources: true,
    });
  } catch {
    const cached = readSnapshot(manifests, scope).filter(
      (agent) => agent.source !== "builtin" && agent.source !== "org-directory",
    );
    return {
      agents: withFallback(
        getBuiltinAgents("dispatch").map(toManifest),
        cached,
      ),
      degraded: {
        source: "connected-apps",
        status: "unavailable",
        usingCache: cached.length > 0,
      } satisfies DispatchMcpDegradedSource,
    };
  }

  const agents = result.agents.map(toManifest);
  const directory = result.directory;
  if (directory.status === "unavailable") {
    const cached = readSnapshot(manifests, scope).filter(
      (agent) => agent.source === "org-directory",
    );
    // Keep the last known directory snapshot at its original expiry while the
    // directory is unavailable. Repeated failures must not extend its life.
    return {
      agents: withFallback(agents, cached),
      degraded: {
        source: "workspace-directory",
        status: "unavailable",
        usingCache: cached.length > 0,
      } satisfies DispatchMcpDegradedSource,
    };
  }
  saveSnapshot(manifests, scope, started, agents);
  return {
    agents,
    degraded:
      directory.status === "forbidden"
        ? ({
            source: "workspace-directory",
            status: "forbidden",
            usingCache: false,
          } satisfies DispatchMcpDegradedSource)
        : undefined,
  };
}

function statusFromError(error: unknown): number | undefined {
  if (typeof error !== "object" || !error) return undefined;
  const status =
    "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : "status" in error
        ? error.status
        : undefined;
  return typeof status === "number" && status >= 400 && status <= 599
    ? status
    : undefined;
}

async function readMounts(
  scope: string | null,
  started: number,
  ownerEmail: string,
  orgId: string | undefined,
) {
  try {
    const apps = await listWorkspaceApps({ includeAgentCards: false });
    const entries = apps
      .filter((app) => app.status !== "pending")
      .map(({ id, url, path }) => ({ id, url, path }));
    saveSnapshot(mounts, scope, started, entries);
    return { mounts: entries };
  } catch (error) {
    const httpStatus = statusFromError(error);
    const forbidden = httpStatus === 401 || httpStatus === 403;
    if (forbidden) saveSnapshot(mounts, scope, started, []);
    const cached = forbidden ? [] : readSnapshot(mounts, scope);
    let verified: WorkspaceMount[] = [];
    if (cached.length > 0) {
      try {
        const currentAccess = await resolveAccessMany(
          "workspace-app",
          cached.map((app) => app.id),
          { userEmail: ownerEmail, ...(orgId ? { orgId } : {}) },
        );
        verified = cached.filter((app) => {
          const access = currentAccess.get(app.id);
          return (
            access?.resource?.path === app.path &&
            (access.resource.orgEnabled !== false || access.role === "owner")
          );
        });
      } catch {
        // A mount needs a current sharing decision before it can be reused.
      }
    }
    return {
      mounts: verified,
      degraded: {
        source: "workspace-mounts",
        status: forbidden ? "forbidden" : "unavailable",
        usingCache: verified.length > 0,
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
  const [agents, mounts] = await Promise.all([
    readAgents(scope, started),
    readMounts(scope, started, ownerEmail, orgId),
  ]);
  const degradedSources = [agents.degraded, mounts.degraded].filter(
    (source) => source !== undefined,
  );
  for (const source of degradedSources) {
    console.warn("[dispatch] MCP app discovery degraded", source);
  }
  return { agents: agents.agents, mountedApps: mounts.mounts, degradedSources };
}
