import { H3, type H3Event } from "h3";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  session: { email: "member@example.test", orgId: "fake-org" } as {
    email: string;
    orgId?: string;
    orgRole?: string;
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
    "permanent-creation",
    "schema-read",
    "unexpected-read",
    "delegated-transient",
    "ordinary-owner-transient",
    "ordinary-admin-transient",
    "ordinary-owner-refused",
    "ordinary-admin-dns",
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
      ...(scenario === "personal" || scenario === "permanent-creation"
        ? {}
        : { orgId: "fake-org" }),
      ...(scenario.startsWith("ordinary-owner-")
        ? { orgRole: "owner" }
        : scenario.startsWith("ordinary-admin-")
          ? { orgRole: "admin" }
          : {}),
    };
    fixture.role = scenario;
    fixture.failure =
      scenario.endsWith("-refused") || scenario.endsWith("-dns")
        ? Object.assign(new Error("Fake private network diagnostics"), {
            code: scenario.endsWith("-refused") ? "ECONNREFUSED" : "EAI_AGAIN",
          })
        : scenario.endsWith("-transient")
          ? Object.assign(new Error("db query timed out"), { code: "57014" })
          : scenario === "denied-read" || scenario === "permanent-creation"
            ? Object.assign(
                new Error("permission denied for table org_members"),
                {
                  code: "42501",
                },
              )
            : scenario === "schema-read"
              ? Object.assign(new Error("private schema failure"), {
                  code: "42P01",
                })
              : scenario === "unexpected-read"
                ? new TypeError("private unexpected failure")
                : undefined;
    fixture.execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("FROM org_members")) {
        if (fixture.failure && scenario !== "permanent-creation")
          throw fixture.failure;
        return {
          rows:
            scenario === "personal" ||
            scenario === "delegated-revoked" ||
            scenario === "permanent-creation"
              ? []
              : [{ orgId: "fake-org", orgName: "Fake", role: fixture.role }],
        };
      }
      if (
        scenario === "permanent-creation" &&
        sql.includes("INSERT INTO organizations")
      )
        throw fixture.failure;
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
      scenario.endsWith("-transient") ||
      scenario.endsWith("-refused") ||
      scenario.endsWith("-dns");
    const permanent =
      scenario.endsWith("-read") || scenario === "permanent-creation";
    const forbidden = scenario === "member" || scenario === "delegated-revoked";
    expect(response.status).toBe(
      unavailable ? 503 : permanent ? 500 : forbidden ? 403 : 200,
    );
    expect(response.headers.get("retry-after")).toBe(unavailable ? "5" : null);
    expect(fixture.save).toHaveBeenCalledTimes(
      unavailable || permanent || forbidden ? 0 : 1,
    );
    expect(await response.text()).not.toContain("org_members");
    expect(
      fixture.execute.mock.calls.some(([query]) =>
        query.sql.includes("FROM org_members"),
      ),
    ).toBe(true);
  });
});
