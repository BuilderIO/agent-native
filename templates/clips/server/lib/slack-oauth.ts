import { randomUUID } from "node:crypto";

import { writeAppState } from "@agent-native/core/application-state";
import {
  deleteAppSecret,
  readAppSecret,
  writeAppSecret,
  type SecretScope,
} from "@agent-native/core/secrets";
import {
  encodeOAuthState,
  getSession,
  isElectron,
  oauthCallbackResponse,
  oauthErrorPage,
  resolveOAuthRedirectUri,
  safeReturnPath,
  type OAuthStatePayload,
} from "@agent-native/core/server";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { and, desc, eq, or } from "drizzle-orm";
import { getQuery, type H3Event } from "h3";

import { getDb, schema } from "../db/index.js";
import {
  getActiveOrganizationId,
  getOrganizationRoleForEmail,
  sameOwnerEmail,
} from "./recordings.js";
import type { SlackLinkSharedPayload } from "./slack-unfurls.js";

export const CLIPS_SLACK_OAUTH_APP_ID = `${
  process.env.APP_NAME || "clips"
}:slack`;
export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
export const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";
export const SLACK_UNFURL_SCOPES = [
  "links:read",
  "links:write",
  "links.embed:write",
] as const;

type SlackOAuthAccessResponse = {
  ok?: boolean;
  error?: string;
  access_token?: string;
  scope?: string;
  bot_user_id?: string;
  app_id?: string;
  authed_user?: { id?: string };
  team?: { id?: string; name?: string };
  enterprise?: { id?: string; name?: string };
};

export type SlackInstallationListItem = {
  id: string;
  teamId: string;
  teamName: string | null;
  enterpriseId: string | null;
  enterpriseName: string | null;
  apiAppId: string | null;
  botUserId: string | null;
  scope: string | null;
  ownerEmail: string;
  orgId: string | null;
  status: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export function isSlackConnectState(state: OAuthStatePayload): boolean {
  return state.app === CLIPS_SLACK_OAUTH_APP_ID && state.addAccount === true;
}

export function slackInstallationBotTokenKey(
  teamId: string,
  apiAppId?: string | null,
): string {
  return `clips-slack:${apiAppId || "default"}:${teamId}:bot-token`;
}

export function buildSlackAuthorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: "code",
    scope: (options.scopes ?? SLACK_UNFURL_SCOPES).join(","),
    state: options.state,
  });
  return `${SLACK_AUTHORIZE_URL}?${params.toString()}`;
}

export async function buildSlackOAuthInstallUrl(
  event: H3Event,
): Promise<string | Response | Record<string, string>> {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return oauthErrorPage(
      "Slack OAuth is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET, then try again.",
    );
  }

  const redirectUri = resolveOAuthRedirectUri(
    event,
    "/api/slack/oauth/callback",
  );
  if (!redirectUri) {
    return oauthErrorPage("Slack OAuth redirect URL is not allowed.");
  }

  const session = await getSession(event);
  const owner = session?.email;
  if (!owner) {
    return oauthErrorPage("Sign in to Clips before connecting Slack.");
  }

  const query = getQuery(event);
  const desktop =
    isElectron(event) || query.desktop === "1" || query.desktop === "true";
  const requestedReturn =
    typeof query.return === "string"
      ? safeReturnPath(query.return)
      : "/settings";
  const returnUrl = requestedReturn !== "/" ? requestedReturn : "/settings";
  const state = encodeOAuthState({
    redirectUri,
    owner,
    desktop,
    addAccount: true,
    app: CLIPS_SLACK_OAUTH_APP_ID,
    returnUrl,
  });

  return buildSlackAuthorizeUrl({ clientId, redirectUri, state });
}

export async function exchangeSlackOAuthCode(options: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<SlackOAuthAccessResponse> {
  const {
    code,
    clientId,
    clientSecret,
    redirectUri,
    fetchImpl = fetch,
  } = options;
  const res = await fetchImpl(SLACK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });
  const data = (await res
    .json()
    .catch(() => null)) as SlackOAuthAccessResponse | null;
  if (!res.ok || !data?.ok) {
    throw new Error(
      data?.error || `Slack OAuth exchange failed (${res.status})`,
    );
  }
  return data;
}

function asSecretScope(value: string): SecretScope | null {
  return value === "user" || value === "org" || value === "workspace"
    ? value
    : null;
}

async function resolveSlackSecretTarget(
  userEmail: string,
  event: H3Event,
): Promise<{ scope: SecretScope; scopeId: string; orgId: string | null }> {
  const orgId = await getActiveOrganizationId(event).catch(() => null);
  if (!orgId) return { scope: "user", scopeId: userEmail, orgId: null };

  const role = await getOrganizationRoleForEmail(orgId, userEmail);
  if (role !== "admin" && role !== "owner") {
    throw new Error(
      "Only organization admins can connect Agent-Native Clips for Slack.",
    );
  }

  return { scope: "org", scopeId: orgId, orgId };
}

async function upsertSlackInstallation(options: {
  teamId: string;
  teamName?: string | null;
  enterpriseId?: string | null;
  enterpriseName?: string | null;
  apiAppId?: string | null;
  botUserId?: string | null;
  botTokenSecretRef: string;
  secretScope: SecretScope;
  secretScopeId: string;
  scope?: string | null;
  installedBySlackUserId?: string | null;
  ownerEmail: string;
  orgId?: string | null;
}): Promise<SlackInstallationListItem> {
  const db = getDb();
  const now = new Date().toISOString();
  const byTeam = [eq(schema.slackInstallations.teamId, options.teamId)];
  if (options.apiAppId) {
    byTeam.push(eq(schema.slackInstallations.apiAppId, options.apiAppId));
  }

  const [existing] = await db
    .select({ id: schema.slackInstallations.id })
    .from(schema.slackInstallations)
    .where(and(...byTeam))
    .orderBy(desc(schema.slackInstallations.updatedAt))
    .limit(1);

  const values = {
    teamId: options.teamId,
    teamName: options.teamName ?? null,
    enterpriseId: options.enterpriseId ?? null,
    enterpriseName: options.enterpriseName ?? null,
    apiAppId: options.apiAppId ?? null,
    botUserId: options.botUserId ?? null,
    botTokenSecretRef: options.botTokenSecretRef,
    secretScope: options.secretScope,
    secretScopeId: options.secretScopeId,
    scope: options.scope ?? null,
    installedBySlackUserId: options.installedBySlackUserId ?? null,
    ownerEmail: options.ownerEmail,
    orgId: options.orgId ?? null,
    status: "connected" as const,
    lastError: null,
    updatedAt: now,
  };

  if (existing) {
    await db
      .update(schema.slackInstallations)
      .set(values)
      .where(eq(schema.slackInstallations.id, existing.id));
    return (await getSlackInstallation(existing.id))!;
  }

  const id = randomUUID();
  await db.insert(schema.slackInstallations).values({
    id,
    ...values,
    createdAt: now,
  });
  return (await getSlackInstallation(id))!;
}

export async function handleSlackOAuthCallback(
  event: H3Event,
  state: OAuthStatePayload,
) {
  const query = getQuery(event);
  const slackError = query.error as string | undefined;
  if (slackError) {
    return oauthErrorPage(`Slack connection failed: ${slackError}`);
  }

  if (!isSlackConnectState(state) || !state.owner) {
    return oauthErrorPage(
      "Start Slack installation from Clips Settings so this workspace can be connected to your account.",
    );
  }

  const code = query.code as string | undefined;
  if (!code) {
    return oauthErrorPage("Missing authorization code from Slack.");
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return oauthErrorPage(
      "Slack OAuth is not configured (missing client id/secret).",
    );
  }

  const session = await getSession(event);
  const userEmail = session?.email ?? state.owner;
  if (!userEmail) {
    return oauthErrorPage(
      "Your session expired during the Slack install flow. Sign in again and retry.",
    );
  }

  try {
    return await runWithRequestContext({ userEmail }, async () => {
      const tokens = await exchangeSlackOAuthCode({
        code,
        clientId,
        clientSecret,
        redirectUri: state.redirectUri,
      });
      const teamId = tokens.team?.id;
      const accessToken = tokens.access_token;
      if (!teamId || !accessToken) {
        return oauthErrorPage(
          "Slack did not return the team id and bot token needed for unfurls.",
        );
      }

      const target = await resolveSlackSecretTarget(userEmail, event);
      const botTokenKey = slackInstallationBotTokenKey(teamId, tokens.app_id);
      const teamName = tokens.team?.name ?? teamId;
      await writeAppSecret({
        key: botTokenKey,
        value: accessToken,
        scope: target.scope,
        scopeId: target.scopeId,
        description: `Slack bot token for ${teamName}`,
      });

      const installation = await upsertSlackInstallation({
        teamId,
        teamName: tokens.team?.name ?? null,
        enterpriseId: tokens.enterprise?.id ?? null,
        enterpriseName: tokens.enterprise?.name ?? null,
        apiAppId: tokens.app_id ?? null,
        botUserId: tokens.bot_user_id ?? null,
        botTokenSecretRef: botTokenKey,
        secretScope: target.scope,
        secretScopeId: target.scopeId,
        scope: tokens.scope ?? null,
        installedBySlackUserId: tokens.authed_user?.id ?? null,
        ownerEmail: userEmail,
        orgId: target.orgId,
      });

      await writeAppState("refresh-signal", { ts: Date.now() });
      return oauthCallbackResponse(event, installation.teamName || teamId, {
        desktop: state.desktop,
        addAccount: true,
        returnUrl: state.returnUrl,
        appName: "Clips",
      });
    });
  } catch (err) {
    return oauthErrorPage(
      `Slack connection failed: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
  }
}

export async function getSlackInstallation(
  id: string,
): Promise<SlackInstallationListItem | null> {
  const [row] = await getDb()
    .select({
      id: schema.slackInstallations.id,
      teamId: schema.slackInstallations.teamId,
      teamName: schema.slackInstallations.teamName,
      enterpriseId: schema.slackInstallations.enterpriseId,
      enterpriseName: schema.slackInstallations.enterpriseName,
      apiAppId: schema.slackInstallations.apiAppId,
      botUserId: schema.slackInstallations.botUserId,
      scope: schema.slackInstallations.scope,
      ownerEmail: schema.slackInstallations.ownerEmail,
      orgId: schema.slackInstallations.orgId,
      status: schema.slackInstallations.status,
      lastError: schema.slackInstallations.lastError,
      createdAt: schema.slackInstallations.createdAt,
      updatedAt: schema.slackInstallations.updatedAt,
    })
    .from(schema.slackInstallations)
    .where(eq(schema.slackInstallations.id, id))
    .limit(1);
  return row ?? null;
}

export async function listVisibleSlackInstallations(options: {
  userEmail: string;
  orgId?: string | null;
}): Promise<SlackInstallationListItem[]> {
  const scopeWhere = options.orgId
    ? or(
        eq(schema.slackInstallations.orgId, options.orgId),
        eq(schema.slackInstallations.ownerEmail, options.userEmail),
      )
    : eq(schema.slackInstallations.ownerEmail, options.userEmail);

  return getDb()
    .select({
      id: schema.slackInstallations.id,
      teamId: schema.slackInstallations.teamId,
      teamName: schema.slackInstallations.teamName,
      enterpriseId: schema.slackInstallations.enterpriseId,
      enterpriseName: schema.slackInstallations.enterpriseName,
      apiAppId: schema.slackInstallations.apiAppId,
      botUserId: schema.slackInstallations.botUserId,
      scope: schema.slackInstallations.scope,
      ownerEmail: schema.slackInstallations.ownerEmail,
      orgId: schema.slackInstallations.orgId,
      status: schema.slackInstallations.status,
      lastError: schema.slackInstallations.lastError,
      createdAt: schema.slackInstallations.createdAt,
      updatedAt: schema.slackInstallations.updatedAt,
    })
    .from(schema.slackInstallations)
    .where(
      and(
        scopeWhere,
        or(
          eq(schema.slackInstallations.status, "connected"),
          eq(schema.slackInstallations.status, "error"),
        ),
      ),
    )
    .orderBy(desc(schema.slackInstallations.updatedAt));
}

export async function readSlackBotTokenForPayload(
  payload: SlackLinkSharedPayload,
): Promise<string | null> {
  const teamId = payload.team_id;
  if (!teamId) return null;

  // guard:allow-unscoped — signed Slack webhook resolves the installation by
  // provider team/app id before reading the encrypted app_secrets token ref.
  const rows = await getDb()
    .select({
      id: schema.slackInstallations.id,
      teamId: schema.slackInstallations.teamId,
      apiAppId: schema.slackInstallations.apiAppId,
      botTokenSecretRef: schema.slackInstallations.botTokenSecretRef,
      secretScope: schema.slackInstallations.secretScope,
      secretScopeId: schema.slackInstallations.secretScopeId,
      updatedAt: schema.slackInstallations.updatedAt,
    })
    .from(schema.slackInstallations)
    .where(
      and(
        eq(schema.slackInstallations.teamId, teamId),
        eq(schema.slackInstallations.status, "connected"),
      ),
    )
    .orderBy(desc(schema.slackInstallations.updatedAt));

  const row =
    (payload.api_app_id
      ? rows.find(
          (candidate) =>
            !candidate.apiAppId || candidate.apiAppId === payload.api_app_id,
        )
      : rows[0]) ?? null;
  if (!row) return null;

  const scope = asSecretScope(row.secretScope);
  if (!scope || !row.secretScopeId) return null;
  const secret = await readAppSecret({
    key: row.botTokenSecretRef,
    scope,
    scopeId: row.secretScopeId,
  });
  return secret?.value ?? null;
}

export async function disconnectSlackInstallation(options: {
  id: string;
  userEmail: string;
  orgId?: string | null;
}): Promise<SlackInstallationListItem | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.slackInstallations)
    .where(eq(schema.slackInstallations.id, options.id))
    .limit(1);
  if (!row) return null;

  const canDisconnectOwn = sameOwnerEmail(row.ownerEmail, options.userEmail);
  let canDisconnectOrg = false;
  if (row.orgId) {
    const role = await getOrganizationRoleForEmail(
      row.orgId,
      options.userEmail,
    );
    canDisconnectOrg = role === "admin" || role === "owner";
  }
  if (!canDisconnectOwn && !canDisconnectOrg) {
    throw new Error(
      "You do not have access to disconnect this Slack workspace.",
    );
  }

  const scope = asSecretScope(row.secretScope);
  if (scope && row.secretScopeId) {
    await deleteAppSecret({
      key: row.botTokenSecretRef,
      scope,
      scopeId: row.secretScopeId,
    }).catch(() => {});
  }

  await db
    .update(schema.slackInstallations)
    .set({
      status: "disconnected",
      lastError: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.slackInstallations.id, row.id));
  await writeAppState("refresh-signal", { ts: Date.now() });
  return getSlackInstallation(row.id);
}
