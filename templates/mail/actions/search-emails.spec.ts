import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildDeepLink: vi.fn(),
  fetchGmailLabelMap: vi.fn(),
  getClientsWithErrors: vi.fn(),
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
  getClientsWithErrors: mocks.getClientsWithErrors,
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
  mocks.getClientsWithErrors.mockResolvedValue({
    clients: [
      { email: ACCOUNT, accessToken: "access-token", refreshToken: "" },
    ],
    errors: [],
  });
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

describe("search-emails query cost", () => {
  it("uses a bounded metadata window and scopes reads to the requested account", async () => {
    mocks.listGmailMessages.mockResolvedValue({ messages: [], errors: [] });

    await action.run({ q: "from:sender@example.com", account: ACCOUNT });

    expect(mocks.getClientsWithErrors).toHaveBeenCalledWith(OWNER, [ACCOUNT]);
    expect(mocks.assertGmailNotCoolingDown).toHaveBeenCalledWith([ACCOUNT]);
    expect(mocks.fetchGmailLabelMap).toHaveBeenCalledTimes(1);
    expect(mocks.listGmailMessages).toHaveBeenCalledWith(
      "from:sender@example.com",
      25,
      OWNER,
      undefined,
      {
        mode: "threads",
        threadFormat: "metadata",
        threadCandidateLimit: 40,
        accountEmails: [ACCOUNT],
      },
    );
  });

  it("loads full thread details for non-compact results", async () => {
    mocks.listGmailMessages.mockResolvedValue({ messages: [], errors: [] });

    await action.run({ q: "invoice", compact: false });

    expect(mocks.listGmailMessages).toHaveBeenCalledWith(
      "invoice",
      25,
      OWNER,
      undefined,
      expect.objectContaining({ threadFormat: "full" }),
    );
  });

  it("loads full thread details for attachment-metadata searches", async () => {
    mocks.listGmailMessages.mockResolvedValue({ messages: [], errors: [] });

    await action.run({ q: "has:attachment" });

    expect(mocks.listGmailMessages).toHaveBeenCalledWith(
      "has:attachment",
      25,
      OWNER,
      undefined,
      expect.objectContaining({ threadFormat: "full" }),
    );
  });

  it("keeps larger requested result limits within the candidate window", async () => {
    mocks.listGmailMessages.mockResolvedValue({ messages: [], errors: [] });

    await action.run({ q: "from:sender@example.com", limit: 60 });

    expect(mocks.listGmailMessages).toHaveBeenCalledWith(
      "from:sender@example.com",
      60,
      OWNER,
      undefined,
      expect.objectContaining({ threadCandidateLimit: 61 }),
    );
  });

  it("rejects result limits outside Gmail's supported range", () => {
    expect(action.schema.safeParse({ q: "invoice", limit: 501 }).success).toBe(
      false,
    );
    expect(action.schema.safeParse({ q: "invoice", limit: 0 }).success).toBe(
      false,
    );
  });

  it("fails when any mailbox cannot be resolved", async () => {
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [
        { email: ACCOUNT, accessToken: "access-token", refreshToken: "" },
      ],
      errors: [{ email: "second@example.com", error: "token refresh failed" }],
    });

    await expect(action.run({ q: "invoice" })).rejects.toThrow(
      "second@example.com: token refresh failed",
    );
    expect(mocks.listGmailMessages).not.toHaveBeenCalled();
  });

  it("fails instead of returning a partial mailbox result", async () => {
    mocks.listGmailMessages.mockResolvedValue({
      messages: [{}],
      errors: [{ email: "second@example.com", error: "provider unavailable" }],
    });

    await expect(action.run({ q: "invoice" })).rejects.toThrow(
      "second@example.com: provider unavailable",
    );
  });

  it("keeps quota errors typed when another mailbox returned results", async () => {
    mocks.listGmailMessages.mockResolvedValue({
      messages: [{}],
      errors: [
        {
          email: "second@example.com",
          error: "rate limit exceeded",
          isQuotaError: true,
          retryAfterMs: 30_000,
        },
      ],
    });

    await expect(action.run({ q: "invoice" })).rejects.toMatchObject({
      errorCode: "gmail_quota_cooldown",
      details: { retryAfterMs: 30_000 },
    });
  });
});
