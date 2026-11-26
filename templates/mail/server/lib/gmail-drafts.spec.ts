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

import {
  moveGmailAttachments,
  type MovedGmailAttachment,
} from "../../shared/compose-attachments.js";
import type { ComposeAttachment } from "../../shared/types.js";
import {
  assertGmailDraftAccount,
  deleteGmailDraft,
  findGmailDraftAccount,
  saveGmailDraft,
} from "./gmail-drafts.js";

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
    mocks.googleFetch.mockImplementation(async (url: string, token: string) => {
      if (token === "token:owner@example.com") {
        if (url.includes("/drafts?")) return { drafts: [] };
        throw googleError(404, "Not Found");
      }
      return { id: "legacy-draft" };
    });

    await expect(
      findGmailDraftAccount({
        ownerEmail: "owner@example.com",
        draftId: "legacy-draft",
      }),
    ).resolves.toBe("secondary@example.com");
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

describe("assertGmailDraftAccount", () => {
  it("refuses an account the owner hasn't connected", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    mocks.getManagedGmailAccountEmail.mockResolvedValue(null);

    await expect(
      assertGmailDraftAccount("stranger@example.com", "owner@example.com"),
    ).rejects.toThrow("Account not owned by current user");
  });

  it("accepts the account the workspace manages", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    mocks.getManagedGmailAccountEmail.mockResolvedValue("owner@example.com");

    await expect(
      assertGmailDraftAccount("owner@example.com", "owner@example.com"),
    ).resolves.toBeUndefined();
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
    const [, , options] =
      mocks.googleFetch.mock.calls.find(
        ([, , init]) =>
          (init as { method?: string } | undefined)?.method === "PUT",
      ) ?? [];
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

describe("a Gmail draft reopened by its message ID", () => {
  const notFound = () => googleError(404, "Not Found");

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

  it("fails, without looking for another draft, when Gmail's error isn't a 404", async () => {
    mocks.googleFetch.mockRejectedValue(
      googleError(500, "upstream returned 404"),
    );

    await expect(
      saveGmailDraft({
        ownerEmail: "owner@example.com",
        accountEmail: "owner@example.com",
        draftId: "message-of-draft",
        to: "recipient@example.com",
        subject: "Edited",
        body: "Edited body",
      }),
    ).rejects.toMatchObject({ status: 500 });
    expect(calls()).toEqual(["PUT /drafts/message-of-draft"]);
  });
});

describe("attachments of a Gmail draft updated in place", () => {
  const notFound = () => googleError(404, "Not Found");
  type Part = { filename: string; data: string; attachmentId: string };

  function mimeAttachments(raw: string) {
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    return [
      ...mime.matchAll(
        /filename="([^"]*)"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n\r\n--/g,
      ),
    ].map(([, filename = "", body = ""]) => ({
      filename,
      data: Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8"),
    }));
  }

  function fakeGmail() {
    let version = 1;
    const draft = {
      id: "r-draft-7",
      deleted: false,
      messageId: "message-of-draft",
      parts: [
        { filename: "brief.pdf", data: "draft file", attachmentId: "part-1-0" },
      ] as Part[],
    };
    const messages = new Map<string, Part[]>([
      [
        "source-message",
        [
          {
            filename: "forwarded.txt",
            data: "forwarded file",
            attachmentId: "source-part",
          },
        ],
      ],
    ]);
    const partsOf = (messageId: string) =>
      messageId === draft.messageId && !draft.deleted
        ? draft.parts
        : messages.get(messageId);
    mocks.gmailGetMessage.mockImplementation(
      async (_token: string, messageId: string) => {
        if (!partsOf(messageId)) throw notFound();
        return { id: messageId };
      },
    );
    const writeMessage = (options: RequestInit) => {
      version += 1;
      draft.messageId = `message-${version}`;
      draft.parts = mimeAttachments(
        JSON.parse(String(options.body)).message.raw,
      ).map((part, index) => ({
        ...part,
        attachmentId: `part-${version}-${index}`,
      }));
    };
    mocks.gmailGetAttachment.mockImplementation(
      async (_token: string, messageId: string, attachmentId: string) => {
        const part = partsOf(messageId)?.find(
          (candidate) => candidate.attachmentId === attachmentId,
        );
        if (!part) throw notFound();
        return { data: Buffer.from(part.data).toString("base64url") };
      },
    );
    mocks.googleFetch.mockImplementation(
      async (url: string, _token: string, options?: RequestInit) => {
        if (url.includes("/drafts?")) {
          return {
            drafts: draft.deleted
              ? []
              : [{ id: draft.id, message: { id: draft.messageId } }],
          };
        }
        const { pathname } = new URL(url);
        if (pathname.endsWith("/drafts") && options?.method === "POST") {
          writeMessage(options);
          Object.assign(draft, { id: "r-new-draft", deleted: false });
          return { id: draft.id, message: { id: draft.messageId } };
        }
        if (draft.deleted || !pathname.endsWith(`/drafts/${draft.id}`)) {
          throw notFound();
        }
        if (options?.method === "PUT") {
          writeMessage(options);
          return { id: draft.id, message: { id: draft.messageId } };
        }
        return {
          id: draft.id,
          message: {
            id: draft.messageId,
            payload: {
              parts: [
                { filename: "", body: { size: 0 } },
                ...draft.parts.map((part) => ({
                  filename: part.filename,
                  body: {
                    attachmentId: part.attachmentId,
                    size: Buffer.byteLength(part.data),
                  },
                })),
              ],
            },
          },
        };
      },
    );
    return draft;
  }

  const draftFile: ComposeAttachment = {
    id: "part-1-0",
    filename: "brief.pdf",
    originalName: "brief.pdf",
    mimeType: "application/pdf",
    size: 10,
    source: "gmail",
    gmailMessageId: "message-of-draft",
    gmailAttachmentId: "part-1-0",
    accountEmail: "owner@example.com",
  };
  const forwardedFile: ComposeAttachment = {
    id: "source-part",
    filename: "forwarded.txt",
    originalName: "forwarded.txt",
    mimeType: "text/plain",
    size: 14,
    source: "gmail",
    gmailMessageId: "source-message",
    gmailAttachmentId: "source-part",
    accountEmail: "owner@example.com",
  };

  const save = (draftId: string, attachments: ComposeAttachment[]) =>
    saveGmailDraft({
      ownerEmail: "owner@example.com",
      accountEmail: "owner@example.com",
      draftId,
      to: "recipient@example.com",
      subject: "Edited",
      body: "Edited body",
      attachments,
    });

  const requests = () =>
    mocks.googleFetch.mock.calls.map(([url, , options]) => {
      const { pathname, searchParams } = new URL(String(url));
      return `${(options as RequestInit | undefined)?.method ?? "GET"} ${pathname.replace("/gmail/v1/users/me", "")}${searchParams.has("format") ? `?format=${searchParams.get("format")}` : ""}`;
    });

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

  it("keeps a reopened draft's own file through two saves", async () => {
    const draft = fakeGmail();

    const first = await save("message-of-draft", [draftFile]);
    expect(first?.movedAttachments).toEqual([
      {
        from: {
          gmailMessageId: "message-of-draft",
          gmailAttachmentId: "part-1-0",
        },
        to: { gmailMessageId: "message-2", gmailAttachmentId: "part-2-0" },
      },
    ]);
    const moved = moveGmailAttachments(
      [draftFile],
      first?.movedAttachments ?? [],
    );

    const second = await save("r-draft-7", moved);
    expect(second?.movedAttachments).toEqual([
      {
        from: { gmailMessageId: "message-2", gmailAttachmentId: "part-2-0" },
        to: { gmailMessageId: "message-3", gmailAttachmentId: "part-3-0" },
      },
    ]);
    expect(draft.parts).toEqual([
      { filename: "brief.pdf", data: "draft file", attachmentId: "part-3-0" },
    ]);
    expect(mocks.gmailGetMessage).not.toHaveBeenCalled();
  });

  it("leaves a forwarded file's refs alone, since its message stays", async () => {
    fakeGmail();

    const result = await save("r-draft-7", [forwardedFile]);

    expect(result).not.toHaveProperty("movedAttachments");
    expect(requests()).toEqual([
      "GET /drafts/r-draft-7?format=minimal",
      "PUT /drafts/r-draft-7",
    ]);
  });

  it("matches each file to its own part when only some moved", async () => {
    const draft = fakeGmail();

    const result = await save("r-draft-7", [forwardedFile, draftFile]);

    expect(result?.movedAttachments).toEqual([
      {
        from: {
          gmailMessageId: "message-of-draft",
          gmailAttachmentId: "part-1-0",
        },
        to: { gmailMessageId: "message-2", gmailAttachmentId: "part-2-1" },
      },
    ] satisfies MovedGmailAttachment[]);
    expect(draft.parts.map((part) => part.data)).toEqual([
      "forwarded file",
      "draft file",
    ]);
  });

  it("asks Gmail nothing more for a draft with no Gmail files", async () => {
    fakeGmail();

    await save("r-draft-7", []);

    expect(requests()).toEqual(["PUT /drafts/r-draft-7"]);
  });

  it("fails loudly when Gmail's copy doesn't hold the files Mail sent", async () => {
    const draft = fakeGmail();
    const gmail = mocks.googleFetch.getMockImplementation();
    mocks.googleFetch.mockImplementation(async (...args: unknown[]) => {
      const result = await gmail?.(...args);
      draft.parts = [];
      return result;
    });

    const result = await save("r-draft-7", [draftFile]);

    expect(result?.draftId).toBe("r-draft-7");
    expect(result?.attachmentsError?.message).toContain(
      "its attachments don't match",
    );
    expect(result).not.toHaveProperty("movedAttachments");
  });

  function failReadAfterUpdate() {
    const gmail = mocks.googleFetch.getMockImplementation();
    let updated = false;
    let failed = false;
    mocks.googleFetch.mockImplementation(
      async (url: string, token: string, options?: RequestInit) => {
        if (options?.method === "PUT" || options?.method === "POST") {
          updated = true;
        } else if (
          updated &&
          !failed &&
          new URL(url).searchParams.get("format") === "full"
        ) {
          failed = true;
          throw new Error("Google API error (503): Backend Error");
        }
        return gmail?.(url, token, options);
      },
    );
  }

  it("keeps the draft and its file when Mail can't read where an update moved it", async () => {
    const draft = fakeGmail();
    failReadAfterUpdate();

    const first = await save("message-of-draft", [draftFile]);

    expect(first?.draftId).toBe("r-draft-7");
    expect(first?.attachmentsError?.message).toContain(
      "couldn't confirm where its attachments moved",
    );
    expect(first).not.toHaveProperty("movedAttachments");
    expect(draft.messageId).toBe("message-2");

    const second = await save(first?.draftId ?? "", [draftFile]);

    expect(second).toMatchObject({ draftId: "r-draft-7", updated: true });
    expect(second?.attachmentsError).toBeUndefined();
    expect(second?.movedAttachments).toEqual([
      {
        from: {
          gmailMessageId: "message-of-draft",
          gmailAttachmentId: "part-1-0",
        },
        to: { gmailMessageId: "message-3", gmailAttachmentId: "part-3-0" },
      },
    ]);
    expect(draft.parts).toEqual([
      { filename: "brief.pdf", data: "draft file", attachmentId: "part-3-0" },
    ]);
  });

  function deleteDraftAfterFirstRead(draft: { deleted: boolean }) {
    const read = mocks.gmailGetAttachment.getMockImplementation();
    let first = true;
    mocks.gmailGetAttachment.mockImplementation(async (...args: unknown[]) => {
      const result = await read?.(...args);
      if (first) draft.deleted = true;
      first = false;
      return result;
    });
  }

  it("says where a deleted draft's files went in the draft that replaces it", async () => {
    const draft = fakeGmail();
    deleteDraftAfterFirstRead(draft);

    const result = await save("r-draft-7", [draftFile, forwardedFile]);

    expect(result).toMatchObject({ draftId: "r-new-draft", created: true });
    expect(result?.attachmentsError).toBeUndefined();
    expect(result?.movedAttachments).toEqual([
      {
        from: {
          gmailMessageId: "message-of-draft",
          gmailAttachmentId: "part-1-0",
        },
        to: { gmailMessageId: "message-2", gmailAttachmentId: "part-2-0" },
      },
      {
        from: {
          gmailMessageId: "source-message",
          gmailAttachmentId: "source-part",
        },
        to: { gmailMessageId: "message-2", gmailAttachmentId: "part-2-1" },
      },
    ] satisfies MovedGmailAttachment[]);
    expect(draft.parts.map((part) => part.data)).toEqual([
      "draft file",
      "forwarded file",
    ]);
  });

  it("names the replacing draft when it can't say where a deleted draft's files went", async () => {
    const draft = fakeGmail();
    deleteDraftAfterFirstRead(draft);
    failReadAfterUpdate();

    const first = await save("r-draft-7", [draftFile]);

    expect(first).toMatchObject({ draftId: "r-new-draft", created: true });
    expect(first?.attachmentsError?.message).toContain(
      "couldn't confirm where its attachments moved",
    );
    expect(first).not.toHaveProperty("movedAttachments");

    const second = await save("r-new-draft", [draftFile]);

    expect(second).toMatchObject({ draftId: "r-new-draft", updated: true });
    expect(second?.movedAttachments).toEqual([
      {
        from: {
          gmailMessageId: "message-of-draft",
          gmailAttachmentId: "part-1-0",
        },
        to: { gmailMessageId: "message-3", gmailAttachmentId: "part-3-0" },
      },
    ]);
  });

  it("won't swap in a draft file for one whose read failed while its message stands", async () => {
    const draft = fakeGmail();
    draft.parts = [
      {
        filename: "forwarded.txt",
        data: "forwarded file",
        attachmentId: "part-1-0",
      },
    ];
    const read = mocks.gmailGetAttachment.getMockImplementation();
    mocks.gmailGetAttachment.mockImplementation(
      async (token: string, messageId: string, attachmentId: string) =>
        messageId === "source-message"
          ? {}
          : read?.(token, messageId, attachmentId),
    );

    await expect(save("r-draft-7", [forwardedFile])).rejects.toThrow(
      "Gmail attachment could not be read",
    );
    expect(mocks.gmailGetMessage).toHaveBeenCalledWith(
      "token",
      "source-message",
      "minimal",
    );
    expect(draft.messageId).toBe("message-of-draft");
  });

  it("won't swap in a draft file for another account's file whose read failed", async () => {
    mocks.listOAuthAccountsByOwner.mockResolvedValue([
      {
        accountId: "owner@example.com",
        displayName: null,
        tokens: { scope: "https://mail.google.com/" },
      },
      {
        accountId: "source@example.com",
        displayName: null,
        tokens: { scope: "https://mail.google.com/" },
      },
    ]);
    mocks.getClientForConnectedAccount.mockImplementation(
      async (_owner: string, account: string) => ({
        email: account,
        accessToken: `token:${account}`,
      }),
    );
    const draft = fakeGmail();
    draft.parts = [
      {
        filename: "forwarded.txt",
        data: "unrelated file",
        attachmentId: "part-1-0",
      },
    ];
    const read = mocks.gmailGetAttachment.getMockImplementation();
    mocks.gmailGetAttachment.mockImplementation(
      async (token: string, messageId: string, attachmentId: string) =>
        token === "token:source@example.com"
          ? {}
          : read?.(token, messageId, attachmentId),
    );
    const getMessage = mocks.gmailGetMessage.getMockImplementation();
    mocks.gmailGetMessage.mockImplementation(
      async (token: string, messageId: string, format: string) => {
        if (
          messageId === "source-message" &&
          token !== "token:source@example.com"
        ) {
          throw notFound();
        }
        return getMessage?.(token, messageId, format);
      },
    );

    await expect(
      save("r-draft-7", [
        { ...forwardedFile, accountEmail: "source@example.com" },
      ]),
    ).rejects.toThrow("Gmail attachment could not be read");
    expect(draft.messageId).toBe("message-of-draft");
    expect(draft.parts.map((part) => part.data)).toEqual(["unrelated file"]);
  });

  it("won't recover a file when Gmail can't say whether its message is gone", async () => {
    const draft = fakeGmail();
    mocks.gmailGetMessage.mockRejectedValue(googleError(503, "Backend Error"));
    const stale = { ...draftFile, gmailMessageId: "message-gone" };

    await expect(save("r-draft-7", [stale])).rejects.toThrow(
      "Google API error (503)",
    );
    expect(draft.messageId).toBe("message-of-draft");
  });

  it("won't guess which of two same-named files a stale ref meant", async () => {
    const draft = fakeGmail();
    draft.parts = [
      { filename: "brief.pdf", data: "draft file", attachmentId: "part-1-0" },
      { filename: "brief.pdf", data: "other file", attachmentId: "part-1-1" },
    ];
    const stale = { ...draftFile, gmailMessageId: "message-gone" };

    await expect(save("r-draft-7", [stale])).rejects.toThrow(
      `couldn't tell which file in the Gmail draft is "brief.pdf"`,
    );
    expect(draft.messageId).toBe("message-of-draft");
  });

  const resumeFile: ComposeAttachment = {
    ...draftFile,
    filename: "Résumé.pdf",
    originalName: "Résumé.pdf",
  };
  it.each([
    ["decomposed", (name: string) => name.normalize("NFD")],
    [
      "as an RFC 2047 encoded word",
      (name: string) =>
        `=?UTF-8?B?${Buffer.from(name, "utf8").toString("base64")}?=`,
    ],
    [
      "as UTF-8 read as Latin-1",
      (name: string) => Buffer.from(name, "utf8").toString("latin1"),
    ],
  ])(
    "matches a non-ASCII filename Gmail reports %s",
    async (_form, reported) => {
      const draft = fakeGmail();
      draft.parts = [
        {
          filename: reported("Résumé.pdf"),
          data: "draft file",
          attachmentId: "part-1-0",
        },
      ];
      const gmail = mocks.googleFetch.getMockImplementation();
      mocks.googleFetch.mockImplementation(async (...args: unknown[]) => {
        const result = await gmail?.(...args);
        draft.parts = draft.parts.map((part) => ({
          ...part,
          filename: reported(part.filename.normalize("NFC")),
        }));
        return result;
      });

      const result = await save("message-of-draft", [resumeFile]);

      expect(result?.attachmentsError).toBeUndefined();
      expect(result?.movedAttachments).toEqual([
        {
          from: {
            gmailMessageId: "message-of-draft",
            gmailAttachmentId: "part-1-0",
          },
          to: { gmailMessageId: "message-2", gmailAttachmentId: "part-2-0" },
        },
      ]);
    },
  );

  it("still tells a different non-ASCII filename apart", async () => {
    const draft = fakeGmail();
    draft.parts = [
      { filename: "Résumé.pdf", data: "draft file", attachmentId: "part-1-0" },
    ];
    const gmail = mocks.googleFetch.getMockImplementation();
    mocks.googleFetch.mockImplementation(async (...args: unknown[]) => {
      const result = await gmail?.(...args);
      draft.parts = draft.parts.map((part) => ({
        ...part,
        filename: "Resume.pdf",
      }));
      return result;
    });

    const result = await save("message-of-draft", [resumeFile]);

    expect(result?.attachmentsError?.message).toContain(
      `its copy of "Résumé.pdf" doesn't match`,
    );
  });
});
