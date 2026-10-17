import { createHmac, randomUUID } from "node:crypto";

import { canonicalA2AAudience } from "../a2a/audience.js";
import { isLoopbackAddress } from "../a2a/auth-policy.js";
import { signA2AToken } from "../a2a/client.js";
import { getAppConfig } from "../app-config/index.js";
import { getDbExec, type DbExec } from "../db/client.js";
import { readDeployCredentialEnv } from "../server/credential-provider.js";
import {
  isHostedWorkspaceRuntime,
  resolveVercelDeploymentProtectionHeaders,
} from "../server/deployment-protection.js";
import { workspaceUserGroupsIncludeUser } from "../workspace-connections/groups.js";
import { isMissingOrganizationTableError } from "./membership.js";
import {
  getCachedWorkspaceAccess,
  invalidateMemberOrgCaches,
  rememberWorkspaceAccess,
  workspaceAccessGenerationNow,
} from "./request-org-cache.js";
import {
  describeFetchFailure,
  isWorkspaceAppAccessUnavailable,
  registryErrorDetail,
  workspaceAppAccessUnavailable,
  WORKSPACE_APP_ACCESS_UNAVAILABLE,
  type WorkspaceAppAccessCheck,
  type WorkspaceAppAccessOutcome,
  type WorkspaceAppAccessUnavailable,
} from "./workspace-app-access-outcome.js";

export {
  WORKSPACE_APP_ACCESS_UNAVAILABLE,
  WORKSPACE_APP_ACCESS_UNAVAILABLE_MESSAGE,
  isWorkspaceAppAccessUnavailable,
  workspaceAppAccessUnavailableBody,
  type WorkspaceAppAccessCheck,
  type WorkspaceAppAccessOutcome,
  type WorkspaceAppAccessUnavailable,
  type WorkspaceAppAccessUnavailableReason,
} from "./workspace-app-access-outcome.js";

const WORKSPACE_APPS_ACTION_PATH = "/_agent-native/actions/list-workspace-apps";
const WORKSPACE_APP_CLAIM_ACTION_PATH =
  "/_agent-native/actions/claim-workspace-app-organization";
const WORKSPACE_APP_ACCESS_TIMEOUT_MS = 10_000;

type WorkspaceAppRegistryEntry = {
  id: string;
  isDispatch?: unknown;
  orgEnabled?: unknown;
  org_enabled?: unknown;
  name?: unknown;
  description?: unknown;
  path?: unknown;
};

type WorkspaceAppRegistryResult =
  | { status: "available"; apps: WorkspaceAppRegistryEntry[] }
  | WorkspaceAppAccessUnavailable;

interface HostedWorkspaceAppAuth {
  url: URL;
  audience: string;
  headers: Record<string, string>;
  protectionHeaders: Record<string, string>;
  requestKey: string;
}

// An unavailable registry is re-asked on every request, so one failing page
// load would otherwise log the same cause dozens of times. The key is
// categorical only: `detail` is upstream text, and a per-request id in it would
// grow this set without bound.
const reportedUnavailable = new Set<string>();

function reportUnavailable(
  outcome: WorkspaceAppAccessUnavailable,
): WorkspaceAppAccessUnavailable {
  const key = [
    outcome.reason,
    outcome.upstreamStatus ?? "",
    outcome.audience ?? "",
  ].join("|");
  if (reportedUnavailable.has(key)) return outcome;
  reportedUnavailable.add(key);
  console.error("[workspace-app-access] unavailable", {
    reason: outcome.reason,
    upstreamStatus: outcome.upstreamStatus,
    audience: outcome.audience,
    detail: outcome.detail,
  });
  return outcome;
}

const inFlightWorkspaceAppRegistryReads = new Map<
  string,
  Promise<WorkspaceAppRegistryResult>
>();

export interface WorkspaceAppAccessContext {
  email: string;
  orgId?: string | null;
}

interface WorkspaceOrgMember {
  role: string;
  identityAuthority: string;
  identityId: string;
}

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function workspaceManifestDispatchState(
  appsJson: string | undefined,
): "missing" | "dispatch" | "no-dispatch" {
  const apps = workspaceAppsFromManifest(appsJson);
  if (!apps) return "missing";

  const hasDispatch = apps.some((entry) => {
    return (
      entry.id.trim().toLowerCase() === "dispatch" || entry.isDispatch === true
    );
  });
  return hasDispatch ? "dispatch" : "no-dispatch";
}

export function isStandaloneDispatchRuntime(): boolean {
  const app = getAppConfig().app;
  const isDispatch = [
    app.id,
    app.legacyId,
    app.template,
    app.slug,
    app.packageName,
  ].some((value) => value?.trim().toLowerCase() === "dispatch");
  return isDispatch && !isHostedWorkspaceRuntime();
}

function configuredWorkspaceDirectory(): string | null {
  const workspace = getAppConfig().workspace;
  const orgDirectoryUrl = workspace.orgDirectoryUrl?.trim();
  if (orgDirectoryUrl) return orgDirectoryUrl;

  if (workspaceManifestDispatchState(workspace.appsJson) === "no-dispatch") {
    return null;
  }

  const gatewayUrl = workspace.gatewayUrl?.trim();
  if (!gatewayUrl) return null;

  try {
    const url = new URL(gatewayUrl);
    if (!isLoopbackAddress(url.hostname.replace(/^\[|\]$/g, ""))) {
      return gatewayUrl;
    }
    const basePath = url.pathname.replace(/\/+$/, "");
    url.pathname = basePath.endsWith("/dispatch")
      ? basePath
      : `${basePath}/dispatch`;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return gatewayUrl;
  }
}

function workspaceAppsActionUrl(base: string): URL | null {
  try {
    const baseUrl = new URL(base);
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      return null;
    }
    const basePath = baseUrl.pathname.replace(/\/+$/, "");
    baseUrl.pathname = `${basePath}${WORKSPACE_APPS_ACTION_PATH}`;
    baseUrl.search = "";
    baseUrl.searchParams.set("includeAgentCards", "false");
    baseUrl.searchParams.set("audience", "all");
    baseUrl.hash = "";
    return baseUrl;
  } catch {
    // coercion-ok: malformed configured URL is a typed unavailable registry.
    return null;
  }
}

function workspaceAppsFromResponse(
  value: unknown,
): WorkspaceAppRegistryEntry[] | null {
  const apps = Array.isArray(value)
    ? value
    : value &&
        typeof value === "object" &&
        Array.isArray((value as { apps?: unknown }).apps)
      ? (value as { apps: unknown[] }).apps
      : null;
  if (
    !apps ||
    apps.some(
      (app) =>
        !app ||
        typeof app !== "object" ||
        typeof (app as { id?: unknown }).id !== "string",
    )
  ) {
    return null;
  }
  return apps as WorkspaceAppRegistryEntry[];
}

function workspaceAppsFromManifest(
  appsJson: string | undefined,
): WorkspaceAppRegistryEntry[] | null {
  if (appsJson === undefined) return null;
  if (!appsJson.trim()) {
    throw new Error("AGENT_NATIVE_WORKSPACE_APPS_JSON must not be empty.");
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(appsJson);
  } catch (error) {
    throw new Error(
      "AGENT_NATIVE_WORKSPACE_APPS_JSON must contain valid JSON.",
      { cause: error },
    );
  }

  const apps = workspaceAppsFromResponse(manifest);
  if (!apps || apps.length === 0 || apps.some((app) => !app.id.trim())) {
    throw new Error(
      "AGENT_NATIVE_WORKSPACE_APPS_JSON must contain apps with non-empty string ids.",
    );
  }
  return apps;
}

function workspaceAppIsDisabled(app: WorkspaceAppRegistryEntry): boolean {
  const value = app.orgEnabled ?? app.org_enabled;
  return value === false || value === 0 || value === "false" || value === "0";
}

function configuredWorkspaceApp(appId: string): {
  name: string;
  description: string | null;
  path: string;
} | null {
  const app = workspaceAppsFromManifest(
    getAppConfig().workspace.appsJson,
  )?.find((entry) => entry.id.trim() === appId);
  if (!app) return null;
  if (
    typeof app.name !== "string" ||
    !app.name.trim() ||
    typeof app.path !== "string" ||
    !app.path.startsWith("/") ||
    app.path.startsWith("//")
  ) {
    throw new Error(`Workspace app ${appId} has invalid manifest metadata.`);
  }

  const path = new URL(app.path, "https://workspace-app.invalid");
  if (
    path.origin !== "https://workspace-app.invalid" ||
    path.pathname !== app.path ||
    path.search ||
    path.hash
  ) {
    throw new Error(`Workspace app ${appId} has an invalid manifest path.`);
  }

  return {
    name: app.name.trim(),
    description: typeof app.description === "string" ? app.description : null,
    path: app.path,
  };
}

async function hostedWorkspaceAppAccess(
  appId: string,
  context: WorkspaceAppAccessContext,
  email: string,
): Promise<WorkspaceAppAccessCheck | null> {
  const configuredDirectory = configuredWorkspaceDirectory();
  if (!configuredDirectory) return null;

  const auth = await resolveHostedWorkspaceAppAuth(
    configuredDirectory,
    context,
    email,
  );
  if (isWorkspaceAppAccessUnavailable(auth)) return reportUnavailable(auth);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    WORKSPACE_APP_ACCESS_TIMEOUT_MS,
  );
  try {
    const registry = await waitForRegistryResult(
      getHostedWorkspaceAppRegistry(auth),
      controller.signal,
    );
    if (!registry) {
      return reportUnavailable(
        workspaceAppAccessUnavailable("registry-timeout", {
          audience: auth.audience,
        }),
      );
    }
    if (registry.status === "unavailable") return reportUnavailable(registry);

    const matchingApp = registry.apps.find((app) => app.id === appId);
    if (matchingApp) return !workspaceAppIsDisabled(matchingApp);

    const claimed = await claimHostedWorkspaceApp(
      auth,
      appId,
      controller.signal,
    );
    return isWorkspaceAppAccessUnavailable(claimed)
      ? reportUnavailable(claimed)
      : claimed;
  } finally {
    clearTimeout(timeout);
  }
}

async function cachedOrgDomain(orgId: string): Promise<string | null> {
  const key = `domain:${orgId}`;
  const cached = getCachedWorkspaceAccess<string | null>(key);
  if (cached !== undefined) return cached;
  const generation = workspaceAccessGenerationNow();
  const { getOrgDomain } = await import("./context.js");
  const domain = await getOrgDomain(orgId);
  rememberWorkspaceAccess(key, domain, generation);
  return domain;
}

async function resolveHostedWorkspaceAppAuth(
  configuredDirectory: string,
  context: WorkspaceAppAccessContext,
  email: string,
): Promise<HostedWorkspaceAppAuth | WorkspaceAppAccessUnavailable> {
  const url = workspaceAppsActionUrl(configuredDirectory);
  if (!url) return workspaceAppAccessUnavailable("directory-url-invalid");

  const orgId = context.orgId?.trim() || null;
  const audience = canonicalA2AAudience(configuredDirectory);
  let stage: "org-domain-lookup-failed" | "token-signing-failed" =
    "org-domain-lookup-failed";
  try {
    const orgDomain = orgId ? await cachedOrgDomain(orgId) : null;
    const normalizedOrgDomain = orgDomain?.trim() || undefined;
    if (orgId && !normalizedOrgDomain) {
      return workspaceAppAccessUnavailable("org-domain-missing", { audience });
    }
    const signingSecret = readDeployCredentialEnv("A2A_SECRET")?.trim();
    if (!signingSecret) {
      return workspaceAppAccessUnavailable("a2a-secret-missing", { audience });
    }
    stage = "token-signing-failed";
    const token = await signA2AToken(email, normalizedOrgDomain, undefined, {
      expiresIn: "1m",
      preferGlobalSecret: true,
      audience,
      extraClaims: {
        jti: randomUUID(),
      },
    });

    const protectionHeaders = resolveVercelDeploymentProtectionHeaders(
      url.toString(),
    );
    const requestKey = createHmac("sha256", signingSecret)
      .update(
        JSON.stringify([
          configuredDirectory,
          email,
          orgId,
          normalizedOrgDomain ?? null,
          getAppConfig().app.url ?? "http://localhost:3000",
          protectionHeaders,
        ]),
      )
      .digest("hex");
    return {
      url,
      audience,
      requestKey,
      protectionHeaders,
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...protectionHeaders,
      },
    };
  } catch (error) {
    console.error("[workspace-app-access] registry auth unavailable", error);
    return workspaceAppAccessUnavailable(stage, { audience });
  }
}

function waitForRegistryResult(
  request: Promise<WorkspaceAppRegistryResult>,
  signal: AbortSignal,
): Promise<WorkspaceAppRegistryResult | null> {
  if (signal.aborted) return Promise.resolve(null);
  let removeAbortListener = () => {};
  const aborted = new Promise<null>((resolve) => {
    const onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });
  return Promise.race([request, aborted]).finally(removeAbortListener);
}

function getHostedWorkspaceAppRegistry(
  auth: HostedWorkspaceAppAuth,
): Promise<WorkspaceAppRegistryResult> {
  const registryKey = `registry:${auth.requestKey}`;
  const cached =
    getCachedWorkspaceAccess<WorkspaceAppRegistryResult>(registryKey);
  if (cached) return Promise.resolve(cached);

  const pending = inFlightWorkspaceAppRegistryReads.get(auth.requestKey);
  if (pending) return pending;

  // Keyed by the HMAC over the caller, org, and directory, so one caller's
  // registry never answers another. Only a successful read is held: an
  // unavailable registry must be re-asked on the next request.
  const generation = workspaceAccessGenerationNow();
  const request = fetchHostedWorkspaceAppRegistry(auth).then((registry) => {
    if (registry.status === "available") {
      rememberWorkspaceAccess(registryKey, registry, generation);
    }
    return registry;
  });
  inFlightWorkspaceAppRegistryReads.set(auth.requestKey, request);
  const removeSettledRequest = () => {
    if (inFlightWorkspaceAppRegistryReads.get(auth.requestKey) === request) {
      inFlightWorkspaceAppRegistryReads.delete(auth.requestKey);
    }
  };
  void request.then(removeSettledRequest, removeSettledRequest);
  return request;
}

async function fetchHostedWorkspaceAppRegistry(
  auth: HostedWorkspaceAppAuth,
): Promise<WorkspaceAppRegistryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    WORKSPACE_APP_ACCESS_TIMEOUT_MS,
  );
  try {
    const response = await fetch(auth.url, {
      headers: auth.headers,
      ...(auth.protectionHeaders["x-vercel-protection-bypass"]
        ? { redirect: "manual" as const }
        : {}),
      signal: controller.signal,
    });
    if (!response.ok) {
      return workspaceAppAccessUnavailable("registry-http-error", {
        upstreamStatus: response.status,
        audience: auth.audience,
        detail: registryErrorDetail(
          // coercion-ok: an unreadable error body only drops the optional detail; the status is already on the outcome.
          await response.json().catch(() => null),
        ),
      });
    }
    const apps = workspaceAppsFromResponse(
      // coercion-ok: malformed registry JSON is an authorization failure.
      await response.json().catch(() => null),
    );
    return apps
      ? { status: "available", apps }
      : workspaceAppAccessUnavailable("registry-malformed-response", {
          upstreamStatus: response.status,
          audience: auth.audience,
        });
  } catch (error) {
    console.error("[workspace-app-access] registry access check failed", error);
    return registryFetchFailure(error, auth);
  } finally {
    clearTimeout(timeout);
  }
}

function registryFetchFailure(
  error: unknown,
  auth: HostedWorkspaceAppAuth,
): WorkspaceAppAccessUnavailable {
  const failure = describeFetchFailure(error);
  return failure.timedOut
    ? workspaceAppAccessUnavailable("registry-timeout", {
        audience: auth.audience,
      })
    : workspaceAppAccessUnavailable("registry-fetch-failed", {
        audience: auth.audience,
        detail: failure.detail,
      });
}

async function claimHostedWorkspaceApp(
  auth: HostedWorkspaceAppAuth,
  appId: string,
  signal: AbortSignal,
): Promise<WorkspaceAppAccessCheck> {
  const timedOut = () =>
    workspaceAppAccessUnavailable("registry-timeout", {
      audience: auth.audience,
    });
  if (signal.aborted) return timedOut();

  const claimUrl = new URL(auth.url);
  claimUrl.pathname = claimUrl.pathname.replace(
    WORKSPACE_APPS_ACTION_PATH,
    WORKSPACE_APP_CLAIM_ACTION_PATH,
  );
  claimUrl.search = "";
  try {
    const claimResponse = await fetch(claimUrl, {
      method: "POST",
      headers: {
        ...auth.headers,
        "content-type": "application/json",
      },
      ...(auth.protectionHeaders["x-vercel-protection-bypass"]
        ? { redirect: "manual" as const }
        : {}),
      body: JSON.stringify({ appId }),
      signal,
    });
    if (signal.aborted) return timedOut();
    if (!claimResponse.ok) {
      return workspaceAppAccessUnavailable("claim-http-error", {
        upstreamStatus: claimResponse.status,
        audience: auth.audience,
        detail: registryErrorDetail(
          // coercion-ok: an unreadable error body only drops the optional detail; the status is already on the outcome.
          await claimResponse.json().catch(() => null),
        ),
      });
    }
    const claim = (await claimResponse.json().catch(() => null)) as {
      allowed?: unknown;
    } | null;
    if (!claim || typeof claim.allowed !== "boolean") {
      return workspaceAppAccessUnavailable("claim-malformed-response", {
        upstreamStatus: claimResponse.status,
        audience: auth.audience,
      });
    }
    if (!claim.allowed) return false;
    // A cached registry predates this claim and would keep requesting one.
    invalidateMemberOrgCaches();

    const refreshedResponse = await fetch(auth.url, {
      headers: auth.headers,
      ...(auth.protectionHeaders["x-vercel-protection-bypass"]
        ? { redirect: "manual" as const }
        : {}),
      signal,
    });
    if (signal.aborted) return timedOut();
    if (!refreshedResponse.ok) {
      return workspaceAppAccessUnavailable("registry-http-error", {
        upstreamStatus: refreshedResponse.status,
        audience: auth.audience,
        detail: registryErrorDetail(
          // coercion-ok: an unreadable error body only drops the optional detail; the status is already on the outcome.
          await refreshedResponse.json().catch(() => null),
        ),
      });
    }
    const refreshedApps = workspaceAppsFromResponse(
      // coercion-ok: malformed registry JSON is an authorization failure.
      await refreshedResponse.json().catch(() => null),
    );
    if (!refreshedApps) {
      return workspaceAppAccessUnavailable("registry-malformed-response", {
        upstreamStatus: refreshedResponse.status,
        audience: auth.audience,
      });
    }
    const refreshedApp = refreshedApps.find((app) => app.id === appId);
    return refreshedApp ? !workspaceAppIsDisabled(refreshedApp) : false;
  } catch (error) {
    console.error("[workspace-app-access] registry access check failed", error);
    return registryFetchFailure(error, auth);
  }
}

async function localOrganizationAppEnabled(
  appId: string,
  orgId: string | null,
): Promise<boolean | null> {
  if (!orgId) return null;
  const key = `local-app:${appId}:${orgId}`;
  const cached = getCachedWorkspaceAccess<boolean>(key);
  if (cached !== undefined) return cached;
  const generation = workspaceAccessGenerationNow();
  try {
    const result = await getDbExec().execute({
      sql: `SELECT org_enabled FROM workspace_apps
            WHERE id = ? AND org_id = ? LIMIT 1`,
      args: [appId, orgId],
    });
    const row = Array.isArray(result?.rows)
      ? (result.rows[0] as { org_enabled?: unknown } | undefined)
      : undefined;
    if (!row) return null;
    const enabled = !(
      row.org_enabled === false ||
      row.org_enabled === 0 ||
      row.org_enabled === "false" ||
      row.org_enabled === "0"
    );
    rememberWorkspaceAccess(key, enabled, generation);
    return enabled;
  } catch (error) {
    if (!isMissingOrganizationTableError(error)) {
      console.error(
        "[workspace-app-access] local organization app state unavailable",
        error,
      );
    }
    return null;
  }
}

type WorkspaceAppRow = {
  owner_email?: unknown;
  org_id?: unknown;
  visibility?: unknown;
  org_enabled?: unknown;
};

async function cachedWorkspaceAppRow(
  db: DbExec,
  appId: string,
): Promise<WorkspaceAppRow | undefined> {
  const key = `app:${appId}`;
  const cached = getCachedWorkspaceAccess<WorkspaceAppRow>(key);
  if (cached) return cached;
  const generation = workspaceAccessGenerationNow();
  const appResult = await db.execute({
    sql: `SELECT owner_email, org_id, visibility, org_enabled
          FROM workspace_apps WHERE id = ? LIMIT 1`,
    args: [appId],
  });
  const app = appResult.rows[0] as WorkspaceAppRow | undefined;
  if (app) rememberWorkspaceAccess(key, app, generation);
  return app;
}

async function cachedWorkspaceOrgMember(
  db: DbExec,
  orgId: string,
  email: string,
): Promise<WorkspaceOrgMember | null> {
  const key = `member:${orgId}:${email}`;
  const cached = getCachedWorkspaceAccess<WorkspaceOrgMember>(key);
  if (cached) return cached;
  const generation = workspaceAccessGenerationNow();
  const member = await loadWorkspaceOrgMember(db, orgId, email);
  if (member) rememberWorkspaceAccess(key, member, generation);
  return member;
}

async function loadWorkspaceOrgMember(
  db: DbExec,
  orgId: string,
  email: string,
): Promise<WorkspaceOrgMember | null> {
  let memberResult;
  try {
    memberResult = await db.execute({
      sql: `SELECT m.role,
                   o.identity_authority AS "identityAuthority",
                   o.identity_id AS "identityId"
            FROM org_members m
            LEFT JOIN organizations o ON o.id = m.org_id
            WHERE m.org_id = ? AND LOWER(m.email) = ?
              AND m.federation_removal_pending_at IS NULL
            LIMIT 1`,
      args: [orgId, email],
    });
  } catch (error) {
    if (!isMissingOrganizationTableError(error)) throw error;
    if (!isStandaloneDispatchRuntime()) throw error;
    memberResult = await db.execute({
      sql: `SELECT role FROM org_members
            WHERE org_id = ? AND LOWER(email) = ?
              AND federation_removal_pending_at IS NULL
            LIMIT 1`,
      args: [orgId, email],
    });
  }

  const row = memberResult.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    role: String(row.role ?? ""),
    identityAuthority: String(
      row.identityAuthority ?? row.identity_authority ?? "",
    ).trim(),
    identityId: String(row.identityId ?? row.identity_id ?? "").trim(),
  };
}

async function isActiveWorkspaceOrgMember(
  member: WorkspaceOrgMember,
  orgId: string,
  email: string,
): Promise<boolean> {
  if (!member.identityAuthority && !member.identityId) return true;
  const { validateFederatedOrganizationMembershipForCurrentRequest } =
    await import("./federation.js");
  const membership =
    await validateFederatedOrganizationMembershipForCurrentRequest({
      orgId,
      email,
    });
  return membership.active;
}

async function claimWorkspaceAppOrganization(
  db: DbExec,
  appId: string,
  orgId: string,
  member: WorkspaceOrgMember,
): Promise<boolean> {
  if (member.role !== "owner" && member.role !== "admin") {
    return false;
  }
  const configuredApp = configuredWorkspaceApp(appId);
  if (configuredApp) {
    const now = Date.now();
    await db.execute({
      sql: `INSERT INTO workspace_apps
              (id, owner_email, org_id, visibility, name, description, path, created_at, updated_at)
            VALUES (?, '', NULL, 'org', ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO NOTHING`,
      args: [
        appId,
        configuredApp.name,
        configuredApp.description,
        configuredApp.path,
        now,
        now,
      ],
    });
  }
  const claim = await db.execute({
    sql: `UPDATE workspace_apps SET org_id = ?
          WHERE id = ? AND org_id IS NULL
            AND TRIM(owner_email) = '' AND visibility = 'org'
          RETURNING org_id`,
    args: [orgId, appId],
  });
  invalidateMemberOrgCaches();
  if (claim.rows.length > 0) return true;

  const current = await db.execute({
    sql: `SELECT org_id FROM workspace_apps WHERE id = ? LIMIT 1`,
    args: [appId],
  });
  return current.rows[0]?.org_id === orgId;
}

export async function claimWorkspaceAppForOrganization(
  appId: string,
  context: WorkspaceAppAccessContext,
): Promise<boolean> {
  const normalizedAppId = appId.trim();
  const email = normalizedEmail(context.email);
  const orgId = context.orgId?.trim() || null;
  if (!normalizedAppId || !email || !orgId) return false;

  try {
    const db = getDbExec();
    const member = await loadWorkspaceOrgMember(db, orgId, email);
    if (!member || !(await isActiveWorkspaceOrgMember(member, orgId, email))) {
      return false;
    }
    return claimWorkspaceAppOrganization(db, normalizedAppId, orgId, member);
  } catch (error) {
    console.error("[workspace-app-access] organization claim failed", error);
    return false;
  }
}

async function isDispatchWorkspaceAppAccessAllowed(
  context: WorkspaceAppAccessContext,
  email: string,
): Promise<boolean> {
  const orgId = context.orgId?.trim() || null;
  if (!orgId) return true;

  try {
    const member = await cachedWorkspaceOrgMember(getDbExec(), orgId, email);
    return Boolean(
      member && (await isActiveWorkspaceOrgMember(member, orgId, email)),
    );
  } catch (error) {
    if (
      isMissingOrganizationTableError(error) &&
      isStandaloneDispatchRuntime()
    ) {
      return true;
    }
    console.error("[workspace-app-access] Dispatch access check failed", error);
    return false;
  }
}

/**
 * Keeps the contract this function has always had: `true`, `false`, or the
 * `"unavailable"` sentinel. Use `checkWorkspaceAppAccess` to learn why a verdict
 * could not be reached.
 */
export async function isWorkspaceAppAccessAllowed(
  appId: string,
  context: WorkspaceAppAccessContext,
): Promise<WorkspaceAppAccessOutcome> {
  const check = await checkWorkspaceAppAccess(appId, context);
  return isWorkspaceAppAccessUnavailable(check)
    ? WORKSPACE_APP_ACCESS_UNAVAILABLE
    : check;
}

export async function checkWorkspaceAppAccess(
  appId: string,
  context: WorkspaceAppAccessContext,
): Promise<WorkspaceAppAccessCheck> {
  const normalizedAppId = appId.trim();
  const email = normalizedEmail(context.email);
  if (!normalizedAppId || !email) {
    return true;
  }
  if (normalizedAppId.toLowerCase() === "dispatch") {
    return isDispatchWorkspaceAppAccessAllowed(context, email);
  }

  if (configuredWorkspaceDirectory()) {
    const locallyEnabled = await localOrganizationAppEnabled(
      normalizedAppId,
      context.orgId?.trim() || null,
    );
    if (locallyEnabled === false) return false;
  }

  const hostedAccess = await hostedWorkspaceAppAccess(
    normalizedAppId,
    context,
    email,
  );
  if (hostedAccess !== null) return hostedAccess;

  try {
    const db = getDbExec();
    const app = await cachedWorkspaceAppRow(db, normalizedAppId);
    if (!app) {
      const orgId = context.orgId?.trim() || null;
      if (!orgId) return false;
      const member = await loadWorkspaceOrgMember(db, orgId, email);
      if (
        !member ||
        !(await isActiveWorkspaceOrgMember(member, orgId, email))
      ) {
        return false;
      }
      return claimWorkspaceAppOrganization(db, normalizedAppId, orgId, member);
    }

    const ownerEmail = normalizedEmail(
      typeof app.owner_email === "string" ? app.owner_email : "",
    );
    const resourceOrgId =
      (typeof app.org_id === "string" ? app.org_id : "").trim() || null;
    const orgId = context.orgId?.trim() || null;
    const sameOrg = !!resourceOrgId && resourceOrgId === orgId;
    const orgEnabled =
      app.org_enabled !== false &&
      app.org_enabled !== 0 &&
      app.org_enabled !== "false" &&
      app.org_enabled !== "0";
    const canClaimCallerOrg =
      !resourceOrgId && !ownerEmail && app.visibility === "org" && !!orgId;

    if (sameOrg && !orgEnabled) return false;
    if (ownerEmail === email && (!resourceOrgId || sameOrg)) return true;
    if ((!sameOrg && !canClaimCallerOrg) || !orgId) return false;

    const member = await cachedWorkspaceOrgMember(db, orgId, email);
    if (!member || !(await isActiveWorkspaceOrgMember(member, orgId, email))) {
      return false;
    }
    const memberRole = member.role;
    if (canClaimCallerOrg) {
      if (
        !(await claimWorkspaceAppOrganization(
          db,
          normalizedAppId,
          orgId,
          member,
        ))
      ) {
        return false;
      }
    }
    if (memberRole === "owner" || memberRole === "admin") return true;

    if (app.visibility === "org") return true;
    if (app.visibility !== "private") return false;

    const userShare = await db.execute({
      sql: `SELECT 1 FROM workspace_app_shares
            WHERE resource_id = ? AND principal_type = 'user'
              AND LOWER(principal_id) = ? LIMIT 1`,
      args: [normalizedAppId, email],
    });
    if (userShare.rows.length > 0) return true;

    const orgShare = await db.execute({
      sql: `SELECT 1 FROM workspace_app_shares
            WHERE resource_id = ? AND principal_type = 'org'
              AND principal_id = ? LIMIT 1`,
      args: [normalizedAppId, orgId],
    });
    if (orgShare.rows.length > 0) return true;

    const groupShares = await db.execute({
      sql: `SELECT principal_id FROM workspace_app_shares
            WHERE resource_id = ? AND principal_type = 'group'`,
      args: [normalizedAppId],
    });
    const groupIds = groupShares.rows
      .map((row) =>
        typeof row.principal_id === "string" ? row.principal_id : "",
      )
      .filter(Boolean);
    return workspaceUserGroupsIncludeUser(resourceOrgId, groupIds, email);
  } catch (error) {
    console.error("[workspace-app-access] access check failed", error);
    return false;
  }
}
