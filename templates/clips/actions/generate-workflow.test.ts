import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  vi.useRealTimers();
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

    const first = action.run({
      recordingId: "rec_1",
      kind: "pr",
      openInChat: true,
    });
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
    const workflowState = mocks.writeAppState.mock.calls.find(
      ([key]) => key === "clips-workflow-rec_1",
    )?.[1];
    const queuedRequest = mocks.writeAppState.mock.calls.find(
      ([key]) => key === "clips-ai-request-rec_1",
    )?.[1];
    expect(queuedRequest.requestedAt).toBe(workflowState.requestedAt);
    expect(queuedRequest.requestId).toBe(workflowState.requestId);
    expect(queuedRequest.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(queuedRequest.message).toContain("complete-workflow");
    expect(queuedRequest.message).toContain(workflowState.requestId);
    expect(queuedRequest.openInChat).toBe(true);
  });

  it("uses distinct request IDs for requests created in the same millisecond", async () => {
    const now = new Date("2026-09-25T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await action.run({ recordingId: "rec_1", kind: "email" });
    await action.run({ recordingId: "rec_1", kind: "email" });

    const workflowStates = mocks.writeAppState.mock.calls
      .filter(([key]) => key === "clips-workflow-rec_1")
      .map(([, value]) => value);
    const queuedRequests = mocks.writeAppState.mock.calls
      .filter(([key]) => key === "clips-ai-request-rec_1")
      .map(([, value]) => value);

    expect(workflowStates).toHaveLength(2);
    expect(workflowStates[0].requestedAt).toBe(workflowStates[1].requestedAt);
    expect(workflowStates[0].requestId).not.toBe(workflowStates[1].requestId);
    expect(workflowStates[0].requestedAt).toBe(now.toISOString());
    expect(queuedRequests.map((request) => request.requestId)).toEqual(
      workflowStates.map((state) => state.requestId),
    );
  });

  it("does not enqueue when workflow state cannot be read", async () => {
    mocks.readAppState.mockRejectedValueOnce(
      Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
    );

    await expect(
      action.run({ recordingId: "rec_1", kind: "email" }),
    ).rejects.toThrow("connection reset");
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });
});
