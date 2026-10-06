import { randomUUID } from "node:crypto";

import { mockEvent, type H3Event } from "h3";
import * as jose from "jose";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// The browser sign-in is not under test. Everything after the session —
// Connect minting, token storage, organization trust metadata, and token
// verification — runs the real code against an in-memory PGlite database.
const signedIn = vi.hoisted(() => ({ email: null as string | null }));
vi.mock("../server/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/auth.js")>()),
  getSession: async () => (signedIn.email ? { email: signedIn.email } : null),
}));
vi.mock("../tracking/registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tracking/registry.js")>()),
  track: () => undefined,
  flushTracking: async () => [],
}));

import { closeDbExec, getDbExec } from "../db/client.js";
import { withMigrationRuntime } from "../db/migration-runtime.js";
import { createOrganization } from "../org/context.js";
import { runFrameworkReleaseMigrations } from "../server/release-migrations.js";
import { verifyAuth } from "./build-server.js";
import {
  handleMcpConnect,
  mintOrgServiceToken,
  OrgServiceTokenAppUrlError,
} from "./connect-route.js";
import { recordMintedToken } from "./connect-store.js";
import { getMcpOAuthAudiences } from "./oauth-route.js";
import { verifyMcpOAuthAccessToken } from "./oauth-token.js";

const ORIGIN = "https://app.example.test";
const ALIAS = "https://alias.example.test";
const ALICE = "alice@example.test";
const ORG = "org-synthetic-connect-trust";
const DOMAIN = "example.test";
const DEPLOY_A2A_SECRET = "synthetic-test-a2a-secret-not-real";
const ORG_A2A_SECRET = "synthetic-test-org-a2a-secret-not-real";
const ORIGINAL_ENV = { ...process.env };
/** The origin every request below reaches the app through. */
let requestOrigin = ORIGIN;

function appEvent(
  path: string,
  init: { method?: string; body?: unknown } = {},
): H3Event {
  const headers: Record<string, string> = {
    "x-forwarded-host": new URL(requestOrigin).host,
    "x-forwarded-proto": "https",
  };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return mockEvent(`${requestOrigin}${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function as<T>(email: string, fn: () => Promise<T>): Promise<T> {
  signedIn.email = email;
  try {
    return await fn();
  } finally {
    signedIn.email = null;
  }
}

async function connect(path: string, body: unknown): Promise<Response> {
  return handleMcpConnect(
    appEvent(`/mcp/connect${path}`, { method: "POST", body }),
    path,
  );
}

/** "Generate a static token" on the Connect page. */
async function mintStaticToken(): Promise<{ token: string; mcpUrl: string }> {
  const res = await as(ALICE, () => connect("/token", {}));
  const body = await res.json();
  if (!body.token) throw new Error(`static mint answered ${res.status}`);
  return { token: body.token, mcpUrl: body.mcpUrl };
}

/** The terminal device-code flow: start, approve in the browser, poll. */
async function mintDeviceToken(): Promise<{ token: string; mcpUrl: string }> {
  const started = await (await connect("/device/start", {})).json();
  const approved = await as(ALICE, () =>
    connect("/device/authorize", { user_code: started.user_code }),
  );
  if (approved.status !== 200) {
    throw new Error(`device approval answered ${approved.status}`);
  }
  const polled = await (
    await connect("/device/poll", { device_code: started.device_code })
  ).json();
  if (!polled.token) throw new Error(`device poll answered ${polled.status}`);
  return { token: polled.token, mcpUrl: polled.mcpUrl };
}

const MINT = { static: mintStaticToken, device: mintDeviceToken } as const;

async function verifyAtMcp(token: string) {
  return verifyAuth(`Bearer ${token}`, undefined, {
    resourceUrl: getMcpOAuthAudiences(appEvent("/mcp", { method: "POST" })),
    requestOrigin,
  });
}

async function mintServiceToken(): Promise<string> {
  const { token } = await mintOrgServiceToken({
    serviceName: `ci-${randomUUID().slice(0, 8)}`,
    orgId: ORG,
    createdBy: ALICE,
    appUrl: requestOrigin,
  });
  return token;
}

async function setOrgTrust(allowedDomain: string | null, a2aSecret: string) {
  await getDbExec().execute({
    sql: `UPDATE organizations SET allowed_domain = ?, a2a_secret = ? WHERE id = ?`,
    args: [allowedDomain, a2aSecret, ORG],
  });
}

/** A connect token as Connect signed it before it switched to the MCP OAuth format. */
async function earlierFormatConnectToken(
  secret: string,
  jti: string,
): Promise<string> {
  return new jose.SignJWT({
    sub: ALICE,
    org_domain: DOMAIN,
    jti,
    scope: "mcp-connect",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ORIGIN)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(secret));
}

beforeAll(async () => {
  process.env.DATABASE_URL = "pglite:memory"; // guard:allow-env-mutation — spec-owned in-memory database
  process.env.BETTER_AUTH_SECRET = "synthetic-test-auth-secret-not-real"; // guard:allow-env-mutation — spec-owned fake secret
  process.env.A2A_SECRET = DEPLOY_A2A_SECRET; // guard:allow-env-mutation — spec-owned fake secret
  for (const key of [
    "APP_BASE_PATH",
    "VITE_APP_BASE_PATH",
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
  await getDbExec().execute({
    sql: `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
          VALUES ('synthetic-alice', 'Alice', ?, true, now(), now())`,
    args: [ALICE],
  });
  await createOrganization("Synthetic Org", ALICE, "owner", { id: ORG });
}, 180_000);

afterAll(async () => {
  await closeDbExec();
  process.env = ORIGINAL_ENV; // guard:allow-env-mutation — restore the spec-owned environment
});

describe("connect tokens in an org that shares the deployment's A2A secret", () => {
  beforeEach(() => setOrgTrust(DOMAIN, DEPLOY_A2A_SECRET));

  it.each(["static", "device"] as const)(
    "admits a %s connect token as the person who minted it",
    async (flow) => {
      const { token } = await MINT[flow]();
      expect(await verifyAtMcp(token)).toMatchObject({
        authed: true,
        identity: { userEmail: ALICE, identityAssurance: "user", orgId: ORG },
      });
    },
  );

  it.each(["static", "device"] as const)(
    "mints a %s connect token bound to this app's MCP URL",
    async (flow) => {
      const { token, mcpUrl } = await MINT[flow]();
      expect(await verifyMcpOAuthAccessToken(token, mcpUrl)).toMatchObject({
        userEmail: ALICE,
        clientId: "agent-native-connect",
      });
      expect(
        await verifyMcpOAuthAccessToken(
          token,
          "https://other.example.test/mcp",
        ),
      ).toBeNull();
    },
  );

  it("admits a connect token minted in the earlier A2A format as its stored owner", async () => {
    const jti = randomUUID();
    await recordMintedToken({ jti, ownerEmail: ALICE, orgId: ORG });
    const token = await earlierFormatConnectToken(DEPLOY_A2A_SECRET, jti);
    expect(await verifyAtMcp(token)).toMatchObject({
      authed: true,
      identity: { userEmail: ALICE, identityAssurance: "user", orgId: ORG },
    });
  });

  it("names why an earlier-format connect token with no stored row is refused", async () => {
    const token = await earlierFormatConnectToken(
      DEPLOY_A2A_SECRET,
      randomUUID(),
    );
    expect(await verifyAtMcp(token)).toEqual({
      authed: false,
      refusal: "unknown-connect-token",
    });
  });

  it("admits an org service token as a service, not a person", async () => {
    const token = await mintServiceToken();
    expect(await verifyAtMcp(token)).toMatchObject({
      authed: true,
      identity: { identityAssurance: "service", orgId: ORG },
    });
  });

  it("signs org service tokens with a credential version earlier verifiers refuse", async () => {
    // Verifiers before service assurance admit credential_version 2 only, and
    // admit it as a verified user.
    const service = jose.decodeJwt(await mintServiceToken());
    const personal = jose.decodeJwt((await mintStaticToken()).token);
    expect(personal.credential_version).toBe(2);
    expect(service.credential_version).not.toBe(2);
  });
});

describe("connect tokens minted where the configured public URL differs from the request", () => {
  afterEach(() => {
    requestOrigin = ORIGIN;
    delete process.env.APP_URL;
    delete process.env.APP_BASE_PATH;
  });

  it("admits every mint reached through an alias of the configured URL", async () => {
    process.env.APP_URL = ORIGIN; // guard:allow-env-mutation — spec-owned public URL
    requestOrigin = ALIAS;
    const tokens = [
      (await mintStaticToken()).token,
      (await mintDeviceToken()).token,
      await mintServiceToken(),
    ];
    for (const token of tokens) {
      expect(await verifyAtMcp(token)).toMatchObject({ authed: true });
    }
  });

  it("mints a service token from the configured URL when there is no request", async () => {
    process.env.APP_URL = ORIGIN; // guard:allow-env-mutation — spec-owned public URL
    const { token } = await mintOrgServiceToken({
      serviceName: `ci-${randomUUID().slice(0, 8)}`,
      orgId: ORG,
      createdBy: ALICE,
      appUrl: undefined,
    });
    expect(await verifyAtMcp(token)).toMatchObject({ authed: true });
  });

  it("refuses to mint a service token when nothing names the app URL", async () => {
    await expect(
      mintOrgServiceToken({
        serviceName: "ci",
        orgId: ORG,
        createdBy: ALICE,
        appUrl: undefined,
      }),
    ).rejects.toBeInstanceOf(OrgServiceTokenAppUrlError);
  });

  it("admits every mint under a configured base path", async () => {
    process.env.APP_BASE_PATH = "/content"; // guard:allow-env-mutation — spec-owned base path
    const tokens = [
      (await mintStaticToken()).token,
      (await mintDeviceToken()).token,
      await mintServiceToken(),
    ];
    for (const token of tokens) {
      expect(await verifyAtMcp(token)).toMatchObject({ authed: true });
    }
  });
});

describe("connect tokens under other organization trust settings", () => {
  it.each([
    ["no allowed domain", null],
    ["its own A2A secret", DOMAIN],
  ] as const)("admits both flows for an org with %s", async (_, domain) => {
    await setOrgTrust(domain, ORG_A2A_SECRET);
    for (const mint of [mintStaticToken, mintDeviceToken]) {
      const { token } = await mint();
      expect(await verifyAtMcp(token)).toMatchObject({
        authed: true,
        identity: { userEmail: ALICE, orgId: ORG },
      });
    }
  });

  it("refuses an earlier-format connect token signed with an organization secret", async () => {
    await setOrgTrust(DOMAIN, ORG_A2A_SECRET);
    const jti = randomUUID();
    await recordMintedToken({ jti, ownerEmail: ALICE, orgId: ORG });
    const token = await earlierFormatConnectToken(ORG_A2A_SECRET, jti);
    expect(await verifyAtMcp(token)).toEqual({
      authed: false,
      refusal: "invalid",
    });
  });

  describe("without an A2A_SECRET", () => {
    beforeEach(() => {
      delete process.env.A2A_SECRET;
    });
    afterEach(() => {
      process.env.A2A_SECRET = DEPLOY_A2A_SECRET; // guard:allow-env-mutation — restore the spec-owned fake secret
    });

    it("admits both flows", async () => {
      await setOrgTrust(DOMAIN, ORG_A2A_SECRET);
      for (const mint of [mintStaticToken, mintDeviceToken]) {
        const { token } = await mint();
        expect(await verifyAtMcp(token)).toMatchObject({
          authed: true,
          identity: { userEmail: ALICE, orgId: ORG },
        });
      }
    });
  });
});
