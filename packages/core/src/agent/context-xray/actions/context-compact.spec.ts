import { beforeEach, describe, expect, it, vi } from "vitest";

const requestUserEmailMock = vi.hoisted(() => vi.fn());
const callerOwnsThreadMock = vi.hoisted(() => vi.fn());
const compactThreadNowMock = vi.hoisted(() => vi.fn());
const getThreadCompactionStatusMock = vi.hoisted(() => vi.fn());

vi.mock("../../../server/request-context.js", () => ({
  getRequestUserEmail: () => requestUserEmailMock(),
  getRequestOrgId: () => "org-1",
}));
vi.mock("../../run-ownership.js", () => ({
  callerOwnsThread: (...args: unknown[]) => callerOwnsThreadMock(...args),
}));
vi.mock("../../observational-memory/compactor.js", () => ({
  compactThreadNow: (...args: unknown[]) => compactThreadNowMock(...args),
  getThreadCompactionStatus: (...args: unknown[]) =>
    getThreadCompactionStatusMock(...args),
}));

const { default: compact } = await import("./context-compact.js");
const { default: compactionGet } = await import("./context-compaction-get.js");

beforeEach(() => {
  vi.clearAllMocks();
  requestUserEmailMock.mockReturnValue("owner@example.com");
  callerOwnsThreadMock.mockResolvedValue(true);
  getThreadCompactionStatusMock.mockResolvedValue({
    unobservedTokens: 52_000,
    observationTokenThreshold: 30_000,
    tokensUntilAutoCompact: 0,
  });
});

describe("context-compact", () => {
  it("compacts the owner's thread and reports what it replaced", async () => {
    compactThreadNowMock.mockResolvedValue({
      observer: {
        observed: true,
        unobservedTokens: 52_000,
        entry: { tokenEstimate: 1_800 },
      },
      reflector: { reflected: false, observationLogTokens: 1_800 },
    });

    const result = await compact.run({ threadId: "thread-1" });

    expect(compactThreadNowMock).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      orgId: "org-1",
      threadId: "thread-1",
    });
    expect(result).toMatchObject({
      threadId: "thread-1",
      status: "compacted",
      compactedTokens: 52_000,
      observationTokens: 1_800,
      reflected: false,
    });
  });

  it("says when there is nothing left to compact", async () => {
    compactThreadNowMock.mockResolvedValue({
      observer: { observed: false, unobservedTokens: 0 },
      reflector: { reflected: false, observationLogTokens: 0 },
    });
    await expect(compact.run({ threadId: "thread-1" })).resolves.toMatchObject({
      status: "nothing-to-compact",
      compactedTokens: 0,
    });
  });

  it("fails instead of reporting success when no summary was produced", async () => {
    compactThreadNowMock.mockResolvedValue({
      observer: { observed: false, unobservedTokens: 9_000 },
      reflector: { reflected: false, observationLogTokens: 0 },
    });
    await expect(compact.run({ threadId: "thread-1" })).rejects.toMatchObject({
      errorCode: "compaction_empty",
    });
  });

  it("refuses when the compaction cursor is ahead of the saved thread", async () => {
    getThreadCompactionStatusMock.mockResolvedValue({
      unobservedTokens: 0,
      observationTokenThreshold: 30_000,
    });
    await expect(compact.run({ threadId: "thread-1" })).rejects.toMatchObject({
      errorCode: "compaction_cursor_ahead",
    });
    expect(compactThreadNowMock).not.toHaveBeenCalled();
  });

  it("surfaces a model failure as a typed error", async () => {
    compactThreadNowMock.mockRejectedValue(new Error("No model credentials"));
    await expect(compact.run({ threadId: "thread-1" })).rejects.toMatchObject({
      errorCode: "compaction_failed",
      message: expect.stringContaining("No model credentials"),
    });
  });

  it("refuses a thread the caller does not own", async () => {
    callerOwnsThreadMock.mockResolvedValue(false);
    await expect(compact.run({ threadId: "thread-2" })).rejects.toMatchObject({
      errorCode: "not_found",
      statusCode: 404,
    });
    expect(callerOwnsThreadMock).toHaveBeenCalledWith(
      "owner@example.com",
      "thread-2",
    );
    expect(compactThreadNowMock).not.toHaveBeenCalled();
  });

  it("requires a signed-in caller", async () => {
    requestUserEmailMock.mockReturnValue(undefined);
    await expect(compact.run({ threadId: "thread-1" })).rejects.toMatchObject({
      errorCode: "auth_required",
      statusCode: 401,
    });
    expect(compactThreadNowMock).not.toHaveBeenCalled();
  });
});

describe("context-compaction-get", () => {
  it("returns the owner's distance to automatic compaction", async () => {
    getThreadCompactionStatusMock.mockResolvedValue({
      unobservedTokens: 12_000,
      observationTokenThreshold: 30_000,
      tokensUntilAutoCompact: 18_000,
    });
    await expect(compactionGet.run({ threadId: "thread-1" })).resolves.toEqual({
      threadId: "thread-1",
      unobservedTokens: 12_000,
      observationTokenThreshold: 30_000,
      tokensUntilAutoCompact: 18_000,
    });
  });

  it("refuses a thread the caller does not own", async () => {
    callerOwnsThreadMock.mockResolvedValue(false);
    await expect(
      compactionGet.run({ threadId: "thread-2" }),
    ).rejects.toMatchObject({ errorCode: "not_found" });
    expect(getThreadCompactionStatusMock).not.toHaveBeenCalled();
  });
});
