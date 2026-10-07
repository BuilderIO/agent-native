import { beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_PAGE_SIZE } from "../shared/session-page.js";

const labEnabled = vi.hoisted(() => ({ value: false }));
const getUserLabEnabled = vi.hoisted(() => vi.fn(async () => labEnabled.value));
const listSessionRecordings = vi.hoisted(() => vi.fn(async () => []));
const getSessionReplaySummary = vi.hoisted(() =>
  vi.fn(async (id: string) => ({ id, sessionId: "s1" })),
);
const listSessionRecordingsPage = vi.hoisted(() =>
  vi.fn(async () => ({ recordings: [], total: 0, appCounts: [] })),
);
const getSessionRecordingPerformance = vi.hoisted(() =>
  vi.fn(async () => ({ performance: {}, coverageStartedAt: null })),
);
const listRoutePerformance = vi.hoisted(() =>
  vi.fn(async () => ({ routes: [], coverageStartedAt: null })),
);
const listSessionEventNames = vi.hoisted(() =>
  vi.fn(async () => ({ events: [], coverageStartedAt: null })),
);
const listEventCatalog = vi.hoisted(() =>
  vi.fn(async () => ({
    from: "2026-09-01",
    to: "2026-09-30",
    entries: [
      {
        eventName: "clip.viewed",
        app: "clips",
        volume: 3,
        lastSeenAt: "2026-09-29T10:00:00.000Z",
        propertyKeys: [],
        description: null as string | null,
        automatic: false,
        stoppedFiring: false,
      },
    ],
    apps: [],
    truncated: false,
  })),
);

const getSessionFrictionDetails = vi.hoisted(() =>
  vi.fn(async (_scope: unknown, recordings: Array<{ id: string }>) => {
    return new Map(
      recordings.map((recording) => [recording.id, { score: 4 }] as const),
    );
  }),
);

const listRecordingFriction = vi.hoisted(() =>
  vi.fn(async () => ({ r1: { score: 4 } })),
);

vi.mock("@agent-native/core/labs/server", () => ({ getUserLabEnabled }));
vi.mock("../server/lib/session-friction.js", () => ({
  getSessionFrictionDetails,
  listRecordingFriction,
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  getRequestUserEmail: () => "user@example.test",
  getRequestOrgId: () => "org-1",
}));
vi.mock("@agent-native/core/settings", () => ({
  listOrgSettings: vi.fn(async () => ({
    "data-dict-clip-viewed": {
      metric: "Clip viewed",
      definition: "A viewer opened a clip.",
    },
  })),
  listSettingsByPrefix: vi.fn(async () => []),
}));
vi.mock("../server/lib/session-replay.js", () => ({
  getSessionRecordingPerformance,
  getSessionReplaySummary,
  listSessionRecordings,
  listSessionRecordingsPage,
}));
vi.mock("../server/lib/session-performance.js", () => ({
  listRoutePerformance,
  ROUTE_PERFORMANCE_MAX_LIMIT: 200,
}));
vi.mock("../server/lib/session-event-index.js", () => ({
  listSessionEventNames,
  listEventCatalog,
}));

const { default: listRecordings } = await import("./list-session-recordings");
const { default: listEventNames } = await import("./list-session-event-names");
const { default: listCatalog } = await import("./list-event-catalog");
const { default: listRoutes } = await import("./list-route-performance");
const { default: listSpeed } = await import("./list-session-performance");
const { default: listFriction } = await import("./list-session-friction");
const { default: getSummary } = await import("./get-session-replay-summary");

describe("Sessions triage Lab guard on event actions", () => {
  beforeEach(() => {
    labEnabled.value = false;
    getUserLabEnabled.mockClear();
    listSessionRecordings.mockClear();
    listSessionRecordingsPage.mockClear();
    listRoutePerformance.mockClear();
    getSessionRecordingPerformance.mockClear();
    getSessionFrictionDetails.mockClear();
    listRecordingFriction.mockClear();
  });

  it("keeps plain session lists working with the Lab off", async () => {
    await listRecordings.run({ paginated: true } as never);
    expect(getUserLabEnabled).not.toHaveBeenCalled();
    expect(listSessionRecordingsPage).toHaveBeenCalledOnce();
  });

  it("rejects event filters, event names, and the catalog with the Lab off", async () => {
    await expect(
      listRecordings.run({
        paginated: true,
        didEvents: ["recording_started"],
      } as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(listEventNames.run({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(listCatalog.run({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(listSessionRecordingsPage).not.toHaveBeenCalled();
    expect(getUserLabEnabled).toHaveBeenCalledWith(
      "user@example.test",
      expect.objectContaining({ key: "analytics.sessions-triage" }),
      { orgId: "org-1" },
    );
  });

  it("rejects the slow filter, speed hints, and route speed with the Lab off", async () => {
    for (const args of [
      { paginated: true, slow: "vitals" },
      { paginated: true, includePerformance: true },
      { slow: "requests" },
    ]) {
      await expect(listRecordings.run(args as never)).rejects.toMatchObject({
        statusCode: 403,
      });
    }
    await expect(listRoutes.run({} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      listSpeed.run({ recordingIds: ["r1"] } as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(listSessionRecordingsPage).not.toHaveBeenCalled();
    expect(listSessionRecordings).not.toHaveBeenCalled();
    expect(listRoutePerformance).not.toHaveBeenCalled();
    expect(getSessionRecordingPerformance).not.toHaveBeenCalled();

    labEnabled.value = true;
    await listRoutes.run({} as never);
    expect(listRoutePerformance).toHaveBeenCalledWith(
      { userEmail: "user@example.test", orgId: "org-1" },
      {},
    );
    await listSpeed.run({ recordingIds: ["r1"] } as never);
    expect(getSessionRecordingPerformance).toHaveBeenCalledWith(
      { userEmail: "user@example.test", orgId: "org-1" },
      ["r1"],
    );
  });

  it("serves event filters and fills catalog descriptions with the Lab on", async () => {
    labEnabled.value = true;
    await listRecordings.run({
      paginated: true,
      didNotEvents: ["clip_viewed"],
    } as never);
    expect(listSessionRecordingsPage).toHaveBeenCalledWith(
      { userEmail: "user@example.test", orgId: "org-1" },
      expect.objectContaining({ didNotEvents: ["clip_viewed"] }),
    );

    const catalog = (await listCatalog.run({} as never)) as Awaited<
      ReturnType<typeof listEventCatalog>
    >;
    expect(catalog.entries[0].description).toBe("A viewer opened a clip.");
  });

  it("bounds speed lookups to one page of recordings", () => {
    expect(listSpeed.schema.parse({})).toEqual({ recordingIds: [] });
    expect(
      listSpeed.schema.safeParse({
        recordingIds: Array.from(
          { length: SESSION_PAGE_SIZE + 1 },
          (_, index) => `r${index}`,
        ),
      }).success,
    ).toBe(false);
    expect(
      listSpeed.schema.safeParse({
        recordingIds: Array.from(
          { length: SESSION_PAGE_SIZE },
          (_, index) => `r${index}`,
        ),
      }).success,
    ).toBe(true);
  });

  it("rejects friction filters, sorts, and details with the Lab off", async () => {
    for (const args of [
      { frictionSignals: ["dead_clicks"] },
      { sort: "friction" },
      { sort: "thumbs_down" },
      { includeFriction: true },
    ]) {
      await expect(
        listRecordings.run({ paginated: true, ...args } as never),
      ).rejects.toMatchObject({ statusCode: 403 });
    }
    await expect(
      listFriction.run({ recordingIds: ["r1"] } as never),
    ).rejects.toThrow("Session friction is part of");
    expect(listSessionRecordingsPage).not.toHaveBeenCalled();
    expect(getSessionFrictionDetails).not.toHaveBeenCalled();
    expect(listRecordingFriction).not.toHaveBeenCalled();
  });

  it("serves row friction for one page of recordings with the Lab on", async () => {
    labEnabled.value = true;
    await expect(
      listFriction.run({ recordingIds: ["r1"] } as never),
    ).resolves.toEqual({ friction: { r1: { score: 4 } } });
    expect(listRecordingFriction).toHaveBeenCalledWith(
      { userEmail: "user@example.test", orgId: "org-1" },
      ["r1"],
    );
    expect(listFriction.schema.parse({})).toEqual({ recordingIds: [] });
    expect(
      listFriction.schema.safeParse({
        recordingIds: Array.from({ length: 101 }, (_, index) => `r${index}`),
      }).success,
    ).toBe(false);
  });

  it("names what the Lab gates in its 403", async () => {
    await expect(
      listRecordings.run({ paginated: true, sort: "friction" } as never),
    ).rejects.toThrow(
      "Session friction is part of the Sessions triage Lab. Turn it on in Settings > Labs.",
    );
    await expect(
      listRecordings.run({
        paginated: true,
        didEvents: ["clip_viewed"],
        includeFriction: true,
      } as never),
    ).rejects.toThrow("Session events and friction are part of");
    await expect(
      listRecordings.run({ paginated: true, slow: "requests" } as never),
    ).rejects.toThrow("Session speed is part of");
    await expect(
      listRecordings.run({
        paginated: true,
        didEvents: ["clip_viewed"],
        frictionSignals: ["stalled_requests"],
        slow: "requests",
      } as never),
    ).rejects.toThrow("Session events, friction, and speed are part of");
    await expect(
      listSpeed.run({ recordingIds: ["r1"] } as never),
    ).rejects.toThrow("Session speed is part of");
  });

  it("answers a friction filter with the paginated shape, so coverage can travel with it", async () => {
    labEnabled.value = true;
    listSessionRecordingsPage.mockResolvedValueOnce({
      recordings: [],
      total: 0,
      appCounts: [],
      frictionCoverageStartedAt: null,
    } as never);
    const result = await listRecordings.run({
      frictionSignals: ["dead_clicks"],
    } as never);
    expect(listSessionRecordings).not.toHaveBeenCalled();
    expect(result).toMatchObject({ frictionCoverageStartedAt: null });
  });

  it("answers a slow filter or speed summaries with the paginated shape, so coverage can travel with it", async () => {
    labEnabled.value = true;
    for (const args of [{ slow: "any" }, { includePerformance: true }]) {
      listSessionRecordingsPage.mockResolvedValueOnce({
        recordings: [],
        total: 0,
        appCounts: [],
        performanceCoverageStartedAt: null,
      } as never);
      const result = await listRecordings.run(args as never);
      expect(result).toMatchObject({ performanceCoverageStartedAt: null });
    }
    expect(listSessionRecordings).not.toHaveBeenCalled();
  });

  it("keeps the plain sorts working with the Lab off", async () => {
    await listRecordings.run({ paginated: true, sort: "errors" } as never);
    expect(getUserLabEnabled).not.toHaveBeenCalled();
    expect(listSessionRecordingsPage).toHaveBeenCalledOnce();
  });

  it("filters by friction and attaches friction with the Lab on", async () => {
    labEnabled.value = true;
    listSessionRecordingsPage.mockResolvedValueOnce({
      recordings: [{ id: "r1" }] as never[],
      total: 1,
      appCounts: [],
    });
    const page = (await listRecordings.run({
      paginated: true,
      frictionSignals: ["dead_clicks"],
      sort: "friction",
      includeFriction: true,
    } as never)) as { recordings: Array<{ id: string; friction?: unknown }> };
    expect(listSessionRecordingsPage).toHaveBeenCalledWith(
      { userEmail: "user@example.test", orgId: "org-1" },
      expect.objectContaining({
        frictionSignals: ["dead_clicks"],
        sort: "friction",
      }),
    );
    expect(page.recordings).toEqual([{ id: "r1", friction: { score: 4 } }]);
  });

  it("adds friction and speed to a replay summary only with the Lab on, and says when either could not", async () => {
    const speed = {
      ttfbMs: 120,
      lcpMs: 4_500,
      inpMs: null,
      cls: null,
      slowRequests: 2,
      maxRequestMs: 1_800,
      atLeast: [],
      incomplete: false,
    };
    getSessionRecordingPerformance.mockResolvedValue({
      performance: { r1: speed },
      coverageStartedAt: "2026-09-20T00:00:00.000Z",
    } as never);
    await expect(getSummary.run({ recordingId: "r1" })).resolves.toEqual({
      id: "r1",
      sessionId: "s1",
    });
    expect(listRecordingFriction).not.toHaveBeenCalled();
    expect(getSessionRecordingPerformance).not.toHaveBeenCalled();

    labEnabled.value = true;
    await expect(getSummary.run({ recordingId: "r1" })).resolves.toEqual({
      id: "r1",
      sessionId: "s1",
      friction: { score: 4 },
      performance: speed,
      performanceCoverageStartedAt: "2026-09-20T00:00:00.000Z",
    });

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const frictionFailure = new Error(
      'relation "analytics_session_friction" does not exist',
    );
    listRecordingFriction.mockRejectedValueOnce(frictionFailure);
    await expect(getSummary.run({ recordingId: "r1" })).resolves.toEqual({
      id: "r1",
      sessionId: "s1",
      frictionError: "Couldn't read session friction.",
      performance: speed,
      performanceCoverageStartedAt: "2026-09-20T00:00:00.000Z",
    });

    const speedFailure = new Error(
      'relation "analytics_session_performance" does not exist',
    );
    getSessionRecordingPerformance.mockRejectedValueOnce(speedFailure);
    await expect(getSummary.run({ recordingId: "r1" })).resolves.toEqual({
      id: "r1",
      sessionId: "s1",
      friction: { score: 4 },
      performanceError: "Couldn't read session speed data.",
    });

    getSessionRecordingPerformance.mockResolvedValueOnce({
      performance: { r1: null },
      coverageStartedAt: null,
    } as never);
    await expect(getSummary.run({ recordingId: "r1" })).resolves.toEqual({
      id: "r1",
      sessionId: "s1",
      friction: { score: 4 },
      performance: null,
      performanceCoverageStartedAt: null,
    });

    const labFailure = new Error('relation "settings" does not exist');
    getUserLabEnabled.mockRejectedValueOnce(labFailure);
    await expect(getSummary.run({ recordingId: "r1" })).resolves.toEqual({
      id: "r1",
      sessionId: "s1",
      labStateError: "Couldn't read the Sessions triage Lab state.",
    });
    expect(log).toHaveBeenCalledWith(
      "[get-session-replay-summary] Couldn't read session friction.",
      frictionFailure,
    );
    expect(log).toHaveBeenCalledWith(
      "[get-session-replay-summary] Couldn't read the Sessions triage Lab state.",
      labFailure,
    );
    expect(log).toHaveBeenCalledWith(
      "[get-session-replay-summary] Couldn't read session speed data.",
      speedFailure,
    );
    log.mockRestore();
    getSessionRecordingPerformance.mockReset();
    getSessionRecordingPerformance.mockResolvedValue({
      performance: {},
      coverageStartedAt: null,
    });
  });

  it("rejects event range bounds that are not timestamps", () => {
    expect(listCatalog.schema.safeParse({ from: "last week" }).success).toBe(
      false,
    );
    expect(listEventNames.schema.safeParse({ to: "soon" }).success).toBe(false);
    for (const bound of ["Sept 1", "2026-02-30", "2026-09-20T10:00:00"]) {
      expect(listCatalog.schema.safeParse({ from: bound }).success).toBe(false);
    }
    for (const bound of [
      "2026-09-01",
      "2026-09-01T00:00:00.000Z",
      "2026-09-01T02:00:00+02:00",
    ]) {
      expect(listCatalog.schema.safeParse({ from: bound }).success).toBe(true);
    }
  });
});
