import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  readBodyWithSizeLimit: vi.fn(),
  resolveAccess: vi.fn(),
  getRequestIP: vi.fn(),
  setResponseStatus: vi.fn(),
  getDb: vi.fn(),
  nanoid: vi.fn(),
  writeAppState: vi.fn(),
  emit: vi.fn(),
  enqueueTransactionalEmail: vi.fn(),
  ensureTransactionalEmailEnabled: vi.fn(),
  ownerEmailMatches: vi.fn(),
}));

const tables = vi.hoisted(() => ({
  recordingViewers: {
    id: "recording_viewers.id",
    recordingId: "recording_viewers.recording_id",
    viewerKey: "recording_viewers.viewer_key",
    viewerEmail: "recording_viewers.viewer_email",
    viewerName: "recording_viewers.viewer_name",
    firstViewedAt: "recording_viewers.first_viewed_at",
    totalWatchMs: "recording_viewers.total_watch_ms",
    completedPct: "recording_viewers.completed_pct",
    countedView: "recording_viewers.counted_view",
    ctaClicked: "recording_viewers.cta_clicked",
  },
  recordingEvents: { table: "recording_events" },
  recordingViews: {
    table: "recording_views",
    id: "recording_views.id",
    recordingId: "recording_views.recording_id",
    viewerKey: "recording_views.viewer_key",
    viewSessionId: "recording_views.view_session_id",
    viewerEmail: "recording_views.viewer_email",
    viewedAt: "recording_views.viewed_at",
  },
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRequestIP: (...args: unknown[]) => mocks.getRequestIP(...args),
  setResponseStatus: (...args: unknown[]) => mocks.setResponseStatus(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ type: "and", conditions }),
  asc: (column: unknown) => ({ type: "asc", column }),
  eq: (left: unknown, right: unknown) => ({ type: "eq", left, right }),
  isNull: (column: unknown) => ({ type: "is-null", column }),
  not: (condition: unknown) => ({ type: "not", condition }),
  or: (...conditions: unknown[]) => ({ type: "or", conditions }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
}));

vi.mock("@agent-native/core/event-bus", () => ({
  emit: (...args: unknown[]) => mocks.emit(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: (...args: unknown[]) => mocks.getSession(...args),
  readBodyWithSizeLimit: (...args: unknown[]) =>
    mocks.readBodyWithSizeLimit(...args),
  runWithRequestContext: (
    _context: unknown,
    callback: () => Promise<unknown>,
  ) => callback(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  resolveAccess: (...args: unknown[]) => mocks.resolveAccess(...args),
}));

vi.mock("../../db/index.js", () => ({
  getDb: (...args: unknown[]) => mocks.getDb(...args),
  schema: tables,
}));

vi.mock("../../lib/recordings.js", () => ({
  nanoid: () => mocks.nanoid(),
  ownerEmailMatches: (...args: unknown[]) => mocks.ownerEmailMatches(...args),
  shouldCountView: (
    totalWatchMs: number,
    completedPct: number,
    scrubbedToEnd: boolean,
  ) => totalWatchMs >= 5000 || completedPct >= 75 || scrubbedToEnd,
}));

vi.mock("../../lib/transactional-email-store.js", () => ({
  transactionalEmailStore: {
    enqueue: (...args: unknown[]) => mocks.enqueueTransactionalEmail(...args),
    ensureEnabledAt: (...args: unknown[]) =>
      mocks.ensureTransactionalEmailEnabled(...args),
  },
}));

import handler, { __resetViewEventRateLimitForTests } from "./view-event.post";

interface FakeViewer {
  id: string;
  recordingId: string;
  viewerKey: string | null;
  viewerEmail: string | null;
  viewerName: string | null;
  totalWatchMs: number;
  completedPct: number;
  countedView: boolean;
  ctaClicked: boolean;
}

function makeEvent(
  body: Record<string, unknown> = {},
  options: { ip?: string; contentLength?: number } = {},
) {
  return {
    body: {
      recordingId: "rec-example",
      kind: "view-start",
      sessionId: "session-example",
      ...body,
    },
    ip: options.ip ?? "203.0.113.10",
    contentLength: options.contentLength,
    status: 200,
    headers: { "x-forwarded-for": "198.51.100.99" },
  };
}

function createStatefulDb(
  initialViewer: FakeViewer | null = null,
  initialCountedViews: Array<Record<string, unknown>> = [],
) {
  const state = {
    viewer: initialViewer,
    events: [] as Array<Record<string, unknown>>,
    countedViews: [...initialCountedViews],
  };

  function select(projection: Record<string, unknown>) {
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn(() => builder),
      orderBy: vi.fn(() => builder),
      limit: vi.fn(async () => {
        if (!state.viewer) return [];
        if ("totalWatchMs" in projection) {
          return state.viewer.viewerKey
            ? [
                {
                  id: state.viewer.id,
                  totalWatchMs: state.viewer.totalWatchMs,
                  completedPct: state.viewer.completedPct,
                  countedView: state.viewer.countedView,
                  ctaClicked: state.viewer.ctaClicked,
                },
              ]
            : [];
        }
        if ("countedView" in projection) {
          return [{ countedView: state.viewer.countedView }];
        }
        if ("viewSessionId" in projection) {
          return [...state.countedViews]
            .sort(
              (left, right) =>
                String(left.viewedAt).localeCompare(String(right.viewedAt)) ||
                String(left.id).localeCompare(String(right.id)),
            )
            .slice(0, 1);
        }
        return state.viewer.viewerKey === null ? [{ id: state.viewer.id }] : [];
      }),
    };
    return builder;
  }

  function insert(table: unknown) {
    return {
      values(value: Record<string, unknown>) {
        let executed = false;
        const execute = () => {
          if (executed) return;
          executed = true;
          if (table === tables.recordingViewers) {
            if (!state.viewer) {
              state.viewer = {
                id: String(value.id),
                recordingId: String(value.recordingId),
                viewerKey: String(value.viewerKey),
                viewerEmail: (value.viewerEmail as string | null) ?? null,
                viewerName: (value.viewerName as string | null) ?? null,
                totalWatchMs: Number(value.totalWatchMs),
                completedPct: Number(value.completedPct),
                countedView: Boolean(value.countedView),
                ctaClicked: Boolean(value.ctaClicked),
              };
            }
          } else if (table === tables.recordingEvents) {
            state.events.push(value);
          } else if (table === tables.recordingViews) {
            if (
              !state.countedViews.some(
                (row) =>
                  row.recordingId === value.recordingId &&
                  row.viewerKey === value.viewerKey &&
                  row.viewSessionId === value.viewSessionId,
              )
            ) {
              state.countedViews.push(value);
            }
          }
        };
        return {
          onConflictDoNothing: async () => execute(),
          then(resolve: (value?: unknown) => void) {
            execute();
            resolve();
          },
        };
      },
    };
  }

  function update() {
    let values: Record<string, unknown> = {};
    return {
      set(next: Record<string, unknown>) {
        values = next;
        return {
          where: async () => {
            if (!state.viewer) return;
            if (typeof values.viewerKey === "string") {
              if (state.viewer.viewerKey === null) {
                state.viewer.viewerKey = values.viewerKey;
              }
              return;
            }
            const watchSql = values.totalWatchMs as
              | { values?: unknown[] }
              | undefined;
            const completionSql = values.completedPct as
              | { values?: unknown[] }
              | undefined;
            state.viewer.totalWatchMs = Math.max(
              state.viewer.totalWatchMs,
              Number(watchSql?.values?.[1] ?? 0),
            );
            state.viewer.completedPct = Math.max(
              state.viewer.completedPct,
              Number(completionSql?.values?.[1] ?? 0),
            );
            if (values.countedView === true) state.viewer.countedView = true;
            if (values.ctaClicked === true) state.viewer.ctaClicked = true;
          },
        };
      },
    };
  }

  const db = {
    select: vi.fn(select),
    insert: vi.fn(insert),
    update: vi.fn(update),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(db),
    ),
  };
  return { db, state };
}

describe("POST /api/view-event", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    __resetViewEventRateLimitForTests();
    let id = 0;
    mocks.nanoid.mockImplementation(() => `generated-${++id}`);
    mocks.getSession.mockResolvedValue(null);
    mocks.getRequestIP.mockImplementation((event) => event.ip);
    mocks.setResponseStatus.mockImplementation((event, status) => {
      event.status = status;
    });
    mocks.readBodyWithSizeLimit.mockImplementation(
      async (event, maxBytes: number) => {
        if (
          (event.contentLength && event.contentLength > maxBytes) ||
          new TextEncoder().encode(JSON.stringify(event.body)).byteLength >
            maxBytes
        ) {
          throw Object.assign(new Error("oversize"), { statusCode: 413 });
        }
        return event.body;
      },
    );
    mocks.resolveAccess.mockResolvedValue({
      resource: { ownerEmail: "owner@example.com" },
    });
    mocks.enqueueTransactionalEmail.mockResolvedValue({ created: true });
    mocks.ensureTransactionalEmailEnabled.mockResolvedValue({
      enabledAt: "2000-01-01T00:00:00.000Z",
    });
    mocks.ownerEmailMatches.mockReturnValue({ type: "owner-email-match" });
  });

  it("rejects declared and actual oversized bodies before database access", async () => {
    const declared = makeEvent({}, { contentLength: 16 * 1024 + 1 });
    const actual = makeEvent({ payload: { text: "x".repeat(17 * 1024) } });

    await expect(handler(declared as any)).resolves.toEqual({
      error: "Request body too large",
    });
    await expect(handler(actual as any)).resolves.toEqual({
      error: "Request body too large",
    });
    expect(declared.status).toBe(413);
    expect(actual.status).toBe(413);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each([
    [{ recordingId: "r".repeat(257) }, "recordingId"],
    [{ sessionId: "s".repeat(257) }, "sessionId"],
    [{ viewSessionId: "v".repeat(257) }, "viewSessionId"],
    [{ viewerName: "n".repeat(201) }, "viewerName"],
    [{ timestampMs: Number.NaN }, "metrics"],
    [{ totalWatchMs: -1 }, "metrics"],
    [{ completedPct: 101 }, "metrics"],
    [{ scrubbedToEnd: "yes" }, "scrubbedToEnd"],
    [{ payload: [] }, "payload"],
    [{ payload: { text: "x".repeat(9 * 1024) } }, "payload"],
  ])("rejects bounded invalid input %j", async (body, errorPart) => {
    const event = makeEvent(body);

    const result = await handler(event as any);

    expect(event.status).toBe(400);
    expect(result).toEqual({ error: expect.stringContaining(errorPart) });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("uses H3 peer-address resolution instead of a raw forwarded header", async () => {
    mocks.resolveAccess.mockResolvedValue(null);
    const event = makeEvent({}, { ip: "203.0.113.42" });

    for (let i = 0; i < 60; i += 1) {
      await handler({ ...event, status: 200 } as any);
    }
    const limited = { ...event, status: 200 };
    await expect(handler(limited as any)).resolves.toEqual({
      error: "Rate limit exceeded",
    });

    expect(mocks.getRequestIP).toHaveBeenCalledWith(
      expect.objectContaining({ ip: "203.0.113.42" }),
    );
    expect(limited.status).toBe(429);
  });

  it("bounds limiter buckets, then prunes them after their window expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T00:00:00.000Z"));
    mocks.resolveAccess.mockResolvedValue(null);

    for (let i = 0; i < 5000; i += 1) {
      const result = await handler(
        makeEvent({ sessionId: `session-${i}` }) as any,
      );
      expect(result).toEqual({ ok: true, ignored: true });
    }
    const atCapacity = makeEvent({ sessionId: "session-over-capacity" });
    await handler(atCapacity as any);
    expect(atCapacity.status).toBe(429);

    vi.advanceTimersByTime(10_001);
    const afterExpiry = makeEvent({ sessionId: "session-after-expiry" });
    await expect(handler(afterExpiry as any)).resolves.toEqual({
      ok: true,
      ignored: true,
    });
    expect(afterExpiry.status).toBe(200);
  });

  it("claims a deterministic legacy viewer without creating a new row", async () => {
    const { db, state } = createStatefulDb({
      id: "legacy-viewer",
      recordingId: "rec-example",
      viewerKey: null,
      viewerEmail: null,
      viewerName: "anon:session-example",
      totalWatchMs: 1000,
      completedPct: 10,
      countedView: false,
      ctaClicked: false,
    });
    mocks.getDb.mockReturnValue(db);

    const result = await handler(
      makeEvent({ kind: "watch-progress", totalWatchMs: 2500 }) as any,
    );

    expect(result).toMatchObject({ ok: true, viewerId: "legacy-viewer" });
    expect(state.viewer?.viewerKey).toBe("anon:session-example");
    expect(state.events).toHaveLength(1);
    expect(state.events[0].viewerId).toBe("legacy-viewer");
  });

  it("enqueues after an anonymous viewer first transitions to counted and preserves clip.viewed", async () => {
    const { db } = createStatefulDb({
      id: "viewer-1",
      recordingId: "rec-example",
      viewerKey: "anon:session-example",
      viewerEmail: null,
      viewerName: "anon:session-example",
      totalWatchMs: 1000,
      completedPct: 10,
      countedView: false,
      ctaClicked: false,
    });
    mocks.getDb.mockReturnValue(db);

    await handler(makeEvent({ kind: "view-start", totalWatchMs: 5000 }) as any);

    expect(mocks.enqueueTransactionalEmail).toHaveBeenCalledWith(
      "first-view:rec-example",
      {
        type: "first-view",
        recipient: "owner@example.com",
        recordingIds: ["rec-example"],
        requestedBy: "owner@example.com",
      },
    );
    expect(db.transaction.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.enqueueTransactionalEmail.mock.invocationCallOrder[0],
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      "clip.viewed",
      {
        clipId: "rec-example",
        viewerEmail: null,
        viewedAt: expect.any(String),
      },
      { owner: "owner@example.com" },
    );
  });

  it("does not enqueue for an already-counted viewer or the recording owner", async () => {
    const alreadyCounted = createStatefulDb({
      id: "viewer-1",
      recordingId: "rec-example",
      viewerKey: "anon:session-example",
      viewerEmail: null,
      viewerName: "anon:session-example",
      totalWatchMs: 5000,
      completedPct: 75,
      countedView: true,
      ctaClicked: false,
    });
    mocks.getDb.mockReturnValue(alreadyCounted.db);
    await handler(makeEvent({ totalWatchMs: 6000 }) as any);

    const ownerViewer = createStatefulDb({
      id: "viewer-owner",
      recordingId: "rec-example",
      viewerKey: "owner@example.com",
      viewerEmail: "owner@example.com",
      viewerName: "owner",
      totalWatchMs: 1000,
      completedPct: 10,
      countedView: false,
      ctaClicked: false,
    });
    mocks.getSession.mockResolvedValue({ email: "OWNER@example.com" });
    mocks.getDb.mockReturnValue(ownerViewer.db);
    await handler(
      makeEvent({ sessionId: "owner-session", totalWatchMs: 5000 }) as any,
    );

    expect(mocks.enqueueTransactionalEmail).not.toHaveBeenCalled();
  });

  it("does not enqueue when a historical first non-owner view predates enablement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
    mocks.ensureTransactionalEmailEnabled.mockResolvedValue({
      enabledAt: "2026-01-01T00:00:00.000Z",
    });
    const { db } = createStatefulDb(
      {
        id: "viewer-later",
        recordingId: "rec-example",
        viewerKey: "anon:later-session",
        viewerEmail: null,
        viewerName: "anon:later-session",
        totalWatchMs: 0,
        completedPct: 0,
        countedView: false,
        ctaClicked: false,
      },
      [
        {
          id: "historical-view",
          recordingId: "rec-example",
          viewerKey: "anon:historical-session",
          viewSessionId: "legacy:historical-session",
          viewerEmail: null,
          viewedAt: "2025-12-31T23:59:59.000Z",
        },
      ],
    );
    mocks.getDb.mockReturnValue(db);

    await handler(
      makeEvent({ sessionId: "later-session", totalWatchMs: 5000 }) as any,
    );

    expect(mocks.enqueueTransactionalEmail).not.toHaveBeenCalled();
  });

  it("enqueues the genuine first post-enabled non-owner counted view", async () => {
    const { db } = createStatefulDb({
      id: "viewer-first",
      recordingId: "rec-example",
      viewerKey: "anon:first-session",
      viewerEmail: null,
      viewerName: "anon:first-session",
      totalWatchMs: 0,
      completedPct: 0,
      countedView: false,
      ctaClicked: false,
    });
    mocks.getDb.mockReturnValue(db);

    await handler(
      makeEvent({ sessionId: "first-session", totalWatchMs: 5000 }) as any,
    );

    expect(mocks.enqueueTransactionalEmail).toHaveBeenCalledOnce();
    expect(mocks.enqueueTransactionalEmail).toHaveBeenCalledWith(
      "first-view:rec-example",
      {
        type: "first-view",
        recipient: "owner@example.com",
        recordingIds: ["rec-example"],
        requestedBy: "owner@example.com",
      },
    );
  });

  it("concurrent first events share one viewer and preserve monotonic flags", async () => {
    const { db, state } = createStatefulDb();
    mocks.getDb.mockReturnValue(db);

    const [watchResult, completionResult] = await Promise.all([
      handler(
        makeEvent({
          kind: "watch-progress",
          totalWatchMs: 6000,
          viewerEmail: "spoofed@example.com",
        }) as any,
      ),
      handler(
        makeEvent({
          kind: "cta-click",
          completedPct: 80,
          viewSessionId: "open-example",
        }) as any,
      ),
    ]);

    expect(watchResult).toMatchObject({
      ok: true,
      viewerId: state.viewer?.id,
      countedView: true,
    });
    expect(completionResult).toMatchObject({
      ok: true,
      viewerId: state.viewer?.id,
      countedView: true,
    });
    expect(state.viewer).toMatchObject({
      viewerKey: "anon:session-example",
      viewerEmail: null,
      totalWatchMs: 6000,
      completedPct: 80,
      countedView: true,
      ctaClicked: true,
    });
    expect(state.events).toHaveLength(2);
    expect(new Set(state.events.map((event) => event.viewerId))).toEqual(
      new Set([state.viewer?.id]),
    );
  });
});
