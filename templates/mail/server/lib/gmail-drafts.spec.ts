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
  moveGmailAttachments,
  type MovedGmailAttachment,
} from "../../shared/compose-attachments.js";
import type { ComposeAttachment } from "../../shared/types.js";
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
    const [, , options] =
      mocks.googleFetch.mock.calls.find(
        ([, , init]) => (init as { method?: string })?.method === "PUT",
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

// Gmail replaces a draft's message on every update, and the old message's
// attachment IDs stop working with it. A draft reopened from Drafts carries
// attachments read from the message it had then.
describe("attachments of a Gmail draft updated in place", () => {
  const notFound = () => new Error("Google API error (404): Not Found");
  type Part = { filename: string; data: string; attachmentId: string };

  /** The attachments of a raw MIME message Mail built, in order. */
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

  /** A mailbox holding draft "r-draft-7" and a received "source-message". */
  function fakeGmail() {
    let version = 1;
    const draft = {
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
      messageId === draft.messageId ? draft.parts : messages.get(messageId);
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
            drafts: [{ id: "r-draft-7", message: { id: draft.messageId } }],
          };
        }
        if (!new URL(url).pathname.endsWith("/drafts/r-draft-7")) {
          throw notFound();
        }
        if (options?.method === "PUT") {
          version += 1;
          draft.messageId = `message-${version}`;
          draft.parts = mimeAttachments(
            JSON.parse(String(options.body)).message.raw,
          ).map((part, index) => ({
            ...part,
            attachmentId: `part-${version}-${index}`,
          }));
          return { id: "r-draft-7", message: { id: draft.messageId } };
        }
        return {
          id: "r-draft-7",
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

    await expect(save("r-draft-7", [draftFile])).rejects.toThrow(
      "its attachments don't match",
    );
  });
});
