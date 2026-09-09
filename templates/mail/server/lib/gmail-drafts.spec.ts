import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOAuthTokens: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  saveOAuthTokens: vi.fn(),
  createOAuth2Client: vi.fn(),
  getOAuth2Credentials: vi.fn(),
  gmailGetMessage: vi.fn(),
  googleFetch: vi.fn(),
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  getOAuthTokens: mocks.getOAuthTokens,
  listOAuthAccountsByOwner: mocks.listOAuthAccountsByOwner,
  saveOAuthTokens: mocks.saveOAuthTokens,
}));

vi.mock("./google-api.js", () => ({
  createOAuth2Client: mocks.createOAuth2Client,
  gmailGetMessage: mocks.gmailGetMessage,
  googleFetch: mocks.googleFetch,
}));

vi.mock("./google-auth.js", () => ({
  getOAuth2Credentials: mocks.getOAuth2Credentials,
}));

import { saveGmailDraft } from "./gmail-drafts.js";

describe("saveGmailDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    mocks.getOAuthTokens.mockResolvedValue({ access_token: "token" });
    mocks.gmailGetMessage.mockResolvedValue({
      threadId: "gmail-thread-1",
      payload: {
        headers: [
          { name: "Message-ID", value: "<message-1@example.com>" },
          { name: "References", value: "<root@example.com>" },
        ],
      },
    });
    mocks.googleFetch.mockResolvedValue({ id: "gmail-draft-1" });
  });

  it("preserves Gmail reply threading and the resolved account", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "owner@example.com",
        displayName: null,
        tokens: {
          access_token: "token",
          scope: "https://mail.google.com/",
        },
      },
    ]);

    const result = await saveGmailDraft({
      ownerEmail: "owner@example.com",
      to: "recipient@example.com",
      subject: "Re: Hello",
      body: "Reply",
      replyToId: "message-1",
      replyToThreadId: "fallback-thread",
    });

    expect(result).toEqual({
      draftId: "gmail-draft-1",
      accountEmail: "owner@example.com",
      created: true,
    });
    expect(mocks.gmailGetMessage).toHaveBeenCalledWith(
      "token",
      "message-1",
      "metadata",
    );
    const [, , options] = mocks.googleFetch.mock.calls[0] ?? [];
    const body = JSON.parse(options.body);
    const raw = Buffer.from(body.message.raw, "base64url").toString("utf8");
    expect(body.message.threadId).toBe("gmail-thread-1");
    expect(raw).toContain("In-Reply-To: <message-1@example.com>");
    expect(raw).toContain(
      "References: <root@example.com> <message-1@example.com>",
    );
  });

  it("uses a connected Gmail account when the owner email is not the account", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "gmail@example.com",
        displayName: null,
        tokens: {
          access_token: "token",
          scope: "https://www.googleapis.com/auth/gmail.modify",
        },
      },
    ]);

    const result = await saveGmailDraft({
      ownerEmail: "owner@example.com",
      to: "recipient@example.com",
      subject: "Hello",
      body: "Draft",
    });

    expect(result?.accountEmail).toBe("gmail@example.com");
    expect(mocks.getOAuthTokens).toHaveBeenCalledWith(
      "google",
      "gmail@example.com",
    );
  });

  it("skips a non-Gmail owner account when choosing a default", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "owner@example.com",
        displayName: null,
        tokens: {
          access_token: "owner-token",
          scope: "https://www.googleapis.com/auth/calendar.readonly",
        },
      },
      {
        accountId: "gmail@example.com",
        displayName: null,
        tokens: {
          access_token: "gmail-token",
          scope: "https://www.googleapis.com/auth/gmail.modify",
        },
      },
    ]);

    const result = await saveGmailDraft({
      ownerEmail: "owner@example.com",
      to: "recipient@example.com",
      subject: "Hello",
      body: "Draft",
    });

    expect(result?.accountEmail).toBe("gmail@example.com");
    expect(mocks.getOAuthTokens).toHaveBeenCalledWith(
      "google",
      "gmail@example.com",
    );
  });

  it("rejects an explicitly selected account without Gmail scope", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "owner@example.com",
        displayName: null,
        tokens: {
          access_token: "owner-token",
          scope: "https://www.googleapis.com/auth/calendar.readonly",
        },
      },
      {
        accountId: "gmail@example.com",
        displayName: null,
        tokens: {
          access_token: "gmail-token",
          scope: "https://www.googleapis.com/auth/gmail.modify",
        },
      },
    ]);

    await expect(
      saveGmailDraft({
        ownerEmail: "owner@example.com",
        accountEmail: "owner@example.com",
        to: "recipient@example.com",
        subject: "Hello",
        body: "Draft",
      }),
    ).rejects.toThrow("Account not owned by current user");
    expect(mocks.getOAuthTokens).not.toHaveBeenCalled();
  });

  it("keeps the local draft path when no Gmail account is connected", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "owner@example.com",
        displayName: null,
        tokens: {
          access_token: "owner-token",
          scope: "https://www.googleapis.com/auth/calendar.readonly",
        },
      },
    ]);

    const result = await saveGmailDraft({
      ownerEmail: "owner@example.com",
      to: "recipient@example.com",
      subject: "Hello",
      body: "Draft",
    });

    expect(result).toBeNull();
    expect(mocks.getOAuthTokens).not.toHaveBeenCalled();
  });

  it("refreshes a secondary account with the authenticated owner credentials", async () => {
    const refreshToken = vi.fn().mockResolvedValue({
      access_token: "refreshed-token",
      expires_in: 3600,
    });
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "gmail@example.com",
        displayName: null,
        tokens: {
          access_token: "expiring-token",
          refresh_token: "refresh-token",
          expiry_date: Date.now() + 1000,
          scope: "https://www.googleapis.com/auth/gmail.modify",
        },
      },
    ]);
    mocks.getOAuthTokens.mockResolvedValue({
      access_token: "expiring-token",
      refresh_token: "refresh-token",
      expiry_date: Date.now() + 1000,
    });
    mocks.getOAuth2Credentials.mockResolvedValue({
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    mocks.createOAuth2Client.mockReturnValue({ refreshToken });

    const result = await saveGmailDraft({
      ownerEmail: "owner@example.com",
      to: "recipient@example.com",
      subject: "Hello",
      body: "Draft",
    });

    expect(result?.accountEmail).toBe("gmail@example.com");
    expect(mocks.getOAuth2Credentials).toHaveBeenCalledWith(
      "owner@example.com",
    );
    expect(refreshToken).toHaveBeenCalledWith("refresh-token");
  });
});
