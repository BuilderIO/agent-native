import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildDeepLink: vi.fn(),
  fetchGmailLabelMap: vi.fn(),
  getClients: vi.fn(),
  getRequestUserEmail: vi.fn(),
  getUserSetting: vi.fn(),
  isConnected: vi.fn(),
  listGmailMessages: vi.fn(),
  assertGmailNotCoolingDown: vi.fn(),
  track: vi.fn(),
}));

vi.mock("../server/lib/gmail-quota.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/gmail-quota.js")>()),
  assertGmailNotCoolingDown: mocks.assertGmailNotCoolingDown,
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: mocks.buildDeepLink,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
}));

vi.mock("@agent-native/core/tracking", () => ({
  track: mocks.track,
}));

vi.mock("../server/lib/google-auth.js", () => ({
  fetchGmailLabelMap: mocks.fetchGmailLabelMap,
  getClients: mocks.getClients,
  gmailToEmailMessage: vi.fn(),
  isConnected: mocks.isConnected,
  listGmailMessages: mocks.listGmailMessages,
}));

import { GmailQuotaCooldownError } from "../server/lib/google-api.js";
import action from "./search-emails";

const OWNER = "owner@example.com";
const ACCOUNT = "inbox@example.com";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertGmailNotCoolingDown.mockResolvedValue(undefined);
  mocks.getRequestUserEmail.mockReturnValue(OWNER);
  mocks.isConnected.mockResolvedValue(true);
  mocks.getClients.mockResolvedValue([
    { email: ACCOUNT, accessToken: "access-token", refreshToken: "" },
  ]);
  mocks.fetchGmailLabelMap.mockResolvedValue(new Map());
  mocks.listGmailMessages.mockResolvedValue({
    messages: [],
    errors: [
      {
        email: ACCOUNT,
        error: "Email service is briefly busy.",
        isQuotaError: true,
        retryAfterMs: 45_000,
      },
    ],
  });
});

describe("search-emails quota cooldown", () => {
  it("preserves a whole-mailbox cooldown as a typed 429 error", async () => {
    const error = await action
      .run({ q: "from:sender@example.com" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GmailQuotaCooldownError);
    expect(error).toMatchObject({
      actionContractError: true,
      statusCode: 429,
      errorCode: "gmail_quota_cooldown",
      details: { retryAfterSeconds: 45, retryAfterMs: 45_000 },
    });
    expect((error as Error).message).toContain("Do not retry before then");
  });

  it("rejects every repeat call inside the cooldown without any Gmail work", async () => {
    mocks.assertGmailNotCoolingDown.mockRejectedValue(
      new GmailQuotaCooldownError(45_000),
    );

    const first = await action
      .run({ q: "from:sender@example.com" })
      .catch((caught: unknown) => caught);
    const second = await action
      .run({ q: "subject:invoice" })
      .catch((caught: unknown) => caught);

    for (const error of [first, second]) {
      expect(error).toBeInstanceOf(GmailQuotaCooldownError);
      expect(error).toMatchObject({
        errorCode: "gmail_quota_cooldown",
        details: { retryAfterMs: 45_000 },
      });
    }
    expect(mocks.assertGmailNotCoolingDown).toHaveBeenCalledWith([ACCOUNT]);
    expect(mocks.fetchGmailLabelMap).not.toHaveBeenCalled();
    expect(mocks.listGmailMessages).not.toHaveBeenCalled();
  });
});
