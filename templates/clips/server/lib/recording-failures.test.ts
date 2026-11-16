import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTrack = vi.hoisted(() => vi.fn());
const mockGetRequestContext = vi.hoisted(() =>
  vi.fn(
    () =>
      undefined as
        | { authUserId?: string; browserSessionId?: string }
        | undefined,
  ),
);

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: () => mockGetRequestContext(),
}));

import {
  builderGatewayFailure,
  finalizeFailureTracking,
  hostedStorageAuthFailure,
  normalizeRecordingFailureCode,
  normalizeRecordingPlatform,
  trackRecordingFailure,
} from "./recording-failures.js";

describe("recording failure analytics", () => {
  beforeEach(() => {
    mockTrack.mockClear();
    mockGetRequestContext.mockReturnValue(undefined);
  });

  it("adds the verified Better Auth id without inferring it from the email", () => {
    mockGetRequestContext.mockReturnValue({
      authUserId: "better-auth-user-1",
      browserSessionId: "ambient-browser-session",
    });

    trackRecordingFailure({
      recordingId: "rec_1",
      userId: "owner@example.com",
      platform: "web",
      failureCode: "finalize_failed",
    });

    expect(mockTrack).toHaveBeenCalledWith(
      "recording_failed",
      expect.any(Object),
      {
        userId: "owner@example.com",
        authUserId: "better-auth-user-1",
        sessionId: "ambient-browser-session",
      },
    );
  });

  it("normalizes unknown platforms and correlates failure to the attempt", () => {
    trackRecordingFailure({
      recordingId: "rec_1",
      userId: "owner@example.com",
      uploadAttemptId: "attempt_1",
      platform: "future-client",
      failureCode: "finalize_failed",
    });

    expect(mockTrack).toHaveBeenCalledWith(
      "recording_failed",
      expect.objectContaining({
        recording_attempt_id: "rec_1",
        upload_attempt_id: "attempt_1",
        recording_platform: "unknown",
        failure_code: "finalize_failed",
      }),
      { userId: "owner@example.com" },
    );
    expect(mockTrack.mock.calls[0][2]).toEqual({ userId: "owner@example.com" });
  });

  it("uses an explicitly stored browser session when no request context exists", () => {
    trackRecordingFailure({
      recordingId: "rec_1",
      userId: "owner@example.com",
      platform: "web",
      failureCode: "media_verification_failed",
      browserSessionId: "browser-session-1",
    });

    expect(mockTrack).toHaveBeenCalledWith(
      "recording_failed",
      expect.any(Object),
      { userId: "owner@example.com", sessionId: "browser-session-1" },
    );
  });

  it("prefers an explicitly stored session over the ambient request session", () => {
    mockGetRequestContext.mockReturnValue({
      browserSessionId: "ambient-browser-session",
    });

    trackRecordingFailure({
      recordingId: "rec_1",
      userId: "owner@example.com",
      platform: "web",
      failureCode: "media_verification_failed",
      browserSessionId: "stored-browser-session",
    });

    expect(mockTrack).toHaveBeenCalledWith(
      "recording_failed",
      expect.any(Object),
      { userId: "owner@example.com", sessionId: "stored-browser-session" },
    );
  });

  it("accepts only the normalized platform vocabulary", () => {
    expect(normalizeRecordingPlatform("extension")).toBe("extension");
    expect(normalizeRecordingPlatform("Chrome")).toBe("unknown");
  });

  it("recognizes hosted storage auth status and typed provider codes", () => {
    expect(hostedStorageAuthFailure({ statusCode: 403 })).toEqual({
      status: 403,
    });
    expect(
      hostedStorageAuthFailure({
        cause: Object.assign(new Error("Access denied"), {
          Code: "SignatureDoesNotMatch",
        }),
      }),
    ).toEqual({});
    expect(
      hostedStorageAuthFailure({
        name: "AccessDeniedException",
        $metadata: { httpStatusCode: 403 },
      }),
    ).toEqual({ status: 403 });
    expect(hostedStorageAuthFailure({ statusCode: 503 })).toBeNull();
    expect(normalizeRecordingFailureCode("hosted_storage_unavailable")).toBe(
      "hosted_storage_unavailable",
    );
  });

  it("tracks normalized stage and status for an HTML chunk error", () => {
    trackRecordingFailure({
      recordingId: "rec_1",
      userId: "owner@example.com",
      platform: "web",
      failureCode: "chunk_html_error",
      failureStage: "chunk_upload",
      httpStatus: 502,
    });

    expect(mockTrack).toHaveBeenCalledWith(
      "recording_failed",
      expect.objectContaining({
        failure_code: "chunk_html_error",
        failure_stage: "chunk_upload",
        http_status: 502,
      }),
      { userId: "owner@example.com" },
    );
  });

  describe("Builder gateway failures", () => {
    const gatewayError = (over: Record<string, unknown> = {}) =>
      Object.assign(
        new Error("Builder.io upload complete failed (502): HTML error page"),
        {
          name: "BuilderGatewayError",
          step: "complete",
          status: 502,
          attempts: 4,
          isHtml: true,
          traceIds: ["trace-a", "trace-b"],
          headers: { server: "Google Frontend" },
          ...over,
        },
      );

    it("finds the gateway error through the wrapping finalize error", () => {
      const wrapped = Object.assign(
        new Error(
          "Upload completion failed: Builder.io upload complete failed",
        ),
        { cause: gatewayError() },
      );

      expect(builderGatewayFailure(wrapped)).toEqual({
        step: "complete",
        status: 502,
        attempts: 4,
        traceId: "trace-b",
        server: "Google Frontend",
      });
    });

    it("reports nothing for errors that did not come from the gateway", () => {
      expect(builderGatewayFailure(new Error("boom"))).toBeNull();
      expect(builderGatewayFailure("boom")).toBeNull();
      expect(
        builderGatewayFailure(gatewayError({ step: "something_else" })),
      ).toBeNull();
    });

    it("leaves out the status when the gateway never answered", () => {
      expect(
        builderGatewayFailure(gatewayError({ status: 0 })),
      ).not.toHaveProperty("status");
    });

    it("tracks a failed finalize with its stage, status, attempts and trace id", () => {
      trackRecordingFailure({
        recordingId: "rec_1",
        userId: "owner@example.com",
        platform: "web",
        failureCode: "finalize_failed",
        ...finalizeFailureTracking(gatewayError()),
      });

      expect(mockTrack).toHaveBeenCalledWith(
        "recording_failed",
        expect.objectContaining({
          failure_code: "finalize_failed",
          failure_stage: "finalize",
          http_status: 502,
          gateway_step: "complete",
          gateway_attempts: 4,
          gateway_trace_id: "trace-b",
          gateway_server: "Google Frontend",
        }),
        { userId: "owner@example.com" },
      );
    });

    it("tags a finalize failure that was not the gateway with the stage only", () => {
      expect(finalizeFailureTracking(new Error("chunks missing"))).toEqual({
        failureStage: "finalize",
      });
    });
  });

  it("records cancellation separately from recording failures", () => {
    trackRecordingFailure({
      recordingId: "rec_1",
      userId: "owner@example.com",
      platform: "web",
      failureCode: "user_cancelled",
    });

    expect(mockTrack).toHaveBeenCalledWith(
      "recording_cancelled",
      expect.objectContaining({ failure_code: "user_cancelled" }),
      { userId: "owner@example.com" },
    );
  });
});
