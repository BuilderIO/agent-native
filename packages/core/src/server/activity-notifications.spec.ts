import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSetting: vi.fn(),
  isEmailConfigured: vi.fn(),
}));

vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: (...args: unknown[]) => mocks.getUserSetting(...args),
}));

vi.mock("./email.js", () => ({
  isEmailConfigured: (...args: unknown[]) => mocks.isEmailConfigured(...args),
}));

import {
  notifyActivity,
  runActivityNotification,
  resolveActivityRecipients,
} from "./activity-notifications.js";

const PREFERENCE_KEY = "example-user-prefs";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserSetting.mockResolvedValue(null);
  mocks.isEmailConfigured.mockResolvedValue(true);
});

describe("resolveActivityRecipients", () => {
  it("excludes the actor regardless of casing or padding", async () => {
    const recipients = await resolveActivityRecipients({
      candidates: ["Owner@Example.com", "viewer@example.com"],
      actorEmail: "  owner@example.COM ",
      preferenceKey: PREFERENCE_KEY,
    });

    expect(recipients).toEqual(["viewer@example.com"]);
  });

  it("collapses duplicates and drops blanks and non-addresses", async () => {
    const recipients = await resolveActivityRecipients({
      candidates: [
        "owner@example.com",
        "OWNER@example.com",
        "",
        null,
        undefined,
        "not-an-email",
      ],
      preferenceKey: PREFERENCE_KEY,
    });

    expect(recipients).toEqual(["owner@example.com"]);
  });

  it("treats a missing preference blob as opted in", async () => {
    const recipients = await resolveActivityRecipients({
      candidates: ["owner@example.com"],
      preferenceKey: PREFERENCE_KEY,
    });

    expect(recipients).toEqual(["owner@example.com"]);
  });

  it("excludes users who turned the preference off", async () => {
    mocks.getUserSetting.mockImplementation(async (email: string) =>
      email === "quiet@example.com" ? { emailNotifications: false } : null,
    );

    const recipients = await resolveActivityRecipients({
      candidates: ["quiet@example.com", "loud@example.com"],
      preferenceKey: PREFERENCE_KEY,
    });

    expect(recipients).toEqual(["loud@example.com"]);
  });

  it("honors a custom preference field", async () => {
    mocks.getUserSetting.mockResolvedValue({
      emailNotifications: false,
      commentEmails: true,
    });

    const recipients = await resolveActivityRecipients({
      candidates: ["owner@example.com"],
      preferenceKey: PREFERENCE_KEY,
      preferenceField: "commentEmails",
    });

    expect(recipients).toEqual(["owner@example.com"]);
  });
});

describe("notifyActivity", () => {
  it("reports email-not-configured distinctly and sends nothing", async () => {
    mocks.isEmailConfigured.mockResolvedValue(false);
    const send = vi.fn();

    const result = await notifyActivity({
      candidates: ["owner@example.com"],
      preferenceKey: PREFERENCE_KEY,
      send,
    });

    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "email-not-configured",
      sent: [],
      failed: [],
    });
  });

  it("reports no-recipients when everyone opted out", async () => {
    mocks.getUserSetting.mockResolvedValue({ emailNotifications: false });
    const send = vi.fn();

    const result = await notifyActivity({
      candidates: ["owner@example.com"],
      preferenceKey: PREFERENCE_KEY,
      send,
    });

    expect(send).not.toHaveBeenCalled();
    expect(result.status).toBe("no-recipients");
  });

  it("keeps a failed send out of the sent list", async () => {
    const send = vi.fn(async (to: string) => {
      if (to === "broken@example.com") throw new Error("SMTP 550");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await notifyActivity({
      candidates: ["ok@example.com", "broken@example.com"],
      preferenceKey: PREFERENCE_KEY,
      send,
    });

    expect(result.status).toBe("delivered");
    expect(result.sent).toEqual(["ok@example.com"]);
    expect(result.failed).toEqual([
      { email: "broken@example.com", error: "SMTP 550" },
    ]);
  });

  it("reports a batch where every send failed as undelivered", async () => {
    const send = vi.fn(async () => {
      throw new Error("SMTP 550");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await notifyActivity({
      candidates: ["a@example.com", "b@example.com"],
      preferenceKey: PREFERENCE_KEY,
      send,
    });

    expect(result.status).toBe("delivery-failed");
    expect(result.sent).toEqual([]);
    expect(result.failed).toHaveLength(2);
  });
});

describe("runActivityNotification", () => {
  it("passes a resolved result straight through", async () => {
    const result = await runActivityNotification("[test]", async () => ({
      status: "delivered" as const,
      sent: ["a@example.com"],
      failed: [],
    }));

    expect(result.status).toBe("delivered");
  });

  it("turns a thrown resolution into a distinct notification-error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runActivityNotification("[test]", async () => {
      throw new Error("participants query failed");
    });

    expect(result.status).toBe("notification-error");
    expect(result).toMatchObject({ error: "participants query failed" });
    expect(result.sent).toEqual([]);
  });
});
