import { createHash, randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/pglite";
import { mockEvent, type H3Event } from "h3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The browser sign-in is not under test: the OAuth consent and the org admin
// screens need *a* signed-in user, so the session resolves to whichever
// synthetic account the step acts as. Everything after the session — org
// storage, invitation, OAuth issuance, token verification, member removal —
// runs the real code against an in-memory PGlite database.
const signedIn = vi.hoisted(() => ({ email: null as string | null }));
vi.mock("../server/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/auth.js")>()),
  getSession: async () => (signedIn.email ? { email: signedIn.email } : null),
}));
// Local only: no invitation email and no analytics delivery.
vi.mock("../server/email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/email.js")>()),
  isEmailConfigured: async () => false,
  sendEmail: async () => {
    throw new Error("outbound email is disabled in this spec");
  },
}));
vi.mock("../tracking/registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tracking/registry.js")>()),
  track: () => undefined,
  flushTracking: async () => [],
}));
// The real membership lookup, with a switch to make it fail like a dropped
// database connection.
const membershipLookup = vi.hoisted(() => ({ fail: false }));
vi.mock("../org/membership.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../org/membership.js")>();
  return {
    ...actual,
    isOrgMember: async (...args: Parameters<typeof actual.isOrgMember>) => {
      if (membershipLookup.fail) {
        throw new Error("synthetic: the database connection was lost");
      }
      return actual.isOrgMember(...args);
    },
  };
});

import { signA2AToken } from "../a2a/client.js";
import { closeDbExec, getDbExec, getPgliteClient } from "../db/client.js";
import { withMigrationRuntime } from "../db/migration-runtime.js";
import { table, text, ownableColumns } from "../db/schema.js";
import { createOrganization, listOrgMemberships } from "../org/context.js";
import {
  acceptInvitationHandler,
  createInvitationHandler,
  removeMemberHandler,
} from "../org/handlers.js";
import { runFrameworkReleaseMigrations } from "../server/release-migrations.js";
import { runWithRequestContext } from "../server/request-context.js";
import { accessFilter } from "../sharing/access.js";
import { createSharesTable } from "../sharing/schema.js";
import { resolveMcpIdentityOrgId, verifyAuth } from "./build-server.js";
import { mintOrgServiceToken } from "./connect-route.js";
import {
  approveDeviceCode,
  createDeviceCode,
  getDeviceCode,
  recordMintedToken,
} from "./connect-store.js";
import {
  getMcpOAuthAudiences,
  getMcpOAuthResource,
  handleMcpOAuth,
} from "./oauth-route.js";
import { createOAuthCode, createOAuthRefreshToken } from "./oauth-store.js";
import { signMcpOAuthAccessToken } from "./oauth-token.js";

const ORIGIN = "https://app.example.test";
const ALICE = "alice@example.test";
const BOB = "bob@example.test";
const CAROL = "carol@example.test";
const DAVE = "dave@example.test";
const ORG = "org-synthetic-membership";
const SERVICE_SHAPED_HUMAN = `svc-human@service.${ORG}`;
const REDIRECT_URI = "http://localhost:5555/callback";
const CODE_VERIFIER = "synthetic-pkce-verifier-".padEnd(64, "x");
const ORG_DOC = "synthetic-org-visible-doc";
const ALICE_PRIVATE_DOC = "synthetic-alice-private-doc";

const docs = table("synthetic_org_docs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  ...ownableColumns(),
});
const docShares = createSharesTable("synthetic_org_doc_shares");

const ORIGINAL_ENV = { ...process.env };

function appEvent(
  path: string,
  init: { method?: string; body?: unknown } = {},
): H3Event {
  const headers: Record<string, string> = {
    "x-forwarded-host": new URL(ORIGIN).host,
    "x-forwarded-proto": "https",
  };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return mockEvent(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

function as<T>(email: string, fn: () => Promise<T>): Promise<T> {
  signedIn.email = email;
  return fn().finally(() => {
    signedIn.email = null;
  });
}

type TokenResponse = {
  status: number;
  body: Record<string, any>;
};

async function tokenRequest(body: Record<string, string>) {
  const res = await handleMcpOAuth(
    appEvent("/mcp/oauth/token", { method: "POST", body }),
    "token",
  );
  return { status: res.status, body: await res.json() } as TokenResponse;
}

/** The MCP endpoint's own auth chain: `handleMcpRequest` → `verifyAuth` →
 * `createMCPServerForRequest` → `resolveMcpIdentityOrgId`. */
async function authenticateMcpRequest(accessToken: string) {
  const mcpEvent = appEvent("/mcp", { method: "POST" });
  const auth = await verifyAuth(`Bearer ${accessToken}`, undefined, {
    resourceUrl: getMcpOAuthAudiences(mcpEvent),
    requestOrigin: ORIGIN,
  });
  const mcpOrgId = auth.authed
    ? await resolveMcpIdentityOrgId(auth.identity)
    : undefined;
  return { auth, mcpOrgId };
}

/** Rows an MCP tool call made with this token can read through `accessFilter`,
 * using the same request context `createMCPServerForRequest` installs. */
async function docsVisibleTo(accessToken: string): Promise<string[]> {
  const { auth, mcpOrgId } = await authenticateMcpRequest(accessToken);
  if (!auth.authed) return [];
  const db = drizzle(await getPgliteClient(process.env.DATABASE_URL!));
  return runWithRequestContext(
    {
      userEmail: auth.identity?.userEmail,
      orgId: mcpOrgId,
      ...(auth.identity?.orgId === null
        ? { orgScope: "personal" as const }
        : {}),
    },
    async () => {
      const rows = await db
        .select({ id: docs.id })
        .from(docs)
        .where(accessFilter(docs, docShares));
      return rows.map((row) => row.id);
    },
  );
}

type McpClient = { clientId: string };
type McpConnection = McpClient & {
  accessToken: string;
  refreshToken: string;
};

async function registerMcpClient(): Promise<McpClient> {
  const registered = await handleMcpOAuth(
    appEvent("/mcp/oauth/register", {
      method: "POST",
      body: { redirect_uris: [REDIRECT_URI], client_name: "Synthetic MCP" },
    }),
    "register",
  );
  return { clientId: (await registered.json()).client_id };
}

/** Consent as `email` for `ORG` through the real authorize endpoint. */
async function authorizationCode(email: string, client: McpClient) {
  const authorizeQuery = new URLSearchParams({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: REDIRECT_URI,
    resource: getMcpOAuthResource(appEvent("/mcp"))!,
    scope: "mcp:read mcp:write offline_access",
    state: "synthetic-state",
    code_challenge: createHash("sha256")
      .update(CODE_VERIFIER)
      .digest("base64url"),
    code_challenge_method: "S256",
  });
  const consentHtml = await as(email, async () =>
    (
      await handleMcpOAuth(
        appEvent(`/mcp/oauth/authorize?${authorizeQuery}`),
        "authorize",
      )
    ).text(),
  );
  const consentToken = consentHtml.match(
    /name="consent_token" value="([^"]+)"/,
  )?.[1];
  if (!consentToken) throw new Error("consent page had no consent_token");
  const approved = await as(email, () =>
    handleMcpOAuth(
      appEvent("/mcp/oauth/authorize", {
        method: "POST",
        body: {
          ...Object.fromEntries(authorizeQuery),
          consent_token: consentToken,
          organization_id: ORG,
          decision: "approve",
        },
      }),
      "authorize",
    ),
  );
  const code = new URL(approved.headers.get("location") ?? "").searchParams.get(
    "code",
  );
  if (!code) throw new Error("authorize did not redirect with a code");
  return code;
}

function exchangeCode(client: McpClient, code: string) {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: client.clientId,
    redirect_uri: REDIRECT_URI,
    code_verifier: CODE_VERIFIER,
  });
}

function refresh(connection: McpConnection) {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: connection.refreshToken,
    client_id: connection.clientId,
  });
}

async function connectMcpClient(email: string): Promise<McpConnection> {
  const client = await registerMcpClient();
  const issued = await exchangeCode(
    client,
    await authorizationCode(email, client),
  );
  if (issued.status !== 200) {
    throw new Error(`token exchange failed: ${JSON.stringify(issued.body)}`);
  }
  return {
    ...client,
    accessToken: issued.body.access_token,
    refreshToken: issued.body.refresh_token,
  };
}

async function refreshRowsFor(client: McpClient) {
  const { rows } = await getDbExec().execute({
    sql: `SELECT owner_email, org_id, revoked_at, last_used_at, expires_at
          FROM mcp_oauth_refresh_tokens WHERE client_id = ?`,
    args: [client.clientId],
  });
  return rows as Array<Record<string, unknown>>;
}

async function invite(email: string) {
  const created = (await as(ALICE, () =>
    createInvitationHandler(
      appEvent("/_agent-native/org/invitations", {
        method: "POST",
        body: { email, role: "member" },
      }),
    ),
  )) as { id?: string; invitationId?: string };
  const invitationId = created.id ?? created.invitationId;
  if (!invitationId) {
    throw new Error(`invitation id missing: ${JSON.stringify(created)}`);
  }
  await as(email, () =>
    acceptInvitationHandler(
      appEvent(
        `/_agent-native/org/invitations/${encodeURIComponent(invitationId)}/accept`,
        { method: "POST" },
      ),
    ),
  );
}

let alice: McpConnection;
let bob: McpConnection;
let carol: McpConnection;
let bobPendingCode: { client: McpClient; code: string };
let carolPendingCode: { client: McpClient; code: string };
let bobConnectToken: { token: string; jti: string };
let bobDeviceCode: string;
let serviceToken: string;
let serviceShapedHuman: McpConnection;
let serviceShapedHumanPendingCode: { client: McpClient; code: string };
let removal: unknown;
const beforeRemoval: {
  bob?: Awaited<ReturnType<typeof authenticateMcpRequest>>;
  bobDocs?: string[];
  bobRefresh?: TokenResponse;
  bobRefreshedAuth?: Awaited<ReturnType<typeof authenticateMcpRequest>>;
  bobRefreshRows?: Array<Record<string, unknown>>;
  bobConnect?: Awaited<ReturnType<typeof authenticateMcpRequest>>;
  carol?: Awaited<ReturnType<typeof authenticateMcpRequest>>;
} = {};

beforeAll(async () => {
  process.env.DATABASE_URL = "pglite:memory"; // guard:allow-env-mutation — spec-owned in-memory database
  process.env.BETTER_AUTH_SECRET = "synthetic-test-auth-secret-not-real"; // guard:allow-env-mutation — spec-owned fake secret
  process.env.A2A_SECRET = "synthetic-test-a2a-secret-not-real"; // guard:allow-env-mutation — spec-owned fake secret
  for (const key of [
    "APP_BASE_PATH",
    "VITE_APP_BASE_PATH",
    "WORKSPACE_OAUTH_ORIGIN",
    "VITE_WORKSPACE_OAUTH_ORIGIN",
    "APP_URL",
    "VITE_APP_URL",
    "BETTER_AUTH_URL",
    "VITE_BETTER_AUTH_URL",
    "ACCESS_TOKEN",
    "ACCESS_TOKENS",
    "AGENT_NATIVE_OWNER_EMAIL",
    "AGENT_NATIVE_IDENTITY_HUB_URL",
  ]) {
    delete process.env[key];
  }
  await closeDbExec();
  await withMigrationRuntime(() => runFrameworkReleaseMigrations(null));

  const exec = getDbExec();
  await exec.execute(`
    INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES
      ('synthetic-alice', 'Alice', '${ALICE}', true, now(), now()),
      ('synthetic-bob', 'Bob', '${BOB}', true, now(), now()),
      ('synthetic-carol', 'Carol', '${CAROL}', true, now(), now())
  `);
  await exec.execute({
    sql: `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
          VALUES ('synthetic-service-shaped-human', 'Human', ?, true, now(), now())`,
    args: [SERVICE_SHAPED_HUMAN],
  });

  // Alice creates the org; she invites Bob and Carol, who accept — the real
  // handlers.
  await createOrganization("Synthetic Org", ALICE, "owner", { id: ORG });
  await invite(BOB);
  await invite(CAROL);
  await invite(SERVICE_SHAPED_HUMAN);

  // A document Alice shares with her org, the kind of row org scope exposes.
  await exec.execute(`
    CREATE TABLE synthetic_org_docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      owner_email TEXT NOT NULL,
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )
  `);
  await exec.execute(`
    CREATE TABLE synthetic_org_doc_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      notified_at TEXT
    )
  `);
  await exec.execute({
    sql: `INSERT INTO synthetic_org_docs (id, title, owner_email, org_id, visibility)
          VALUES (?, 'Org plan', ?, ?, 'org'), (?, 'Alice notes', ?, ?, 'private')`,
    args: [ORG_DOC, ALICE, ORG, ALICE_PRIVATE_DOC, ALICE, ORG],
  });

  // Everyone connects an MCP client through the real OAuth endpoints. Bob and
  // Carol also leave an approved code unexchanged.
  alice = await connectMcpClient(ALICE);
  bob = await connectMcpClient(BOB);
  carol = await connectMcpClient(CAROL);
  serviceShapedHuman = await connectMcpClient(SERVICE_SHAPED_HUMAN);
  const serviceShapedHumanPendingClient = await registerMcpClient();
  serviceShapedHumanPendingCode = {
    client: serviceShapedHumanPendingClient,
    code: await authorizationCode(
      SERVICE_SHAPED_HUMAN,
      serviceShapedHumanPendingClient,
    ),
  };
  const bobPendingClient = await registerMcpClient();
  bobPendingCode = {
    client: bobPendingClient,
    code: await authorizationCode(BOB, bobPendingClient),
  };
  const carolPendingClient = await registerMcpClient();
  carolPendingCode = {
    client: carolPendingClient,
    code: await authorizationCode(CAROL, carolPendingClient),
  };

  // Bob also holds a legacy connect token (its org lives on the stored row),
  // a CLI device code he approved but the CLI has not collected yet, and he
  // minted an org service token for CI.
  const jti = randomUUID();
  await recordMintedToken({ jti, ownerEmail: BOB, orgId: ORG, label: "CLI" });
  bobConnectToken = {
    jti,
    token: await signA2AToken(BOB, undefined, undefined, {
      preferGlobalSecret: true,
      expiresIn: "365d",
      extraClaims: { jti, scope: "mcp-connect" },
    }),
  };
  const device = await createDeviceCode();
  bobDeviceCode = device.deviceCode;
  await approveDeviceCode(device.userCode, BOB, ORG);
  serviceToken = (
    await mintOrgServiceToken({
      serviceName: "ci",
      orgId: ORG,
      createdBy: BOB,
      appUrl: ORIGIN,
    })
  ).token;

  beforeRemoval.bob = await authenticateMcpRequest(bob.accessToken);
  beforeRemoval.bobDocs = await docsVisibleTo(bob.accessToken);
  beforeRemoval.bobRefresh = await refresh(bob);
  beforeRemoval.bobRefreshedAuth = await authenticateMcpRequest(
    beforeRemoval.bobRefresh.body.access_token,
  );
  beforeRemoval.bobRefreshRows = await refreshRowsFor(bob);
  beforeRemoval.bobConnect = await authenticateMcpRequest(
    bobConnectToken.token,
  );
  beforeRemoval.carol = await authenticateMcpRequest(carol.accessToken);

  // Alice removes Bob through the real Team-settings handler. The handler
  // requires a successor for Bob's rows; Alice takes them.
  removal = await as(ALICE, () =>
    removeMemberHandler(
      appEvent(`/_agent-native/org/members/${encodeURIComponent(BOB)}`, {
        method: "DELETE",
        body: { transferTo: ALICE },
      }),
    ),
  );
  // Carol's membership ends without offboarding, as when the identity
  // authority drops her or another instance removes the row: her credentials
  // are untouched, so only the live membership check stands in the way.
  await exec.execute({
    sql: `DELETE FROM org_members WHERE org_id = ? AND LOWER(email) = ?`,
    args: [ORG, CAROL],
  });
  await exec.execute({
    sql: `DELETE FROM org_members WHERE org_id = ? AND LOWER(email) = ?`,
    args: [ORG, SERVICE_SHAPED_HUMAN],
  });
}, 180_000);

afterAll(async () => {
  await closeDbExec();
  process.env = ORIGINAL_ENV; // guard:allow-env-mutation — restore the spec's environment
});

let bobRefreshAfterRemoval: Promise<TokenResponse> | undefined;
function refreshBobAfterRemoval() {
  bobRefreshAfterRemoval ??= refresh(bob);
  return bobRefreshAfterRemoval;
}

describe("MCP OAuth access after the user is removed from the org", () => {
  it("control: before removal, Bob's token authenticates with the org as its MCP org context", () => {
    expect(beforeRemoval.bob?.auth).toMatchObject({
      authed: true,
      identity: { userEmail: BOB, orgId: ORG },
    });
    expect(beforeRemoval.bob?.mcpOrgId).toBe(ORG);
    expect(beforeRemoval.bobDocs).toContain(ORG_DOC);
    expect(beforeRemoval.bobDocs).not.toContain(ALICE_PRIVATE_DOC);
    expect(beforeRemoval.bobRefresh?.status).toBe(200);
    expect(beforeRemoval.bobRefreshedAuth?.auth).toMatchObject({
      authed: true,
      identity: { userEmail: BOB, orgId: ORG },
    });
    expect(beforeRemoval.bobRefreshRows).toMatchObject([
      { owner_email: BOB, org_id: ORG, revoked_at: null },
    ]);
    expect(beforeRemoval.bobConnect?.auth).toMatchObject({
      authed: true,
      identity: { userEmail: BOB, orgId: ORG },
    });
    expect(beforeRemoval.carol?.auth).toMatchObject({
      authed: true,
      identity: { userEmail: CAROL, orgId: ORG },
    });
  });

  it("control: the real removal path deleted Bob's membership", async () => {
    expect(removal).toEqual({ success: true });
    const { rows } = await getDbExec().execute({
      sql: `SELECT org_id FROM org_members WHERE LOWER(email) = ?`,
      args: [BOB],
    });
    expect(rows).toEqual([]);
    expect(
      (await listOrgMemberships(BOB))?.map((m) => m.orgId) ?? [],
    ).not.toContain(ORG);
  });

  it("(a) the already-issued access token is refused", async () => {
    const { auth } = await authenticateMcpRequest(bob.accessToken);
    expect(auth).toEqual({ authed: false });
  });

  it("(a) an MCP call with the already-issued token cannot read the org's org-visible rows", async () => {
    expect(await docsVisibleTo(bob.accessToken)).not.toContain(ORG_DOC);
  });

  it("(b) a refresh-token exchange after removal is refused with invalid_grant", async () => {
    const refreshed = await refreshBobAfterRemoval();
    expect(refreshed.status).toBe(400);
    expect(refreshed.body.error).toBe("invalid_grant");
    expect(refreshed.body.access_token).toBeUndefined();
  });

  it("removal revokes Bob's refresh-token row instead of handing it to the successor", async () => {
    await refreshBobAfterRemoval();
    const rows = await refreshRowsFor(bob);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner_email: BOB, org_id: ORG });
    expect(Number(rows[0].revoked_at)).toBeGreaterThan(0);
  });

  it("removal deletes Bob's unexchanged authorization code, so it mints nothing", async () => {
    const exchanged = await exchangeCode(
      bobPendingCode.client,
      bobPendingCode.code,
    );
    expect(exchanged.status).toBe(400);
    expect(exchanged.body.error).toBe("invalid_grant");
    expect(await refreshRowsFor(bobPendingCode.client)).toEqual([]);
  });

  it("removal revokes Bob's connect token in place instead of transferring it", async () => {
    const { auth } = await authenticateMcpRequest(bobConnectToken.token);
    expect(auth).toEqual({ authed: false });
    const { rows } = await getDbExec().execute({
      sql: `SELECT owner_email, revoked_at FROM mcp_connect_tokens WHERE jti = ?`,
      args: [bobConnectToken.jti],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner_email: BOB });
    expect(Number(rows[0].revoked_at)).toBeGreaterThan(0);
  });

  it("removal deletes the device code Bob approved, so the CLI cannot collect a token", async () => {
    expect(await getDeviceCode(bobDeviceCode)).toBeNull();
  });
});

describe("MCP OAuth access after membership ends without offboarding", () => {
  it("refuses a human OAuth access token whose subject uses a service address", async () => {
    const { auth } = await authenticateMcpRequest(
      serviceShapedHuman.accessToken,
    );
    expect(auth).toEqual({ authed: false });
  });

  it("refuses a human OAuth refresh whose subject uses a service address", async () => {
    const refreshed = await refresh(serviceShapedHuman);
    expect(refreshed.status).toBe(400);
    expect(refreshed.body.error).toBe("invalid_grant");
    expect(refreshed.body.access_token).toBeUndefined();
  });

  it("refuses human OAuth code issuance whose subject uses a service address", async () => {
    const exchanged = await exchangeCode(
      serviceShapedHumanPendingCode.client,
      serviceShapedHumanPendingCode.code,
    );
    expect(exchanged.status).toBe(400);
    expect(exchanged.body.error).toBe("invalid_grant");
    expect(await refreshRowsFor(serviceShapedHumanPendingCode.client)).toEqual(
      [],
    );
  });

  it("refuses the access token of a user whose membership row is gone", async () => {
    const { auth } = await authenticateMcpRequest(carol.accessToken);
    expect(auth).toEqual({ authed: false });
    expect(await docsVisibleTo(carol.accessToken)).toEqual([]);
  });

  it("refuses the refresh with invalid_grant and revokes the token, keeping its owner", async () => {
    const refreshed = await refresh(carol);
    expect(refreshed.status).toBe(400);
    expect(refreshed.body.error).toBe("invalid_grant");
    const rows = await refreshRowsFor(carol);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner_email: CAROL, org_id: ORG });
    expect(Number(rows[0].revoked_at)).toBeGreaterThan(0);

    expect((await refresh(carol)).body.error).toBe("invalid_grant");
  });

  it("refuses the authorization code and issues no refresh token", async () => {
    const exchanged = await exchangeCode(
      carolPendingCode.client,
      carolPendingCode.code,
    );
    expect(exchanged.status).toBe(400);
    expect(exchanged.body.error).toBe("invalid_grant");
    expect(await refreshRowsFor(carolPendingCode.client)).toEqual([]);
  });
});

describe("MCP access that removing a member must not affect", () => {
  it("a current member's access token keeps the org and its org-visible rows", async () => {
    const { auth, mcpOrgId } = await authenticateMcpRequest(alice.accessToken);
    expect(auth).toMatchObject({
      authed: true,
      identity: { userEmail: ALICE, orgId: ORG },
    });
    expect(mcpOrgId).toBe(ORG);
    expect(await docsVisibleTo(alice.accessToken)).toEqual(
      expect.arrayContaining([ORG_DOC, ALICE_PRIVATE_DOC]),
    );
  });

  it("a current member's refresh still mints an org-scoped token for that member", async () => {
    const refreshed = await refresh(alice);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refresh_token).toBe(alice.refreshToken);
    const { auth } = await authenticateMcpRequest(refreshed.body.access_token);
    expect(auth).toMatchObject({
      authed: true,
      identity: { userEmail: ALICE, orgId: ORG },
    });
    expect(await refreshRowsFor(alice)).toMatchObject([
      { owner_email: ALICE, org_id: ORG, revoked_at: null },
    ]);
  });

  it("an org service token keeps working after the member who minted it leaves", async () => {
    const { auth, mcpOrgId } = await authenticateMcpRequest(serviceToken);
    expect(auth).toMatchObject({
      authed: true,
      identity: { userEmail: `svc-ci@service.${ORG}`, orgId: ORG },
    });
    expect(mcpOrgId).toBe(ORG);
    expect(await docsVisibleTo(serviceToken)).toContain(ORG_DOC);
  });

  it("the removed user's Personal-scope token still authenticates, without org access", async () => {
    const personal = await signMcpOAuthAccessToken({
      ownerEmail: BOB,
      orgId: null,
      orgDomain: null,
      clientId: bob.clientId,
      scope: "mcp:read",
      resource: getMcpOAuthResource(appEvent("/mcp"))!,
      issuer: ORIGIN,
    });
    const { auth, mcpOrgId } = await authenticateMcpRequest(personal);
    expect(auth).toMatchObject({
      authed: true,
      identity: { userEmail: BOB, orgId: null },
    });
    expect(mcpOrgId).toBeUndefined();
    expect(await docsVisibleTo(personal)).not.toContain(ORG_DOC);
  });

  it("a token with no org claim still authenticates the removed user, without org access", async () => {
    const token = await signA2AToken(BOB, undefined, undefined, {
      preferGlobalSecret: true,
    });
    const { auth, mcpOrgId } = await authenticateMcpRequest(token);
    expect(auth).toMatchObject({ authed: true, identity: { userEmail: BOB } });
    expect(auth.identity?.orgId).toBeUndefined();
    expect(mcpOrgId).toBeUndefined();
    expect(await docsVisibleTo(token)).not.toContain(ORG_DOC);
  });

  // Another app signed these and vouches for the org itself, as it does with
  // `org_domain`. This app's org_members is not that app's roster.
  it("a cross-app A2A token naming the org authenticates a user this app has never seen", async () => {
    const token = await signA2AToken(DAVE, undefined, undefined, {
      preferGlobalSecret: true,
      extraClaims: { org_id: ORG },
    });
    const { auth, mcpOrgId } = await authenticateMcpRequest(token);
    expect(auth).toMatchObject({
      authed: true,
      identity: { userEmail: DAVE, orgId: ORG },
    });
    expect(mcpOrgId).toBe(ORG);
  });

  it("a first-party MCP token from a sibling app authenticates a user this app has never seen", async () => {
    const token = await signA2AToken(DAVE, undefined, undefined, {
      preferGlobalSecret: true,
      expiresIn: "5m",
      audience: getMcpOAuthResource(appEvent("/mcp"))!,
      extraClaims: {
        jti: randomUUID(),
        scope: "mcp-connect",
        org_id: ORG,
        agent_native_first_party_mcp: true,
      },
    });
    const { auth, mcpOrgId } = await authenticateMcpRequest(token);
    expect(auth).toMatchObject({
      authed: true,
      identity: { userEmail: DAVE, orgId: ORG, firstPartyMcp: true },
    });
    expect(mcpOrgId).toBe(ORG);
  });
});

describe("MCP access when the membership lookup fails", () => {
  async function withFailingMembershipLookup<T>(fn: () => Promise<T>) {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    membershipLookup.fail = true;
    try {
      return await fn();
    } finally {
      membershipLookup.fail = false;
      consoleError.mockRestore();
    }
  }

  it("refuses a member's access token as unavailable, not as authenticated", async () => {
    const { auth } = await withFailingMembershipLookup(() =>
      authenticateMcpRequest(alice.accessToken),
    );
    expect(auth).toEqual({ authed: false, unavailable: true });
  });

  it("answers a member's refresh with a retryable 503 and leaves the token untouched", async () => {
    const before = await refreshRowsFor(alice);
    const refreshed = await withFailingMembershipLookup(() => refresh(alice));
    expect(refreshed.status).toBe(503);
    expect(refreshed.body.error).toBe("temporarily_unavailable");
    expect(await refreshRowsFor(alice)).toEqual(before);

    expect((await refresh(alice)).status).toBe(200);
  });
});

describe("MCP OAuth issuance-owner cutover", () => {
  it("refuses a legacy successor access token through the full MCP authentication chain", async () => {
    const resource = getMcpOAuthResource(appEvent("/mcp"))!;
    const legacyAccessToken = await signA2AToken(ALICE, undefined, undefined, {
      preferGlobalSecret: true,
      expiresIn: "30d",
      audience: resource,
      extraClaims: {
        typ: "agent-native-mcp-oauth",
        org_id: ORG,
        client_id: alice.clientId,
        scope: "mcp:read",
        resource,
      },
    });

    expect((await authenticateMcpRequest(legacyAccessToken)).auth).toEqual({
      authed: false,
    });
    expect(await docsVisibleTo(legacyAccessToken)).toEqual([]);
    expect(
      (await authenticateMcpRequest(alice.accessToken)).auth,
    ).toMatchObject({
      authed: true,
      identity: { userEmail: ALICE, orgId: ORG },
    });
  });

  it("refuses a legacy transferred refresh token instead of authenticating its successor", async () => {
    const client = await registerMcpClient();
    const refreshToken = "synthetic-legacy-transferred-refresh";
    await createOAuthRefreshToken({
      refreshToken,
      clientId: client.clientId,
      ownerEmail: BOB,
      orgId: ORG,
      scope: "mcp:read",
      resource: getMcpOAuthResource(appEvent("/mcp"))!,
    });
    await getDbExec().execute(
      "ALTER TABLE mcp_oauth_refresh_tokens ADD COLUMN IF NOT EXISTS issued_for_email TEXT",
    );
    await getDbExec().execute({
      sql: "UPDATE mcp_oauth_refresh_tokens SET owner_email = ?, issued_for_email = NULL WHERE client_id = ?",
      args: [ALICE, client.clientId],
    });

    const response = await tokenRequest({
      grant_type: "refresh_token",
      client_id: client.clientId,
      refresh_token: refreshToken,
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_grant");
    expect(response.body.access_token).toBeUndefined();
    expect(await refreshRowsFor(client)).toMatchObject([
      { owner_email: ALICE, last_used_at: null },
    ]);
  });

  it("refuses a legacy transferred code and creates no successor credentials", async () => {
    const client = await registerMcpClient();
    const code = await createOAuthCode({
      clientId: client.clientId,
      redirectUri: REDIRECT_URI,
      codeChallenge: createHash("sha256")
        .update(CODE_VERIFIER)
        .digest("base64url"),
      codeChallengeMethod: "S256",
      ownerEmail: BOB,
      orgId: ORG,
      scope: "mcp:read",
      resource: getMcpOAuthResource(appEvent("/mcp"))!,
    });
    await getDbExec().execute(
      "ALTER TABLE mcp_oauth_codes ADD COLUMN IF NOT EXISTS issued_for_email TEXT",
    );
    await getDbExec().execute({
      sql: "UPDATE mcp_oauth_codes SET owner_email = ?, issued_for_email = NULL WHERE code = ?",
      args: [ALICE, code.code],
    });

    const response = await exchangeCode(client, code.code);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_grant");
    expect(response.body.access_token).toBeUndefined();
    expect(await refreshRowsFor(client)).toEqual([]);
  });
});
