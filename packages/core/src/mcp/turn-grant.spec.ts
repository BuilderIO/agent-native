import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createApp, getRequestHeader, mockEvent } from "h3";
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
import { z } from "zod";

const browser = vi.hoisted(() => ({
  email: "viewer@example.test" as string | null,
}));
const getSettingMock = vi.hoisted(() =>
  vi.fn<() => Promise<Record<string, unknown> | null>>(async () => null),
);
vi.mock("../server/auth.js", async (original) => ({
  ...(await original<typeof import("../server/auth.js")>()),
  getBrowserCookieSession: async (
    event: Parameters<typeof getRequestHeader>[0],
  ) =>
    browser.email &&
    getRequestHeader(event, "cookie")?.includes("test-session=signed-in") &&
    !getRequestHeader(event, "authorization")
      ? { email: browser.email, orgId: null }
      : null,
}));
vi.mock("../server/better-auth-instance.js", async (original) => ({
  ...(await original<typeof import("../server/better-auth-instance.js")>()),
  getAuthSecret: () => "synthetic-turn-grant-auth-secret",
  findBetterAuthUserIdForEmail: async () => undefined,
}));
vi.mock("../deploy/route-discovery.js", async (original) => ({
  ...(await original<typeof import("../deploy/route-discovery.js")>()),
  getMissingDefaultPlugins: async () => [],
}));
vi.mock("../settings/store.js", async (original) => ({
  ...(await original<typeof import("../settings/store.js")>()),
  getSetting: getSettingMock,
}));
vi.mock("../extensions/url-safety.js", () => ({
  createSsrfSafeDispatcher: async () => undefined,
  isBlockedExtensionUrlWithDns: async () => false,
}));
vi.mock("../org/context.js", async (original) => ({
  ...(await original<typeof import("../org/context.js")>()),
  resolveOrgIdForEmail: async () => undefined,
  resolveOrgScopeForEmail: async () => ({ status: "personal" }),
}));

import { currentInvocationEvidence } from "../action-frame.js";
import {
  defineAction,
  reversibleWriteNeedsApproval,
  type ActionCaller,
} from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import { closeDbExec, getDbExec } from "../db/client.js";
import { coreActionLoaderEntries } from "../server/action-discovery.js";
import { mountActionRoutes } from "../server/action-routes.js";
import {
  markExplicitPersonalOrgScope,
  runWithRequestContext,
} from "../server/request-context.js";
import { signShortLivedToken } from "../server/short-lived-token.js";
import { ensureApprovalTable } from "./approval-store.js";
import { runWithMcpChatTurnCall } from "./chat-turn-scope.js";
import {
  admitMcpChatTurn,
  mintMcpChatTurn,
  mintMcpChatTurnMetadata,
  readMcpChatTurn,
  registerMcpChatTurnApps,
  resetMcpChatTurnAppsForTests,
} from "./chat-turn-store.js";
import {
  approveDeviceCode,
  consumeDeviceCode,
  createDeviceCode,
  MCP_CONNECT_OAUTH_CLIENT_ID,
  recordMintedToken,
} from "./connect-store.js";
import { signMcpOAuthAccessToken } from "./oauth-token.js";
import { handleMcpRequest } from "./server.js";
import {
  admitWithMcpTurnGrantAdmitters,
  clearMcpTurnGrantAdmittersForTests,
  MCP_TURN_GRANT_ADMITTER_TIMEOUT_MS,
  registerMcpTurnGrantAdmitter,
} from "./turn-grant-admitters.js";
import { actionUserTurn, isMcpTurnGrantAction } from "./turn-grant-scope.js";
import { mcpTurnGrantsStore, mintMcpTurnGrant } from "./turn-grant-store.js";

const ORIGIN = "https://app.example.test";
const OWNER = "viewer@example.test";
const APP = "planner";
let token: string;
let otherToken: string;
let ordinaryToken: string;

// A fake consumer app: what the run sees is the grant the call carried.
function probe(name: string) {
  return () => ({
    granted: isMcpTurnGrantAction(name),
    interactive: currentInvocationEvidence()?.providerInteractive === true,
  });
}
const actions: Record<string, ActionEntry> = {
  "list-items": defineAction({
    description: "Read items",
    mcpTool: true,
    readOnly: true,
    userTurn: "read",
    run: probe("list-items"),
  }),
  "update-item": defineAction({
    description: "Update an item",
    mcpTool: true,
    userTurn: "approval",
    needsApproval: true,
    schema: z.object({ title: z.string().default("Test") }),
    run: probe("update-item"),
  }),
  "send-item": defineAction({
    description: "Send an item",
    mcpTool: true,
    userTurn: "approval",
    requiresUserTurn: true,
    needsApproval: true,
    schema: z.object({ title: z.string().default("Test") }),
    run: probe("send-item"),
  }),
  "other-read": defineAction({
    description: "Read another resource",
    mcpTool: true,
    readOnly: true,
    run: probe("other-read"),
  }),
};

async function deviceToken(email: string) {
  const jti = randomUUID();
  const code = await createDeviceCode();
  await approveDeviceCode(code.userCode, email, null);
  await consumeDeviceCode(code.deviceCode, jti);
  await recordMintedToken({ jti, ownerEmail: email, orgId: null });
  return signMcpOAuthAccessToken({
    ownerEmail: email,
    orgId: null,
    clientId: MCP_CONNECT_OAUTH_CLIENT_ID,
    scope: "mcp:read mcp:write",
    resource: `${ORIGIN}/mcp`,
    issuer: ORIGIN,
    jti,
  });
}

beforeAll(async () => {
  vi.stubEnv("APP_URL", ORIGIN);
  vi.stubEnv("A2A_SECRET", "synthetic-turn-grant-deployment-secret");
  token = await deviceToken(OWNER);
  otherToken = await deviceToken("other@example.test");
  ordinaryToken = await signMcpOAuthAccessToken({
    ownerEmail: OWNER,
    orgId: null,
    clientId: "ordinary-oauth-client",
    scope: "mcp:read mcp:write",
    resource: `${ORIGIN}/mcp`,
    issuer: ORIGIN,
  });
  await ensureApprovalTable();
}, 120_000);
afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});
beforeEach(async () => {
  await getDbExec().execute("DELETE FROM mcp_action_approvals");
  browser.email = OWNER;
  getSettingMock.mockReset();
  getSettingMock.mockResolvedValue(null);
  resetAppConfigForTests();
  defineAppConfig({ app: { url: ORIGIN } });
  resetMcpChatTurnAppsForTests();
});
afterEach(() => {
  vi.useRealTimers();
});

async function mint(
  headers: Record<string, string> = {},
  caller?: ActionCaller,
) {
  const loader = coreActionLoaderEntries().find(
    ([name]) => name === "mint-turn-grant",
  );
  if (!loader) throw new Error("mint-turn-grant is not a core action");
  const app = createApp();
  mountActionRoutes(
    { h3: app },
    { "mint-turn-grant": (await loader[1]()).default },
    {
      appId: APP,
      ...(caller ? { caller } : {}),
      getOwnerFromEvent: async () => OWNER,
      resolveOrgId: async (event) => {
        markExplicitPersonalOrgScope(event);
        return undefined;
      },
    },
  );
  const capability = signShortLivedToken({
    resourceId: "ui-action",
    viewerEmail: OWNER,
  });
  return app.fetch(
    new Request(`${ORIGIN}/_agent-native/actions/mint-turn-grant?frontend=1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        "x-agent-native-frontend": "1",
        cookie: `test-session=signed-in; agent-native-ui-capability=${capability}`,
        ...headers,
      },
      body: "{}",
    }),
  );
}

async function seed(
  overrides: { owner?: string; app?: string; revoked?: number } = {},
) {
  const id = randomBytes(32).toString("base64url");
  const createdAt = Date.now();
  await getDbExec().execute({
    sql: "INSERT INTO mcp_turn_grants (grant_hash, owner_email, app_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [
      createHash("sha256").update(id).digest("hex"),
      overrides.owner ?? OWNER,
      overrides.app ?? APP,
      createdAt,
      createdAt + 9 * 60_000,
      overrides.revoked ?? null,
    ],
  });
  return id;
}

async function rpc(
  grant?: string,
  options: {
    bearer?: string;
    app?: string;
    name?: string;
    method?: string;
    args?: Record<string, unknown>;
    actions?: Record<string, ActionEntry>;
  } = {},
) {
  const event = mockEvent(`${ORIGIN}/`, {
    method: "POST",
    headers: {
      host: "app.example.test",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${options.bearer ?? token}`,
      ...(grant === undefined ? {} : { "x-agent-native-turn-grant": grant }),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: options.method ?? "tools/call",
      params: {
        name: options.name ?? "list-items",
        arguments: options.args ?? {},
      },
    }),
  });
  const response = await handleMcpRequest(event, {
    name: "Planner",
    appId: options.app ?? APP,
    actions: options.actions ?? actions,
  });
  if (!(response instanceof Response))
    throw new Error("MCP did not return a response");
  const text = await response.text();
  const data = text.startsWith("{")
    ? text
    : text
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6);
  if (!data) throw new Error(`Unreadable MCP response: ${text}`);
  return JSON.parse(data).result;
}

function seen(result: any): { granted: boolean; interactive: boolean } {
  expect(result).not.toMatchObject({ isError: true });
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}

it("rejects requiresUserTurn without an approval user turn", () => {
  expect(() =>
    defineAction({
      description: "Misdeclared",
      requiresUserTurn: true,
      userTurn: "read",
      run: () => null,
    }),
  ).toThrow(/requiresUserTurn/);
});

it("rejects an approval user turn that nothing would ask the person to approve", () => {
  expect(() =>
    defineAction({
      description: "Unattended write",
      userTurn: "approval",
      run: () => null,
    }),
  ).toThrow(/needsApproval \(not false\) or requiresUserTurn/);
  expect(() =>
    defineAction({
      description: "Opted-out write",
      userTurn: "approval",
      needsApproval: false,
      run: () => null,
    }),
  ).toThrow(/needsApproval \(not false\) or requiresUserTurn/);
});

it("a proven page mints an opaque grant and stores only its hash", async () => {
  const response = await mint();
  expect(response.status).toBe(200);
  const { grantId } = await response.json();
  expect(grantId).toMatch(/^[A-Za-z0-9_-]{22,256}$/);
  const { rows } = await getDbExec().execute({
    sql: "SELECT * FROM mcp_turn_grants WHERE grant_hash = ?",
    args: [createHash("sha256").update(grantId).digest("hex")],
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ owner_email: OWNER, app_id: APP });
  expect(JSON.stringify(rows)).not.toContain(grantId);
  expect(seen(await rpc(grantId))).toEqual({
    granted: true,
    interactive: true,
  });
});

it.each(["bearer", "cookie", "tool", "mcp", "cross-origin"])(
  "mint refuses %s",
  async (kind) => {
    if (kind === "cookie") browser.email = null;
    const response = await mint(
      kind === "bearer"
        ? { authorization: `Bearer ${token}` }
        : kind === "cross-origin"
          ? { "sec-fetch-site": "cross-site" }
          : {},
      kind === "tool" || kind === "mcp" ? kind : undefined,
    );
    expect(response.status).toBe(403);
  },
);

it("advertises only declared userTurn kinds in the tool listing", async () => {
  const result = await rpc(undefined, { method: "tools/list" });
  const kinds = Object.fromEntries(
    result.tools.map((tool: any) => [
      tool.name,
      tool._meta?.["agent-native/userTurn"],
    ]),
  );
  expect(kinds["list-items"]).toBe("read");
  expect(kinds["update-item"]).toBe("approval");
  expect(kinds["other-read"]).toBeUndefined();
});

it.each([
  "missing",
  "unknown",
  "expired",
  "revoked",
  "owner",
  "wrong-app-grant",
  "non-device",
  "a2a-context",
  "agent-run",
  "undeclared action",
])("does not grant the call when %s", async (kind) => {
  const grant =
    kind === "missing"
      ? undefined
      : kind === "unknown"
        ? randomBytes(32).toString("base64url")
        : await seed({
            ...(kind === "revoked" ? { revoked: Date.now() } : {}),
            ...(kind === "wrong-app-grant" ? { app: "another-app" } : {}),
          });
  if (kind === "expired") {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 9 * 60_000);
  }
  const call = () =>
    rpc(grant, {
      ...(kind === "owner"
        ? { bearer: otherToken }
        : kind === "non-device"
          ? { bearer: ordinaryToken }
          : {}),
      ...(kind === "undeclared action" ? { name: "other-read" } : {}),
    });
  const result =
    kind === "a2a-context"
      ? await runWithRequestContext({ a2aIdentityAssurance: "user" }, call)
      : kind === "agent-run"
        ? await runWithRequestContext({ run: { runId: "agent-run" } }, call)
        : await call();
  expect(seen(result)).toEqual({ granted: false, interactive: false });
});

it("a required user turn refuses a call without a grant", async () => {
  const result = await rpc(undefined, { name: "send-item" });
  expect(result).toMatchObject({ isError: true });
  expect(JSON.stringify(result)).toContain("requires a valid user-turn grant");
});

it("a granted approval write opens the app's own review page", async () => {
  for (const name of ["update-item", "send-item"]) {
    const result = await rpc(await seed(), { name });
    const text = JSON.stringify(result);
    expect(text).toMatch(
      /https:\/\/app\.example\.test\/mcp\/approvals\/[a-f0-9-]{36}/,
    );
    expect(text).not.toContain("/_agent-native/mcp/approvals/");
  }
});

it("an app without userTurn actions keeps today's approval flow", async () => {
  const plain: Record<string, ActionEntry> = {
    "update-item": defineAction({
      description: "Update an item",
      mcpTool: true,
      needsApproval: true,
      run: () => "updated",
    }),
  };
  const result = await rpc(await seed(), {
    name: "update-item",
    actions: plain,
  });
  expect(JSON.stringify(result)).not.toMatch(
    /app\.example\.test\/mcp\/approvals\//,
  );
});

it("ask_app mints a chat-turn proof only for a registered app", async () => {
  const identity = {
    userEmail: OWNER,
    orgDomain: undefined,
    orgId: null,
    identityAssurance: "user" as const,
  };
  const mintFor = (app: string) =>
    runWithMcpChatTurnCall(identity, "ask_app", false, () =>
      mintMcpChatTurn(app),
    );
  expect(await mintFor(APP)).toEqual({ status: "not-registered" });
  registerMcpChatTurnApps([APP]);
  const minted = await mintFor(APP);
  expect(minted).toMatchObject({
    status: "minted",
    claim: { owner: OWNER, appId: APP },
  });
  expect(await mintFor("another-app")).toEqual({ status: "not-registered" });
  expect(
    await runWithMcpChatTurnCall(identity, "list-items", false, () =>
      mintMcpChatTurn(APP),
    ),
  ).toMatchObject({ status: "refused", reason: "not-user-call" });
});

it("drops grants that expired more than a day ago when it mints a new one", async () => {
  await mcpTurnGrantsStore.ready();
  const db = getDbExec();
  const now = Date.now();
  const insert = (hash: string, expiresAt: number) =>
    db.execute({
      sql: "INSERT INTO mcp_turn_grants (grant_hash, owner_email, app_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      args: [hash, OWNER, APP, expiresAt - 1000, expiresAt],
    });
  await insert("stale-grant", now - 2 * 24 * 60 * 60_000);
  await insert("recent-grant", now - 60 * 60_000);
  await mintMcpTurnGrant(OWNER, APP);
  const { rows } = await db.execute({
    sql: "SELECT grant_hash FROM mcp_turn_grants WHERE grant_hash IN ('stale-grant', 'recent-grant')",
    args: [],
  });
  expect(rows.map((row) => (row as { grant_hash: string }).grant_hash)).toEqual(
    ["recent-grant"],
  );
});

it("keeps an admitted chat turn readable after its 120 s proof expired", async () => {
  const identity = {
    userEmail: OWNER,
    orgDomain: undefined,
    orgId: null,
    identityAssurance: "user" as const,
  };
  registerMcpChatTurnApps([APP]);
  const minted = await runWithMcpChatTurnCall(identity, "ask_app", false, () =>
    mintMcpChatTurn(APP),
  );
  if (minted.status !== "minted") throw new Error("expected a minted proof");
  const binding = {
    owner: OWNER,
    assurance: "user",
    appId: APP,
    taskId: "long-turn",
  };
  await admitMcpChatTurn(minted.claim, binding);
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(Date.now() + 5 * 60_000);
    expect(await readMcpChatTurn(binding)).toMatchObject({
      status: "admitted",
    });
    vi.setSystemTime(Date.now() + 10 * 60_000);
    expect(await readMcpChatTurn(binding)).toMatchObject({
      status: "refused",
      reason: "durable-invalid-or-expired",
    });
  } finally {
    vi.useRealTimers();
  }
});

it("sends an ordinary turn for a non-user caller but fails on a real mint refusal", async () => {
  registerMcpChatTurnApps([APP]);
  const asCaller = (assurance: "user" | "none", userEmail: string) =>
    runWithMcpChatTurnCall(
      {
        userEmail,
        orgDomain: undefined,
        orgId: null,
        identityAssurance: assurance,
      },
      "ask_app",
      false,
      () => mintMcpChatTurnMetadata(APP),
    );
  expect(await asCaller("user", OWNER)).toHaveProperty(
    "__agentNativeMcpChatTurn",
  );
  await expect(
    runWithMcpChatTurnCall(
      {
        userEmail: OWNER,
        orgDomain: undefined,
        orgId: null,
        identityAssurance: "user",
      },
      "list-items",
      false,
      () => mintMcpChatTurnMetadata(APP),
    ),
  ).resolves.toBeUndefined();
});

it("still mints a chat-turn proof under a tab-target run context, but not inside an agent run", async () => {
  registerMcpChatTurnApps([APP]);
  const identity = {
    userEmail: OWNER,
    orgDomain: undefined,
    orgId: null,
    identityAssurance: "user" as const,
  };
  const mintUnder = (run: Record<string, unknown>) =>
    runWithRequestContext({ userEmail: OWNER, run }, () =>
      runWithMcpChatTurnCall(identity, "ask_app", false, () =>
        mintMcpChatTurnMetadata(APP),
      ),
    );
  expect(
    await mintUnder({
      browserTabTarget: { resolve: async () => ({ kind: "unavailable" }) },
    }),
  ).toHaveProperty("__agentNativeMcpChatTurn");
  expect(await mintUnder({ runId: "run-1" })).toBeUndefined();
});

it("refuses further turn-grant mints once an owner has minted too many recently", async () => {
  const owner = "capped@example.test";
  for (let index = 0; index < 60; index += 1) {
    await mintMcpTurnGrant(owner, APP);
  }
  await expect(mintMcpTurnGrant(owner, APP)).rejects.toMatchObject({
    errorCode: "turn_grant_rate_limited",
    statusCode: 429,
  });
  await expect(mintMcpTurnGrant(OWNER, APP)).resolves.toHaveProperty("grantId");
});

describe("deployment turn grant admitters", () => {
  const external = "ext1.synthetic-grant";
  afterEach(() => clearMcpTurnGrantAdmittersForTests());

  it("leaves a grant the framework does not know refused when no admitter is registered", async () => {
    expect(seen(await rpc(external))).toEqual({
      granted: false,
      interactive: false,
    });
  });

  it("runs the call as the user's turn when an admitter admits the grant", async () => {
    const admit = vi.fn(() => ({
      status: "admitted" as const,
      expiresAt: Date.now() + 60_000,
      ownerEmail: OWNER,
      appId: APP,
    }));
    registerMcpTurnGrantAdmitter({ id: "external", admit });
    expect(seen(await rpc(external))).toEqual({
      granted: true,
      interactive: true,
    });
    expect(admit).toHaveBeenCalledWith({
      grant: external,
      appId: APP,
      actionName: "list-items",
      userTurn: "read",
      identity: expect.objectContaining({ userEmail: OWNER }),
    });
  });

  it("keeps the call outside the turn when the admitter refuses, passes, throws, or admits an expired, unbound or mismatched grant", async () => {
    const decisions = [
      () => ({ status: "refused" as const, reason: "call-cap" }),
      () => undefined,
      () => {
        throw new Error("store down");
      },
      () => ({
        status: "admitted" as const,
        expiresAt: Date.now() - 1,
        ownerEmail: OWNER,
        appId: APP,
      }),
      () => ({
        status: "admitted" as const,
        expiresAt: Date.now() + 60_000,
        ownerEmail: "someone-else@example.test",
        appId: APP,
      }),
      () => ({
        status: "admitted" as const,
        expiresAt: Date.now() + 60_000,
        ownerEmail: OWNER,
        appId: "another-app",
      }),
      () => ({ status: "admitted" as const, expiresAt: Date.now() + 60_000 }),
    ];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const admit of decisions) {
      clearMcpTurnGrantAdmittersForTests();
      registerMcpTurnGrantAdmitter({ id: "external", admit });
      expect(seen(await rpc(external))).toEqual({
        granted: false,
        interactive: false,
      });
    }
    error.mockRestore();
  });

  it("refuses a grant whose admitter never settles once the admitter deadline passes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      registerMcpTurnGrantAdmitter({
        id: "external",
        admit: () => new Promise<never>(() => {}),
      });
      const decision = admitWithMcpTurnGrantAdmitters({
        grant: external,
        appId: APP,
        actionName: "list-items",
        userTurn: "read",
        identity: undefined,
      });
      await vi.advanceTimersByTimeAsync(MCP_TURN_GRANT_ADMITTER_TIMEOUT_MS);
      await expect(decision).resolves.toEqual({
        status: "refused",
        reason: "admitter-timeout",
      });
    } finally {
      vi.useRealTimers();
      error.mockRestore();
    }
  });

  it("is not asked about a framework grant, an undeclared action, or an agent context", async () => {
    const admit = vi.fn(() => ({
      status: "admitted" as const,
      expiresAt: Date.now() + 60_000,
      ownerEmail: OWNER,
      appId: APP,
    }));
    registerMcpTurnGrantAdmitter({ id: "external", admit });
    expect(seen(await rpc(await seed()))).toEqual({
      granted: true,
      interactive: true,
    });
    expect(seen(await rpc(external, { name: "other-read" }))).toEqual({
      granted: false,
      interactive: false,
    });
    expect(
      seen(
        await runWithRequestContext({ a2aIdentityAssurance: "user" }, () =>
          rpc(external),
        ),
      ),
    ).toEqual({ granted: false, interactive: false });
    expect(admit).not.toHaveBeenCalled();
  });

  it("is not asked about a grant from a caller that is not a device-connected user", async () => {
    const admit = vi.fn(() => ({
      status: "admitted" as const,
      expiresAt: Date.now() + 60_000,
      ownerEmail: OWNER,
      appId: APP,
    }));
    registerMcpTurnGrantAdmitter({ id: "external", admit });
    expect(seen(await rpc(external, { bearer: ordinaryToken }))).toEqual({
      granted: false,
      interactive: false,
    });
    expect(admit).not.toHaveBeenCalled();
  });
});

describe("userTurn: direct", () => {
  let runs = 0;
  let gate: (args: { guests: string[] }) => unknown = (args) =>
    args.guests.length > 0;
  const directActions: Record<string, ActionEntry> = {
    "add-own-item": defineAction({
      description: "Add an item to the caller's own list",
      mcpTool: true,
      userTurn: "direct",
      schema: z.object({
        title: z.string().default("Test"),
        guests: z.array(z.string()).default([]),
      }),
      needsApproval: ((args: { guests: string[] }) => gate(args)) as never,
      run: () => {
        runs += 1;
        return probe("add-own-item")();
      },
    }),
  };
  const call = (
    grant: string | undefined,
    args: Record<string, unknown> = {},
  ) => rpc(grant, { name: "add-own-item", actions: directActions, args });
  const reviewLink =
    /https:\/\/app\.example\.test\/mcp\/approvals\/[a-f0-9-]{36}/;

  beforeEach(() => {
    runs = 0;
    gate = (args) => args.guests.length > 0;
  });

  it("rejects direct without a per-call needsApproval predicate", () => {
    for (const needsApproval of [undefined, true, false]) {
      expect(() =>
        defineAction({
          description: "Misdeclared",
          userTurn: "direct",
          ...(needsApproval === undefined ? {} : { needsApproval }),
          run: () => null,
        }),
      ).toThrow(/userTurn: "direct"/);
    }
  });

  it("advertises direct in the tool listing", async () => {
    const result = await rpc(undefined, {
      method: "tools/list",
      actions: directActions,
    });
    expect(result.tools[0]._meta["agent-native/userTurn"]).toBe("direct");
  });

  it("runs an admitted safe call immediately, with no review page", async () => {
    const result = await call(await seed());
    expect(seen(result)).toEqual({ granted: true, interactive: true });
    expect(JSON.stringify(result)).not.toMatch(/mcp\/approvals/);
    expect(runs).toBe(1);
  });

  it("still sends an admitted unsafe call to the review page", async () => {
    const result = await call(await seed(), { guests: ["a@example.test"] });
    expect(JSON.stringify(result)).toMatch(reviewLink);
    expect(runs).toBe(0);
  });

  it.each([
    ["returns a non-boolean", () => undefined],
    ["returns a truthy non-boolean", () => "yes"],
    [
      "throws",
      () => {
        throw new Error("state unreadable");
      },
    ],
    ["rejects", () => Promise.reject(new Error("state unreadable"))],
  ])("reviews an admitted call when the predicate %s", async (_kind, fn) => {
    gate = fn;
    const result = await call(await seed());
    expect(JSON.stringify(result)).toMatch(reviewLink);
    expect(runs).toBe(0);
  });

  it.each([
    "missing",
    "unknown",
    "expired",
    "revoked",
    "owner",
    "wrong-app-grant",
    "non-device",
    "a2a-context",
    "agent-run",
  ])("never runs a safe call when the grant is %s", async (kind) => {
    const grant =
      kind === "missing"
        ? undefined
        : kind === "unknown"
          ? randomBytes(32).toString("base64url")
          : await seed({
              ...(kind === "revoked" ? { revoked: Date.now() } : {}),
              ...(kind === "wrong-app-grant" ? { app: "another-app" } : {}),
            });
    if (kind === "expired") {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 9 * 60_000);
    }
    const send = () =>
      rpc(grant, {
        name: "add-own-item",
        actions: directActions,
        ...(kind === "owner"
          ? { bearer: otherToken }
          : kind === "non-device"
            ? { bearer: ordinaryToken }
            : {}),
      });
    const result =
      kind === "a2a-context"
        ? await runWithRequestContext({ a2aIdentityAssurance: "user" }, send)
        : kind === "agent-run"
          ? await runWithRequestContext({ run: { runId: "agent-run" } }, send)
          : await send();
    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).toContain(
      "requires a valid user-turn grant",
    );
    expect(runs).toBe(0);
  });

  it("keeps a grant from admitting a call after it is revoked", async () => {
    const grant = await seed();
    expect(seen(await call(grant))).toMatchObject({ granted: true });
    await getDbExec().execute({
      sql: "UPDATE mcp_turn_grants SET revoked_at = ? WHERE owner_email = ?",
      args: [Date.now(), OWNER],
    });
    expect(await call(grant)).toMatchObject({ isError: true });
    expect(runs).toBe(1);
  });

  it("refuses a direct call without a grant with its own message, and a required-turn call with the review-page one", async () => {
    const direct = JSON.stringify(await call(undefined));
    expect(direct).toContain("requires a valid user-turn grant.");
    expect(direct).not.toContain("review page");
    const required = JSON.stringify(
      await rpc(undefined, { name: "send-item" }),
    );
    expect(required).toContain("approval on its review page");
  });

  it("still reviews an approval write whose predicate says false", async () => {
    let ran = 0;
    const approval: Record<string, ActionEntry> = {
      "update-item": defineAction({
        description: "Update an item",
        mcpTool: true,
        userTurn: "approval",
        needsApproval: (() => false) as never,
        run: () => {
          ran += 1;
          return null;
        },
      }),
    };
    const result = await rpc(await seed(), {
      name: "update-item",
      actions: approval,
    });
    expect(JSON.stringify(result)).toMatch(reviewLink);
    expect(ran).toBe(0);
  });

  it("skips review for direct and approval-only MCP calls when no-approvals is on, and still reviews when off or unreadable", async () => {
    getSettingMock.mockResolvedValue({ enabled: true });
    const directOn = await call(await seed(), {
      guests: ["a@example.test"],
    });
    expect(seen(directOn)).toEqual({ granted: true, interactive: true });
    expect(JSON.stringify(directOn)).not.toMatch(/mcp\/approvals/);
    expect(runs).toBe(1);

    for (const name of ["update-item", "send-item"]) {
      const approvalOn = await rpc(await seed(), { name });
      expect(seen(approvalOn)).toEqual({ granted: true, interactive: true });
      expect(JSON.stringify(approvalOn)).not.toMatch(/mcp\/approvals/);
    }

    getSettingMock.mockResolvedValue({ enabled: false });
    const directOff = await call(await seed(), {
      guests: ["a@example.test"],
    });
    expect(JSON.stringify(directOff)).toMatch(reviewLink);
    expect(runs).toBe(1);

    for (const name of ["update-item", "send-item"]) {
      const approvalOff = await rpc(await seed(), { name });
      expect(JSON.stringify(approvalOff)).toMatch(reviewLink);
    }

    getSettingMock.mockRejectedValue(new Error("settings unreadable"));
    const directUnreadable = await call(await seed(), {
      guests: ["a@example.test"],
    });
    expect(JSON.stringify(directUnreadable)).toMatch(reviewLink);
    expect(runs).toBe(1);

    const approvalUnreadable = await rpc(await seed(), {
      name: "update-item",
    });
    expect(JSON.stringify(approvalUnreadable)).toMatch(reviewLink);
  });
});

it("reads a declared user turn and nothing from a missing or unknown entry", () => {
  expect(actionUserTurn(undefined)).toBeUndefined();
  expect(actionUserTurn({ userTurn: "grant" })).toBeUndefined();
  expect(actionUserTurn({ userTurn: "direct" })).toBe("direct");
});

describe("reversible-write policy over MCP", () => {
  let runs = 0;
  const reversibleActions: Record<string, ActionEntry> = {
    "save-draft": defineAction({
      description: "Save a reversible draft",
      mcpTool: true,
      userTurn: "direct",
      schema: z.object({ title: z.string().default("Draft") }),
      needsApproval: reversibleWriteNeedsApproval,
      run: () => {
        runs += 1;
        return probe("save-draft")();
      },
    }),
  };

  beforeEach(() => {
    runs = 0;
  });

  it("runs without approval at the default setting (no-approvals unset) and when no-approvals is on", async () => {
    getSettingMock.mockResolvedValue(null);
    const defaultResult = await rpc(await seed(), {
      name: "save-draft",
      actions: reversibleActions,
    });
    expect(seen(defaultResult)).toEqual({ granted: true, interactive: true });
    expect(JSON.stringify(defaultResult)).not.toMatch(/mcp\/approvals/);
    expect(runs).toBe(1);

    getSettingMock.mockResolvedValue({ enabled: true });
    const onResult = await rpc(await seed(), {
      name: "save-draft",
      actions: reversibleActions,
    });
    expect(seen(onResult)).toEqual({ granted: true, interactive: true });
    expect(runs).toBe(2);
  });

  it("asks inline in an MCP form when approvals are explicitly on, and never emits a review-page link", async () => {
    getSettingMock.mockResolvedValue({ enabled: false });

    const noFormResult = await rpc(await seed(), {
      name: "save-draft",
      actions: reversibleActions,
    });
    expect(noFormResult).toMatchObject({ isError: true });
    expect(JSON.stringify(noFormResult)).not.toMatch(/mcp\/approvals/);
    expect(
      noFormResult?._meta?.["agent-native/approvalReview"],
    ).toBeUndefined();
    expect(runs).toBe(0);

    const { Client, StreamableHTTPClientTransport } =
      await import("@modelcontextprotocol/client");
    const grant = await seed();
    const elicitRequests: Array<Record<string, unknown>> = [];
    const transport = new StreamableHTTPClientTransport(
      new URL(`${ORIGIN}/mcp`),
      {
        requestInit: {
          headers: {
            authorization: `Bearer ${token}`,
            "x-agent-native-turn-grant": grant,
          },
        },
        fetch: async (input, init) => {
          const request = new Request(input, init);
          const body =
            request.method === "POST"
              ? await request.clone().text()
              : undefined;
          const event = mockEvent(`${ORIGIN}/`, {
            method: request.method,
            headers: {
              host: "app.example.test",
              ...Object.fromEntries(request.headers),
            },
            ...(body === undefined ? {} : { body }),
          });
          const response = await handleMcpRequest(event, {
            name: "Planner",
            appId: APP,
            actions: reversibleActions,
          });
          if (!(response instanceof Response)) {
            throw new Error("MCP did not return a response");
          }
          return response;
        },
      },
    );
    const client = new Client(
      { name: "form-client", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    client.registerCapabilities({
      elicitation: { form: {}, url: {} },
    } as never);
    client.setRequestHandler(
      "elicitation/create",
      async (req: { params: Record<string, unknown> }) => {
        elicitRequests.push(req.params);
        return {
          action: "accept" as const,
          content: { decision: "approve" },
        };
      },
    );
    await client.connect(transport);
    try {
      const approved = await client.callTool({
        name: "save-draft",
        arguments: { title: "Long draft ".repeat(40) },
      });
      expect(elicitRequests).toHaveLength(1);
      expect(elicitRequests[0]?.mode).not.toBe("url");
      expect(elicitRequests[0]?.requestedSchema).toMatchObject({
        type: "object",
        properties: {
          decision: { enum: ["approve", "deny"] },
        },
      });
      expect(JSON.stringify(elicitRequests[0])).not.toMatch(/mcp\/approvals/);
      expect(JSON.stringify(approved)).not.toMatch(/mcp\/approvals/);
      expect(runs).toBe(1);
    } finally {
      await client.close();
    }
  });
});
