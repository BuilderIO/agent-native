import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUserSetting, putUserSetting, notifyWithDelivery } = vi.hoisted(
  () => ({
    getUserSetting: vi.fn(),
    putUserSetting: vi.fn(),
    notifyWithDelivery: vi.fn(),
  }),
);

vi.mock("../settings/user-settings.js", () => ({
  getUserSetting,
  putUserSetting,
}));

vi.mock("./registry.js", () => ({ notifyWithDelivery }));

import {
  DEFAULT_PERSONAL_NOTIFICATION_ROUTING,
  getPersonalNotificationRouting,
  notifyPersonalWithDelivery,
  setPersonalNotificationRouting,
} from "./routing.js";

describe("personal notification routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserSetting.mockResolvedValue(null);
    putUserSetting.mockResolvedValue(undefined);
    notifyWithDelivery.mockResolvedValue({
      deliveredChannels: ["inbox"],
      unknownChannels: [],
      skippedChannels: [],
      failedChannels: [],
      channelOutcomes: [],
    });
  });

  it("defaults to inbox and browser without opting into external delivery", async () => {
    await expect(
      getPersonalNotificationRouting("alice@example.com"),
    ).resolves.toEqual(DEFAULT_PERSONAL_NOTIFICATION_ROUTING);
  });

  it("stores only a normalized Slack secret key name", async () => {
    await setPersonalNotificationRouting("alice@example.com", {
      inbox: true,
      browser: true,
      email: true,
      personalSlack: true,
      personalSlackWebhookKey: "${keys.ALICE_SLACK_WEBHOOK}",
    });

    expect(putUserSetting).toHaveBeenCalledWith(
      "alice@example.com",
      "notification-routing",
      expect.objectContaining({
        personalSlack: true,
        personalSlackWebhookKey: "ALICE_SLACK_WEBHOOK",
      }),
    );
    expect(JSON.stringify(putUserSetting.mock.calls)).not.toContain(
      "hooks.slack.com",
    );
  });

  it("rejects personal Slack routing without a valid secret key", async () => {
    await expect(
      setPersonalNotificationRouting("alice@example.com", {
        personalSlack: true,
        personalSlackWebhookKey: "https://hooks.slack.com/example",
      }),
    ).rejects.toThrow(/secret key/i);
    expect(putUserSetting).not.toHaveBeenCalled();
  });

  it("maps personal delivery to inbox, email, and isolated personal Slack", async () => {
    getUserSetting.mockResolvedValue({
      inbox: true,
      browser: true,
      email: true,
      personalSlack: true,
      personalSlackWebhookKey: "ALICE_SLACK_WEBHOOK",
    });

    await notifyPersonalWithDelivery(
      { severity: "info", title: "Review requested" },
      { owner: "alice@example.com", workflowEffectId: "effect-1" },
    );

    expect(notifyWithDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: ["inbox", "email", "personal-slack"],
        metadata: {
          delivery: {
            emailRecipients: ["alice@example.com"],
            personalSlackWebhookUrl: "${keys.ALICE_SLACK_WEBHOOK}",
          },
        },
      }),
      { owner: "alice@example.com", workflowEffectId: "effect-1" },
    );
  });
});
