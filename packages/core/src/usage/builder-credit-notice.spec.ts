import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: new Map<string, Record<string, unknown>>(),
  sendEmail: vi.fn(),
  loadMessages: vi.fn(),
}));

vi.mock("../server/email.js", () => ({
  sendEmail: mocks.sendEmail,
}));
vi.mock("../server/email-templates.js", () => ({
  renderBuilderCreditLimitEmail: vi.fn((input) => ({
    subject: input.subject,
    html: "<html />",
    text: input.body,
  })),
}));
vi.mock("../settings/user-settings.js", () => ({
  getUserSetting: vi.fn(async () => ({ locale: "en-US" })),
  mutateUserSetting: async (
    email: string,
    key: string,
    update: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown>,
  ) => {
    const storageKey = `${email}:${key}`;
    const next = update(mocks.settings.get(storageKey) ?? null);
    mocks.settings.set(storageKey, next);
    return next;
  },
  deleteUserSetting: vi.fn(async (email: string, key: string) =>
    mocks.settings.delete(`${email}:${key}`),
  ),
}));
vi.mock("../localization/core-messages.js", () => ({
  loadAgentChatMessagesForLocale: mocks.loadMessages,
}));

import {
  clearBuilderCreditLimitNotice,
  sendBuilderCreditLimitNotice,
} from "./builder-credit-notice.js";

describe("Builder credit limit email notice", () => {
  beforeEach(() => {
    mocks.settings.clear();
    mocks.sendEmail.mockReset().mockResolvedValue(undefined);
    mocks.loadMessages.mockReset().mockResolvedValue({
      "billing.builderCreditLimitTitle": "Credits used up",
      "billing.builderCreditLimitEmailBody": "No credits remain.",
      "billing.builderCreditUpgrade": "Upgrade plan",
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("deduplicates simultaneous and repeated limit errors per user and organization", async () => {
    await Promise.all([
      sendBuilderCreditLimitNotice({
        ownerEmail: "person@example.com",
        orgId: "org-1",
      }),
      sendBuilderCreditLimitNotice({
        ownerEmail: "person@example.com",
        orgId: "org-1",
      }),
    ]);
    await sendBuilderCreditLimitNotice({
      ownerEmail: "person@example.com",
      orgId: "org-1",
    });

    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "person@example.com",
        subject: "Credits used up",
        templateId: "core.builder-credit-limit",
        orgId: "org-1",
      }),
    );
  });

  it("allows one new notice after live status clears the exhaustion episode", async () => {
    const input = { ownerEmail: "person@example.com", orgId: "org-1" };
    await sendBuilderCreditLimitNotice(input);
    await clearBuilderCreditLimitNotice(input.ownerEmail, input.orgId);
    await sendBuilderCreditLimitNotice(input);

    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("releases a failed email claim so a later run can retry", async () => {
    mocks.sendEmail
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce(undefined);
    const input = { ownerEmail: "person@example.com", orgId: "org-1" };

    await sendBuilderCreditLimitNotice(input);
    await sendBuilderCreditLimitNotice(input);

    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
  });
});
