import { H3, type H3Event } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  session: { email: "member@example.test", orgId: "fake-org" } as {
    email: string;
    orgId?: string;
  },
  role: "member",
  failure: undefined as unknown,
  execute: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../server/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/auth.js")>()),
  getSession: async () => fixture.session,
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
vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: async () =>
    fixture.role === "personal" ? { orgId: null } : null,
}));
vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: async () => [],
}));
vi.mock("../server/interval-job.js", () => ({
  startIntervalJob: () => ({ stop() {} }),
}));
vi.mock("./config-store.js", () => ({
  getIntegrationConfig: async () => ({ configData: { enabled: false } }),
  saveIntegrationConfig: fixture.save,
}));

import { runWithRequestContext } from "../server/request-context.js";
import { createIntegrationsPlugin } from "./plugin.js";
import type { PlatformAdapter } from "./types.js";

const adapter = {
  platform: "fake",
  label: "Fake",
  getRequiredEnvKeys: () => [],
  getStatus: async () => ({
    platform: "fake",
    label: "Fake",
    configured: true,
    enabled: false,
  }),
} as PlatformAdapter;

afterEach(() => vi.restoreAllMocks());

describe("integration membership HTTP boundary", () => {
  it.each([
    "denied-read",
    "delegated-transient",
    "delegated-revoked",
    "personal",
    "owner",
    "admin",
    "member",
  ])("handles %s through the real org lookup", async (scenario) => {
    fixture.save.mockClear();
    fixture.execute.mockClear();
    fixture.session = {
      email: `member+${scenario}@example.test`,
      ...(scenario === "personal" ? {} : { orgId: "fake-org" }),
    };
    fixture.role = scenario;
    fixture.failure =
      scenario === "delegated-transient"
        ? Object.assign(new Error("db query timed out"), { code: "57014" })
        : scenario === "denied-read"
          ? Object.assign(
              new Error("permission denied for table org_members"),
              { code: "42501" },
            )
          : undefined;
    fixture.execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("FROM org_members")) {
        if (fixture.failure) throw fixture.failure;
        return {
          rows:
            scenario === "personal" || scenario === "delegated-revoked"
              ? []
              : [{ orgId: "fake-org", orgName: "Fake", role: fixture.role }],
        };
      }
      return { rows: [] };
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const middleware: Array<
      (event: H3Event, next: () => Promise<unknown>) => unknown
    > = [];
    const plugin = createIntegrationsPlugin({ adapters: [adapter] });
    await plugin({ h3: { "~middleware": middleware } } as Parameters<
      typeof plugin
    >[0]);
    const app = new H3();
    app.use((event: H3Event) => {
      let index = 0;
      const next = async (): Promise<unknown> =>
        middleware[index++]?.(event, next);
      return next();
    });
    const response = await runWithRequestContext(
      scenario.startsWith("delegated-")
        ? {
            userEmail: fixture.session.email,
            orgId: "fake-org",
            a2aIdentityAssurance: "org-member",
          }
        : { userEmail: fixture.session.email },
      () =>
        app.fetch(
          new Request(
            "https://app.example.test/_agent-native/integrations/fake/enable",
            { method: "POST", headers: { "X-Agent-Native-CSRF": "1" } },
          ),
        ),
    );
    const unavailable =
      scenario === "denied-read" || scenario === "delegated-transient";
    const forbidden = scenario === "member" || scenario === "delegated-revoked";
    expect(response.status).toBe(unavailable ? 503 : forbidden ? 403 : 200);
    expect(response.headers.get("retry-after")).toBe(unavailable ? "5" : null);
    expect(fixture.save).toHaveBeenCalledTimes(
      unavailable || forbidden ? 0 : 1,
    );
    expect(await response.text()).not.toContain("org_members");
    expect(
      fixture.execute.mock.calls.some(([query]) =>
        query.sql.includes("FROM org_members"),
      ),
    ).toBe(true);
  });
});
