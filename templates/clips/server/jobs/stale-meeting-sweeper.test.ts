import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  transcriptText: "Recovered meeting transcript",
  // Overridable per test: the candidate row(s) the main query returns, and
  // the transcript's last-activity timestamp (the second select in the loop).
  candidates: [] as Array<Record<string, unknown>>,
  transcriptUpdatedAt: "2026-07-06T08:45:00.000Z",
  selectCall: 0,
  requestContexts: [] as Array<Record<string, unknown>>,
  updateSets: [] as Array<Record<string, unknown>>,
}));

const finalizeRun = vi.hoisted(() => vi.fn(async () => ({ ok: true })));

vi.mock("@agent-native/core/server/request-context", () => ({
  runWithRequestContext: async (
    ctx: Record<string, unknown>,
    fn: () => Promise<unknown>,
  ) => {
    state.requestContexts.push(ctx);
    return fn();
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
  isNotNull: vi.fn((column: unknown) => ({ column, op: "isNotNull" })),
  isNull: vi.fn((column: unknown) => ({ column, op: "isNull" })),
  lt: vi.fn((column: unknown, value: unknown) => ({ column, value, op: "lt" })),
  or: vi.fn((...args: unknown[]) => args),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: strings.join("?"),
    values,
  })),
}));

vi.mock("../../actions/finalize-meeting.js", () => ({
  default: {
    run: finalizeRun,
  },
}));

vi.mock("../db/index.js", () => {
  const schema = {
    meetings: {
      id: "meetings.id",
      recordingId: "meetings.recordingId",
      ownerEmail: "meetings.ownerEmail",
      orgId: "meetings.orgId",
      updatedAt: "meetings.updatedAt",
      scheduledEnd: "meetings.scheduledEnd",
      actualStart: "meetings.actualStart",
      actualEnd: "meetings.actualEnd",
      trashedAt: "meetings.trashedAt",
      transcriptStatus: "meetings.transcriptStatus",
    },
    recordingTranscripts: {
      fullText: "recordingTranscripts.fullText",
      updatedAt: "recordingTranscripts.updatedAt",
      recordingId: "recordingTranscripts.recordingId",
    },
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      orgId: "recordings.orgId",
      status: "recordings.status",
      updatedAt: "recordings.updatedAt",
    },
  };

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          state.selectCall += 1;
          // Call 1: the main stale-candidates query.
          if (state.selectCall === 1) return Promise.resolve(state.candidates);
          // Call 4: sweepStalePendingFinalizes — no stuck pending rows here.
          if (state.selectCall === 4) return Promise.resolve([]);
          // Calls 2 & 3: transcript lastActivity lookup, then closeOutStaleMeeting's
          // hasTranscript lookup — both go through `.limit(1)`.
          return {
            limit: async () => [
              state.selectCall === 2
                ? { updatedAt: state.transcriptUpdatedAt }
                : { fullText: state.transcriptText },
            ],
          };
        }),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        state.updateSets.push(values);
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{ id: "meeting_1" }]),
          })),
        };
      }),
    })),
  };

  return {
    getDb: () => db,
    schema,
  };
});

// Fixed reference point so relative "N minutes/hours ago" offsets below don't
// flake against real wall-clock time.
const NOW_MS = Date.parse("2026-07-06T09:00:00.000Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function isoMinutesAgo(minutes: number): string {
  return new Date(NOW_MS - minutes * MIN).toISOString();
}

describe("stale-meeting-sweeper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    state.transcriptText = "Recovered meeting transcript";
    // Default fixture is deliberately clear of every time-bound predicate
    // (scheduledEnd only 5 min ago, well inside the 20-min grace) so tests 1
    // & 2 below isolate the original no-activity rule, and each time-bound
    // test overrides scheduledEnd/actualStart/transcriptUpdatedAt itself.
    state.candidates = [
      {
        id: "meeting_1",
        recordingId: "rec_1",
        ownerEmail: "owner@example.com",
        orgId: "org_1",
        updatedAt: isoMinutesAgo(70),
        scheduledEnd: isoMinutesAgo(5),
        actualStart: isoMinutesAgo(90),
      },
    ];
    state.transcriptUpdatedAt = isoMinutesAgo(70);
    state.selectCall = 0;
    state.requestContexts = [];
    state.updateSets = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("finalizes recovered stale meetings with transcript text (60-min no-activity rule)", async () => {
    const { runStaleMeetingSweepOnce } =
      await import("./stale-meeting-sweeper.js");

    await runStaleMeetingSweepOnce();

    expect(finalizeRun).toHaveBeenCalledWith({ meetingId: "meeting_1" });
    expect(state.requestContexts).toContainEqual({
      userEmail: "owner@example.com",
      orgId: "org_1",
    });
    expect(state.updateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transcriptStatus: "ready" }),
        expect.objectContaining({ status: "ready" }),
      ]),
    );
  });

  it("does not finalize recovered meetings without transcript text", async () => {
    const { runStaleMeetingSweepOnce } =
      await import("./stale-meeting-sweeper.js");
    state.transcriptText = "";

    await runStaleMeetingSweepOnce();

    expect(finalizeRun).not.toHaveBeenCalled();
    expect(state.updateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transcriptStatus: "failed" }),
      ]),
    );
  });

  it("does not close a scheduled meeting only 10 min past end with fresh activity", async () => {
    const { runStaleMeetingSweepOnce } =
      await import("./stale-meeting-sweeper.js");
    state.candidates[0].scheduledEnd = isoMinutesAgo(10);
    state.transcriptUpdatedAt = isoMinutesAgo(1);

    await runStaleMeetingSweepOnce();

    expect(state.updateSets).toEqual([]);
  });

  it("(a) does not close a scheduled meeting 25 min past end with activity 1 min ago", async () => {
    const { runStaleMeetingSweepOnce } =
      await import("./stale-meeting-sweeper.js");
    state.candidates[0].scheduledEnd = isoMinutesAgo(25);
    state.transcriptUpdatedAt = isoMinutesAgo(1);

    await runStaleMeetingSweepOnce();

    expect(state.updateSets).toEqual([]);
  });

  it("(b) closes a scheduled meeting 25 min past end once activity is 6 min old", async () => {
    const { runStaleMeetingSweepOnce } =
      await import("./stale-meeting-sweeper.js");
    state.candidates[0].scheduledEnd = isoMinutesAgo(25);
    state.transcriptUpdatedAt = isoMinutesAgo(6);

    await runStaleMeetingSweepOnce();

    expect(state.updateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actualEnd: expect.objectContaining({
            values: expect.arrayContaining([isoMinutesAgo(6)]),
          }),
        }),
      ]),
    );
  });

  it("does not close a 1-hour-old ad-hoc meeting with fresh activity", async () => {
    const { runStaleMeetingSweepOnce } =
      await import("./stale-meeting-sweeper.js");
    state.candidates[0].scheduledEnd = null;
    state.candidates[0].actualStart = new Date(NOW_MS - 1 * HOUR).toISOString();
    state.transcriptUpdatedAt = isoMinutesAgo(1);

    await runStaleMeetingSweepOnce();

    expect(state.updateSets).toEqual([]);
  });

  it("(c) does not close a 5-hour-old ad-hoc meeting with activity 1 min ago", async () => {
    const { runStaleMeetingSweepOnce } =
      await import("./stale-meeting-sweeper.js");
    state.candidates[0].scheduledEnd = null;
    state.candidates[0].actualStart = new Date(NOW_MS - 5 * HOUR).toISOString();
    state.transcriptUpdatedAt = isoMinutesAgo(1);

    await runStaleMeetingSweepOnce();

    expect(state.updateSets).toEqual([]);
  });

  it("only considers meetings whose scheduledEnd has passed or is unset", async () => {
    // The gate lives in the candidate query, which this mock does not
    // evaluate — assert the query shape instead of the outcome.
    const { or } = await import("drizzle-orm");
    const { runStaleMeetingSweepOnce } =
      await import("./stale-meeting-sweeper.js");

    await runStaleMeetingSweepOnce();

    expect(vi.mocked(or)).toHaveBeenCalledWith(
      { column: "meetings.scheduledEnd", op: "isNull" },
      expect.objectContaining({ column: "meetings.scheduledEnd", op: "lt" }),
    );
  });

  it("stamps a first-write-wins end reason when closing a stale meeting", async () => {
    const { runStaleMeetingSweepOnce } =
      await import("./stale-meeting-sweeper.js");

    await runStaleMeetingSweepOnce();

    const closing = state.updateSets.find((set) => "endReason" in set) as
      | { endReason: { sql: string; values: unknown[] } }
      | undefined;
    expect(closing?.endReason.sql).toContain("coalesce(");
    expect(closing?.endReason.values).toContain(
      "sweeper:no-transcript-activity",
    );
  });

  it("(d) closes a 13-hour-old ad-hoc meeting via the hard cap even with activity 1 min ago", async () => {
    const { runStaleMeetingSweepOnce } =
      await import("./stale-meeting-sweeper.js");
    state.candidates[0].scheduledEnd = null;
    state.candidates[0].actualStart = new Date(
      NOW_MS - 13 * HOUR,
    ).toISOString();
    state.transcriptUpdatedAt = isoMinutesAgo(1);

    await runStaleMeetingSweepOnce();

    expect(state.updateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actualEnd: expect.objectContaining({
            values: expect.arrayContaining([isoMinutesAgo(1)]),
          }),
        }),
      ]),
    );
  });
});
