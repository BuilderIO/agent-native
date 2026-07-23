import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadBody = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockDispatchPostFinalizeJob = vi.hoisted(() => vi.fn());
const mockRunWithRequestContext = vi.hoisted(() => vi.fn());
const mockVerifyScopedAgentAccessToken = vi.hoisted(() => vi.fn());
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
        },
      ]),
    };
    return builder;
  }),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  readBody: (...args: unknown[]) => mockReadBody(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn(() => "eq") }));

vi.mock("@agent-native/core/server", () => ({
  runWithRequestContext: (...args: unknown[]) =>
    mockRunWithRequestContext(...args),
  verifyScopedAgentAccessToken: (...args: unknown[]) =>
    mockVerifyScopedAgentAccessToken(...args),
}));

vi.mock("../../../../actions/finalize-recording.js", () => ({
  default: { run: vi.fn() },
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
    },
  },
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
});
