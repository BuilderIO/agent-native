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

describe("requestOverlayReciprocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isEmailConfigured).mockResolvedValue(true);
    mutateUserSettingMock.mockImplementation(defaultMutateUserSettingImpl);
  });

  it("throws when the peer is not in the owner's overlay list", async () => {
    getUserSettingMock.mockImplementation(async (_email: string, key: string) =>
      key === "calendar-overlay-people" ? { people: [] } : null,
    );

    await expect(
      requestOverlayReciprocation({
        ownerEmail: "owner@example.com",
        peerEmail: "peer@example.com",
      }),
    ).rejects.toThrow("This person is not in your calendar overlay list");
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends the request email and records the nudge timestamp", async () => {
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
    expect(mutateUserSettingMock).toHaveBeenCalledWith(
      "owner@example.com",
      "calendar-overlay-nudges",
      expect.any(Function),
    );
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
    vi.mocked(isEmailConfigured).mockResolvedValue(false);
    getUserSettingMock.mockImplementation(settingsStore());

    const result = await requestOverlayReciprocation({
      ownerEmail: "owner@example.com",
      peerEmail: "peer@example.com",
    });

    expect(result).toEqual({ sent: false, reason: "email-not-configured" });
    expect(sendEmail).not.toHaveBeenCalled();
    // Claimed once, then released once — the cooldown must not be consumed
    // by a request that never actually sent anything.
    expect(mutateUserSettingMock).toHaveBeenCalledTimes(2);
  });
});
