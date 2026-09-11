import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelectRows = vi.hoisted(() => ({
  queue: [] as Array<Array<Record<string, unknown>>>,
}));
const mockUpdateSet = vi.hoisted(() => vi.fn(() => ({ where: vi.fn() })));
const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));
const mockCleanupTranscriptRun = vi.hoisted(() => vi.fn());

const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => mockSelectRows.queue.shift() ?? []),
      })),
    })),
  })),
  update: vi.fn(() => ({ set: mockUpdateSet })),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => ({ role: "editor" })),
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
      description: "recordings.description",
      updatedAt: "recordings.updatedAt",
    },
    recordingTranscripts: {
      recordingId: "recordingTranscripts.recordingId",
    },
  },
}));

vi.mock("../shared/clips-ai-prefs.js", () => ({
  withFullVideoAiInstructions: (message: string) => message,
}));

vi.mock("./cleanup-transcript.js", () => ({
  default: { run: (...args: unknown[]) => mockCleanupTranscriptRun(...args) },
}));

vi.mock("./lib/clips-ai-prefs.js", () => ({
  readIncludeFullVideoInAi: vi.fn(async () => false),
}));

import regenerateSummary from "./regenerate-summary";

describe("regenerate-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectRows.queue = [];
    mockCleanupTranscriptRun.mockResolvedValue({
      summaryMd: "A concise summary.",
      provider: "builder",
    });
  });

  it("uses the server cleanup path instead of starting an agent turn", async () => {
    mockSelectRows.queue = [
      [{ id: "rec_1", title: "A Clip", description: "" }],
      [{ status: "ready", fullText: "The transcript." }],
    ];

    const result = await regenerateSummary.run({ recordingId: "rec_1" });

    expect(mockCleanupTranscriptRun).toHaveBeenCalledWith({
      transcript: "The transcript.",
      task: "summary",
      context: "Clip title: A Clip",
    });
    expect(mockUpdateSet).toHaveBeenCalledWith({
      description: "A concise summary.",
      updatedAt: expect.any(String),
    });
    expect(mockWriteAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.any(Object),
    );
    expect(mockWriteAppState).not.toHaveBeenCalledWith(
      "clips-ai-request-rec_1",
      expect.anything(),
    );
    expect(result).toMatchObject({
      updated: true,
      recordingId: "rec_1",
      description: "A concise summary.",
      provider: "builder",
    });
  });
});
