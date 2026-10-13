import { H3 } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const claims = vi.hoisted(() => ({
  email: "alice@example.com",
  appId: "calendar",
  expiresAt: Date.now() + 60_000,
}));
const decryptSecretValueMock = vi.hoisted(() => vi.fn());
const putUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("../secrets/crypto.js", () => ({
  decryptSecretValue: decryptSecretValueMock,
  encryptSecretValue: vi.fn((value: string) => value),
}));
vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: vi.fn(),
  putUserSetting: putUserSettingMock,
}));

const { createAutomationFailureUnsubscribeHandler } =
  await import("./automation-failure-notifications.js");

function createApp() {
  const app = new H3();
  app.use("/unsubscribe", createAutomationFailureUnsubscribeHandler());
  return app;
}

describe("automation failure unsubscribe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decryptSecretValueMock.mockImplementation((token: string) => {
      if (token !== "valid") throw new Error("invalid token");
      return JSON.stringify({
        purpose: "automation-failure-email",
        ...claims,
      });
    });
  });

  it("shows a confirmation on GET without changing preferences", async () => {
    const response = await createApp().fetch(
      new Request("http://example.test/unsubscribe?token=valid"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await response.text()).toContain("Unsubscribe");
    expect(putUserSettingMock).not.toHaveBeenCalled();
  });

  it("accepts an RFC 8058 one-click POST and disables only that app's alerts", async () => {
    const response = await createApp().fetch(
      new Request("http://example.test/unsubscribe?token=valid", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
    );

    expect(response.status).toBe(204);
    expect(putUserSettingMock).toHaveBeenCalledWith(
      "alice@example.com",
      "automationFailureEmails:calendar",
      { enabled: false },
    );
  });

  it("rejects invalid tokens and malformed one-click requests", async () => {
    const app = createApp();
    const invalid = await app.fetch(
      new Request("http://example.test/unsubscribe?token=invalid"),
    );
    const malformed = await app.fetch(
      new Request("http://example.test/unsubscribe?token=valid", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=unsubscribe",
      }),
    );

    expect(invalid.status).toBe(404);
    expect(malformed.status).toBe(400);
    expect(putUserSettingMock).not.toHaveBeenCalled();
  });
});
