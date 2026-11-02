import {
  MAX_APP_ACTIVITY_BYTES,
  MAX_APP_ACTIVITY_EVENTS,
  type RecorderEvent,
  type RecorderReport,
} from "@shared/app-activity";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AppActivityCollector,
  type AppActivityRead,
  AppActivityReadTimeoutError,
  buildAppActivity,
  diagnosticsClockMs,
  MAX_RECORDER_REPORT_CHARS,
  parseRecorderReportResult,
  readRecorderReport,
  stopReadSeconds,
  withReadTimeout,
} from "./app-activity";

const START = 1_760_000_000_000;
const clock = { startedAtMs: START, pauses: [] };

function report(overrides: Partial<RecorderReport> = {}): RecorderReport {
  return {
    app: "design",
    build: "dev",
    url: "/designs/:id",
    at: new Date(START).toISOString(),
    reason: "manual",
    windowSeconds: 120,
    events: [],
    watched: {},
    pending: [],
    dropped: 0,
    ...overrides,
  };
}

function event(at: number, overrides: Partial<RecorderEvent> = {}) {
  return {
    t: 0,
    at,
    type: "action" as const,
    name: "update-file",
    ...overrides,
  };
}

function read(
  readAtMs: number,
  overrides: Partial<RecorderReport> = {},
): AppActivityRead {
  const parsed = parseRecorderReportResult(
    { status: "ok", json: JSON.stringify(report(overrides)) },
    readAtMs,
  );
  if (parsed.status !== "ok") throw new Error(`fixture: ${parsed.status}`);
  return parsed.read;
}

describe("readRecorderReport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports a page without the agent-native recorder as absent", () => {
    vi.stubGlobal("window", {});
    expect(readRecorderReport(30, MAX_RECORDER_REPORT_CHARS)).toEqual({
      status: "absent",
    });
  });

  it("asks the recorder for the requested window and returns its JSON", () => {
    const reportFn = vi.fn(() => report());
    vi.stubGlobal("window", { __agentNativeRecorder: { report: reportFn } });
    const result = readRecorderReport(30, MAX_RECORDER_REPORT_CHARS);
    expect(reportFn).toHaveBeenCalledWith({ seconds: 30 });
    expect(result).toEqual({ status: "ok", json: JSON.stringify(report()) });
  });

  it("refuses a report over the size limit instead of transferring it", () => {
    vi.stubGlobal("window", {
      __agentNativeRecorder: { report: () => report({ app: "x".repeat(50) }) },
    });
    expect(readRecorderReport(30, 40)).toMatchObject({ status: "too-large" });
  });

  it("returns a failure when the recorder throws", () => {
    vi.stubGlobal("window", {
      __agentNativeRecorder: {
        report: () => {
          throw new Error("disabled");
        },
      },
    });
    expect(readRecorderReport(30, MAX_RECORDER_REPORT_CHARS)).toEqual({
      status: "failed",
      error: "disabled",
    });
  });
});

describe("withReadTimeout", () => {
  afterEach(() => vi.useRealTimers());

  it("passes a prompt read through", async () => {
    await expect(withReadTimeout(Promise.resolve("report"))).resolves.toBe(
      "report",
    );
  });

  it("gives up on a page that never answers", async () => {
    vi.useFakeTimers();
    const read = withReadTimeout(new Promise(() => {}), 2_000);
    vi.advanceTimersByTime(2_000);
    await expect(read).rejects.toBeInstanceOf(AppActivityReadTimeoutError);
  });
});

describe("stopReadSeconds", () => {
  it("covers the recording, plus the lookback when there was no start read", () => {
    expect(stopReadSeconds(START, START + 9_500, true)).toBe(11);
    expect(stopReadSeconds(START, START + 9_500, false)).toBe(41);
  });
});

describe("parseRecorderReportResult", () => {
  it("refuses an oversized report before parsing it, whatever the page claims", () => {
    expect(
      parseRecorderReportResult(
        { status: "ok", json: " ".repeat(MAX_RECORDER_REPORT_CHARS + 1) },
        0,
      ),
    ).toMatchObject({ status: "failed" });
  });

  it("keeps a missing recorder distinct from an unreadable one", () => {
    expect(parseRecorderReportResult({ status: "absent" }, START)).toEqual({
      status: "absent",
    });
    expect(parseRecorderReportResult(undefined, START)).toMatchObject({
      status: "failed",
    });
    expect(
      parseRecorderReportResult({ status: "ok", json: "{nope" }, START),
    ).toEqual({ status: "failed", reason: "the report is not JSON" });
  });

  it("rejects a report that does not match the recorder contract", () => {
    const { events: _events, ...withoutEvents } = report();
    expect(
      parseRecorderReportResult(
        { status: "ok", json: JSON.stringify(withoutEvents) },
        START,
      ),
    ).toEqual({
      status: "failed",
      reason: "the report does not match the recorder contract",
    });
  });
});

describe("diagnosticsClockMs", () => {
  it("is negative before the start and leaves out paused time", () => {
    const paused = {
      startedAtMs: START,
      pauses: [
        { startedAtMs: START + 10_000, endedAtMs: START + 15_000 },
        { startedAtMs: START + 30_000, endedAtMs: null },
      ],
    };
    expect(diagnosticsClockMs(START - 4_000, paused)).toBe(-4_000);
    expect(diagnosticsClockMs(START + 5_000, paused)).toBe(5_000);
    expect(diagnosticsClockMs(START + 12_000, paused)).toBe(10_000);
    expect(diagnosticsClockMs(START + 20_000, paused)).toBe(15_000);
    expect(diagnosticsClockMs(START + 40_000, paused)).toBe(25_000);
  });
});

describe("buildAppActivity", () => {
  it("places lookback events before zero and drops ones older than the lookback window", () => {
    const activity = buildAppActivity(
      {
        start: read(START + 20, {
          events: [
            event(START - 31_000, { name: "too-old" }),
            event(START - 12_400, { name: "design-selection", type: "state" }),
          ],
        }),
        stop: null,
      },
      clock,
    );

    expect(activity?.events).toEqual([
      {
        timestampMs: START - 12_400,
        elapsedMs: -12_400,
        type: "state",
        name: "design-selection",
      },
    ]);
    expect(activity?.coverage).toEqual([
      { fromElapsedMs: -30_000, toElapsedMs: 0 },
    ]);
  });

  it("takes each event from one read and pause-adjusts events after the start", () => {
    const shared = event(START + 5, { name: "seen-twice", ms: 40 });
    const activity = buildAppActivity(
      {
        start: read(START + 20, {
          events: [event(START - 1_000, { name: "before" }), shared],
        }),
        stop: read(START + 60_000, {
          events: [
            event(START - 1_000, { name: "before" }),
            shared,
            event(START + 50_000, {
              name: "list-folders",
              ok: false,
              status: 403,
              errorCode: "forbidden_scope",
            }),
          ],
          watched: { inspector: { state: "focus" } },
        }),
      },
      {
        startedAtMs: START,
        pauses: [{ startedAtMs: START + 20_000, endedAtMs: START + 30_000 }],
      },
    );

    expect(
      activity?.events.map((entry) => [entry.name, entry.elapsedMs]),
    ).toEqual([
      ["before", -1_000],
      ["seen-twice", 5],
      ["list-folders", 40_000],
    ]);
    expect(activity?.events[1]).toMatchObject({ durationMs: 40 });
    expect(activity?.watched).toEqual({ inspector: { state: "focus" } });
    expect(activity?.coverage).toEqual([
      { fromElapsedMs: -30_000, toElapsedMs: 50_000 },
    ]);
  });

  it("uses the stop read's lookback when the start read is missing", () => {
    const activity = buildAppActivity(
      {
        start: null,
        stop: read(START + 10_000, {
          events: [event(START - 2_000), event(START + 1_000)],
          windowSeconds: 120,
        }),
      },
      clock,
    );
    expect(activity?.events.map((entry) => entry.elapsedMs)).toEqual([
      -2_000, 1_000,
    ]);
  });

  it("returns nothing when neither read reached the recorder", () => {
    expect(buildAppActivity({ start: null, stop: null }, clock)).toBeNull();
  });

  it("records a gap when the recorder's window is shorter than the recording", () => {
    const activity = buildAppActivity(
      {
        start: read(START, { windowSeconds: 120 }),
        stop: read(START + 300_000, { windowSeconds: 120 }),
      },
      clock,
    );
    expect(activity?.coverage).toEqual([
      { fromElapsedMs: -30_000, toElapsedMs: 0 },
      { fromElapsedMs: 180_000, toElapsedMs: 300_000 },
    ]);
  });

  it("counts malformed events and the recorder's own evictions as dropped", () => {
    const activity = buildAppActivity(
      {
        start: null,
        stop: read(START + 1_000, {
          dropped: 3,
          events: [
            event(START + 10),
            { at: "soon", type: "action" } as unknown as RecorderEvent,
            event(START + 20, { type: "unknown" as RecorderEvent["type"] }),
          ],
        }),
      },
      clock,
    );
    expect(activity?.events).toHaveLength(1);
    expect(activity?.dropped).toBe(5);
  });

  it("takes the recorder's cumulative dropped count from the latest read only", () => {
    const malformed = {
      at: "soon",
      type: "action",
    } as unknown as RecorderEvent;
    const activity = buildAppActivity(
      {
        start: read(START, { dropped: 2, events: [malformed] }),
        stop: read(START + 1_000, {
          dropped: 4,
          events: [malformed, event(START + 10)],
        }),
      },
      clock,
    );
    expect(activity?.dropped).toBe(5);
  });

  it("redacts secrets and bounds page-supplied values", () => {
    const activity = buildAppActivity(
      {
        start: null,
        stop: read(START + 1_000, {
          events: [
            event(START + 10, {
              name: "x".repeat(500),
              data: {
                password: "hunter2",
                header: "Authorization: Bearer abc.def",
                big: "y".repeat(5_000),
              },
            }),
            event(START + 20, {
              data: Object.fromEntries(
                Array.from({ length: 40 }, (_, index) => [
                  `k${index}`,
                  "z".repeat(150),
                ]),
              ),
            }),
          ],
        }),
      },
      clock,
    );
    const [first, second] = activity!.events;
    expect(first.name).toHaveLength(203);
    expect(first.data).toMatchObject({
      password: "<redacted>",
      header: "Authorization: <redacted>",
    });
    expect((first.data!.big as string).length).toBe(203);
    expect(second.data).toEqual({ "[omitted]": "over 2000 characters" });
  });

  it("caps the event count, keeping failures and lookback before the newest", () => {
    const events = [
      event(START - 5_000, { name: "lookback" }),
      event(START + 1, { name: "early-failure", type: "error" }),
      ...Array.from({ length: MAX_APP_ACTIVITY_EVENTS + 10 }, (_, index) =>
        event(START + 100 + index, { name: `later-${index}` }),
      ),
    ];
    const activity = buildAppActivity(
      { start: null, stop: read(START + 60_000, { events }) },
      clock,
    );
    const names = activity!.events.map((entry) => entry.name);
    expect(names).toHaveLength(MAX_APP_ACTIVITY_EVENTS);
    expect(names.slice(0, 2)).toEqual(["lookback", "early-failure"]);
    expect(names).not.toContain("later-11");
    expect(names[names.length - 1]).toBe(
      `later-${MAX_APP_ACTIVITY_EVENTS + 9}`,
    );
    expect(activity!.dropped).toBe(12);
  });

  it("keeps the stored activity under the byte cap", () => {
    const events = Array.from({ length: 1_500 }, (_, index) =>
      event(START + index, {
        data: {
          a: "a".repeat(190),
          b: "b".repeat(190),
          c: "c".repeat(190),
          d: "d".repeat(190),
          index,
        },
      }),
    );
    const activity = buildAppActivity(
      { start: null, stop: read(START + 60_000, { events }) },
      clock,
    );
    const bytes = new TextEncoder().encode(JSON.stringify(activity)).byteLength;
    expect(bytes).toBeLessThanOrEqual(MAX_APP_ACTIVITY_BYTES);
    expect(activity!.events.length).toBeLessThan(1_500);
    expect(activity!.dropped).toBe(1_500 - activity!.events.length);
  });
});

describe("incremental private app collection", () => {
  afterEach(() => vi.useRealTimers());

  function sourceRead(
    now: number,
    events: RecorderEvent[] = [],
    documentId = "design-document",
  ) {
    return {
      status: "ok" as const,
      read: read(now, {
        documentId,
        recordingSince: START - 600_000,
        at: new Date(now).toISOString(),
        windowSeconds: 120,
        events: events.map((entry, index) => ({
          ...entry,
          documentId,
          seq: entry.seq ?? index + 1,
        })),
      }),
    };
  }

  it("retains a middle event after it leaves the source buffer and deduplicates overlapping sequence identities", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const middle = event(START + 45_000, { seq: 1, name: "duplicate-screen" });
    const collector = new AppActivityCollector({
      startedAtMs: START,
      requestedHistorySeconds: 30,
      clock: () => clock,
      read: async () =>
        sourceRead(
          Date.now(),
          Date.now() >= middle.at && Date.now() - middle.at < 120_000
            ? [middle]
            : [],
        ),
    });
    await collector.start();
    for (let ms = 15_000; ms <= 300_000; ms += 15_000) {
      vi.setSystemTime(START + ms);
      await collector.sample();
    }
    const activity = await collector.stop();
    expect(
      activity.events.map((entry) => [entry.name, entry.documentId, entry.seq]),
    ).toEqual([["duplicate-screen", "design-document", 1]]);
    expect(activity.sourceCoverage).toEqual([
      {
        documentId: "design-document",
        fromMs: START - 30_000,
        toMs: START + 300_000,
      },
    ]);
    expect(activity.collectionStatus).toBe("ready");
  });

  it("keeps identical same-millisecond events distinct and treats reload as a new source", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    let documentId = "before-reload";
    const events = [event(START, { seq: 1 }), event(START, { seq: 2 })];
    const collector = new AppActivityCollector({
      startedAtMs: START,
      requestedHistorySeconds: 30,
      clock: () => clock,
      read: async () => sourceRead(Date.now(), events, documentId),
    });
    await collector.start();
    await collector.sample();
    documentId = "after-reload";
    await collector.sample();
    const activity = await collector.stop();
    expect(
      activity.events.map((entry) => [entry.documentId, entry.seq]),
    ).toEqual([
      ["before-reload", 1],
      ["before-reload", 2],
      ["after-reload", 1],
      ["after-reload", 2],
    ]);
  });

  it("reports a five-minute request as partial against two-minute retention", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const collector = new AppActivityCollector({
      startedAtMs: START,
      requestedHistorySeconds: 300,
      clock: () => clock,
      read: async () => sourceRead(Date.now(), [event(START - 110_000)]),
    });
    await collector.start();
    const activity = await collector.stop();
    expect(activity.collectionStatus).toBe("partial");
    expect(activity.events[0]?.elapsedMs).toBe(-110_000);
    expect(activity.gaps).toEqual([
      {
        fromMs: START - 300_000,
        toMs: START - 120_000,
        reason: "source-not-observed",
      },
    ]);
  });

  it("recomputes retained event coordinates using final pauses and does not invent paused footage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START + 30_000);
    const pauses: Array<{ startedAtMs: number; endedAtMs: number }> = [];
    const collector = new AppActivityCollector({
      startedAtMs: START,
      requestedHistorySeconds: 30,
      clock: () => ({ startedAtMs: START, pauses }),
      read: async () =>
        sourceRead(Date.now(), [
          event(START + 15_000, { seq: 1 }),
          event(START + 25_000, { seq: 2 }),
        ]),
    });
    await collector.start();
    pauses.push({ startedAtMs: START + 10_000, endedAtMs: START + 20_000 });
    const activity = await collector.stop(START + 26_000);
    expect(
      activity.events.map((entry) => [
        entry.elapsedMs,
        entry.duringPause === true,
      ]),
    ).toEqual([
      [10_000, true],
      [15_000, false],
    ]);
    expect(activity.requestedWindow?.toMs).toBe(START + 26_000);
  });

  it.each(["absent", "denied", "failed", "unsupported"] as const)(
    "keeps %s distinguishable from successful empty collection",
    async (status) => {
      vi.useFakeTimers();
      vi.setSystemTime(START);
      const collector = new AppActivityCollector({
        startedAtMs: START,
        requestedHistorySeconds: 30,
        clock: () => clock,
        read: async () =>
          status === "absent" ? { status } : { status, reason: "test-outcome" },
      });
      await collector.start();
      const activity = await collector.stop();
      expect(activity.collectionStatus).toBe(
        status === "absent" ? "unsupported" : status,
      );
      expect(
        activity.collectionOutcomes?.[activity.collectionOutcomes.length - 1]
          ?.status,
      ).toBe(status);
      expect(activity.gaps).toEqual([
        { fromMs: START - 30_000, toMs: START, reason: "source-not-observed" },
      ]);
    },
  );

  it("surfaces local quota failure while preserving the collected payload", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const collector = new AppActivityCollector({
      startedAtMs: START,
      requestedHistorySeconds: 30,
      clock: () => clock,
      read: async () => sourceRead(Date.now(), [event(START)]),
      onSnapshot: async () => {
        throw new Error("quota-exceeded");
      },
    });
    await collector.start();
    const activity = await collector.stop();
    expect(activity.collectionStatus).toBe("partial");
    expect(activity.events).toHaveLength(1);
    expect(
      activity.collectionOutcomes?.[activity.collectionOutcomes.length - 1],
    ).toEqual({ atMs: START, status: "failed", reason: "quota-exceeded" });
  });

  it("resumes a retained journal without duplicating original source events", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const options = {
      startedAtMs: START,
      requestedHistorySeconds: 30,
      clock: () => clock,
      read: async () => sourceRead(Date.now(), [event(START)]),
    };
    const first = new AppActivityCollector(options);
    await first.start();
    const persisted = first.snapshot();
    first.cancel();
    vi.setSystemTime(START + 300_000);
    const resumed = new AppActivityCollector({
      ...options,
      initialActivity: persisted,
      read: async () => sourceRead(Date.now()),
    });
    await resumed.start();
    const activity = await resumed.stop();
    expect(activity.events).toHaveLength(1);
    expect(activity.gaps).toEqual([
      { fromMs: START, toMs: START + 180_000, reason: "source-not-observed" },
    ]);
  });
  it("restores source sequence and cumulative drop cursors without counting prior loss twice", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    const result = sourceRead(START, [event(START, { seq: 100 })]);
    result.read.dropped = 7;
    const options = {
      startedAtMs: START,
      requestedHistorySeconds: 30,
      clock: () => clock,
      read: async () => result,
    };
    const first = new AppActivityCollector(options);
    await first.start();
    const persisted = first.snapshot();
    first.cancel();
    const resumed = new AppActivityCollector({
      ...options,
      initialActivity: persisted,
    });
    await resumed.start();
    const activity = await resumed.stop();
    expect(activity.events).toHaveLength(1);
    expect(activity.dropped).toBe(7);
    expect(activity.sourceCursors).toEqual([
      { documentId: "design-document", seq: 100, dropped: 7 },
    ]);
  });

  it("discards an in-flight local snapshot after capture is cancelled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    let resolveRead: (result: ReturnType<typeof sourceRead>) => void = () => {
      throw new Error("missing pending read");
    };
    const persisted = vi.fn(async () => {});
    const collector = new AppActivityCollector({
      startedAtMs: START,
      requestedHistorySeconds: 30,
      clock: () => clock,
      read: () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      onSnapshot: persisted,
    });
    const pending = collector.start();
    await Promise.resolve();
    collector.cancel();
    resolveRead(sourceRead(START, [event(START)]));
    await pending;
    expect(persisted).not.toHaveBeenCalled();
  });
  it("reports bounded source overflow as partial evidence instead of an unhandled poll failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    let document = 0;
    const collector = new AppActivityCollector({
      startedAtMs: START,
      requestedHistorySeconds: 0,
      clock: () => clock,
      read: async () => {
        const result = sourceRead(
          Date.now(),
          [event(Date.now())],
          `document-${document}`,
        );
        result.read.recordingSince = Date.now();
        return result;
      },
    });
    await collector.start();
    for (document = 1; document <= 100; document += 1) {
      vi.setSystemTime(START + document * 1000);
      await collector.sample();
    }
    const activity = await collector.stop();
    expect(activity.collectionStatus).toBe("partial");
    expect(activity.sources).toHaveLength(100);
    expect(activity.events).toHaveLength(100);
    expect(
      activity.collectionOutcomes?.[activity.collectionOutcomes.length - 1],
    ).toMatchObject({
      status: "failed",
      reason: "App activity source limit reached",
    });
    expect(activity.gaps).toContainEqual({
      fromMs: START + 99_000,
      toMs: START + 100_000,
      reason: "collector-failed",
    });
  });
});
