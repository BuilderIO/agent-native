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
const putUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: getUserSettingMock,
  putUserSetting: putUserSettingMock,
}));

import { requestOverlayReciprocation } from "./overlay-nudge";

describe("requestOverlayReciprocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isEmailConfigured).mockResolvedValue(true);
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
    getUserSettingMock.mockImplementation(
      async (_email: string, key: string) => {
        if (key === "calendar-overlay-people") {
          return { people: [{ email: "peer@example.com", color: "#fff" }] };
        }
        if (key === "calendar-overlay-nudges") return null;
        return null;
      },
    );

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
    expect(putUserSettingMock).toHaveBeenCalledWith(
      "owner@example.com",
      "calendar-overlay-nudges",
      expect.objectContaining({ "peer@example.com": expect.any(String) }),
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

  it("blocks a resend within the 24-hour cooldown", async () => {
    const lastSent = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    getUserSettingMock.mockImplementation(
      async (_email: string, key: string) => {
        if (key === "calendar-overlay-people") {
          return { people: [{ email: "peer@example.com", color: "#fff" }] };
        }
        if (key === "calendar-overlay-nudges") {
          return { "peer@example.com": lastSent };
        }
        return null;
      },
    );

    const result = await requestOverlayReciprocation({
      ownerEmail: "owner@example.com",
      peerEmail: "peer@example.com",
    });

    expect(result.sent).toBe(false);
    expect(result.nextAvailableAt).toBeDefined();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(putUserSettingMock).not.toHaveBeenCalled();
  });

  it("allows a resend once the cooldown has elapsed", async () => {
    const lastSent = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
    getUserSettingMock.mockImplementation(
      async (_email: string, key: string) => {
        if (key === "calendar-overlay-people") {
          return { people: [{ email: "peer@example.com", color: "#fff" }] };
        }
        if (key === "calendar-overlay-nudges") {
          return { "peer@example.com": lastSent };
        }
        return null;
      },
    );

    const result = await requestOverlayReciprocation({
      ownerEmail: "owner@example.com",
      peerEmail: "peer@example.com",
    });

    expect(result).toEqual({ sent: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not send when email is not configured, but still records the nudge", async () => {
    vi.mocked(isEmailConfigured).mockResolvedValue(false);
    getUserSettingMock.mockImplementation(async (_email: string, key: string) =>
      key === "calendar-overlay-people"
        ? { people: [{ email: "peer@example.com", color: "#fff" }] }
        : null,
    );

    const result = await requestOverlayReciprocation({
      ownerEmail: "owner@example.com",
      peerEmail: "peer@example.com",
    });

    expect(result).toEqual({ sent: true });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(putUserSettingMock).toHaveBeenCalled();
  });
});
