/**
 * Workbench → GitHub helper.
 *
 * Workbench reads PRs, CI, and issues through the framework's **shared
 * workspace GitHub integration** — NOT a Workbench-owned OAuth flow. Users
 * connect GitHub once in Dispatch and grant it to Workbench (and Brain,
 * Analytics, etc.). This module is the single entry point every Workbench
 * room uses to get an authenticated Octokit instance.
 *
 * Consumers across rooms (Queue, PR Room, Run Room) should import from here
 * and never reach into `@agent-native/core/workspace-connections` directly.
 *
 * ## Auth model
 *
 * - Provider: `github` (see `@agent-native/core/connections` catalog).
 * - App id: `workbench`.
 * - Credential key: `GITHUB_TOKEN` (the catalog-declared required key).
 * - Per-user/org scoped — every call uses the (`userEmail`, `orgId`) passed
 *   in. Never bypass this scoping; we share a prod DB across deploys.
 *
 * ## Handling `null` from `getGitHubConnection`
 *
 * `null` means one of: no connection exists in the workspace yet, an
 * existing connection has not been granted to Workbench yet, the granted
 * connection is unhealthy (needs reauth / error / disabled), or no
 * `GITHUB_TOKEN` credential ref is reachable for the current user/org.
 *
 * Treat `null` as a soft failure: the right response in an action / room
 * is to tell the user to connect GitHub via Dispatch (or grant Workbench
 * access to an existing connection). Do NOT throw — surface the
 * "not connected" state and let the UI render the connect CTA. The
 * Settings page (`/settings`) shows the live status; deep-link there via
 * `getGitHubConnectionStatus(...).connectUrl`.
 */

import { Octokit } from "@octokit/rest";
import {
  listWorkspaceConnectionsForApp,
  resolveWorkspaceConnectionCredentialForApp,
  type WorkspaceConnectionForApp,
} from "@agent-native/core/workspace-connections";
import { runWithRequestContext } from "@agent-native/core/server";
import { getDispatchIntegrationsUrl } from "./dispatch-url.js";

const APP_ID = "workbench";
const PROVIDER_ID = "github";
const CREDENTIAL_KEY = "GITHUB_TOKEN";

/** User-agent header sent on Octokit requests so GitHub can attribute traffic. */
const OCTOKIT_USER_AGENT = "agent-native-workbench";

/**
 * Wraps the given async function in a request context for the supplied
 * (userEmail, orgId). The workspace-connection helpers in core read
 * AsyncLocalStorage to scope every DB query — when this helper is invoked
 * from a place that doesn't already have one (a background job, a script,
 * a custom Nitro route), we must establish it ourselves.
 *
 * Actions auto-mounted at `/_agent-native/actions/...` already have a
 * request context set up by the framework, but running this through
 * `runWithRequestContext` again is safe (it overlays the values).
 */
async function withScope<T>(
  userEmail: string,
  orgId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const normalizedEmail = userEmail.trim().toLowerCase();
  const normalizedOrgId = orgId.trim();
  if (!normalizedEmail) {
    throw new Error(
      "Workbench GitHub helper requires a non-empty userEmail to scope the request.",
    );
  }
  // `runWithRequestContext` returns `T | Promise<T>` so callers must await
  // through it to satisfy `Promise<T>`. `fn` is itself async, so we always
  // get a Promise back.
  return await runWithRequestContext(
    {
      userEmail: normalizedEmail,
      orgId: normalizedOrgId || undefined,
    },
    fn,
  );
}

/**
 * Returns an authenticated Octokit instance for the current user via the
 * shared workspace GitHub integration. Returns `null` when no GitHub
 * connection is granted to Workbench (or the granted connection cannot
 * yield a usable token).
 *
 * Consumers should treat `null` as "ask the user to connect GitHub via
 * Dispatch" — see the module doc for details. Use
 * `getGitHubConnectionStatus()` to render the connect CTA, or
 * `isGitHubConnected()` for a cheap boolean check.
 *
 * @example
 * ```ts
 * const octokit = await getGitHubConnection(userEmail, orgId);
 * if (!octokit) {
 *   // Surface a friendly "connect GitHub in Dispatch" state to the user.
 *   return { connected: false };
 * }
 * const { data } = await octokit.pulls.list({ owner, repo, state: "open" });
 * ```
 */
export async function getGitHubConnection(
  userEmail: string,
  orgId: string,
): Promise<Octokit | null> {
  return withScope(userEmail, orgId, async () => {
    const resolution = await resolveWorkspaceConnectionCredentialForApp({
      appId: APP_ID,
      provider: PROVIDER_ID,
      key: CREDENTIAL_KEY,
      userEmail,
      orgId,
    });
    if (!resolution.value) return null;
    return new Octokit({
      auth: resolution.value,
      userAgent: OCTOKIT_USER_AGENT,
    });
  });
}

/**
 * Lightweight readiness check used by onboarding step completion and any
 * room that wants to ask "is GitHub usable for me right now?" without
 * actually constructing an Octokit instance.
 */
export async function isGitHubConnected(
  userEmail: string,
  orgId: string,
): Promise<boolean> {
  return withScope(userEmail, orgId, async () => {
    const resolution = await resolveWorkspaceConnectionCredentialForApp({
      appId: APP_ID,
      provider: PROVIDER_ID,
      key: CREDENTIAL_KEY,
      userEmail,
      orgId,
    });
    return resolution.available;
  });
}

/**
 * Shape returned by {@link getGitHubConnectionStatus}. Designed to be the
 * exact thing a Settings page or onboarding panel needs to render.
 */
export interface GitHubConnectionStatus {
  /** True when a connection is granted to Workbench AND healthy. */
  connected: boolean;
  /**
   * Human-readable label of the granted connection ("acme-org" / "@stevee"
   * / etc.). Omitted when no connection is granted to Workbench.
   */
  accountLabel?: string;
  /**
   * OAuth-style scopes the granted connection advertises. Empty array
   * when the connection doesn't track scopes; absent when no connection
   * is granted to Workbench.
   */
  scopes?: string[];
  /**
   * If the connection exists but is in an error / needs-reauth state,
   * a short human-readable reason. Otherwise omitted.
   */
  lastError?: string;
  /**
   * Deep link the UI should send the user to when they click "Connect"
   * or "Repair". This is the Dispatch integrations page filtered to
   * GitHub for `appId=workbench`. Always present so the UI can render
   * the CTA even when no connection exists yet.
   */
  connectUrl: string;
}

/**
 * Returns connection status for the Settings page UI.
 *
 * The returned `connectUrl` always points at Dispatch's integrations page
 * filtered to GitHub for `appId=workbench`. Use it for both the "Connect"
 * CTA (when `connected` is false) and a "Manage" link (when true).
 */
export async function getGitHubConnectionStatus(
  userEmail: string,
  orgId: string,
): Promise<GitHubConnectionStatus> {
  const connectUrl = buildDispatchConnectUrl();
  return withScope(userEmail, orgId, async () => {
    let connections: WorkspaceConnectionForApp[] = [];
    try {
      connections = await listWorkspaceConnectionsForApp({
        appId: APP_ID,
        provider: PROVIDER_ID,
        includeDisabled: true,
      });
    } catch {
      // Workspace-connection tables may not be initialized in some test
      // environments. Treat that as "no connection yet" rather than a
      // hard error, so Settings can still render the connect CTA.
      return { connected: false, connectUrl };
    }

    if (connections.length === 0) {
      return { connected: false, connectUrl };
    }

    // Prefer the first healthy connection if any; otherwise surface the
    // most-recent one with its error so the UI can prompt a repair.
    const healthy = connections.find(
      (connection) => connection.status === "connected",
    );
    const chosen = healthy ?? connections[0];

    // Verify the credential is actually reachable in this scope. A
    // connection row can exist + appear granted but its credential ref
    // can be unreachable (different scope, missing vault entry).
    const credential = healthy
      ? await resolveWorkspaceConnectionCredentialForApp({
          appId: APP_ID,
          provider: PROVIDER_ID,
          key: CREDENTIAL_KEY,
          connectionId: healthy.id,
          userEmail,
          orgId,
        })
      : null;

    const connected = Boolean(healthy) && Boolean(credential?.available);

    const accountLabel =
      chosen.accountLabel?.trim() ||
      chosen.label?.trim() ||
      chosen.accountId?.trim() ||
      undefined;

    const lastError = connected
      ? undefined
      : chosen.lastError?.trim() ||
        (chosen.status !== "connected"
          ? humanStatus(chosen.status)
          : credential && !credential.available
            ? credential.reason
            : undefined);

    return {
      connected,
      accountLabel,
      scopes: chosen.scopes ?? [],
      lastError,
      connectUrl,
    };
  });
}

/**
 * Builds the deep link the Settings page (and any "Connect GitHub" CTA
 * inside Workbench) should navigate the user to. Delegates to the shared
 * `getDispatchIntegrationsUrl` helper so dev/workspace/prod environments
 * all resolve to the right Dispatch origin instead of a relative path
 * that 404s in standalone dev.
 */
function buildDispatchConnectUrl(): string {
  return getDispatchIntegrationsUrl({
    provider: PROVIDER_ID,
    appId: APP_ID,
  });
}

function humanStatus(status: WorkspaceConnectionForApp["status"]): string {
  switch (status) {
    case "needs_reauth":
      return "GitHub connection needs to be reauthorized.";
    case "checking":
      return "GitHub connection health check is still in progress.";
    case "error":
      return "GitHub connection is in an error state.";
    case "disabled":
      return "GitHub connection is disabled.";
    case "connected":
    default:
      return "GitHub connection is connected.";
  }
}
