import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExistsConcurrently: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

const AUTH_TABLES = ["user", "account", "session", "verification"];

function createMockApp() {
  return { use: vi.fn() };
}

function createJsonPostEvent(path: string, body: unknown) {
  const request = new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const headers = Object.fromEntries(request.headers.entries());
  return {
    req: request,
    url: new URL(`http://localhost${path}`),
    res: { headers: new Headers(), status: 200 },
    node: {
      req: {
        method: "POST",
        url: path,
        headers,
        socket: { remoteAddress: "127.0.0.1" },
      },
      res: { setHeader: vi.fn(), getHeader: vi.fn(), appendHeader: vi.fn() },
    },
    headers: request.headers,
    context: {},
    path,
  };
}

type ProbeResult = { rows: Array<{ table_name: string }> };

async function callBa(
  path: string,
  probe: () => Promise<ProbeResult>,
  status = 500,
) {
  vi.stubEnv("NODE_ENV", "production");
  delete process.env.ACCESS_TOKEN;
  delete process.env.ACCESS_TOKENS;
  const execute = vi.fn(async (query: { sql?: string } | string) =>
    typeof query !== "string" &&
    query.sql?.includes("information_schema.tables")
      ? probe()
      : { rows: [] },
  );
  vi.doMock("./better-auth-instance.js", () => ({
    getBetterAuth: vi.fn(async () => ({
      handler: vi.fn(async () => new Response("", { status })),
      api: {
        getSession: vi.fn(async () => null),
        signInEmail: vi.fn(),
        signUpEmail: vi.fn(),
        signOut: vi.fn(),
      },
    })),
    getBetterAuthSync: vi.fn(() => undefined),
    isDeployPreview: vi.fn(() => false),
  }));
  vi.doMock("../db/client.js", () => ({
    getDbExec: () => ({ execute }),
    getRefusedLocalDatabaseSource: () => null,
    isLocalDatabase: () => true,
    retryOnDdlRace: (fn: () => Promise<unknown>) => fn(),
    describeDbError: (error: unknown) => String(error),
  }));
  vi.doMock("./framework-request-handler.js", () => ({
    getH3App: (app: unknown) => app,
  }));
  const { autoMountAuth } = await import("./auth.js");
  const app = createMockApp();
  await autoMountAuth(app as never);
  const handler: unknown = app.use.mock.calls.find(
    (call: unknown[]) => call[0] === "/_agent-native/auth/ba",
  )?.[1];
  if (typeof handler !== "function")
    throw new Error("auth handler not mounted");
  const response = (await handler(
    createJsonPostEvent(`/_agent-native/auth/ba${path}`, {
      email: "person@example.test",
      password: "secret-password",
    }),
  )) as Response;
  return { response, execute };
}

function probeQueries(execute: { mock: { calls: unknown[][] } }) {
  return execute.mock.calls
    .map(([query]) => query as { sql?: string; args?: unknown[] })
    .filter((query) => query.sql?.includes("information_schema.tables"));
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("./better-auth-instance.js");
  vi.doUnmock("../db/client.js");
  vi.doUnmock("./framework-request-handler.js");
  vi.unstubAllEnvs();
});

describe("auth schema probe on a Better Auth 5xx", () => {
  it.each(["/sign-up/email", "/sign-in/email"])(
    "answers a typed 503 on %s when auth tables are missing",
    async (path) => {
      const { response, execute } = await callBa(path, async () => ({
        rows: [{ table_name: "account" }],
      }));
      expect(response.status).toBe(503);
      expect(response.headers.get("content-type")).toBe("application/json");
      const body = await response.json();
      expect(body.code).toBe("AUTH_SCHEMA_NOT_MIGRATED");
      expect(body.error).toBe(body.message);
      expect(body.message).toContain("temporarily unavailable");
      expect(probeQueries(execute)).toHaveLength(1);
    },
  );

  it("probes the four core auth tables with bound names", async () => {
    const { execute } = await callBa("/sign-up/email", async () => ({
      rows: [],
    }));
    const [probe] = probeQueries(execute);
    expect(probe.args).toEqual(AUTH_TABLES);
    expect(probe.sql).toContain("current_schema()");
  });

  it("keeps the original 5xx when every auth table exists", async () => {
    const { response } = await callBa("/sign-up/email", async () => ({
      rows: AUTH_TABLES.map((table_name) => ({ table_name })),
    }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("AUTH_SCHEMA_NOT_MIGRATED");
  });

  it("keeps the original 5xx when the catalog cannot be read", async () => {
    const { response } = await callBa("/sign-up/email", async () => {
      throw new Error("catalog unavailable");
    });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("AUTH_SCHEMA_NOT_MIGRATED");
  });

  it("does not probe a 4xx on an email route", async () => {
    const { response, execute } = await callBa(
      "/sign-up/email",
      async () => ({ rows: [] }),
      400,
    );
    expect(response.status).toBe(400);
    expect(probeQueries(execute)).toHaveLength(0);
  });

  it("does not probe a status just under 500 on an email route", async () => {
    const { execute } = await callBa(
      "/sign-in/email",
      async () => ({ rows: [] }),
      499,
    );
    expect(probeQueries(execute)).toHaveLength(0);
  });

  it("does not probe a 5xx on other auth routes", async () => {
    const { response, execute } = await callBa("/get-session", async () => ({
      rows: [],
    }));
    expect(response.status).toBe(500);
    expect(probeQueries(execute)).toHaveLength(0);
  });
});
