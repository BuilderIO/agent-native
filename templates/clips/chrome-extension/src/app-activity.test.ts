import {
  MAX_APP_ACTIVITY_BYTES,
  MAX_APP_ACTIVITY_EVENTS,
  type RecorderEvent,
  type RecorderReport,
} from "@shared/app-activity";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
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
