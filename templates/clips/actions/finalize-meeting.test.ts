import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAssertAccess = vi.hoisted(() => vi.fn());
const mockGetDb = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core", () => ({
  defineAction: (definition: unknown) => definition,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mockAssertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
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
    recordingTranscripts: {
      recordingId: "recordingTranscripts.recordingId",
      fullText: "recordingTranscripts.fullText",
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

function createDb() {
  const meeting = {
    id: "meeting-1",
    recordingId: "recording-1",
    bulletsJson: "[]",
    actionItemsJson: "[]",
  };
  let selectCount = 0;
  const selectResults = [[meeting], []];
  const select = vi.fn(() => {
    const result = selectResults[selectCount++] ?? [];
    const builder = {
      from: vi.fn(() => builder),
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

describe("finalize-meeting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertAccess.mockResolvedValue({ role: "owner" });
  });

  it("treats an automatic finalize race before transcript flush as a skip", async () => {
    const db = createDb();
    mockGetDb.mockReturnValue(db);

    await expect(
      finalizeMeeting.run({ meetingId: "meeting-1" }),
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
      finalizeMeeting.run({ meetingId: "meeting-1", force: true }),
    ).rejects.toThrow("no transcript text available yet");
  });
});
