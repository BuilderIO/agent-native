import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadBody = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockDispatchPostFinalizeJob = vi.hoisted(() => vi.fn());
const mockRunWithRequestContext = vi.hoisted(() => vi.fn());
const mockVerifyScopedAgentAccessToken = vi.hoisted(() => vi.fn());
const mockRunLoomImportJob = vi.hoisted(() => vi.fn());
const mockFinalizeRun = vi.hoisted(() => vi.fn());
const mockUpdateReturning = vi.hoisted(() =>
  vi.fn(async () => [{ id: "rec-1" }]),
);
const mockDb = vi.hoisted(() => ({
  select: vi.fn(() => {
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn(() => builder),
      limit: vi.fn(async () => [
        {
          id: "rec-1",
          ownerEmail: "owner@example.test",
          orgId: "org-1",
          status: "processing",
          uploadGenerationId: "generation-1",
        },
      ]),
    };
    return builder;
  }),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({ returning: mockUpdateReturning })),
    })),
  })),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  readBody: (...args: unknown[]) => mockReadBody(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => "and"),
  eq: vi.fn(() => "eq"),
  isNull: vi.fn(() => "isNull"),
  lt: vi.fn(() => "lt"),
  or: vi.fn(() => "or"),
}));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (...args: unknown[]) =>
    mockRunWithRequestContext(...args),
  verifyScopedAgentAccessToken: (...args: unknown[]) =>
    mockVerifyScopedAgentAccessToken(...args),
}));

vi.mock("../../../../actions/finalize-recording.js", () => ({
  default: { run: (...args: unknown[]) => mockFinalizeRun(...args) },
}));

vi.mock("../../../../actions/lib/ensure-seekable-video.js", () => ({
  ensureRecordingSeekable: vi.fn(),
}));

vi.mock("../../../../actions/request-transcript.js", () => ({
  default: { run: vi.fn() },
}));

vi.mock("../../../db/index.js", () => ({
  getDb: () => mockDb,
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      orgId: "recordings.orgId",
      status: "recordings.status",
      uploadGenerationId: "recordings.uploadGenerationId",
      loomImportClaimId: "recordings.loomImportClaimId",
      loomImportClaimedAt: "recordings.loomImportClaimedAt",
    },
  },
}));

vi.mock("../../../../actions/lib/loom-import-job.js", () => ({
  runLoomImportJob: (...args: unknown[]) => mockRunLoomImportJob(...args),
}));

vi.mock("../../../lib/post-finalize-dispatch.js", () => ({
  dispatchPostFinalizeJob: (...args: unknown[]) =>
    mockDispatchPostFinalizeJob(...args),
  POST_FINALIZE_JOB_TOKEN_KIND: "post-finalize-job",
  postFinalizeJobResourceId: vi.fn(() => "rec-1:media-ready"),
}));

vi.mock("../../../../actions/export-to-brain.js", () => ({
  default: { run: vi.fn() },
}));

import handler from "./post-finalize-worker.post";

describe("post-finalize worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockReadBody.mockResolvedValue({
      recordingId: "rec-1",
      kind: "media-ready",
      token: "valid-token",
      delayMs: 1_000,
      retryAttempt: 2,
    });
    mockVerifyScopedAgentAccessToken.mockReturnValue({ ok: true });
    mockRunWithRequestContext.mockImplementation(
      (_context: unknown, callback: () => unknown) => callback(),
    );
    mockDispatchPostFinalizeJob.mockResolvedValue({ accepted: true });
    mockFinalizeRun.mockResolvedValue({ status: "processing" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("requires acceptance when re-dispatching delayed media verification", async () => {
    const pending = handler({} as any);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toMatchObject({
      ok: true,
      kind: "media-ready",
      retryAttempt: 2,
    });
    expect(mockDispatchPostFinalizeJob).toHaveBeenCalledWith({
      recordingId: "rec-1",
      kind: "media-ready",
      retryAttempt: 2,
      regenerate: undefined,
      requireAccepted: true,
    });
  });

  it("claims a Loom import before running its side effects", async () => {
    mockReadBody.mockResolvedValue({
      recordingId: "rec-1",
      kind: "loom-import",
      token: "valid-token",
    });
    mockRunLoomImportJob.mockResolvedValue({ status: "ready" });

    await expect(handler({} as any)).resolves.toMatchObject({
      ok: true,
      kind: "loom-import",
      result: { status: "ready" },
    });
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockRunLoomImportJob).toHaveBeenCalledWith({
      recordingId: "rec-1",
      ownerEmail: "owner@example.test",
      claimId: expect.any(String),
    });
  });

  it("re-enters finalization with the processing row generation", async () => {
    mockReadBody.mockResolvedValue({
      recordingId: "rec-1",
      kind: "media-ready",
      token: "valid-token",
      retryAttempt: 2,
    });
    await expect(handler({} as any)).resolves.toMatchObject({
      ok: true,
      kind: "media-ready",
    });
    expect(mockFinalizeRun).toHaveBeenCalledWith({
      id: "rec-1",
      mediaVerificationRetryAttempt: 2,
      uploadGenerationId: "generation-1",
    });
  });

  it("skips a Loom import when its atomic claim is already held", async () => {
    mockReadBody.mockResolvedValue({
      recordingId: "rec-1",
      kind: "loom-import",
      token: "valid-token",
    });
    mockUpdateReturning.mockResolvedValueOnce([]);

    await expect(handler({} as any)).resolves.toMatchObject({
      ok: true,
      kind: "loom-import",
      skipped: true,
      reason: "loom-import-already-running",
    });
    expect(mockRunLoomImportJob).not.toHaveBeenCalled();
  });
});
