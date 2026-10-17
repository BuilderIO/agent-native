import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  flushTracking: vi.fn(),
  getBetterAuthUserIdForEmail: vi.fn(),
  platformWaitUntil: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getBetterAuthUserIdForEmail: (...args: unknown[]) =>
    mocks.getBetterAuthUserIdForEmail(...args),
  platformWaitUntil: (...args: unknown[]) => mocks.platformWaitUntil(...args),
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: (...args: unknown[]) => mocks.track(...args),
  flushTracking: (...args: unknown[]) => mocks.flushTracking(...args),
}));

import { trackClipEventForOwner } from "./clip-funnel-tracking.js";

function makeEvent() {
  const pending: Promise<unknown>[] = [];
  const req = { kind: "request" };
  mocks.platformWaitUntil.mockImplementation((forReq: unknown) =>
    forReq === req
      ? (promise: Promise<unknown>) => pending.push(promise)
      : undefined,
  );
  return { pending, req };
}

describe("trackClipEventForOwner", () => {
  beforeEach(() => {
    mocks.track.mockReset();
    mocks.flushTracking.mockReset().mockResolvedValue([]);
    mocks.platformWaitUntil.mockReset();
    mocks.getBetterAuthUserIdForEmail
      .mockReset()
      .mockResolvedValue("owner-auth-id");
  });

  it("tracks after the owner lookup, keyed by the owner's auth id", async () => {
    const event = makeEvent();

    trackClipEventForOwner(
      event as never,
      "clip_agent_viewed",
      "owner@example.com",
      { output_id: "rec-1" },
      { anonymousId: "anon-1" },
    );
    expect(mocks.track).not.toHaveBeenCalled();
    await Promise.all(event.pending);

    expect(mocks.track).toHaveBeenCalledExactlyOnceWith(
      "clip_agent_viewed",
      {
        app_name: "clips",
        template_name: "clips",
        output_type: "clip",
        output_id: "rec-1",
        owner_auth_user_id: "owner-auth-id",
      },
      { anonymousId: "anon-1" },
    );
  });

  it("hands the platform's waitUntil a chain that ends in a provider flush", async () => {
    const event = makeEvent();
    let flushedAfterTrack = false;
    mocks.flushTracking.mockImplementation(async () => {
      flushedAfterTrack = mocks.track.mock.calls.length === 1;
      return [];
    });

    trackClipEventForOwner(event as never, "clip_agent_viewed", "o@x.com", {});

    expect(mocks.platformWaitUntil).toHaveBeenCalledWith(event.req);
    expect(event.pending).toHaveLength(1);
    await Promise.all(event.pending);
    expect(mocks.flushTracking).toHaveBeenCalledOnce();
    expect(flushedAfterTrack).toBe(true);
  });

  it("still tracks, without an owner id, when the clip has no owner email", async () => {
    const event = makeEvent();

    trackClipEventForOwner(event as never, "clip_agent_viewed", null, {
      output_id: "rec-1",
    });
    await Promise.all(event.pending);

    expect(mocks.getBetterAuthUserIdForEmail).not.toHaveBeenCalled();
    expect(mocks.track.mock.calls[0][1]).toMatchObject({
      owner_auth_user_id: undefined,
    });
  });

  it("never throws or rejects when the lookup or the tracker fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.getBetterAuthUserIdForEmail.mockRejectedValue(new Error("db down"));
    const lookupFails = makeEvent();
    expect(() =>
      trackClipEventForOwner(lookupFails as never, "x", "o@example.com", {}),
    ).not.toThrow();
    await expect(Promise.all(lookupFails.pending)).resolves.toBeDefined();

    mocks.getBetterAuthUserIdForEmail.mockResolvedValue("owner-auth-id");
    mocks.track.mockImplementation(() => {
      throw new Error("tracker down");
    });
    const trackFails = makeEvent();
    trackClipEventForOwner(trackFails as never, "x", "o@example.com", {});
    await expect(Promise.all(trackFails.pending)).resolves.toBeDefined();

    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
