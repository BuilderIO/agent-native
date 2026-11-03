import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockGetDb = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", async (original) => ({
  ...(await original<typeof import("@agent-native/core/sharing")>()),
  resolveAccess: async () => ({ role: "owner" }),
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("drizzle-orm", async (original) => ({
  ...(await original<typeof import("drizzle-orm")>()),
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn(),
  inArray: vi.fn(),
  lt: vi.fn(),
  or: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: (...args: unknown[]) => mockGetDb(...args),
  schema: {
    meetings: {
      id: "meetings.id",
      recordingId: "meetings.recordingId",
      transcriptStatus: "meetings.transcriptStatus",
      updatedAt: "meetings.updatedAt",
    },
    meetingParticipants: {
      table: "meetingParticipants",
      meetingId: "meetingParticipants.meetingId",
    },
    meetingActionItems: {
      table: "meetingActionItems",
      meetingId: "meetingActionItems.meetingId",
    },
    recordings: { table: "recordings", id: "recordings.id" },
    recordingTranscripts: {
      table: "recordingTranscripts",
      recordingId: "recordingTranscripts.recordingId",
      fullText: "recordingTranscripts.fullText",
      earlierAudioRemovedAt: "recordingTranscripts.earlierAudioRemovedAt",
    },
  },
}));

vi.mock("../server/lib/recordings.js", () => ({
  nanoid: () => "generated-id",
}));

vi.mock("./cleanup-transcript.js", () => ({
  default: { run: vi.fn() },
}));

vi.mock("./lib/agents-md-context.js", () => ({
  loadAgentsMdContext: vi.fn(),
}));

import finalizeMeeting from "./finalize-meeting";

function createDb(transcriptStatus: "pending" | "ready" = "ready") {
  const meeting = {
    id: "meeting-1",
    recordingId: "recording-1",
    transcriptStatus,
    bulletsJson: "[]",
    actionItemsJson: "[]",
  };
  let selectCount = 0;
  const selectResults = [[meeting], []];
  const select = vi.fn(() => {
    let result: unknown[] = [];
    const builder = {
      from: vi.fn((table) => {
        result =
          table.table === "recordings"
            ? [
                {
                  id: "recording-1",
                  ownerEmail: "owner@example.test",
                  expiresAt: null,
                },
              ]
            : (selectResults[selectCount++] ?? []);
        return builder;
      }),
      where: vi.fn(() => builder),
      limit: vi.fn(async () => result),
    };
    return builder;
  });
  const updateBuilder = {
    set: vi.fn(() => updateBuilder),
    where: vi.fn(async () => []),
  };
  return {
    select,
    update: vi.fn(() => updateBuilder),
  } as any;
}

function createFinalizingDb(removedAtReads: Array<string | null>) {
  const meeting = {
    id: "meeting-1",
    recordingId: "recording-1",
    title: "Weekly sync",
    ownerEmail: "owner@example.test",
    userNotesMd: "",
    transcriptStatus: "ready",
    bulletsJson: "[]",
    actionItemsJson: "[]",
  };
  const updates: Array<Record<string, unknown>> = [];
  const select = vi.fn((fields?: Record<string, unknown>) => {
    let result: unknown[] = [];
    const builder = {
      from: vi.fn((table) => {
        if (table.table === "recordings") {
          result = [
            {
              id: "recording-1",
              ownerEmail: "owner@example.test",
              expiresAt: null,
              hasPassword: false,
            },
          ];
        } else if (table.table === "meetingParticipants") {
          result = [];
        } else if (table.table === "recordingTranscripts") {
          result =
            fields && "removedAt" in fields
              ? [{ removedAt: removedAtReads.shift() ?? null }]
              : [{ status: "ready", fullText: "Them: earlier audio" }];
        } else if (fields && "shareTranscript" in fields) {
          result = [{ recordingId: "recording-1", shareTranscript: false }];
        } else {
          result = fields && "id" in fields ? [] : [meeting];
        }
        return builder;
      }),
      where: vi.fn(() => builder),
      limit: vi.fn(async () => result),
      for: vi.fn(async () => result),
      then: (resolve: (rows: unknown[]) => unknown) => resolve(result),
    };
    return builder;
  });
  const update = vi.fn(() => {
    const builder = {
      set: vi.fn((patch: Record<string, unknown>) => {
        updates.push(patch);
        return builder;
      }),
      where: vi.fn(() => builder),
      returning: vi.fn(async () => [{ id: "meeting-1" }]),
    };
    return builder;
  });
  const tx = {
    select,
    update,
    delete: vi.fn(() => ({ where: vi.fn(async () => []) })),
    insert: vi.fn(() => ({ values: vi.fn(async () => []) })),
  };
  return {
    updates,
    db: {
      ...tx,
      transaction: vi.fn(async (run: (inner: typeof tx) => unknown) => run(tx)),
    },
  };
}

describe("finalize-meeting", () => {
  describe("when earlier audio is removed during a run", () => {
    const summarize = async () => {
      const { default: cleanupTranscript } =
        await import("./cleanup-transcript.js");
      vi.mocked(cleanupTranscript.run).mockResolvedValue({
        summaryMd: "a summary of the removed audio",
        bullets: [],
        actionItems: [],
        provider: "test",
      } as never);
    };

    it("drops the stale summary instead of restoring what was removed", async () => {
      await summarize();
      const { db, updates } = createFinalizingDb([
        null,
        "2026-11-03T10:00:00.000Z",
      ]);
      mockGetDb.mockReturnValue(db);

      await expect(
        runWithRequestContext({ userEmail: "owner@example.test" }, () =>
          finalizeMeeting.run({ meetingId: "meeting-1", force: true }),
        ),
      ).resolves.toMatchObject({ skipped: "transcript-changed" });

      expect(updates.map((patch) => patch.summaryMd)).not.toContain(
        "a summary of the removed audio",
      );
    });

    it("writes the summary when nothing was removed", async () => {
      await summarize();
      const { db, updates } = createFinalizingDb([null, null]);
      mockGetDb.mockReturnValue(db);

      await runWithRequestContext({ userEmail: "owner@example.test" }, () =>
        finalizeMeeting.run({ meetingId: "meeting-1", force: true }),
      );

      expect(updates.map((patch) => patch.summaryMd)).toContain(
        "a summary of the removed audio",
      );
    });

    it("writes the summary of a transcript already cleaned by an earlier removal", async () => {
      await summarize();
      const { db, updates } = createFinalizingDb([
        "2026-11-03T10:00:00.000Z",
        "2026-11-03T10:00:00.000Z",
      ]);
      mockGetDb.mockReturnValue(db);

      await runWithRequestContext({ userEmail: "owner@example.test" }, () =>
        finalizeMeeting.run({ meetingId: "meeting-1", force: true }),
      );

      expect(updates.map((patch) => patch.summaryMd)).toContain(
        "a summary of the removed audio",
      );
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertAccess.mockResolvedValue({ role: "owner" });
  });

  it("treats an automatic finalize race before transcript flush as a skip", async () => {
    const db = createDb();
    mockGetDb.mockReturnValue(db);

    await expect(
      runWithRequestContext({ userEmail: "owner@example.test" }, () =>
        finalizeMeeting.run({ meetingId: "meeting-1" }),
      ),
    ).resolves.toEqual({
      meetingId: "meeting-1",
      summaryMd: "",
      bullets: [],
      actionItems: [],
      provider: null,
      skipped: "no-transcript",
    });
    expect(mockAssertAccess).toHaveBeenCalledWith(
      "meeting",
      "meeting-1",
      "editor",
    );
    expect(db.update).toHaveBeenCalledOnce();
  });

  it("keeps explicit regeneration errors actionable when no transcript exists", async () => {
    const db = createDb();
    mockGetDb.mockReturnValue(db);

    await expect(
      runWithRequestContext({ userEmail: "owner@example.test" }, () =>
        finalizeMeeting.run({ meetingId: "meeting-1", force: true }),
      ),
    ).rejects.toThrow("no transcript text available yet");
  });

  it("leaves a pending meeting retryable while its transcript row is unavailable", async () => {
    const db = createDb("pending");
    mockGetDb.mockReturnValue(db);

    await expect(
      runWithRequestContext({ userEmail: "owner@example.test" }, () =>
        finalizeMeeting.run({ meetingId: "meeting-1", force: true }),
      ),
    ).resolves.toMatchObject({ skipped: "transcript-pending" });
    expect(db.update).not.toHaveBeenCalled();
  });
});
