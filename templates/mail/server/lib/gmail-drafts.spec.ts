import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listOAuthAccountsByOwner: vi.fn(),
  getClientForConnectedAccount: vi.fn(),
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
}));

import {
  deleteGmailDraft,
  findGmailDraftAccount,
  saveGmailDraft,
} from "./gmail-drafts.js";

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
    mocks.googleFetch.mockImplementation(async (url: string, token: string) => {
      if (token === "token:owner@example.com") {
        if (url.includes("/drafts?")) return { drafts: [] };
        throw new Error("Google API error (404): Not Found");
      }
      return { id: "legacy-draft" };
    });

    await expect(
      findGmailDraftAccount({
        ownerEmail: "owner@example.com",
        draftId: "legacy-draft",
      }),
    ).resolves.toBe("secondary@example.com");
    // The owner's mailbox is also searched for a draft holding that message.
    expect(mocks.googleFetch).toHaveBeenNthCalledWith(
      3,
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
});

// Mail's Drafts list holds Gmail messages, so a draft reopened from it names
// its message ID ("message-of-draft") rather than its draft ID ("r-draft-7").
describe("a Gmail draft reopened by its message ID", () => {
  const notFound = () => new Error("Google API error (404): Not Found");

  function gmailWithDraft(draftsPages: unknown[]) {
    const pages = [...draftsPages];
    mocks.googleFetch.mockImplementation(
      async (url: string, _token: string, options?: { method?: string }) => {
        const method = options?.method ?? "GET";
        if (url.includes("/drafts?")) return pages.shift();
        if (url.endsWith("/drafts/r-draft-7")) {
          return method === "DELETE" ? null : { id: "r-draft-7" };
        }
        if (url.endsWith("/drafts") && method === "POST") {
          return { id: "r-new-draft" };
        }
        throw notFound();
      },
    );
  }

  const twoPages = [
    {
      drafts: [{ id: "r-other", message: { id: "message-of-other" } }],
      nextPageToken: "page-2",
    },
    { drafts: [{ id: "r-draft-7", message: { id: "message-of-draft" } }] },
  ];

  const calls = () =>
    mocks.googleFetch.mock.calls.map(
      ([url, , options]) =>
        `${(options as { method?: string } | undefined)?.method ?? "GET"} ${String(url).replace("https://gmail.googleapis.com/gmail/v1/users/me", "")}`,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "owner@example.com",
        displayName: null,
        tokens: { scope: "https://mail.google.com/" },
      },
    ]);
    mocks.getClientForConnectedAccount.mockResolvedValue({
      email: "owner@example.com",
      accessToken: "token",
    });
  });

  it("updates that draft instead of creating a second one", async () => {
    gmailWithDraft(twoPages);

    const result = await saveGmailDraft({
      ownerEmail: "owner@example.com",
      accountEmail: "owner@example.com",
      draftId: "message-of-draft",
      to: "recipient@example.com",
      subject: "Edited",
      body: "Edited body",
    });

    expect(result).toEqual({
      draftId: "r-draft-7",
      accountEmail: "owner@example.com",
      created: false,
      updated: true,
    });
    expect(calls()).toEqual([
      "PUT /drafts/message-of-draft",
      expect.stringMatching(/^GET \/drafts\?/),
      expect.stringMatching(/^GET \/drafts\?.*pageToken=page-2/),
      "PUT /drafts/r-draft-7",
    ]);
  });

  it("creates a draft only when no draft holds that message", async () => {
    gmailWithDraft([{ drafts: [] }]);

    const result = await saveGmailDraft({
      ownerEmail: "owner@example.com",
      accountEmail: "owner@example.com",
      draftId: "message-of-deleted-draft",
      to: "recipient@example.com",
      subject: "Edited",
      body: "Edited body",
    });

    expect(result).toEqual({
      draftId: "r-new-draft",
      accountEmail: "owner@example.com",
      created: true,
    });
  });

  it("deletes that draft when it is sent or discarded", async () => {
    gmailWithDraft(twoPages);

    await deleteGmailDraft({
      ownerEmail: "owner@example.com",
      accountEmail: "owner@example.com",
      draftId: "message-of-draft",
    });

    expect(calls()).toContain("DELETE /drafts/r-draft-7");
  });

  it("finds the account that owns that draft", async () => {
    gmailWithDraft(twoPages);

    await expect(
      findGmailDraftAccount({
        ownerEmail: "owner@example.com",
        draftId: "message-of-draft",
      }),
    ).resolves.toBe("owner@example.com");
    expect(calls()).toContain("GET /drafts/r-draft-7");
  });
});
