import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listOAuthAccountsByOwner: vi.fn(),
  getClientForConnectedAccount: vi.fn(),
  getManagedGmailAccountEmail: vi.fn(),
  gmailGetAttachment: vi.fn(),
  gmailGetMessage: vi.fn(),
  googleFetch: vi.fn(),
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  listOAuthAccountsByOwner: mocks.listOAuthAccountsByOwner,
}));

vi.mock("./google-api.js", () => ({
  gmailGetAttachment: mocks.gmailGetAttachment,
  gmailGetMessage: mocks.gmailGetMessage,
  googleFetch: mocks.googleFetch,
}));

vi.mock("./google-auth.js", () => ({
  getClientForConnectedAccount: mocks.getClientForConnectedAccount,
  getManagedGmailAccountEmail: mocks.getManagedGmailAccountEmail,
}));

import { findGmailDraftAccount, saveGmailDraft } from "./gmail-drafts.js";

/** An error as google-api.ts throws it, with its HTTP status. */
function googleError(status: number, detail: string) {
  return Object.assign(new Error(`Google API error (${status}): ${detail}`), {
    status,
  });
}

describe("findGmailDraftAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    mocks.getClientForConnectedAccount.mockImplementation(
      async (_owner: string, account: string) => ({
        email: account,
        accessToken: `token:${account}`,
      }),
    );
    mocks.googleFetch.mockResolvedValue({ id: "legacy-draft" });
  });

  it("checks connected mailboxes for an exact legacy draft ID", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "owner@example.com",
        displayName: null,
        tokens: { scope: "https://mail.google.com/" },
      },
      {
        accountId: "secondary@example.com",
        displayName: null,
        tokens: { scope: "https://www.googleapis.com/auth/gmail.modify" },
      },
    ]);
    mocks.googleFetch.mockImplementation(
      async (_url: string, token: string) => {
        if (token === "token:owner@example.com") {
          throw new Error("Google API error (404): Not Found");
        }
        return { id: "legacy-draft" };
      },
    );

    await expect(
      findGmailDraftAccount({
        ownerEmail: "owner@example.com",
        draftId: "legacy-draft",
      }),
    ).resolves.toBe("secondary@example.com");
    expect(mocks.googleFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/drafts/legacy-draft"),
      "token:secondary@example.com",
    );
  });

  it("does not turn unreadable Gmail ownership into an absent draft", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "owner@example.com",
        displayName: null,
        tokens: { scope: "https://mail.google.com/" },
      },
    ]);
    mocks.googleFetch.mockRejectedValue(
      new Error("Google API error (403): Insufficient permissions"),
    );

    await expect(
      findGmailDraftAccount({
        ownerEmail: "owner@example.com",
        draftId: "legacy-draft",
      }),
    ).rejects.toThrow("Google API error (403)");
  });
});

describe("saveGmailDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    mocks.getManagedGmailAccountEmail.mockResolvedValue(null);
    mocks.getClientForConnectedAccount.mockResolvedValue({
      email: "owner@example.com",
      accessToken: "token",
    });
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
          scope: "https://www.googleapis.com/auth/gmail.compose",
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
    expect(mocks.getClientForConnectedAccount).toHaveBeenCalledWith(
      "owner@example.com",
      "gmail@example.com",
    );
  });

  it("keeps Gmail attachments when updating an existing draft", async () => {
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
    mocks.gmailGetAttachment.mockResolvedValue({
      data: Buffer.from("attachment body").toString("base64url"),
    });

    await saveGmailDraft({
      ownerEmail: "owner@example.com",
      accountEmail: "owner@example.com",
      draftId: "gmail-draft-1",
      to: "recipient@example.com",
      subject: "Updated",
      body: "Revised body",
      attachments: [
        {
          id: "attachment-1",
          filename: "brief.pdf",
          originalName: "brief.pdf",
          mimeType: "application/pdf",
          size: 16,
          url: "/api/attachments/brief.pdf",
          source: "gmail",
          gmailMessageId: "source-message-1",
          gmailAttachmentId: "source-attachment-1",
          accountEmail: "owner@example.com",
        },
      ],
    });

    expect(mocks.gmailGetAttachment).toHaveBeenCalledWith(
      "token",
      "source-message-1",
      "source-attachment-1",
    );
    const [, , options] = mocks.googleFetch.mock.calls[0] ?? [];
    const raw = Buffer.from(
      JSON.parse(options.body).message.raw,
      "base64url",
    ).toString("utf8");
    expect(raw).toContain(
      'Content-Disposition: attachment; filename="brief.pdf"',
    );
    expect(raw).toContain(Buffer.from("attachment body").toString("base64"));
  });

  it("reads an attachment from a read-only Gmail account", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "draft@example.com",
        displayName: null,
        tokens: { scope: "https://www.googleapis.com/auth/gmail.compose" },
      },
      {
        accountId: "source@example.com",
        displayName: null,
        tokens: { scope: "https://www.googleapis.com/auth/gmail.readonly" },
      },
    ]);
    mocks.gmailGetAttachment.mockResolvedValue({
      data: Buffer.from("source attachment").toString("base64url"),
    });

    await saveGmailDraft({
      ownerEmail: "owner@example.com",
      accountEmail: "draft@example.com",
      to: "recipient@example.com",
      subject: "Forwarded file",
      body: "See attached",
      attachments: [
        {
          id: "attachment-1",
          filename: "brief.pdf",
          originalName: "brief.pdf",
          mimeType: "application/pdf",
          size: 17,
          url: "/api/attachments/brief.pdf",
          source: "gmail",
          gmailMessageId: "source-message-1",
          gmailAttachmentId: "source-attachment-1",
          accountEmail: "source@example.com",
        },
      ],
    });

    expect(mocks.getClientForConnectedAccount).toHaveBeenCalledWith(
      "owner@example.com",
      "source@example.com",
    );
    expect(mocks.gmailGetAttachment).toHaveBeenCalledWith(
      "token",
      "source-message-1",
      "source-attachment-1",
    );
  });

  it("does not use a compose-only account for reply drafts", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "gmail@example.com",
        displayName: null,
        tokens: {
          access_token: "token",
          scope: "https://www.googleapis.com/auth/gmail.compose",
        },
      },
    ]);

    const result = await saveGmailDraft({
      ownerEmail: "owner@example.com",
      to: "recipient@example.com",
      subject: "Re: Hello",
      body: "Reply",
      replyToId: "message-1",
    });

    expect(result).toBeNull();
    expect(mocks.getClientForConnectedAccount).not.toHaveBeenCalled();
    expect(mocks.gmailGetMessage).not.toHaveBeenCalled();
  });

  it("skips a non-Gmail owner account when choosing a default", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "owner@example.com",
        displayName: null,
        tokens: {
          access_token: "owner-token",
          scope: "https://www.googleapis.com/auth/gmail.readonly",
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
    expect(mocks.getClientForConnectedAccount).toHaveBeenCalledWith(
      "owner@example.com",
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
    expect(mocks.getClientForConnectedAccount).not.toHaveBeenCalled();
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
    expect(mocks.getClientForConnectedAccount).not.toHaveBeenCalled();
  });

  it("uses the shared owner-scoped client for a secondary account", async () => {
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
    mocks.getClientForConnectedAccount.mockResolvedValue({
      email: "gmail@example.com",
      accessToken: "refreshed-token",
    });

    const result = await saveGmailDraft({
      ownerEmail: "owner@example.com",
      to: "recipient@example.com",
      subject: "Hello",
      body: "Draft",
    });

    expect(result?.accountEmail).toBe("gmail@example.com");
    expect(mocks.getClientForConnectedAccount).toHaveBeenCalledWith(
      "owner@example.com",
      "gmail@example.com",
    );
    expect(mocks.googleFetch).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      "refreshed-token",
      expect.any(Object),
    );
  });

  it("saves to a workspace's shared Gmail connection", async () => {
    mocks.getManagedGmailAccountEmail.mockResolvedValue("team@example.com");
    mocks.getClientForConnectedAccount.mockResolvedValue({
      email: "team@example.com",
      accessToken: "team-token",
    });

    const result = await saveGmailDraft({
      ownerEmail: "owner@example.com",
      to: "recipient@example.com",
      subject: "Hello",
      body: "Draft",
    });

    expect(result?.accountEmail).toBe("team@example.com");
    expect(mocks.getManagedGmailAccountEmail).toHaveBeenCalledWith(
      "owner@example.com",
    );
    expect(mocks.googleFetch).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      "team-token",
      expect.any(Object),
    );
  });

  it("matches a chosen account whatever its capitals", async () => {
    mocks.getManagedGmailAccountEmail.mockResolvedValue("Team@Example.com");

    const result = await saveGmailDraft({
      ownerEmail: "owner@example.com",
      accountEmail: "team@example.com",
      to: "recipient@example.com",
      subject: "Hello",
      body: "Draft",
    });

    expect(result?.accountEmail).toBe("Team@Example.com");
  });

  it("uses an OAuth account when the workspace connection can't be reached", async () => {
    mocks.getManagedGmailAccountEmail.mockRejectedValue(
      new Error("Workspace Gmail connection failed"),
    );
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "gmail@example.com",
        displayName: null,
        tokens: { scope: "https://www.googleapis.com/auth/gmail.modify" },
      },
    ]);

    const result = await saveGmailDraft({
      ownerEmail: "owner@example.com",
      to: "recipient@example.com",
      subject: "Hello",
      body: "Draft",
    });
    expect(result?.accountEmail).toBe("gmail@example.com");

    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    await expect(
      saveGmailDraft({
        ownerEmail: "owner@example.com",
        to: "recipient@example.com",
        subject: "Hello",
        body: "Draft",
      }),
    ).rejects.toThrow("Workspace Gmail connection failed");
  });

  describe("with optional reply headers", () => {
    const reply = {
      ownerEmail: "owner@example.com",
      to: "recipient@example.com",
      subject: "Re: Hello",
      body: "Reply",
      replyToId: "message-1",
      replyToThreadId: "thread-1",
      replyHeadersOptional: true,
    };

    function sentMessage() {
      const { calls } = mocks.googleFetch.mock;
      const [, , options] = calls[calls.length - 1] ?? [];
      const message = JSON.parse(options.body).message;
      return {
        threadId: message.threadId,
        raw: Buffer.from(message.raw, "base64url").toString("utf8"),
      };
    }

    it("saves a compose-only account's reply outside the thread", async () => {
      mocks.listOAuthAccountsByOwner.mockResolvedValue([
        {
          accountId: "owner@example.com",
          displayName: null,
          tokens: { scope: "https://www.googleapis.com/auth/gmail.compose" },
        },
      ]);

      const result = await saveGmailDraft(reply);

      expect(result?.draftId).toBe("gmail-draft-1");
      expect(mocks.gmailGetMessage).not.toHaveBeenCalled();
      expect(sentMessage().threadId).toBeUndefined();
      expect(sentMessage().raw).not.toContain("In-Reply-To");
    });

    it("saves a reply to a message that's gone outside the thread", async () => {
      mocks.listOAuthAccountsByOwner.mockResolvedValue([
        {
          accountId: "owner@example.com",
          displayName: null,
          tokens: { scope: "https://mail.google.com/" },
        },
      ]);
      mocks.gmailGetMessage.mockRejectedValue(googleError(404, "Not Found"));

      const result = await saveGmailDraft(reply);

      expect(result?.draftId).toBe("gmail-draft-1");
      expect(sentMessage().threadId).toBeUndefined();
      expect(sentMessage().raw).not.toContain("In-Reply-To");
    });

    it("saves a reply Gmail won't let it read outside the thread", async () => {
      mocks.listOAuthAccountsByOwner.mockResolvedValue([
        {
          accountId: "owner@example.com",
          displayName: null,
          tokens: { scope: "https://mail.google.com/" },
        },
      ]);
      mocks.gmailGetMessage.mockRejectedValue(googleError(403, "Forbidden"));

      await expect(saveGmailDraft(reply)).resolves.toMatchObject({
        draftId: "gmail-draft-1",
      });
      expect(sentMessage().threadId).toBeUndefined();
    });

    it("still threads a reply whose message it can read", async () => {
      mocks.listOAuthAccountsByOwner.mockResolvedValue([
        {
          accountId: "owner@example.com",
          displayName: null,
          tokens: { scope: "https://mail.google.com/" },
        },
      ]);

      await saveGmailDraft(reply);

      expect(sentMessage().threadId).toBe("gmail-thread-1");
      expect(sentMessage().raw).toContain(
        "In-Reply-To: <message-1@example.com>",
      );
    });

    it("doesn't save when reading the message fails for another reason", async () => {
      mocks.listOAuthAccountsByOwner.mockResolvedValue([
        {
          accountId: "owner@example.com",
          displayName: null,
          tokens: { scope: "https://mail.google.com/" },
        },
      ]);
      // The status decides, not a number somewhere in the message.
      mocks.gmailGetMessage.mockRejectedValue(
        googleError(500, "upstream returned 404"),
      );

      await expect(saveGmailDraft(reply)).rejects.toThrow("500");
      expect(mocks.googleFetch).not.toHaveBeenCalled();
    });
  });
});
