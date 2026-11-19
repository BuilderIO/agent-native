/**
 * User-only Slack installs (internal workspaces only).
 *
 * A user-only install requests Slack *user* scopes (`user_scope` with no bot
 * `scope`) and stores the resulting `authed_user` token as a personal
 * grant. The bot installation path in `slack-oauth.ts` keeps its existing
 * behavior and requirements; this module never reads or stores a bot token.
 *
 * Access is fail-closed: a workspace is eligible only when its team id is
 * listed in the `integrations.slackInternalTeamIds` app-config field (env
 * alias `SLACK_INTERNAL_TEAM_IDS`). An empty or malformed allow-list refuses
 * every user-only install.
 */

import { createHash } from "node:crypto";

import { getAppConfig } from "../app-config/index.js";
import type { SlackOAuthAccessResponse } from "./slack-oauth.js";
import {
  mapSlackUserOAuthResponse,
  type SlackUserTokenBundle,
} from "./slack-user-oauth.js";
import {
  beginUserIntegrationGrant,
  completeUserIntegrationGrant,
  getUserIntegrationGrant,
  revokeUserIntegrationGrant,
  type UserIntegrationGrant,
} from "./user-grants-store.js";

/** OAuth state marker for a user-only install request. */
export const SLACK_USER_INSTALL_APP = "agent-native:slack:user";

export interface SlackUserInstallGate {
  allowlist: string[];
  bootstrap: boolean;
}

export interface SlackUserInstallGateConfig {
  slackInternalTeamIds?: readonly string[] | undefined;
  slackUserInstallBootstrap?: boolean | undefined;
}

/**
 * Resolve the install gate from app config (`integrations.slackInternalTeamIds`
 * and `integrations.slackUserInstallBootstrap`). Fail-closed by default: the
 * bootstrap switch applies only while the allow-list is empty, so pinning a
 * workspace id always wins.
 */
export function resolveSlackUserInstallGate(
  config: SlackUserInstallGateConfig = getAppConfig().integrations,
): SlackUserInstallGate {
  const allowlist = parseSlackInternalTeamIds(config.slackInternalTeamIds);
  const bootstrap =
    allowlist.length === 0 && config.slackUserInstallBootstrap === true;
  return { allowlist, bootstrap };
}

const TEAM_ID = /^[A-Z][A-Z0-9]{4,31}$/;
const OPERATION_ID = /^[A-Za-z0-9_-]{8,128}$/;

const USER_INSTALL_UNAVAILABLE = "Slack user authorization is unavailable.";

/**
 * Parse the internal workspace allow-list. Anything malformed is dropped
 * rather than widened, so a typo cannot admit an unintended workspace.
 */
export function parseSlackInternalTeamIds(
  raw: readonly string[] | string | undefined | null,
): string[] {
  const parts =
    typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : [];
  const ids = new Set<string>();
  for (const part of parts) {
    const candidate = typeof part === "string" ? part.trim() : "";
    if (!TEAM_ID.test(candidate)) continue;
    ids.add(candidate);
  }
  return [...ids].sort();
}

/** Throw unless the workspace may run a user-only install. */
export function assertSlackUserInstallAllowed(
  teamId: string | null | undefined,
  allowlist: readonly string[],
): void {
  if (typeof teamId !== "string" || !TEAM_ID.test(teamId)) {
    throw new Error(USER_INSTALL_UNAVAILABLE);
  }
  if (!allowlist.includes(teamId)) {
    throw new Error(USER_INSTALL_UNAVAILABLE);
  }
}

export interface SlackUserInstallResult {
  grantId: string;
  teamId: string;
  externalUserId: string;
  scopes: string[];
}

/**
 * Persist a user-only OAuth response as a personal grant.
 *
 * Only the `authed_user` bundle is stored. The token is written to the
 * encrypted vault by the grant store and is never returned to a caller, a
 * log line or a response body.
 */
export async function installSlackUserGrant(options: {
  response: SlackOAuthAccessResponse;
  allowlist: readonly string[];
  operationId: string;
  now?: number;
  /** Allow the first install while the allow-list is still empty. */
  bootstrap?: boolean;
}): Promise<SlackUserInstallResult> {
  const now = options.now ?? Date.now();
  if (!OPERATION_ID.test(options.operationId)) {
    throw new Error(USER_INSTALL_UNAVAILABLE);
  }
  const identity = mapSlackUserOAuthResponse(options.response, now);
  if (!(options.bootstrap === true && options.allowlist.length === 0)) {
    assertSlackUserInstallAllowed(identity.teamId, options.allowlist);
  }
  const bundle: SlackUserTokenBundle = identity.bundle;
  const attempt = await beginUserIntegrationGrant({
    provider: "slack",
    teamId: identity.teamId,
    apiAppId: identity.apiAppId,
    externalUserId: identity.externalUserId,
    operationId: options.operationId,
  });
  const grant = await completeUserIntegrationGrant(attempt, bundle);
  const readback = await getUserIntegrationGrant(grant.id);
  if (
    !readback ||
    readback.id !== grant.id ||
    readback.status !== "connected" ||
    readback.teamId !== identity.teamId ||
    readback.externalUserId !== identity.externalUserId
  ) {
    try {
      await revokeUserIntegrationGrant(grant.id);
    } catch {
      // coercion-ok: the install still fails loudly with the throw below.
    }
    throw new Error(USER_INSTALL_UNAVAILABLE);
  }
  return {
    grantId: readback.id,
    teamId: readback.teamId,
    externalUserId: readback.externalUserId,
    scopes: readback.scopes,
  };
}

/**
 * Deterministic operation id so a retried callback reuses one grant attempt
 * instead of starting a second generation. The seed is hashed because it
 * contains the one-time OAuth code.
 */
export function slackUserInstallOperationId(seed: string): string {
  return createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32);
}

/** Public shape returned to a response body: no token, no vault key. */
export function slackUserInstallSummary(
  grant: Pick<UserIntegrationGrant, "id" | "teamId" | "scopes">,
): { grantId: string; teamId: string; scopes: string[] } {
  return {
    grantId: grant.id,
    teamId: grant.teamId,
    scopes: [...grant.scopes],
  };
}
