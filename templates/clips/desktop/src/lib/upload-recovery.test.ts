import { describe, expect, it } from "vitest";

import {
  buildStreamingReplayPlan,
  planStreamingRecovery,
  retryConflictDelay,
  retryAttemptIdAfterRestartSignal,
  retryAttemptIdAfterResumeResponse,
} from "./upload-recovery";

const CHUNK_BYTES = 3_932_160;

describe("retryConflictDelay", () => {
  it("accepts only a typed, bounded active-retry delay", () => {
    expect(
      retryConflictDelay({
        resumable: false,
        recoveryEnabled: true,
        status: "uploading",
        reason: "retry_already_active",
        retryAfterMs: 1_500,
      }),
    ).toBe(1_500);
    expect(
      retryConflictDelay({
        resumable: false,
        recoveryEnabled: true,
        status: "uploading",
        reason: "retry_already_active",
        retryAfterMs: 60_000,
      }),
    ).toBe(30_000);
  });

  it("rejects untyped and unreadable conflict delays", () => {
    expect(
      retryConflictDelay({
        resumable: false,
        recoveryEnabled: true,
        status: "uploading",
        reason: "retry_already_active",
      }),
    ).toBeNull();
    expect(
      retryConflictDelay({
        resumable: false,
        recoveryEnabled: true,
        status: "uploading",
        reason: "upload_state_changed",
        retryAfterMs: 1_000,
      }),
    ).toBeNull();
  });
});

describe("retryAttemptIdAfterRestartSignal", () => {
  it("preserves an existing retry claim through a flag rollback", () => {
    expect(retryAttemptIdAfterRestartSignal("attempt-1", false)).toBe(
      "attempt-1",
    );
    expect(retryAttemptIdAfterRestartSignal("attempt-1", true)).toBe(
      "attempt-1",
    );
    expect(retryAttemptIdAfterRestartSignal("attempt-1", undefined)).toBe(
      "attempt-1",
    );
  });
});

describe("retryAttemptIdAfterResumeResponse", () => {
  it("keeps only a server-acknowledged retry claim", () => {
    expect(
      retryAttemptIdAfterResumeResponse("attempt-1", {
        resumable: true,
        recoveryEnabled: true,
        status: "uploading",
        uploadMode: "streaming",
        attemptId: "attempt-1",
        uploadGenerationId: "generation-1",
        bytesReceived: 0,
        nextChunkIndex: 0,
      }),
    ).toBe("attempt-1");
  });

  it("drops a local claim when the server did not acknowledge it", () => {
    expect(
      retryAttemptIdAfterResumeResponse("attempt-1", {
        resumable: false,
        recoveryEnabled: true,
        status: "failed",
      }),
    ).toBeUndefined();
  });

  it("preserves a server-acknowledged claim while the flag is rolled back", () => {
    expect(
      retryAttemptIdAfterResumeResponse("attempt-1", {
        resumable: false,
        recoveryEnabled: false,
        status: "uploading",
        reason: "feature_disabled",
        attemptId: "attempt-1",
        uploadGenerationId: "generation-1",
      }),
    ).toBe("attempt-1");
  });

  it("drops an unacknowledged legacy claim while the flag is rolled back", () => {
    expect(
      retryAttemptIdAfterResumeResponse("attempt-1", {
        resumable: false,
        recoveryEnabled: false,
        status: "uploading",
        reason: "feature_disabled",
      }),
    ).toBeUndefined();
  });
});

describe("planStreamingRecovery", () => {
  it("resumes from an aligned authoritative offset", () => {
    expect(
      planStreamingRecovery({
        response: {
          resumable: true,
          recoveryEnabled: true,
          status: "uploading",
          uploadMode: "streaming",
          attemptId: "attempt-1",
          uploadGenerationId: "generation-1",
          bytesReceived: CHUNK_BYTES * 2,
          nextChunkIndex: 2,
        },
        localBytes: CHUNK_BYTES * 5,
        chunkBytes: CHUNK_BYTES,
      }),
    ).toEqual({
      action: "resume",
      bytesReceived: CHUNK_BYTES * 2,
      nextChunkIndex: 2,
      progress: 0.4,
    });
  });

  it.each([
    [CHUNK_BYTES + 1, 1, "server chunk offset is inconsistent"],
    [CHUNK_BYTES * 2, 1, "server chunk offset is inconsistent"],
    [CHUNK_BYTES * 6, 6, "server byte offset is invalid"],
  ])(
    "restarts when offset %s and index %s contradict the local backup",
    (bytesReceived, nextChunkIndex, reason) => {
      expect(
        planStreamingRecovery({
          response: {
            resumable: true,
            recoveryEnabled: true,
            status: "uploading",
            uploadMode: "streaming",
            attemptId: "attempt-1",
            uploadGenerationId: "generation-1",
            bytesReceived,
            nextChunkIndex,
          },
          localBytes: CHUNK_BYTES * 5,
          chunkBytes: CHUNK_BYTES,
        }),
      ).toEqual({ action: "restart", reason });
    },
  );

  it("restarts explicitly when the session is unavailable", () => {
    expect(
      planStreamingRecovery({
        response: {
          resumable: false,
          recoveryEnabled: true,
          status: "failed",
          reason: "missing_session",
        },
        localBytes: CHUNK_BYTES,
        chunkBytes: CHUNK_BYTES,
      }),
    ).toEqual({ action: "restart", reason: "missing_session" });
  });

  it("reconciles a response lost after the server accepted finalization", () => {
    expect(
      planStreamingRecovery({
        response: {
          resumable: false,
          recoveryEnabled: true,
          status: "processing",
        },
        localBytes: CHUNK_BYTES,
        chunkBytes: CHUNK_BYTES,
      }),
    ).toEqual({ action: "reconcile", status: "processing" });
  });

  it("uses the full-restart control path while the rollout flag is off", () => {
    expect(
      planStreamingRecovery({
        response: {
          resumable: false,
          recoveryEnabled: false,
          status: null,
          reason: "feature_disabled",
        },
        localBytes: CHUNK_BYTES,
        chunkBytes: CHUNK_BYTES,
      }),
    ).toEqual({
      action: "restart",
      reason: "resumable retry is disabled",
    });
  });
});

describe("buildStreamingReplayPlan", () => {
  it("sends only the suffix after the acknowledged prefix", () => {
    expect(
      buildStreamingReplayPlan({
        localBytes: CHUNK_BYTES * 3 + 500,
        chunkBytes: CHUNK_BYTES,
        bytesReceived: CHUNK_BYTES * 2,
        nextChunkIndex: 2,
      }),
    ).toEqual([
      {
        index: 2,
        start: CHUNK_BYTES * 2,
        end: CHUNK_BYTES * 3,
        final: false,
      },
      {
        index: 3,
        start: CHUNK_BYTES * 3,
        end: CHUNK_BYTES * 3 + 500,
        final: true,
      },
    ]);
  });

  it("sends only the close sentinel when all aligned bytes are acknowledged", () => {
    expect(
      buildStreamingReplayPlan({
        localBytes: CHUNK_BYTES * 2,
        chunkBytes: CHUNK_BYTES,
        bytesReceived: CHUNK_BYTES * 2,
        nextChunkIndex: 2,
      }),
    ).toEqual([
      {
        index: 2,
        start: CHUNK_BYTES * 2,
        end: CHUNK_BYTES * 2,
        final: true,
      },
    ]);
  });
});
