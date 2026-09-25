import { describe, expect, it, vi } from "vitest";

const mockTrack = vi.hoisted(() => vi.fn());
const mockFlushTracking = vi.hoisted(() => vi.fn(async () => []));
const mockGetBetterAuthUserIdForEmail = vi.hoisted(() =>
  vi.fn(async () => null),
);

vi.mock("../tracking/registry.js", () => ({
  track: mockTrack,
  flushTracking: mockFlushTracking,
}));
vi.mock("../app-config/index.js", () => ({
  getAppConfig: () => ({ app: { slug: "test-app" } }),
}));
vi.mock("../server/better-auth-instance.js", () => ({
  getBetterAuthUserIdForEmail: mockGetBetterAuthUserIdForEmail,
}));

import {
  registerBackgroundWork,
  trackInviteAccepted,
} from "./track-invite-accepted.js";

const input = {
  email: "invitee@example.test",
  orgId: "org-1",
  role: "member" as const,
  invitedBy: "owner@example.test",
  federated: false,
};

describe("trackInviteAccepted", () => {
  // Regression test for the P1 finding on PR #5765: a discarded promise on
  // a serverless runtime can be killed before its dynamic imports and the
  // async user lookup finish, silently dropping `invite_accepted`. This
  // fails before the fix (no `event`/waitUntil wiring existed) and passes
  // after (the telemetry promise is registered with the event's waitUntil).
  it("registers the telemetry promise with the event's waitUntil when present", () => {
    const waitUntil = vi.fn();
    const event = { waitUntil } as any;

    const result = trackInviteAccepted({ ...input, event });

    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledWith(result);
  });

  it("keeps the registered promise pending until providers flush", async () => {
    let releaseFlush!: () => void;
    mockFlushTracking.mockImplementationOnce(
      () => new Promise((resolve) => (releaseFlush = () => resolve([]))),
    );
    let settled = false;
    const result = trackInviteAccepted(input).then(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(mockFlushTracking).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockTrack).toHaveBeenCalled();
    expect(settled).toBe(false);

    releaseFlush();
    await result;
    expect(settled).toBe(true);
  });

  it("still resolves fail-open when no event is reachable", async () => {
    await expect(trackInviteAccepted(input)).resolves.toBeUndefined();
  });

  it("resolves fail-open even when the event's waitUntil throws", async () => {
    const event = {
      waitUntil: () => {
        throw new Error("adapter placeholder");
      },
    } as any;

    await expect(
      trackInviteAccepted({ ...input, event }),
    ).resolves.toBeUndefined();
  });
});

describe("registerBackgroundWork", () => {
  it("calls the event's waitUntil with the promise when it is a function", () => {
    const waitUntil = vi.fn();
    const promise = Promise.resolve();

    registerBackgroundWork({ waitUntil } as any, promise);

    expect(waitUntil).toHaveBeenCalledWith(promise);
  });

  it("is a no-op fire-and-forget when there is no event", () => {
    expect(() =>
      registerBackgroundWork(undefined, Promise.resolve()),
    ).not.toThrow();
  });
});
