import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// NEED 4958: a fresh *synthetic loopback dev* session has no org, and the
// read-only session resolver never creates one. Better Auth's normal auto-dev
// signup does NOT verify the email, so the org initializer must key off the
// synthetic dev identity, not `emailVerified`. This spec drives the real guard
// with the reviewed rules: initialize the policy-controlled default org before
// the unchanged app-access check, deny protected paths when initialization
// fails even if an unbound-owner ACL would permit, and keep the null
// org-recovery exemption. Uses the same lightweight module doubles as
// auth.additional-session.spec.ts so it runs in the mutation sandbox.

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExistsConcurrently: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

function createMockApp(): any {
  return { use: vi.fn() };
}

function createMockEvent(opts: {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  context?: Record<string, unknown>;
}): any {
  const method = opts.method ?? "GET";
  const headers = { host: "localhost:3000", ...(opts.headers ?? {}) };
  const requestHeaders = new Headers(headers);
  return {
    req: {
      method,
      url: `http://localhost:3000${opts.path}`,
      headers: requestHeaders,
    },
    url: new URL(`http://localhost:3000${opts.path}`),
    res: { headers: new Headers(), status: 200 },
    node: {
      req: {
        method,
        url: opts.path,
        headers,
        socket: { remoteAddress: "127.0.0.1" },
      },
      res: { setHeader: vi.fn(), getHeader: vi.fn(), appendHeader: vi.fn() },
    },
    headers: requestHeaders,
    context: { ...(opts.context ?? {}) },
    path: opts.path,
  };
}

type Guard = (event: any) => Promise<unknown>;

function mockModules(opts: {
  checkAppAccess: ReturnType<typeof vi.fn>;
  getOrgContext: ReturnType<typeof vi.fn>;
}) {
  vi.doMock("./better-auth-instance.js", () => ({
    getBetterAuth: vi.fn(async () => ({
      handler: vi.fn(async () => new Response("{}")),
      api: {
        getSession: vi.fn(async () => null),
        signInEmail: vi.fn(),
        signInMagicLink: vi.fn(),
        signUpEmail: vi.fn(),
        signOut: vi.fn(),
      },
    })),
    getBetterAuthSync: vi.fn(() => undefined),
    isDeployPreview: vi.fn(() => false),
  }));
  vi.doMock("../db/client.js", () => ({
    getDbExec: () => {
      const execute = vi.fn(async () => ({ rows: [] }));
      return {
        execute,
        transaction: async (
          run: (tx: { execute: typeof execute }) => unknown,
        ) => run({ execute }),
      };
    },
    getRefusedLocalDatabaseSource: () => null,
    isLocalDatabase: () => true,
    retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
    describeDbError: (error: unknown) => String(error),
  }));
  vi.doMock("./framework-request-handler.js", () => ({
    getH3App: (app: any) => app,
  }));
  vi.doMock("../org/workspace-app-access.js", () => ({
    checkWorkspaceAppAccess: opts.checkAppAccess,
    WORKSPACE_APP_ACCESS_UNAVAILABLE: "unavailable",
    WORKSPACE_APP_ACCESS_UNAVAILABLE_MESSAGE:
      "Workspace app access is temporarily unavailable.",
  }));
  vi.doMock("../org/context.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../org/context.js")>()),
    getOrgContext: opts.getOrgContext,
    resolveOrgIdForEmailViaEvent: vi.fn(async () => null),
  }));
  // The mock event cannot expose a real socket peer, so pin the loopback check.
  vi.doMock("./loopback.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./loopback.js")>()),
    isLoopbackRequest: () => true,
  }));
}

async function mountGuard(opts: {
  session: Record<string, unknown>;
  checkAppAccess: ReturnType<typeof vi.fn>;
  getOrgContext: ReturnType<typeof vi.fn>;
}): Promise<Guard> {
  mockModules(opts);
  const { autoMountAuth } = await import("./auth.js");
  const app = createMockApp();
  await autoMountAuth(app, { getSession: async () => opts.session });
  const guard = app.use.mock.calls
    .map((call: any[]) => call[0])
    .find((arg: unknown) => typeof arg === "function");
  expect(guard).toBeTypeOf("function");
  return guard as Guard;
}

async function withDevApp(access: Record<string, unknown> = {}) {
  vi.stubEnv("NODE_ENV", "development");
  delete process.env.AUTH_DISABLED;
  delete process.env.CONTEXT;
  delete process.env.AGENT_NATIVE_BUILD_DEPLOY_CONTEXT;
  delete process.env.AGENT_NATIVE_DISABLE_AUTO_DEV_ACCOUNT;
  const { defineAppConfig } = await import("../app-config/index.js");
  defineAppConfig({
    app: { id: "content", workspaceId: "content" },
    access: {
      orgCreation: "open",
      autoCreateDefaultOrg: true,
      ...access,
    } as never,
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("./better-auth-instance.js");
  vi.doUnmock("../db/client.js");
  vi.doUnmock("./framework-request-handler.js");
  vi.doUnmock("../org/workspace-app-access.js");
  vi.doUnmock("../org/context.js");
  vi.doUnmock("./loopback.js");
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("loopback dev org initialization before the app-access guard", () => {
  it("creates the default org before access for an unverified synthetic dev session", async () => {
    await withDevApp();
    const checkAppAccess = vi.fn(
      async (_appId: string, args: { orgId?: string }) =>
        args.orgId === "org-1",
    );
    const getOrgContext = vi.fn(async () => ({ orgId: "org-1" }));
    const guard = await mountGuard({
      // Better Auth's auto-dev signup does NOT verify the email.
      session: { email: "dev@local.test", emailVerified: false },
      checkAppAccess,
      getOrgContext,
    });
    const event = createMockEvent({ path: "/_agent-native/actions/list" });
    await expect(guard(event)).resolves.toBeUndefined();
    expect(getOrgContext).toHaveBeenCalledTimes(1);
    expect(checkAppAccess).toHaveBeenCalledWith("content", {
      email: "dev@local.test",
      orgId: "org-1",
    });
  });

  it("denies when initialization fails even though an unbound-owner ACL permits", async () => {
    await withDevApp();
    // The owner ACL would grant the request; a failed init must still deny.
    const checkAppAccess = vi.fn(async () => true);
    const getOrgContext = vi.fn(async () => {
      throw new Error("no default org");
    });
    const guard = await mountGuard({
      session: { email: "dev@local.test", emailVerified: false },
      checkAppAccess,
      getOrgContext,
    });
    const event = createMockEvent({ path: "/_agent-native/actions/list" });
    await expect(guard(event)).resolves.toEqual({
      error: "You do not have access to this workspace app.",
    });
    expect(event.res.status).toBe(403);
    expect(checkAppAccess).toHaveBeenCalledWith("content", {
      email: "dev@local.test",
    });
  });

  it("denies when the initializer yields no org id", async () => {
    await withDevApp();
    const checkAppAccess = vi.fn(async () => true);
    const getOrgContext = vi.fn(async () => ({}));
    const guard = await mountGuard({
      session: { email: "dev@local.test", emailVerified: false },
      checkAppAccess,
      getOrgContext,
    });
    const event = createMockEvent({ path: "/_agent-native/actions/list" });
    await expect(guard(event)).resolves.toEqual({
      error: "You do not have access to this workspace app.",
    });
    expect(getOrgContext).toHaveBeenCalledTimes(1);
    expect(checkAppAccess).toHaveBeenCalledWith("content", {
      email: "dev@local.test",
    });
  });

  it("keeps the null org-recovery exemption reachable", async () => {
    await withDevApp();
    const checkAppAccess = vi.fn(async () => true);
    const getOrgContext = vi.fn(async () => {
      throw new Error("no default org");
    });
    const guard = await mountGuard({
      session: { email: "dev@local.test", emailVerified: false },
      checkAppAccess,
      getOrgContext,
    });
    const event = createMockEvent({ path: "/_agent-native/org/me" });
    await expect(guard(event)).resolves.toBeUndefined();
    expect(checkAppAccess).not.toHaveBeenCalled();
  });

  it("does not initialize outside a dev environment", async () => {
    await withDevApp();
    vi.stubEnv("NODE_ENV", "production");
    const checkAppAccess = vi.fn(async () => false);
    const getOrgContext = vi.fn(async () => ({ orgId: "org-1" }));
    const guard = await mountGuard({
      session: { email: "dev@local.test", emailVerified: false },
      checkAppAccess,
      getOrgContext,
    });
    const event = createMockEvent({ path: "/_agent-native/actions/list" });
    await expect(guard(event)).resolves.toEqual({
      error: "You do not have access to this workspace app.",
    });
    expect(getOrgContext).not.toHaveBeenCalled();
  });

  it("skips initialization when the session already carries an org", async () => {
    await withDevApp();
    const checkAppAccess = vi.fn(async () => true);
    const getOrgContext = vi.fn(async () => ({ orgId: "new-org" }));
    const guard = await mountGuard({
      session: {
        email: "dev@local.test",
        emailVerified: false,
        orgId: "org-9",
      },
      checkAppAccess,
      getOrgContext,
    });
    const event = createMockEvent({ path: "/_agent-native/actions/list" });
    await expect(guard(event)).resolves.toBeUndefined();
    expect(getOrgContext).not.toHaveBeenCalled();
    expect(checkAppAccess).toHaveBeenCalledWith("content", {
      email: "dev@local.test",
      orgId: "org-9",
    });
  });

  it("skips initialization for an explicit personal org scope", async () => {
    await withDevApp();
    const checkAppAccess = vi.fn(async () => false);
    const getOrgContext = vi.fn(async () => ({ orgId: "org-1" }));
    const guard = await mountGuard({
      session: { email: "dev@local.test", emailVerified: false },
      checkAppAccess,
      getOrgContext,
    });
    const event = createMockEvent({
      path: "/_agent-native/actions/list",
      context: { __anExplicitPersonalOrgScope: true },
    });
    await expect(guard(event)).resolves.toEqual({
      error: "You do not have access to this workspace app.",
    });
    expect(getOrgContext).not.toHaveBeenCalled();
  });

  it("skips initialization for a Builder-preview host", async () => {
    await withDevApp();
    const checkAppAccess = vi.fn(async () => false);
    const getOrgContext = vi.fn(async () => ({ orgId: "org-1" }));
    const guard = await mountGuard({
      session: { email: "dev@local.test", emailVerified: false },
      checkAppAccess,
      getOrgContext,
    });
    const event = createMockEvent({
      path: "/_agent-native/actions/list",
      headers: { host: "preview.builder.codes" },
    });
    await expect(guard(event)).resolves.toEqual({
      error: "You do not have access to this workspace app.",
    });
    expect(getOrgContext).not.toHaveBeenCalled();
  });

  it("skips initialization when default org creation is disabled", async () => {
    await withDevApp({ autoCreateDefaultOrg: false });
    const checkAppAccess = vi.fn(async () => false);
    const getOrgContext = vi.fn(async () => ({ orgId: "org-1" }));
    const guard = await mountGuard({
      session: { email: "dev@local.test", emailVerified: false },
      checkAppAccess,
      getOrgContext,
    });
    const event = createMockEvent({ path: "/_agent-native/actions/list" });
    await expect(guard(event)).resolves.toEqual({
      error: "You do not have access to this workspace app.",
    });
    expect(getOrgContext).not.toHaveBeenCalled();
  });

  it("skips initialization when org creation is closed", async () => {
    await withDevApp({ orgCreation: "closed" });
    const checkAppAccess = vi.fn(async () => false);
    const getOrgContext = vi.fn(async () => ({ orgId: "org-1" }));
    const guard = await mountGuard({
      session: { email: "dev@local.test", emailVerified: false },
      checkAppAccess,
      getOrgContext,
    });
    const event = createMockEvent({ path: "/_agent-native/actions/list" });
    await expect(guard(event)).resolves.toEqual({
      error: "You do not have access to this workspace app.",
    });
    expect(getOrgContext).not.toHaveBeenCalled();
  });

  it("does not initialize for a real (non-synthetic) account", async () => {
    await withDevApp();
    const checkAppAccess = vi.fn(async () => false);
    const getOrgContext = vi.fn(async () => ({ orgId: "org-1" }));
    const guard = await mountGuard({
      session: { email: "member@example.com", emailVerified: false },
      checkAppAccess,
      getOrgContext,
    });
    const event = createMockEvent({ path: "/_agent-native/actions/list" });
    await expect(guard(event)).resolves.toEqual({
      error: "You do not have access to this workspace app.",
    });
    expect(getOrgContext).not.toHaveBeenCalled();
  });
});
