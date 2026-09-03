import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOAuthTokens: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  saveOAuthTokens: vi.fn(),
  gmailGetMessage: vi.fn(),
  googleFetch: vi.fn(),
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  getOAuthTokens: mocks.getOAuthTokens,
  listOAuthAccountsByOwner: mocks.listOAuthAccountsByOwner,
  saveOAuthTokens: mocks.saveOAuthTokens,
}));

vi.mock("./google-api.js", () => ({
  createOAuth2Client: vi.fn(),
  gmailGetMessage: mocks.gmailGetMessage,
  googleFetch: mocks.googleFetch,
}));

vi.mock("./google-auth.js", () => ({
  getOAuth2Credentials: vi.fn(),
}));

import { saveGmailDraft } from "./gmail-drafts.js";

describe("saveGmailDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
