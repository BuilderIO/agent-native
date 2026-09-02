import { isEmailConfigured, sendEmail } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(() => "/_agent-native/open?app=calendar&view=calendar"),
  getAppProductionUrl: vi.fn(() => "https://calendar.example.com"),
  isEmailConfigured: vi.fn(() => true),
  renderEmail: vi.fn((input: Record<string, unknown>) => input),
  sendEmail: vi.fn(),
  toAbsoluteOpenUrl: vi.fn(
    (path: string, origin: string) => `${origin}${path}`,
  ),
}));

const getUserSettingMock = vi.hoisted(() => vi.fn());
const mutateUserSettingMock = vi.hoisted(() => vi.fn());

// A minimal stand-in for the real atomic mutateUserSetting: reads the
// current value through the same mock the rest of the test wires up, then
// applies the updater. It intentionally does not model CAS retries — those
// are covered by the store's own tests — only the single-attempt behavior
// requestOverlayReciprocation depends on. Tests that need to model a real
// race between concurrent claims override this per-test.
async function defaultMutateUserSettingImpl(
  email: string,
  key: string,
  updater: (
    current: Record<string, unknown> | null,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>,
) {
  return updater(await getUserSettingMock(email, key));
}

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: getUserSettingMock,
  mutateUserSetting: mutateUserSettingMock,
}));

import { requestOverlayReciprocation } from "./overlay-nudge";

/**
 * `email === "owner@example.com"` always sees `peer@example.com` in their
 * overlay list (the precondition every test needs); `peerOverlay` controls
 * what the peer sees back, and `nudgeLog` seeds the owner's cooldown state.
 */
function settingsStore({
  peerOverlay = { people: [] },
  nudgeLog = null,
}: {
  peerOverlay?: { people: Array<{ email: string }> };
  nudgeLog?: Record<string, string> | null;
} = {}) {
  return async (email: string, key: string) => {
    if (key === "calendar-overlay-people") {
      if (email === "owner@example.com") {
        return { people: [{ email: "peer@example.com", color: "#fff" }] };
      }
      if (email === "peer@example.com") return peerOverlay;
      return null;
    }
    if (key === "calendar-overlay-nudges" && email === "owner@example.com") {
      return nudgeLog;
    }
    return null;
  };
}

/**
 * A `mutateUserSetting` stand-in that actually persists what the updater
 * returns, in a `{ log }` box the caller can inspect afterward. Used where a
 * test needs to verify real stored state instead of just how many times the
 * mock was called.
 */
function persistentMutateUserSetting(store: {
  log: Record<string, string> | null;
}) {
  return async (
    _email: string,
    _key: string,
    updater: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>,
  ) => {
    store.log = (await updater(store.log)) as Record<string, string>;
    return store.log;
  };
}

describe("requestOverlayReciprocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isEmailConfigured).mockResolvedValue(true);
    mutateUserSettingMock.mockImplementation(defaultMutateUserSettingImpl);
  });

  it("returns not-overlaid without throwing when the peer is not in the owner's overlay list", async () => {
    getUserSettingMock.mockImplementation(async (_email: string, key: string) =>
      key === "calendar-overlay-people" ? { people: [] } : null,
    );

    await expect(
      requestOverlayReciprocation({
        ownerEmail: "owner@example.com",
        peerEmail: "peer@example.com",
      }),
    ).resolves.toEqual({ sent: false, reason: "not-overlaid" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends the request email and records the nudge timestamp", async () => {
    const store: { log: Record<string, string> | null } = { log: null };
    mutateUserSettingMock.mockImplementation(
      persistentMutateUserSetting(store),
    );
    getUserSettingMock.mockImplementation(settingsStore());

    const result = await requestOverlayReciprocation({
      ownerEmail: "owner@example.com",
      peerEmail: "peer@example.com",
    });

    expect(result).toEqual({ sent: true });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "peer@example.com",
        replyTo: "owner@example.com",
      }),
    );
    // Verify the cooldown was actually persisted, not just that
    // mutateUserSetting was invoked with some function.
    expect(store.log).toEqual({ "peer@example.com": expect.any(String) });
  });

  it("blocks a second peer once the owner-wide daily nudge limit is reached", async () => {
    const now = Date.now();
    const recentSends = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [
        `other-${i}@example.com`,
        new Date(now - i * 60 * 1000).toISOString(),
      ]),
    );
    getUserSettingMock.mockImplementation(
      settingsStore({ nudgeLog: recentSends }),
    );

    const result = await requestOverlayReciprocation({
      ownerEmail: "owner@example.com",
      peerEmail: "peer@example.com",
    });

    expect(result).toEqual({ sent: false, reason: "rate-limited" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not count nudges older than 24 hours against the daily limit", async () => {
    const now = Date.now();
    const staleSends = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [
        `other-${i}@example.com`,
        new Date(now - 25 * 60 * 60 * 1000 - i * 1000).toISOString(),
      ]),
    );
    const store: { log: Record<string, string> | null } = { log: staleSends };
    mutateUserSettingMock.mockImplementation(
      persistentMutateUserSetting(store),
    );
    getUserSettingMock.mockImplementation((email: string, key: string) =>
      key === "calendar-overlay-nudges" && email === "owner@example.com"
        ? Promise.resolve(store.log)
        : settingsStore()(email, key),
    );

    const result = await requestOverlayReciprocation({
      ownerEmail: "owner@example.com",
      peerEmail: "peer@example.com",
    });

    expect(result).toEqual({ sent: true });
    // The stale entries should have been pruned away, leaving only the peer
    // that was just claimed.
    expect(store.log).toEqual({ "peer@example.com": expect.any(String) });
  });

  it("is case-insensitive when matching the peer against the overlay list", async () => {
    getUserSettingMock.mockImplementation(async (_email: string, key: string) =>
      key === "calendar-overlay-people"
        ? { people: [{ email: "Peer@Example.com", color: "#fff" }] }
        : null,
    );

    await expect(
      requestOverlayReciprocation({
        ownerEmail: "owner@example.com",
        peerEmail: "peer@example.com",
      }),
    ).resolves.toEqual({ sent: true });
  });

  it("does not send and returns already-reciprocal when the peer has already added the owner back", async () => {
    getUserSettingMock.mockImplementation(
      settingsStore({
        peerOverlay: { people: [{ email: "owner@example.com" }] },
      }),
    );

    const result = await requestOverlayReciprocation({
      ownerEmail: "owner@example.com",
      peerEmail: "peer@example.com",
    });

    expect(result).toEqual({ sent: false, reason: "already-reciprocal" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(mutateUserSettingMock).not.toHaveBeenCalled();
  });

  it("blocks a resend within the 24-hour cooldown", async () => {
    const lastSent = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    getUserSettingMock.mockImplementation(
      settingsStore({ nudgeLog: { "peer@example.com": lastSent } }),
    );

    const result = await requestOverlayReciprocation({
      ownerEmail: "owner@example.com",
      peerEmail: "peer@example.com",
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("cooldown");
    expect(result.nextAvailableAt).toBeDefined();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("allows a resend once the cooldown has elapsed", async () => {
    const lastSent = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
    getUserSettingMock.mockImplementation(
      settingsStore({ nudgeLog: { "peer@example.com": lastSent } }),
    );

    const result = await requestOverlayReciprocation({
      ownerEmail: "owner@example.com",
      peerEmail: "peer@example.com",
    });

    expect(result).toEqual({ sent: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not send and releases the claim when email is not configured", async () => {
    // A persistent log (unlike defaultMutateUserSettingImpl, which reads
    // but never writes back) so the release can be verified by inspecting
    // what actually ended up stored, not just how many times the mock ran.
    let persistedLog: Record<string, string> | null = null;
    mutateUserSettingMock.mockImplementation(
      async (
        _email: string,
        _key: string,
        updater: (
          current: Record<string, unknown> | null,
        ) => Record<string, unknown> | Promise<Record<string, unknown>>,
      ) => {
        persistedLog = (await updater(persistedLog)) as Record<string, string>;
        return persistedLog;
      },
    );
    vi.mocked(isEmailConfigured).mockResolvedValue(false);
    getUserSettingMock.mockImplementation(settingsStore());

    const result = await requestOverlayReciprocation({
      ownerEmail: "owner@example.com",
      peerEmail: "peer@example.com",
    });

    expect(result).toEqual({ sent: false, reason: "email-not-configured" });
    expect(sendEmail).not.toHaveBeenCalled();
    // Claimed once, then released once — the cooldown must not be consumed
    // by a request that never actually sent anything. Verified against the
    // actual persisted state, not just the call count.
    expect(mutateUserSettingMock).toHaveBeenCalledTimes(2);
    expect(persistedLog).toEqual({});
  });
});
