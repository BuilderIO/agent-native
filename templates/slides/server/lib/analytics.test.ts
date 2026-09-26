import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authUserId: undefined as string | undefined,
  track: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext: () =>
    mocks.authUserId ? { authUserId: mocks.authUserId } : undefined,
}));
vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mocks.track(...args),
}));

import { boundedAnalyticsErrorType, trackSlidesEvent } from "./analytics";

beforeEach(() => {
  mocks.authUserId = undefined;
  mocks.track.mockReset();
});

describe("Slides analytics helpers", () => {
  it("adds only the validated canonical request identity", () => {
    mocks.authUserId = "better-auth-user-1";

    trackSlidesEvent(
      "generation_completed",
      { generation_attempt_id: "attempt-1", auth_user_id: "spoofed" },
      { userId: "owner@example.com" },
    );

    expect(mocks.track).toHaveBeenCalledWith(
      "generation_completed",
      {
        generation_attempt_id: "attempt-1",
        auth_user_id: "better-auth-user-1",
      },
      { userId: "owner@example.com" },
    );
  });

  it("omits canonical identity when request context has none", () => {
    trackSlidesEvent("generation_completed", { generation_attempt_id: "a" });

    expect(mocks.track).toHaveBeenCalledWith(
      "generation_completed",
      { generation_attempt_id: "a" },
      undefined,
    );
  });

  it("bounds error types and rejects untrusted names", () => {
    expect(boundedAnalyticsErrorType(new Error("private detail"))).toBe(
      "Error",
    );
    expect(
      boundedAnalyticsErrorType(
        Object.assign(new Error(), { name: "x".repeat(100) }),
      ),
    ).toBe("unknown_error");
    expect(
      boundedAnalyticsErrorType(
        Object.assign(new Error(), { name: "alice@example.com" }),
      ),
    ).toBe("unknown_error");
  });
});
