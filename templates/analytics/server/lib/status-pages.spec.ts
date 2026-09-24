import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const getMonitorStatsMock = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
  return { ...actual, getDb: getDbMock };
});

vi.mock("./monitor-stats.js", () => ({
  getMonitorStats: getMonitorStatsMock,
}));

import type { MonitorStats, UptimeWindows } from "./monitor-stats";
import {
  aggregateWindows,
  assemblePublicMonitors,
  computeOverallStatus,
  getPublicStatusPage,
  normalizeSlug,
  parseStatusPageMonitors,
  sanitizePublicMonitor,
  type PublicMonitorRow,
  type StatusPageMonitorRef,
} from "./status-pages";

// ---------------------------------------------------------------------------
// Test fixtures / helpers
// ---------------------------------------------------------------------------

const EMPTY_WINDOWS: UptimeWindows = {
  uptime24h: null,
  uptime7d: null,
  uptime30d: null,
  uptime90d: null,
};

function ref(
  overrides: Partial<StatusPageMonitorRef> = {},
): StatusPageMonitorRef {
  return {
    monitorId: "m1",
    order: 0,
    displayName: null,
    showUrl: false,
    ...overrides,
  };
}

function monitorRow(
  overrides: Partial<PublicMonitorRow> = {},
): PublicMonitorRow {
  return {
    id: "m1",
    name: "Production API",
    url: "https://api.example.com/health?token=SECRET",
    lastStatus: "up",
    ...overrides,
  };
}

function stats(overrides: Partial<MonitorStats> = {}): MonitorStats {
  return {
    monitorId: "m1",
    status: "up",
    lastCheckedAt: "2026-03-10T00:00:00.000Z",
    lastLatencyMs: 120,
    windows: { uptime24h: 100, uptime7d: 99.9, uptime30d: 99.5, uptime90d: 99 },
    timeline: [],
    responseSeries: [
      {
        bucketStart: "2026-03-10T00:00:00.000Z",
        avg: 120,
        min: 90,
        max: 150,
        count: 4,
      },
    ],
    avgResponseMs: 120,
    incidentCount: 1,
    mtbfMs: 1000,
    ...overrides,
  };
}

/**
 * Minimal Drizzle mock: each `.where(...)` resolves to the next queued result
 * set, and also exposes `.limit()` returning the same set (mirrors the pattern
 * used by session-replay-retention.spec.ts). Queue order must match query order.
 */
function createDbMock(resultSets: unknown[][]) {
  const queue = [...resultSets];
  const makeWhereResult = () => {
    const rows = queue.shift() ?? [];
    return {
      limit: () => Promise.resolve(rows),
      then: (
        resolve: (v: unknown[]) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(rows).then(resolve, reject),
    };
  };
  return {
    select: () => ({
      from: () => ({ where: () => makeWhereResult() }),
    }),
  };
}

const PUBLISHED_PAGE_ROW = {
  id: "page_1",
  slug: "acme",
  title: "Acme Status",
  description: "Live service status.",
  published: true,
  showUptimeBars: true,
  showOverallUptime: true,
  showResponseTime: false,
  density: "comfortable",
  alignment: "left",
  monitors: JSON.stringify([
    { monitorId: "m1", order: 0, showUrl: false, displayName: null },
    { monitorId: "m2", order: 1, showUrl: false, displayName: "Secondary" },
  ]),
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  ownerEmail: "owner@example.com",
  orgId: null,
};

const SAFE_MONITOR_KEYS = [
  "avgResponseMs",
  "host",
  "id",
  "name",
  "responseSeries",
  "status",
  "timeline",
  "url",
  "windows",
];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("normalizeSlug", () => {
  it("lowercases, replaces runs of non-alphanumerics with single dashes, trims", () => {
    expect(normalizeSlug("  My Cool Status!!  ")).toBe("my-cool-status");
    expect(normalizeSlug("Acme___Prod")).toBe("acme-prod");
    expect(normalizeSlug("--edge--")).toBe("edge");
  });
  it("returns empty string for junk-only input", () => {
    expect(normalizeSlug("!!!")).toBe("");
    expect(normalizeSlug(null)).toBe("");
  });
});

describe("parseStatusPageMonitors", () => {
  it("parses, de-duplicates, drops invalid entries, and re-numbers order", () => {
    const refs = parseStatusPageMonitors(
      JSON.stringify([
        { monitorId: "a", showUrl: true, displayName: "  Alpha  " },
        { monitorId: "a" }, // duplicate → dropped
        { monitorId: "" }, // invalid → dropped
        { nope: true }, // invalid → dropped
        { monitorId: "b" },
      ]),
    );
    expect(refs).toEqual([
      { monitorId: "a", order: 0, displayName: "Alpha", showUrl: true },
      { monitorId: "b", order: 1, displayName: null, showUrl: false },
    ]);
  });
  it("tolerates malformed JSON", () => {
    expect(parseStatusPageMonitors("not json")).toEqual([]);
    expect(parseStatusPageMonitors(null)).toEqual([]);
  });
});

describe("sanitizePublicMonitor (security boundary)", () => {
  it("emits only safe fields and never the full URL by default", () => {
    const result = sanitizePublicMonitor(
      {
        id: "m1",
        name: "Prod",
        url: "https://api.example.com/health?token=SECRET",
        lastStatus: "up",
      },
      ref(),
      stats(),
      { showResponseTime: true },
    );
    expect(Object.keys(result).sort()).toEqual(SAFE_MONITOR_KEYS);
    expect(result.host).toBe("api.example.com");
    expect(result.url).toBeNull(); // showUrl false → no leak
    // The token in the query string must never appear anywhere on the object.
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("exposes the full URL only when the per-monitor showUrl opt-in is set", () => {
    const result = sanitizePublicMonitor(
      {
        id: "m1",
        name: "Prod",
        url: "https://api.example.com/health",
        lastStatus: "up",
      },
      ref({ showUrl: true }),
      stats(),
      { showResponseTime: false },
    );
    expect(result.url).toBe("https://api.example.com/health");
  });

  it("applies the display-name override and gates response data by showResponseTime", () => {
    const withResponse = sanitizePublicMonitor(
      monitorRow(),
      ref({ displayName: "Public Name" }),
      stats(),
      { showResponseTime: false },
    );
    expect(withResponse.name).toBe("Public Name");
    expect(withResponse.responseSeries).toEqual([]);
    expect(withResponse.avgResponseMs).toBeNull();
  });

  it("falls back to empty windows when there are no stats", () => {
    const result = sanitizePublicMonitor(monitorRow(), ref(), undefined, {
      showResponseTime: true,
    });
    expect(result.windows).toEqual(EMPTY_WINDOWS);
    expect(result.status).toBe("up"); // falls back to lastStatus
  });
});

describe("computeOverallStatus", () => {
  it("prioritizes down > degraded > operational > unknown", () => {
    expect(computeOverallStatus([{ status: "up" }, { status: "down" }])).toBe(
      "down",
    );
    expect(
      computeOverallStatus([{ status: "up" }, { status: "degraded" }]),
    ).toBe("degraded");
    expect(computeOverallStatus([{ status: "up" }, { status: "up" }])).toBe(
      "operational",
    );
    expect(computeOverallStatus([{ status: null }])).toBe("unknown");
    expect(computeOverallStatus([])).toBe("unknown");
  });
});

describe("aggregateWindows", () => {
  it("averages only the windows that have data", () => {
    const result = aggregateWindows([
      { uptime24h: 100, uptime7d: 100, uptime30d: null, uptime90d: 98 },
      { uptime24h: 98, uptime7d: null, uptime30d: null, uptime90d: 100 },
    ]);
    expect(result.uptime24h).toBeCloseTo(99, 5);
    expect(result.uptime7d).toBe(100);
    expect(result.uptime30d).toBeNull();
    expect(result.uptime90d).toBeCloseTo(99, 5);
  });
});

describe("assemblePublicMonitors (inclusion boundary)", () => {
  it("drops refs whose monitor row is absent (not owned / not returned)", () => {
    const refs = [
      ref({ monitorId: "m1", order: 0 }),
      ref({ monitorId: "m2", order: 1 }),
    ];
    // Only m1 is owned/returned by the owner-scoped query.
    const rows = [monitorRow({ id: "m1" })];
    const statsMap = new Map<string, MonitorStats>([["m1", stats()]]);
    const result = assemblePublicMonitors(refs, rows, statsMap, {
      showResponseTime: false,
    });
    expect(result.map((m) => m.id)).toEqual(["m1"]);
  });
});

// ---------------------------------------------------------------------------
// Public read scoping (behavioral, through getPublicStatusPage)
// ---------------------------------------------------------------------------

describe("getPublicStatusPage", () => {
  beforeEach(() => {
    getDbMock.mockReset();
    getMonitorStatsMock.mockReset();
    getMonitorStatsMock.mockResolvedValue(
      new Map<string, MonitorStats>([["m1", stats()]]),
    );
  });

  it("returns null for an unknown or unpublished slug (no published row)", async () => {
    // The published-only lookup yields nothing → null, and the monitors query
    // is never reached.
    getDbMock.mockReturnValue(createDbMock([[]]));
    const result = await getPublicStatusPage("does-not-exist");
    expect(result).toBeNull();
    expect(getMonitorStatsMock).not.toHaveBeenCalled();
  });

  it("returns only included+owned monitors with sanitized fields for a published page", async () => {
    getDbMock.mockReturnValue(
      createDbMock([
        [PUBLISHED_PAGE_ROW], // status page lookup
        [monitorRow({ id: "m1" })], // owner-scoped monitors: m2 absent (not owned)
      ]),
    );

    const result = await getPublicStatusPage("acme");
    expect(result).not.toBeNull();
    expect(result!.slug).toBe("acme");
    // m2 was included on the page but is NOT owned → excluded.
    expect(result!.monitors.map((m) => m.id)).toEqual(["m1"]);
    const monitor = result!.monitors[0];
    expect(Object.keys(monitor).sort()).toEqual(SAFE_MONITOR_KEYS);
    expect(monitor.url).toBeNull();
    // No secret/config field leaks anywhere in the public payload.
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(result!.overall).toBe("operational");
    // stats were requested only for the owned+included id.
    expect(getMonitorStatsMock).toHaveBeenCalledTimes(1);
    expect(getMonitorStatsMock.mock.calls[0][1]).toEqual(["m1"]);
  });
});

// ---------------------------------------------------------------------------
// Source guards: keep the scoping invariants that the mocks above can't prove
// (that the real SQL filters by published + scopes monitors to the page owner).
// ---------------------------------------------------------------------------

describe("status-pages.ts public-read source invariants", () => {
  const source = readFileSync(
    new URL("./status-pages.ts", import.meta.url),
    "utf8",
  );

  it("the public read filters strictly to published pages", () => {
    expect(source).toMatch(/eq\(\s*table\.published\s*,\s*true\s*\)/);
  });

  it("the public view resolves monitors scoped to the page owner", () => {
    expect(source).toMatch(/monitorsOwnerWhere\(ownerCtx\)/);
  });
});
