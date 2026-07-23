import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Array<Record<string, unknown>>>,
  update: vi.fn(),
  insert: vi.fn(),
  writeAppState: vi.fn(),
}));

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => mocks.rows.shift() ?? []),
      })),
    })),
  })),
  update: (...args: unknown[]) => mocks.update(...args),
  insert: (...args: unknown[]) => mocks.insert(...args),
};

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((column: unknown, value: unknown) => ({ column, value })),
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: {
      id: "recordings.id",
      title: "recordings.title",
      titleSource: "recordings.titleSource",
      description: "recordings.description",
      status: "recordings.status",
    },
    recordingTranscripts: {
      recordingId: "recordingTranscripts.recordingId",
      status: "recordingTranscripts.status",
      fullText: "recordingTranscripts.fullText",
      segmentsJson: "recordingTranscripts.segmentsJson",
    },
  },
}));

vi.mock("../server/lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: vi.fn(),
}));

vi.mock("../server/lib/recordings.js", () => ({
  getCurrentOwnerEmail: vi.fn(() => "owner@example.com"),
}));

import saveBrowserTranscript from "./save-browser-transcript";

describe("save-browser-transcript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows = [];
  });

  it("does not overwrite a pending cloud transcription with an empty native result", async () => {
    mocks.rows = [
      [
        {
          recordingId: "rec-1",
          status: "pending",
          fullText: "",
          segmentsJson: "[]",
        },
      ],
    ];

    const result = await saveBrowserTranscript.run({
      recordingId: "rec-1",
      fullText: "",
      source: "whisper",
      failureReason: "Native transcription returned no speech.",
    });

    expect(result).toEqual({
      recordingId: "rec-1",
      status: "skipped",
      reason: "Transcript attempt already exists",
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
