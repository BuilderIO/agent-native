import { H3Event } from "h3";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  member: true,
  unavailable: false,
  revoked: false,
}));
vi.mock("../org/membership.js", () => ({
  isOrgMember: vi.fn(async () => {
    if (state.unavailable) throw new Error("membership unavailable");
    return state.member;
  }),
}));
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({
    execute: async () => ({
      rows: state.revoked ? [{ revoked_before: Date.now() }] : [],
    }),
  }),
}));
vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: async () => {},
  ensureTableExists: async () => {},
}));
import {
  resolveEmbedSessionFromRequest,
  signEmbedSessionToken,
  verifyEmbedSessionToken,
} from "./embed-session.js";

const env = { ...process.env };
const scope = "capability:workspace-app-chat";
beforeEach(() => {
  process.env.OAUTH_STATE_SECRET = "chat-capability-test-secret";
  process.env.APP_BASE_PATH = "/test-app";
  delete process.env.VITE_APP_BASE_PATH;
  Object.assign(state, { member: true, unavailable: false, revoked: false });
});
afterEach(() => {
  process.env = { ...env };
});
function token(overrides = {}) {
  return signEmbedSessionToken({
    ownerEmail: "owner@example.com",
    orgId: "workspace",
    targetPath: "/",
    audienceHost: "https://apps.example.test",
    scope,
    ticketCreatedAtMs: Date.now() - 1000,
    ttlSeconds: 600,
    ...overrides,
  });
}
function resolve(
  path: string,
  method = "GET",
  credential = token(),
  origin = "https://apps.example.test",
) {
  return resolveEmbedSessionFromRequest(
    new H3Event(
      new Request(`${origin}${path}`, {
        method,
        headers: { authorization: `Bearer ${credential}` },
      }),
    ),
  );
}
it.each([
  ["/mode", "GET"],
  ["/threads", "GET"],
  ["/threads", "POST"],
  ["", "POST"],
  ["/runs/active", "GET"],
  ["/runs/run-one/events", "GET"],
])("authenticates the explicit chat caller %s %s", async (path, method) => {
  expect(
    await resolve(`/test-app/_agent-native/agent-chat${path}`, method),
  ).toMatchObject({ email: "owner@example.com", orgId: "workspace", scope });
});
it.each([
  ["/_agent-native/actions/query", "POST"],
  ["/_agent-native/webmcp/actions/query", "POST"],
  ["/_agent-native/sql", "POST"],
  ["/_agent-native/auth/session", "GET"],
  ["/_agent-native/agent-chat/save-key", "POST"],
  ["/_agent-native/agent-chat/mode", "POST"],
  ["/_agent-native/agent-chat/_process-run", "POST"],
  ["/_agent-native/agent-chat/threads/thread-one/share", "POST"],
  ["/", "GET"],
  ["/assets/main.js", "GET"],
  ["/_agent-native/agent-chat/unknown", "GET"],
])("denies non-chat authority %s %s", async (path, method) => {
  expect(await resolve(`/test-app${path}`, method)).toBeNull();
});
it("keeps document tokens out of chat", async () => {
  expect(
    await resolve(
      "/test-app/_agent-native/agent-chat/mode",
      "GET",
      token({ scope: "minimal" }),
    ),
  ).toBeNull();
});
it("binds the origin and mount", async () => {
  expect(
    await resolve(
      "/test-app/_agent-native/agent-chat/mode",
      "GET",
      token(),
      "https://other.example.test",
    ),
  ).toBeNull();
  expect(await resolve("/other-app/_agent-native/agent-chat/mode")).toBeNull();
});
it("rejects expiry and owner revocation", async () => {
  vi.useFakeTimers();
  const expired = token({ ttlSeconds: 1 });
  vi.advanceTimersByTime(2000);
  expect(
    await resolve("/test-app/_agent-native/agent-chat/mode", "GET", expired),
  ).toBeNull();
  vi.useRealTimers();
  state.revoked = true;
  expect(await resolve("/test-app/_agent-native/agent-chat/mode")).toBeNull();
});
it("checks current membership and fails closed on lookup errors", async () => {
  state.member = false;
  expect(await resolve("/test-app/_agent-native/agent-chat/mode")).toBeNull();
  state.unavailable = true;
  expect(await resolve("/test-app/_agent-native/agent-chat/mode")).toBeNull();
});

it("retains personal authority through getSession and run scope without org backfill", async () => {
  const { getSession } = await import("./auth.js");
  const { resolveAgentRunOrgScope } = await import("./agent-run-context.js");
  const credential = token({ orgId: undefined });
  const event = new H3Event(
    new Request(
      "https://apps.example.test/test-app/_agent-native/agent-chat/mode",
      { headers: { authorization: `Bearer ${credential}` } },
    ),
  );
  const session = await getSession(event);
  expect(session?.email).toBe("owner@example.com");
  expect(session?.orgScope).toBe("personal");
  expect(session?.orgId).toBeUndefined();
  expect(
    await resolveAgentRunOrgScope({
      event,
      ownerContext: { owner: "owner@example.com", anonymous: false },
      resolveOrgId: async () => "unrelated-workspace",
    }),
  ).toEqual({ orgScope: "personal" });
});
it("does not fall back to an ambient custom session after rejecting chat authority", async () => {
  const { getSession, autoMountAuth } = await import("./auth.js");
  const app = { use() {} } as any;
  await autoMountAuth(app, {
    getSession: async () => ({
      email: "other@example.com",
      orgId: "other-workspace",
    }),
  });
  state.member = false;
  const event = new H3Event(
    new Request(
      "https://apps.example.test/test-app/_agent-native/agent-chat/mode",
      {
        headers: {
          authorization: `Bearer ${token()}`,
          cookie: "ambient-session=other-user",
        },
      },
    ),
  );
  expect(await getSession(event)).toBeNull();
});

it("rejects a tampered chat envelope without using an ambient custom identity", async () => {
  const { getSession, autoMountAuth } = await import("./auth.js");
  await autoMountAuth({ use() {} } as any, {
    getSession: async () => ({
      email: "other@example.com",
      orgId: "other-workspace",
    }),
  });
  const payload = token().split(".")[0];
  const event = new H3Event(
    new Request(
      "https://apps.example.test/test-app/_agent-native/agent-chat/mode",
      {
        headers: {
          authorization: `Bearer ${payload}.invalid-signature`,
          cookie: "ambient-session=other-user",
        },
      },
    ),
  );
  expect(await getSession(event)).toBeNull();
});

it("does not allow a chat credential to mint another stream credential", async () => {
  expect(
    await resolve("/test-app/_agent-native/agent-chat/stream-token"),
  ).toBeNull();
});
it.each([
  "/test-app/_agent-native/agent-chat//mode",
  "/test-app/_agent-native/agent-chat/mode/",
  "/test-app/_agent-native/Agent-Chat/mode",
  "/test-app//_agent-native/agent-chat/mode",
  "/test-app/_agent-native/agent-chat/%2emode",
  "/test-app/_agent-native/agent-chat/%2fmode",
])("rejects noncanonical paths %s", async (path) => {
  expect(await resolve(path)).toBeNull();
});
it("uses and validates the framework mounted pathname", async () => {
  const event = new H3Event(
    new Request("https://apps.example.test/mode", {
      headers: { authorization: `Bearer ${token()}` },
    }),
  );
  event.context._mountedPathname = "/test-app/_agent-native/agent-chat/mode";
  expect(await resolveEmbedSessionFromRequest(event)).toMatchObject({ scope });
  for (const path of [
    "/other-app/_agent-native/agent-chat/mode",
    "/test-app/../_agent-native/agent-chat/mode",
    "/test-app/%2e/_agent-native/agent-chat/mode",
    "/test-app//_agent-native/agent-chat/mode",
  ]) {
    event.context._mountedPathname = path;
    expect(await resolveEmbedSessionFromRequest(event)).toBeNull();
  }
});

it("runs the real dedicated MCP mint through bearer authentication with its original revocation anchor", async () => {
  const { getBuiltinCrossAppTools } = await import("../mcp/builtin-tools.js");
  const { runWithRequestContext } = await import("./request-context.js");
  const anchor = Date.now() - 1000;
  const tools = getBuiltinCrossAppTools(
    { name: "Test", actions: {} },
    { inlineMcpApps: true },
    {
      userEmail: "owner@example.com",
      identityAssurance: "user",
      orgId: "workspace",
      firstPartyMcp: true,
      workspaceAppChatIssuedAtMs: anchor,
    },
  );
  const mint = () =>
    runWithRequestContext(
      {
        userEmail: "owner@example.com",
        orgId: "workspace",
        requestOrigin: "https://apps.example.test",
      },
      () =>
        tools.create_embed_session!.run({
          path: "/",
          runtime: "workspace-app-chat",
        }),
    );
  const result = await mint();
  expect(result).not.toHaveProperty("startUrl");
  expect(result.runtime).toBe("workspace-app-chat");
  const claims = verifyEmbedSessionToken(result.token);
  expect(claims.ok).toBe(true);
  if (!claims.ok) throw Error("mint returned invalid authority");
  expect(claims.claims.ticketCreatedAtMs).toBe(anchor);
  expect(claims.claims.exp * 1000).toBe(result.expiresAt);
  expect(claims.claims.exp - claims.claims.iat).toBe(900);
  expect(
    await resolve(
      "/test-app/_agent-native/agent-chat/mode",
      "GET",
      result.token,
    ),
  ).toMatchObject({ email: "owner@example.com", orgId: "workspace", scope });
  state.revoked = true;
  expect(
    await resolve(
      "/test-app/_agent-native/agent-chat/mode",
      "GET",
      result.token,
    ),
  ).toBeNull();
  await expect(mint()).rejects.toThrow(/revoked or expired/);
});
