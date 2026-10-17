import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  compareAndSetManyAppState: vi.fn(),
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
  compareAndSetManyAppState: (...args: unknown[]) =>
    mocks.compareAndSetManyAppState(...args),
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
      selectCount++ % 2 === 0
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
  mocks.compareAndSetManyAppState.mockResolvedValue(true);
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
    const operations = mocks.compareAndSetManyAppState.mock.calls[0][0];
    const workflowState = operations.find(
      (operation: { key: string }) => operation.key === "clips-workflow-rec_1",
    )?.nextValue;
    const queuedRequest = operations.find(
      (operation: { key: string }) =>
        operation.key === "clips-ai-request-rec_1",
    )?.nextValue;
    expect(operations).toHaveLength(2);
    expect(mocks.writeAppState).toHaveBeenCalledTimes(1);
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.any(Object),
    );
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

    const operations = mocks.compareAndSetManyAppState.mock.calls.map(
      ([claim]) => claim,
    );
    const workflowStates = operations.map(
      (claim: Array<{ key: string; nextValue: Record<string, unknown> }>) =>
        claim.find((operation) => operation.key === "clips-workflow-rec_1")
          ?.nextValue,
    );
    const queuedRequests = operations.map(
      (claim: Array<{ key: string; nextValue: Record<string, unknown> }>) =>
        claim.find((operation) => operation.key === "clips-ai-request-rec_1")
          ?.nextValue,
    );

    expect(workflowStates).toHaveLength(2);
    expect(workflowStates[0].requestedAt).toBe(workflowStates[1].requestedAt);
    expect(workflowStates[0].requestId).not.toBe(workflowStates[1].requestId);
    expect(workflowStates[0].requestedAt).toBe(now.toISOString());
    expect(queuedRequests.map((request) => request.requestId)).toEqual(
      workflowStates.map((state) => state.requestId),
    );
  });

  it("replaces an expired generation with a new atomic claim", async () => {
    const now = new Date("2026-09-25T12:00:00.000Z");
    const staleWorkflow = {
      kind: "pr",
      status: "generating",
      recordingId: "rec_1",
      requestedAt: "2026-09-25T11:49:00.000Z",
      requestId: "old-request",
    };
    const staleRequest = {
      kind: "generate-workflow",
      workflowKind: "pr",
      recordingId: "rec_1",
      requestedAt: staleWorkflow.requestedAt,
      requestId: staleWorkflow.requestId,
    };
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mocks.readAppState.mockImplementation(async (key: string) =>
      key === "clips-workflow-rec_1" ? staleWorkflow : staleRequest,
    );

    await expect(
      action.run({ recordingId: "rec_1", kind: "email" }),
    ).resolves.toMatchObject({ queued: true });

    const operations = mocks.compareAndSetManyAppState.mock.calls[0][0];
    const workflowClaim = operations.find(
      (operation: { key: string }) => operation.key === "clips-workflow-rec_1",
    );
    const requestClaim = operations.find(
      (operation: { key: string }) =>
        operation.key === "clips-ai-request-rec_1",
    );
    expect(workflowClaim.expectedValue).toEqual(staleWorkflow);
    expect(workflowClaim.nextValue).toMatchObject({
      kind: "email",
      status: "generating",
      requestedAt: now.toISOString(),
    });
    expect(workflowClaim.nextValue.requestId).not.toBe(staleWorkflow.requestId);
    expect(requestClaim.expectedValue).toEqual(staleRequest);
    expect(requestClaim.nextValue.requestId).toBe(
      workflowClaim.nextValue.requestId,
    );
  });

  it("allows only one action instance to claim and enqueue a workflow", async () => {
    const stored = new Map<string, Record<string, unknown>>();
    let claimCount = 0;
    let releaseClaims!: () => void;
    const bothClaimsReady = new Promise<void>((resolve) => {
      releaseClaims = resolve;
    });
    mocks.readAppState.mockImplementation(
      async (key: string) => stored.get(key) ?? null,
    );
    mocks.compareAndSetManyAppState.mockImplementation(
      async (
        operations: Array<{
          key: string;
          expectedValue: Record<string, unknown> | null;
          nextValue: Record<string, unknown> | null;
        }>,
      ) => {
        claimCount += 1;
        if (claimCount === 2) releaseClaims();
        await bothClaimsReady;

        const matches = operations.every(
          ({ key, expectedValue }) =>
            JSON.stringify(stored.get(key) ?? null) ===
            JSON.stringify(expectedValue),
        );
        if (!matches) return false;
        for (const { key, nextValue } of operations) {
          if (nextValue === null) stored.delete(key);
          else stored.set(key, nextValue);
        }
        return true;
      },
    );

    vi.resetModules();
    const secondAction = (await import("./generate-workflow")).default;
    const results = await Promise.all([
      action.run({ recordingId: "rec_1", kind: "pr" }),
      secondAction.run({ recordingId: "rec_1", kind: "email" }),
    ]);

    expect(results.filter((result) => result.queued === true)).toHaveLength(1);
    expect(results.filter((result) => result.duplicate === true)).toHaveLength(
      1,
    );
    expect(mocks.compareAndSetManyAppState).toHaveBeenCalledTimes(2);
    expect(stored.get("clips-workflow-rec_1")?.status).toBe("generating");
    expect(stored.get("clips-ai-request-rec_1")?.requestId).toBe(
      stored.get("clips-workflow-rec_1")?.requestId,
    );
    expect(mocks.writeAppState).toHaveBeenCalledTimes(1);
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.any(Object),
    );
  });

  it("returns a retry result when a claim loses without a recent active workflow", async () => {
    mocks.compareAndSetManyAppState.mockResolvedValue(false);

    await expect(
      action.run({ recordingId: "rec_1", kind: "email" }),
    ).resolves.toEqual({
      queued: false,
      duplicate: false,
      retry: true,
      reason: "claim-contended",
      recordingId: "rec_1",
      kind: "email",
      stateKey: "clips-workflow-rec_1",
    });
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it("does not enqueue when workflow state cannot be read", async () => {
    mocks.readAppState.mockRejectedValueOnce(
      Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
    );

    await expect(
      action.run({ recordingId: "rec_1", kind: "email" }),
    ).rejects.toThrow("connection reset");
    expect(mocks.writeAppState).not.toHaveBeenCalled();
    expect(mocks.compareAndSetManyAppState).not.toHaveBeenCalled();
  });
});
