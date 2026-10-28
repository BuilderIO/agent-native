import { H3 } from "h3";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  dryRun: vi.fn(),
  resolve: vi.fn(),
  save: vi.fn(),
  backend: vi.fn(),
  admin: vi.fn(),
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestUserEmail: () => "admin@example.com",
  getRequestOrgId: () => "org-1",
}));
vi.mock("../server/lib/bigquery.js", () => ({
  dryRunQuerySchema: mocks.dryRun,
}));
vi.mock("../server/lib/source-generation.js", () => ({
  resolveSourceGeneration: mocks.resolve,
}));
vi.mock("../server/lib/db-admin-connections.js", () => ({
  requireAnalyticsAdminContext: mocks.admin,
}));
vi.mock("../server/lib/first-party-analytics-backend.js", () => ({
  firstPartyEventsModelProjection: (table: string) =>
    `SELECT event_id AS id FROM \`${table}\``,
  getFirstPartyAnalyticsBackend: mocks.backend,
  saveFirstPartyEventsModelTable: mocks.save,
}));

const { default: action } =
  await import("./configure-first-party-events-model");

const MODEL = "example-project.dbt_mart.fact_events";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.admin.mockResolvedValue({
    userEmail: "admin@example.com",
    orgId: "org-1",
    role: "admin",
  });
  mocks.resolve.mockResolvedValue({
    status: "ok",
    sources: [],
    generation: `${MODEL}@1`,
    oldestModifiedAt: "2026-10-16T11:00:00.000Z",
    ageMs: 3_600_000,
    stale: false,
    checkedAt: "2026-10-16T12:00:00.000Z",
  });
  mocks.dryRun.mockResolvedValue({ error: null, totalBytesProcessed: 1024 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(async () => {
  const { closeDbExec } = await import("@agent-native/core/db");
  await closeDbExec();
});

describe("configure-first-party-events-model", () => {
  it("checks with dry runs only and saves nothing", async () => {
    await expect(
      action.run({ mode: "check", table: MODEL }, {} as never),
    ).resolves.toMatchObject({
      status: "ok",
      table: MODEL,
      recentDayBytes: 1024,
      fullScanBytes: 1024,
    });
    expect(mocks.dryRun).toHaveBeenCalledTimes(2);
    expect(mocks.dryRun.mock.calls[0]![0]).toContain(`\`${MODEL}\``);
    for (const [sql] of mocks.dryRun.mock.calls) {
      expect(sql).toMatch(/^SELECT \* FROM /);
    }
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(mocks.dryRun.mock.calls[0]![0]).toMatch(
      new RegExp(`WHERE event_date = DATE '${yesterday}'$`),
    );
    expect(mocks.dryRun.mock.calls[1]![0]).not.toContain("WHERE");
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("reports a model the app cannot see without dry-running it", async () => {
    mocks.resolve.mockResolvedValue({
      status: "unavailable",
      sources: [],
      reason: "access_denied",
      checkedAt: "2026-10-16T12:00:00.000Z",
    });

    await expect(
      action.run({ mode: "check", table: MODEL }, {} as never),
    ).resolves.toEqual({
      status: "unavailable",
      table: MODEL,
      reason: "access_denied",
    });
    expect(mocks.dryRun).not.toHaveBeenCalled();
  });

  it("refuses to save a model the app cannot query", async () => {
    mocks.dryRun.mockResolvedValue({ error: "Access Denied: Table" });

    await expect(
      action.run({ mode: "set", table: MODEL }, {} as never),
    ).rejects.toThrow("the model was not saved");
    expect(mocks.admin).toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("refuses to save a model that rejects an unbounded read", async () => {
    mocks.dryRun
      .mockResolvedValueOnce({ error: null, totalBytesProcessed: 1024 })
      .mockResolvedValueOnce({
        error: "Cannot query over table without a filter over column(s)",
      });

    await expect(
      action.run({ mode: "set", table: MODEL }, {} as never),
    ).rejects.toThrow("full_read_denied");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("saves a model that passes the check", async () => {
    await expect(
      action.run({ mode: "set", table: MODEL }, {} as never),
    ).resolves.toMatchObject({ status: "saved", table: MODEL });
    expect(mocks.save).toHaveBeenCalledWith(
      { userEmail: "admin@example.com", orgId: "org-1", role: "admin" },
      MODEL,
    );
  });

  it("rejects a table that is not project.dataset.table", async () => {
    await expect(
      action.run({ mode: "set", table: "dbt_mart.fact_events" }, {} as never),
    ).rejects.toThrow("project.dataset.table");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});

describe("configure-first-party-events-model over the HTTP action route", () => {
  async function callRoute(
    args: Record<string, unknown>,
    headers: Record<string, string>,
  ) {
    const { mountActionRoutes } = await import("@agent-native/core/server");
    const h3 = new H3();
    mountActionRoutes(
      { h3, hooks: { hook: () => {} } },
      { "configure-first-party-events-model": action as any },
      {
        appId: "analytics",
        getOwnerFromEvent: async () => "admin@example.com",
        resolveOrgId: async () => "org-1",
      },
    );
    const response = await h3.fetch(
      new Request(
        "https://analytics.example.test/_agent-native/actions/configure-first-party-events-model",
        {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(args),
        },
      ),
    );
    return { status: response.status, body: await response.json() };
  }

  it("refuses an admin's bearer call to set the model until it is approved", async () => {
    await expect(
      callRoute(
        { mode: "set", table: MODEL },
        { authorization: "Bearer example-admin-token" },
      ),
    ).resolves.toMatchObject({
      status: 409,
      body: { errorCode: "approval_required" },
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("asks a browser call without UI proof to prove itself first", async () => {
    await expect(
      callRoute({ mode: "clear" }, { "x-agent-native-frontend": "1" }),
    ).resolves.toMatchObject({
      status: 403,
      body: { errorCode: "ui_capability_required" },
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("saves the model when the signed-in app UI sets it", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory");
    const { addSession, COOKIE_NAME, signShortLivedToken } =
      await import("@agent-native/core/server");
    await addSession("test-browser-session", "admin@example.com");
    const capability = signShortLivedToken({
      resourceId: "ui-action",
      viewerEmail: "admin@example.com",
      ttlSeconds: 60,
    });

    await expect(
      callRoute(
        { mode: "set", table: MODEL },
        {
          "x-agent-native-frontend": "1",
          "sec-fetch-site": "same-origin",
          cookie: `${COOKIE_NAME}=test-browser-session; agent-native-ui-capability=${capability}`,
        },
      ),
    ).resolves.toMatchObject({
      status: 200,
      body: { status: "saved", table: MODEL },
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("lets any caller check the model without approval", async () => {
    await expect(
      callRoute(
        { mode: "check", table: MODEL },
        { authorization: "Bearer example-member-token" },
      ),
    ).resolves.toMatchObject({ status: 200, body: { status: "ok" } });
  });
});
