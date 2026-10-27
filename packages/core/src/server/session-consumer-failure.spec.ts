import { H3, type H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  signedIn: true,
  membershipFailure: undefined as unknown,
  execute: vi.fn(),
  listNotifications: vi.fn(async () => []),
  listRuns: vi.fn(async () => []),
  writeSecret: vi.fn(async () => "fake-secret-id"),
}));

vi.mock("./better-auth-instance.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./better-auth-instance.js")>()),
  getBetterAuthSync: () => ({
    api: {
      getSession: async () =>
        fixture.signedIn
          ? {
              user: { id: "fake-user", email: "member@example.test" },
              session: { token: "fake-session" },
            }
          : null,
    },
  }),
  resumeIdentityRekeysForEmail: vi.fn(),
}));
vi.mock("../db/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client.js")>()),
  getDbExec: () => ({ execute: fixture.execute }),
}));
vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn(),
  ensureIndexExists: vi.fn(),
  ensureIndexExistsConcurrently: vi.fn(),
  ensureTableExists: vi.fn(),
}));
vi.mock("../notifications/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../notifications/store.js")>()),
  listNotifications: fixture.listNotifications,
}));
vi.mock("../progress/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../progress/store.js")>()),
  listRuns: fixture.listRuns,
}));
vi.mock("../secrets/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../secrets/storage.js")>()),
  writeAppSecret: fixture.writeSecret,
}));
vi.mock("../deploy/route-discovery.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../deploy/route-discovery.js")>()),
  getMissingDefaultPlugins: vi.fn(async () => []),
}));

import { createNotificationsHandler } from "../notifications/routes.js";
import { createProgressHandler } from "../progress/routes.js";
import { createCoreRoutesPlugin } from "./core-routes-plugin.js";
import { createServer } from "./create-server.js";
import {
  markExplicitPersonalOrgScope,
  runWithRequestContext,
} from "./request-context.js";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AUTH_DISABLED", "false");
  vi.stubEnv("ACCESS_TOKEN", "");
  vi.stubEnv("ACCESS_TOKENS", "");
  vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "fake-session-boundary");
  vi.clearAllMocks();
  fixture.signedIn = true;
  fixture.membershipFailure = undefined;
  fixture.writeSecret.mockReset().mockResolvedValue("fake-secret-id");
  fixture.execute.mockImplementation(async ({ sql }: { sql: string }) => {
    if (sql.includes("FROM org_members") && fixture.membershipFailure) {
      throw fixture.membershipFailure;
    }
    return { rows: [] };
  });
});

type Middleware = (event: H3Event, next: () => Promise<unknown>) => unknown;

describe.each(["createServer", "core plugin"] as const)(
  "%s env-vars session boundary",
  (server) => {
    const key = "FAKE_SESSION_BOUNDARY_KEY";
    const value = "obviously-fake-test-value";

    async function request(
      scope?: "delegated",
      vars: unknown = [{ key, value }],
    ) {
      const envKeys = [{ key, label: "Fake test key" }];
      let dispatch: (request: Request) => Response | Promise<Response>;
      if (server === "createServer") {
        const { app } = createServer({ envKeys, cors: false });
        dispatch = (request) => app.fetch(request);
      } else {
        const middleware: Middleware[] = [];
        const nitroApp = { h3: { "~middleware": middleware } };
        const plugin = createCoreRoutesPlugin({
          envKeys,
          disableHealth: true,
          disableAppState: true,
          disableEmbedRoute: true,
          disablePing: true,
        });
        await plugin(nitroApp as Parameters<typeof plugin>[0]);
        const app = new H3();
        app.use((event: H3Event) => {
          let index = 0;
          const next = async (): Promise<unknown> => {
            const handler = middleware[index++];
            if (handler) return handler(event, next);
            return undefined;
          };
          return next();
        });
        dispatch = (request) => app.fetch(request);
      }
      return runWithRequestContext(
        {
          userEmail: "member@example.test",
          ...(scope === "delegated"
            ? {
                orgId: "fake-org",
                a2aIdentityAssurance: "org-member" as const,
              }
            : {}),
        },
        () =>
          dispatch(
            new Request("https://app.example.test/_agent-native/env-vars", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Agent-Native-CSRF": "1",
              },
              body: JSON.stringify({ vars }),
            }),
          ),
      );
    }

    it.each(["57014", "42501", "42P01"])(
      "classifies membership failure %s without losing scope",
      async (code) => {
        fixture.membershipFailure = Object.assign(
          new Error("private membership failure"),
          { code },
        );
        const response = await request();
        expect(response.status).toBe(code === "57014" ? 503 : 500);
        expect(response.headers.get("Retry-After")).toBe(
          code === "57014" ? "5" : null,
        );
        expect(fixture.writeSecret).not.toHaveBeenCalled();
      },
    );

    it("preserves a definitive delegated refusal as 403", async () => {
      const response = await request("delegated");
      expect(response.status).toBe(403);
      expect(response.headers.get("Retry-After")).toBeNull();
      expect(fixture.writeSecret).not.toHaveBeenCalled();
    });

    it("keeps missing-session ScopedKeyStorageError status and format", async () => {
      fixture.signedIn = false;
      const response = await request();
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Sign in to save keys" });
      expect(fixture.writeSecret).not.toHaveBeenCalled();
    });

    it("keeps validation ScopedKeyStorageError status and format", async () => {
      const response = await request(undefined, [{ key, value: "" }]);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: `Value for ${key} must be non-empty`,
      });
      expect(fixture.writeSecret).not.toHaveBeenCalled();
    });

    it("saves a healthy Personal session's fake key", async () => {
      const response = await request();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        saved: [key],
        storage: "scoped-secrets",
      });
      expect(fixture.writeSecret).toHaveBeenCalledWith({
        key,
        value,
        scope: "user",
        scopeId: "member@example.test",
      });
    });

    it("redacts genuine unexpected failures behind HTTP 500", async () => {
      fixture.writeSecret.mockRejectedValueOnce(
        new Error(`write failed with ${value}`),
      );
      const response = await request();
      expect(response.status).toBe(500);
      const body = await response.text();
      expect(body).not.toContain(value);
      expect(body).not.toContain("write failed");
    });
  },
);

afterEach(() => vi.unstubAllEnvs());

describe.each([
  ["notifications", createNotificationsHandler, fixture.listNotifications],
  ["progress", createProgressHandler, fixture.listRuns],
] as const)("%s session boundary", (_name, createHandler, read) => {
  async function request(scope?: "personal" | "delegated") {
    const handler = createHandler();
    const app = new H3();
    app.use("/", (event: H3Event) => {
      if (scope === "personal") markExplicitPersonalOrgScope(event);
      return runWithRequestContext(
        {
          userEmail: "member@example.test",
          ...(scope === "delegated"
            ? {
                orgId: "fake-org",
                a2aIdentityAssurance: "org-member" as const,
              }
            : {}),
        },
        () => handler(event),
      );
    });
    return app.fetch(new Request("https://app.example.test/"));
  }

  it.each(["57014", "42501"])(
    "preserves membership failure classification %s",
    async (code) => {
      fixture.membershipFailure = Object.assign(
        new Error("private membership failure"),
        { code },
      );
      const response = await request();
      expect(response.status).toBe(code === "57014" ? 503 : 500);
      expect(response.headers.get("Retry-After")).toBe(
        code === "57014" ? "5" : null,
      );
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("keeps a denied delegated identity a definitive 403", async () => {
    const response = await request("delegated");
    expect(response.status).toBe(403);
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("returns 401 for a genuinely missing session", async () => {
    fixture.signedIn = false;
    const response = await request();
    expect(response.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  it.each([undefined, "personal"] as const)(
    "allows a valid Personal session (%s)",
    async (scope) => {
      if (scope === "personal")
        fixture.membershipFailure = new Error("must not read membership");
      const response = await request(scope);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([]);
      expect(read).toHaveBeenCalledWith(
        "member@example.test",
        expect.any(Object),
      );
    },
  );
});
