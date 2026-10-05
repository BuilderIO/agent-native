import { createApp } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrgContext: vi.fn(),
  isRestricted: vi.fn(async () => false),
  writeBuilderCredentials: vi.fn(),
  settings: new Map<string, Record<string, unknown>>(),
  track: vi.fn(),
  recordAudit: vi.fn(async () => undefined),
}));

vi.mock("../org/context.js", () => ({ getOrgContext: mocks.getOrgContext }));

vi.mock("./personal-provider-key-policy.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("./personal-provider-key-policy.js")
  >()),
  isPersonalProviderKeyUseRestricted: mocks.isRestricted,
}));

vi.mock("./credential-provider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./credential-provider.js")>()),
  writeBuilderCredentials: mocks.writeBuilderCredentials,
}));

vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  getSetting: async (key: string) => mocks.settings.get(key) ?? null,
  putSetting: async (key: string, value: Record<string, unknown>) => {
    mocks.settings.set(key, value);
  },
  deleteSetting: async (key: string) => mocks.settings.delete(key),
}));

vi.mock("../tracking/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tracking/index.js")>()),
  track: mocks.track,
}));

vi.mock("../audit/org-admin.js", () => ({
  recordOrgAdminAuditEvent: mocks.recordAudit,
}));

vi.mock("./auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth.js")>()),
  getSession: async () => null,
}));

import type { AuthSession } from "./auth.js";
import {
  appendBuilderConnectToken,
  BUILDER_ACCOUNT_PROVISIONING_SECRET_ENV,
  BUILDER_CONNECT_PARAM,
  signBuilderProvisioningToken,
} from "./builder-browser.js";
import {
  createBuilderProvisionHandler,
  getBuilderConnectErrorKey,
  type BuilderOwnerContext,
} from "./core-routes-plugin.js";

const OWNER = "owner@example.com";
const SESSION_TOKEN = "session-token-example";
const ORIGIN = "https://app.example.com";
const PATH = "/_agent-native/builder/provision";
const PROVISIONED_CREDENTIALS = {
  credentials: {
    privateKey: "bpk-example-provisioned",
    publicKey: "space-example-provisioned",
    orgName: "Agent-Native Workspace",
  },
};

function session(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    email: OWNER,
    token: SESSION_TOKEN,
    emailVerified: true,
    name: "Owner",
    ...overrides,
  };
}

let owner: BuilderOwnerContext;
let upstream: ReturnType<typeof vi.fn>;

function provisionApp() {
  const app = createApp();
  app.use(
    PATH,
    createBuilderProvisionHandler(async () => owner),
  );
  return app;
}

function post(
  body: unknown,
  headers: Record<string, string> = {},
  query = "",
): Promise<Response> {
  return provisionApp().fetch(
    new Request(`${ORIGIN}${PATH}${query}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function upstreamAnswers(status: number, body: Record<string, unknown>) {
  upstream.mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
}

function trackedEvents(name: string) {
  return mocks.track.mock.calls
    .filter(([event]) => event === name)
    .map(([, properties]) => properties as Record<string, unknown>);
}

beforeEach(() => {
  owner = { email: OWNER, session: session(), anonymous: false };
  mocks.getOrgContext.mockReset();
  mocks.getOrgContext.mockResolvedValue({
    email: OWNER,
    orgId: null,
    role: null,
  });
  mocks.isRestricted.mockReset();
  mocks.isRestricted.mockResolvedValue(false);
  mocks.writeBuilderCredentials.mockReset();
  mocks.writeBuilderCredentials.mockResolvedValue({
    scope: "user",
    scopeId: OWNER,
  });
  mocks.settings.clear();
  mocks.track.mockReset();
  mocks.recordAudit.mockClear();
  vi.stubEnv(
    BUILDER_ACCOUNT_PROVISIONING_SECRET_ENV,
    "example-provisioning-secret-at-least-32-chars",
  );
  upstream = vi.fn();
  upstreamAnswers(200, PROVISIONED_CREDENTIALS);
  vi.stubGlobal("fetch", upstream);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("POST /builder/provision", () => {
  it("creates the account with one upstream call and stores its keys", async () => {
    mocks.settings.set("builder-disconnected", { at: 1 });
    mocks.settings.set(getBuilderConnectErrorKey(OWNER), { message: "old" });

    const response = await post(
      { provisioningToken: signBuilderProvisioningToken(OWNER, SESSION_TOKEN) },
      {},
      "?agentNativeFlow=connect_llm&agentNativeConnectSource=first_run",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, scope: "user" });
    expect(upstream).toHaveBeenCalledOnce();
    const [url, init] = upstream.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.builder.io/api/v1/accounts/agent-native",
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      email: OWNER,
      name: "Owner",
    });
    expect(mocks.writeBuilderCredentials).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({
        privateKey: "bpk-example-provisioned",
        publicKey: "space-example-provisioned",
      }),
      undefined,
    );
    expect(mocks.settings.has("builder-disconnected")).toBe(false);
    expect(mocks.settings.has(getBuilderConnectErrorKey(OWNER))).toBe(false);
    expect(trackedEvents("builder connect succeeded")).toEqual([
      expect.objectContaining({
        stage: "provision",
        credential_scope: "user",
        account_provisioned: true,
        agent_native_flow: "connect_llm",
        agent_native_connect_source: "first_run",
      }),
    ]);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "builder-connect",
        userEmail: OWNER,
        personal: true,
      }),
    );
  });

  it("answers an existing Builder account with account_exists", async () => {
    upstreamAnswers(409, { code: "account_exists", error: "exists" });

    const response = await post({
      provisioningToken: signBuilderProvisioningToken(OWNER, SESSION_TOKEN),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      code: "account_exists",
      message:
        "A Builder.io account already exists for this email. Sign in to Builder.io to use it.",
    });
    expect(mocks.writeBuilderCredentials).not.toHaveBeenCalled();
    expect(trackedEvents("builder connect failed")).toEqual([
      expect.objectContaining({ reason: "account_exists", stage: "provision" }),
    ]);
  });

  it("reports an upstream failure as provision_failed without storing anything", async () => {
    upstreamAnswers(500, { error: "boom" });

    const response = await post({
      provisioningToken: signBuilderProvisioningToken(OWNER, SESSION_TOKEN),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "provision_failed",
    });
    expect(mocks.writeBuilderCredentials).not.toHaveBeenCalled();
  });

  it("refuses an unverified email before calling Builder", async () => {
    owner = {
      email: OWNER,
      session: session({ emailVerified: false }),
      anonymous: false,
    };

    const response = await post({
      provisioningToken: signBuilderProvisioningToken(OWNER, SESSION_TOKEN),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "email_not_verified" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses a missing, forged, other-session, or expired provisioning token", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const expired = signBuilderProvisioningToken(OWNER, SESSION_TOKEN);
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);

    for (const body of [
      {},
      { provisioningToken: "not.a.real.token.value" },
      {
        provisioningToken: signBuilderProvisioningToken(
          OWNER,
          "another-session-token",
        ),
      },
      {
        provisioningToken: signBuilderProvisioningToken(
          "someone-else@example.com",
          SESSION_TOKEN,
        ),
      },
      { provisioningToken: expired },
    ]) {
      const response = await post(body);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        ok: false,
        code: "provision_token_invalid",
      });
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("answers 503 when this deployment cannot provision accounts", async () => {
    vi.stubEnv(BUILDER_ACCOUNT_PROVISIONING_SECRET_ENV, "");

    const response = await post({
      provisioningToken: signBuilderProvisioningToken(OWNER, SESSION_TOKEN),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "provision_not_configured",
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects a cross-site request unless it carries the owner's signed connect token", async () => {
    const provisioningToken = signBuilderProvisioningToken(
      OWNER,
      SESSION_TOKEN,
    );

    const crossSite = await post(
      { provisioningToken },
      { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
    );
    expect(crossSite.status).toBe(403);
    expect(await crossSite.json()).toMatchObject({ code: "cross_origin" });

    const foreignToken = new URL(
      appendBuilderConnectToken(`${ORIGIN}/x`, "someone-else@example.com"),
    ).searchParams.get(BUILDER_CONNECT_PARAM);
    const wrongOwner = await post(
      { provisioningToken, connectToken: foreignToken },
      { "sec-fetch-site": "cross-site" },
    );
    expect(wrongOwner.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();

    const ownerToken = new URL(
      appendBuilderConnectToken(`${ORIGIN}/x`, OWNER),
    ).searchParams.get(BUILDER_CONNECT_PARAM);
    const embedded = await post(
      { provisioningToken, connectToken: ownerToken },
      { "sec-fetch-site": "cross-site" },
    );
    expect(embedded.status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("only accepts a JSON POST, so a cross-site form cannot submit it", async () => {
    const provisioningToken = signBuilderProvisioningToken(
      OWNER,
      SESSION_TOKEN,
    );
    for (const contentType of [
      "application/x-www-form-urlencoded",
      "text/plain",
      "multipart/form-data; boundary=x",
    ]) {
      const response = await post(`provisioningToken=${provisioningToken}`, {
        "content-type": contentType,
      });
      expect(response.status).toBe(415);
    }

    const get = await provisionApp().fetch(new Request(`${ORIGIN}${PATH}`));
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");

    const malformed = await post("{not json");
    expect(malformed.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("requires a signed-in, non-anonymous owner", async () => {
    const provisioningToken = signBuilderProvisioningToken(
      OWNER,
      SESSION_TOKEN,
    );
    for (const context of [
      { email: undefined, session: null, anonymous: false },
      { email: "anon@example.com", session: null, anonymous: true },
    ] satisfies BuilderOwnerContext[]) {
      owner = context;
      const response = await post({ provisioningToken });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "unauthorized" });
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("checks the named connection before creating anything", async () => {
    mocks.getOrgContext.mockResolvedValue({
      email: OWNER,
      orgId: "org-123",
      role: "member",
    });

    const response = await post({
      provisioningToken: signBuilderProvisioningToken(OWNER, SESSION_TOKEN),
      scope: "org",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      code: "org_authorization_required",
      message:
        "Only an organization owner or admin can change the shared Builder connection.",
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses a scopeless member activation while personal keys are restricted", async () => {
    mocks.getOrgContext.mockResolvedValue({
      email: OWNER,
      orgId: "org-123",
      role: "member",
    });
    mocks.isRestricted.mockResolvedValue(true);

    const response = await post({
      provisioningToken: signBuilderProvisioningToken(OWNER, SESSION_TOKEN),
    });

    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects an unknown connection scope", async () => {
    const response = await post({
      provisioningToken: signBuilderProvisioningToken(OWNER, SESSION_TOKEN),
      scope: "workspace",
    });

    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
});
