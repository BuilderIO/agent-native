import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  readAppState: vi.fn(),
  writeAppState: vi.fn(),
  readIncludeFullVideoInAi: vi.fn(),
  withFullVideoAiInstructions: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => mocks.readAppState(...args),
  writeAppState: (...args: unknown[]) => mocks.writeAppState(...args),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => args,
}));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ select: mocks.select }),
  schema: {
    recordings: { id: "recordings.id" },
    recordingTranscripts: { recordingId: "recordingTranscripts.recordingId" },
  },
}));

vi.mock("../shared/clips-ai-prefs.js", () => ({
  withFullVideoAiInstructions: (...args: unknown[]) =>
    mocks.withFullVideoAiInstructions(...args),
}));

vi.mock("./lib/clips-ai-prefs.js", () => ({
  readIncludeFullVideoInAi: (...args: unknown[]) =>
    mocks.readIncludeFullVideoInAi(...args),
}));

import action from "./generate-workflow";

function setupDatabase() {
  let selectCount = 0;
  mocks.select.mockImplementation(() => {
    const rows =
      selectCount++ === 0
        ? [{ id: "rec_1", title: "Demo recording", description: "" }]
        : [{ status: "complete", fullText: "Transcript" }];
    return {
      from() {
        return this;
      },
      where() {
        return this;
      },
      limit: async () => rows,
    };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupDatabase();
  mocks.assertAccess.mockResolvedValue(undefined);
  mocks.readAppState.mockResolvedValue(null);
  mocks.writeAppState.mockResolvedValue(undefined);
  mocks.readIncludeFullVideoInAi.mockResolvedValue(false);
  mocks.withFullVideoAiInstructions.mockImplementation(
    (message: string) => message,
  );
});

describe("generate-workflow action", () => {
  it("single-flights concurrent requests for one recording", async () => {
    let releaseRead!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      const originalRead = mocks.readAppState.getMockImplementation();
      mocks.readAppState.mockImplementation(async (key: string) => {
        if (key === "clips-workflow-rec_1") {
          resolve();
          await new Promise<void>((release) => {
            releaseRead = release;
          });
        }
        return originalRead ? originalRead(key) : null;
      });
    });

    const first = action.run({ recordingId: "rec_1", kind: "pr" });
    await readStarted;

    await expect(
      action.run({ recordingId: "rec_1", kind: "pr" }),
    ).resolves.toEqual({
      queued: false,
      duplicate: true,
      recordingId: "rec_1",
      kind: "pr",
      stateKey: "clips-workflow-rec_1",
    });

    releaseRead();
    await expect(first).resolves.toMatchObject({ queued: true });
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "clips-ai-request-rec_1",
      expect.any(Object),
    );
  });
});
