import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  transcriptText: "Recovered meeting transcript",
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
          if (state.selectCall === 1) {
            return Promise.resolve([
              {
                id: "meeting_1",
                recordingId: "rec_1",
                ownerEmail: "owner@example.com",
                orgId: "org_1",
                updatedAt: "2026-07-06T08:00:00.000Z",
                scheduledEnd: "2026-07-06T08:30:00.000Z",
              },
            ]);
          }
          if (state.selectCall === 4) return Promise.resolve([]);
          return {
            limit: async () => [
              state.selectCall === 2
                ? { updatedAt: "2026-07-06T08:45:00.000Z" }
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

describe("stale-meeting-sweeper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.transcriptText = "Recovered meeting transcript";
    state.selectCall = 0;
    state.requestContexts = [];
    state.updateSets = [];
  });

  it("finalizes recovered stale meetings with transcript text", async () => {
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
});
