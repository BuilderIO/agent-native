import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getRouterParam: vi.fn(),
  readBody: vi.fn(),
  readSettings: vi.fn(),
  isConnected: vi.fn(),
  getConnectedAccountsWithErrors: vi.fn(),
  getClientForConnectedAccount: vi.fn(),
  getClientsWithErrors: vi.fn(),
  invalidateHistoryCacheForAccount: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  getAccountDisplayName: vi.fn(),
  setAccountDisplayName: vi.fn(),
  setOAuthDisplayName: vi.fn(),
  resolveGoogleSenderIdentity: vi.fn(),
  incrementSendFrequency: vi.fn(),
  withLocalEmailMutationLock: vi.fn(),
  resolveComposeAttachments: vi.fn(),
  buildOutgoingRawEmail: vi.fn(),
  googleFetch: vi.fn(),
  setResponseStatus: vi.fn(),
  resolveExistingSavedDraftOwnership: vi.fn(),
}));

vi.mock("h3", () => ({
  createError: (error: Record<string, unknown>) =>
    Object.assign(new Error(String(error.statusMessage ?? "Error")), error),
  defineEventHandler: (handler: unknown) => handler,
  getHeader: () => undefined,
  getQuery: () => ({}),
  getRouterParam: mocks.getRouterParam,
  setResponseHeader: vi.fn(),
  setResponseStatus: mocks.setResponseStatus,
}));

vi.mock("@agent-native/core/event-bus", () => ({ emit: vi.fn() }));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: vi.fn(),
}));
vi.mock("@agent-native/core/oauth-tokens", () => ({
  listOAuthAccountsByOwner: mocks.listOAuthAccountsByOwner,
  setOAuthDisplayName: mocks.setOAuthDisplayName,
}));
vi.mock("@agent-native/core/server", () => ({
  getAppProductionUrl: vi.fn(),
  getSession: mocks.getSession,
  readBody: mocks.readBody,
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: vi.fn(),
  putUserSetting: vi.fn(),
}));
vi.mock("../lib/contact-frequency.js", () => ({
  getContactFrequencyMap: vi.fn(),
  incrementSendFrequency: mocks.incrementSendFrequency,
}));
vi.mock("../lib/email-tracking.js", () => ({
  collectLinks: vi.fn(),
  newClickToken: vi.fn(),
  newPixelToken: vi.fn(),
  persistTracking: vi.fn(),
}));
vi.mock("../lib/gmail-query.js", () => ({
  filterInboxScopedThreadMessages: vi.fn(),
  filterLabelMessages: vi.fn(),
}));
vi.mock("../lib/google-api.js", () => ({
  GmailQuotaCooldownError: class GmailQuotaCooldownError extends Error {},
  calendarGetEvent: vi.fn(),
  calendarPatchEvent: vi.fn(),
  gmailGetAttachment: vi.fn(),
  gmailGetMessage: vi.fn(),
  gmailGetThread: vi.fn(),
  gmailListLabels: vi.fn(),
  gmailModifyThread: vi.fn(),
  gmailSendMessage: vi.fn(),
  googleFetch: mocks.googleFetch,
  peopleListConnections: vi.fn(),
  peopleListOtherContacts: vi.fn(),
}));
vi.mock("../lib/google-auth.js", () => ({
  getAccountDisplayName: mocks.getAccountDisplayName,
  getClientForConnectedAccount: mocks.getClientForConnectedAccount,
  getClientsWithErrors: mocks.getClientsWithErrors,
  getConnectedAccountsWithErrors: mocks.getConnectedAccountsWithErrors,
  gmailToEmailMessage: vi.fn(),
  invalidateHistoryCacheForAccount: mocks.invalidateHistoryCacheForAccount,
  invalidateListCacheForOwner: vi.fn(),
  isConnected: mocks.isConnected,
  listGmailMessages: vi.fn(),
  setAccountDisplayName: mocks.setAccountDisplayName,
}));
vi.mock("../lib/thread-cache.js", () => ({
  invalidateThreadCache: vi.fn(),
  threadCacheKey: vi.fn(),
  threadMessagesCache: new Map(),
  THREAD_CACHE_TTL: 60_000,
}));
vi.mock("../lib/inbox-store-sync.js", () => ({
  syncInboxLabelDelta: vi.fn(),
}));
vi.mock("../lib/jobs.js", () => ({
  getSnoozedThreadIds: vi.fn(),
  getSyntheticEmailsForView: vi.fn(),
}));
vi.mock("../lib/list-inbox-emails.js", () => ({ listInboxEmails: vi.fn() }));
vi.mock("../lib/local-email-store.js", () => ({
  readLocalEmails: vi.fn(),
  withLocalEmailMutationLock: mocks.withLocalEmailMutationLock,
  writeLocalEmails: vi.fn(),
}));
vi.mock("../lib/mail-settings.js", () => ({
  readSettings: mocks.readSettings,
}));
vi.mock("../lib/outgoing-email.js", () => ({
  bodyToHtml: vi.fn(),
  buildRawEmail: mocks.buildOutgoingRawEmail,
  mimeAttachmentFilename: (attachment: {
    filename: string;
    originalName?: string;
  }) => attachment.originalName || attachment.filename,
  resolveComposeAttachments: mocks.resolveComposeAttachments,
  splitReplyQuote: vi.fn(),
}));
vi.mock("../lib/saved-draft-ownership.js", () => ({
  resolveExistingSavedDraftOwnership: mocks.resolveExistingSavedDraftOwnership,
  SavedDraftOwnershipError: class SavedDraftOwnershipError extends Error {},
}));
vi.mock("../lib/sender-identity.js", () => ({
  resolveGoogleSenderIdentity: mocks.resolveGoogleSenderIdentity,
}));

const { deleteDraft, saveDraft, sendEmail } = await import("./emails.js");

describe("saveDraft with a workspace-managed Gmail account", () => {
  const ownerEmail = "owner@example.com";
  const managedAccountEmail = "mailbox@example.com";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ email: ownerEmail });
    mocks.getRouterParam.mockReturnValue(undefined);
    mocks.readSettings.mockResolvedValue({ name: "Test", email: ownerEmail });
    mocks.readBody.mockResolvedValue({
      to: "recipient@example.com",
      subject: "Test draft",
      body: "",
    });
    mocks.isConnected.mockResolvedValue(true);
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: [managedAccountEmail],
      errors: [],
    });
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [
        {
          email: managedAccountEmail,
          accessToken: "test-access-token",
          refreshToken: "",
        },
      ],
      errors: [],
    });
    mocks.listOAuthAccountsByOwner.mockResolvedValue([]);
    mocks.getClientForConnectedAccount.mockResolvedValue({
      accessToken: "test-access-token",
      email: managedAccountEmail,
    });
    mocks.incrementSendFrequency.mockResolvedValue(undefined);
    mocks.resolveComposeAttachments.mockResolvedValue([]);
    mocks.buildOutgoingRawEmail.mockReturnValue("encoded-test-message");
    mocks.googleFetch.mockResolvedValue({ id: "gmail-draft-id" });
  });

  it("defaults to the connected account and saves with its managed token", async () => {
    const result = await (saveDraft as (event: unknown) => Promise<unknown>)(
      {},
    );

    expect(mocks.getClientsWithErrors).toHaveBeenCalledWith(ownerEmail);
    expect(mocks.getClientForConnectedAccount).toHaveBeenCalledWith(
      ownerEmail,
      managedAccountEmail,
    );
    expect(mocks.googleFetch).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      "test-access-token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({
      draftId: "gmail-draft-id",
      backend: "gmail",
      accountEmail: managedAccountEmail,
      created: true,
    });
  });

  it("saves an edit to a draft reopened from Drafts into that same Gmail draft", async () => {
    mocks.readBody.mockResolvedValue({
      to: "recipient@example.com",
      subject: "Edited draft",
      body: "Edited body",
      draftId: "message-of-draft",
      savedDraftBackend: "gmail",
      accountEmail: managedAccountEmail,
    });
    mocks.resolveExistingSavedDraftOwnership.mockResolvedValue({
      backend: "gmail",
      accountEmail: managedAccountEmail,
    });
    mocks.googleFetch.mockImplementation(async (url: string) => {
      if (url.endsWith("/drafts/r-draft-7")) return { id: "r-draft-7" };
      if (url.includes("/drafts?")) {
        return {
          drafts: [{ id: "r-draft-7", message: { id: "message-of-draft" } }],
        };
      }
      throw Object.assign(new Error("Google API error (404): Not Found"), {
        status: 404,
      });
    });

    const result = await (saveDraft as (event: unknown) => Promise<unknown>)(
      {},
    );

    expect(result).toEqual({
      draftId: "r-draft-7",
      backend: "gmail",
      accountEmail: managedAccountEmail,
      updated: true,
    });
    expect(mocks.googleFetch).toHaveBeenLastCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts/r-draft-7",
      "test-access-token",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(mocks.googleFetch).not.toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      "test-access-token",
      expect.objectContaining({ method: "POST" }),
    );
  });

  describe("when the reopened draft holds a file of its own", () => {
    const draftFile = {
      id: "part-1",
      filename: "brief.pdf",
      originalName: "brief.pdf",
      mimeType: "application/pdf",
      size: 10,
      source: "gmail",
      gmailMessageId: "message-of-draft",
      gmailAttachmentId: "part-1",
      accountEmail: managedAccountEmail,
    };

    beforeEach(() => {
      mocks.resolveExistingSavedDraftOwnership.mockResolvedValue({
        backend: "gmail",
        accountEmail: managedAccountEmail,
      });
      let messageId = "message-of-draft";
      mocks.googleFetch.mockImplementation(
        async (url: string, _token: string, options?: RequestInit) => {
          const { pathname, searchParams } = new URL(url);
          if (pathname.endsWith("/drafts")) {
            return {
              drafts: [{ id: "r-draft-7", message: { id: messageId } }],
            };
          }
          if (!pathname.endsWith("/drafts/r-draft-7")) {
            throw Object.assign(
              new Error("Google API error (404): Not Found"),
              {
                status: 404,
              },
            );
          }
          if (options?.method === "PUT") {
            messageId = "message-2";
            return { id: "r-draft-7", message: { id: messageId } };
          }
          if (searchParams.get("format") === "minimal") {
            return { message: { id: messageId } };
          }
          return {
            message: {
              id: messageId,
              payload: {
                parts: [
                  { filename: "" },
                  {
                    filename: "brief.pdf",
                    body: { attachmentId: "part-2", size: 10 },
                  },
                ],
              },
            },
          };
        },
      );
    });

    it("says where Gmail moved the file", async () => {
      mocks.readBody.mockResolvedValue({
        to: "recipient@example.com",
        subject: "Edited draft",
        body: "Edited body",
        draftId: "message-of-draft",
        savedDraftBackend: "gmail",
        accountEmail: managedAccountEmail,
        attachments: [draftFile],
      });
      mocks.resolveComposeAttachments.mockResolvedValue([
        { ...draftFile, data: Buffer.from("draft file") },
      ]);

      const result = await (saveDraft as (event: unknown) => Promise<unknown>)(
        {},
      );

      expect(result).toEqual({
        draftId: "r-draft-7",
        backend: "gmail",
        accountEmail: managedAccountEmail,
        updated: true,
        movedAttachments: [
          {
            from: {
              gmailMessageId: "message-of-draft",
              gmailAttachmentId: "part-1",
            },
            to: { gmailMessageId: "message-2", gmailAttachmentId: "part-2" },
          },
        ],
      });
    });

    it("says where the file went in the draft that replaced a deleted one", async () => {
      mocks.googleFetch.mockImplementation(
        async (url: string, _token: string, options?: RequestInit) => {
          const { pathname } = new URL(url);
          if (pathname.endsWith("/drafts") && options?.method === "POST") {
            return { id: "r-new-draft", message: { id: "message-9" } };
          }
          if (pathname.endsWith("/drafts")) return { drafts: [] };
          if (!pathname.endsWith("/drafts/r-new-draft")) {
            throw Object.assign(
              new Error("Google API error (404): Not Found"),
              { status: 404 },
            );
          }
          return {
            message: {
              id: "message-9",
              payload: {
                parts: [
                  { filename: "" },
                  {
                    filename: "brief.pdf",
                    body: { attachmentId: "part-9", size: 10 },
                  },
                ],
              },
            },
          };
        },
      );
      mocks.readBody.mockResolvedValue({
        to: "recipient@example.com",
        subject: "Edited draft",
        body: "Edited body",
        draftId: "r-draft-7",
        savedDraftBackend: "gmail",
        accountEmail: managedAccountEmail,
        attachments: [draftFile],
      });
      mocks.resolveComposeAttachments.mockResolvedValue([
        { ...draftFile, data: Buffer.from("draft file") },
      ]);

      const result = await (saveDraft as (event: unknown) => Promise<unknown>)(
        {},
      );

      expect(result).toEqual({
        draftId: "r-new-draft",
        backend: "gmail",
        accountEmail: managedAccountEmail,
        created: true,
        movedAttachments: [
          {
            from: {
              gmailMessageId: "message-of-draft",
              gmailAttachmentId: "part-1",
            },
            to: { gmailMessageId: "message-9", gmailAttachmentId: "part-9" },
          },
        ],
      });
    });

    it("names the Gmail draft it saved when it can't say where the file moved", async () => {
      const gmail = mocks.googleFetch.getMockImplementation();
      mocks.googleFetch.mockImplementation(
        async (url: string, token: string, options?: RequestInit) => {
          if (new URL(url).searchParams.get("format") === "full") {
            throw new Error("Google API error (503): Backend Error");
          }
          return gmail?.(url, token, options);
        },
      );
      mocks.readBody.mockResolvedValue({
        to: "recipient@example.com",
        subject: "Edited draft",
        body: "Edited body",
        draftId: "message-of-draft",
        savedDraftBackend: "gmail",
        accountEmail: managedAccountEmail,
        attachments: [draftFile],
      });
      mocks.resolveComposeAttachments.mockResolvedValue([
        { ...draftFile, data: Buffer.from("draft file") },
      ]);

      const result = await (saveDraft as (event: unknown) => Promise<unknown>)(
        {},
      );

      expect(mocks.setResponseStatus).toHaveBeenCalledWith({}, 502);
      expect(result).toEqual({
        error: expect.stringContaining(
          "couldn't confirm where its attachments moved",
        ),
        errorCode: "draft_attachments_unconfirmed",
        draftId: "r-draft-7",
        backend: "gmail",
        accountEmail: managedAccountEmail,
      });
    });

    it.each([
      [
        "Gmail's failure, which a retry can clear",
        Object.assign(new Error("Google API error (503): Backend Error"), {
          status: 503,
        }),
        503,
        { error: "Google API error (503): Backend Error" },
      ],
      [
        "a file Mail can't read as a bad request",
        new Error(
          `Mail couldn't tell which file in the Gmail draft is "brief.pdf".`,
        ),
        400,
        { error: "One or more attachments could not be read" },
      ],
    ])(
      "reports %s while reading the draft's files",
      async (_case, error, status, body) => {
        mocks.readBody.mockResolvedValue({
          to: "recipient@example.com",
          subject: "Edited draft",
          body: "Edited body",
          draftId: "r-draft-7",
          savedDraftBackend: "gmail",
          accountEmail: managedAccountEmail,
          attachments: [draftFile],
        });
        mocks.resolveComposeAttachments.mockRejectedValue(error);

        const result = await (
          saveDraft as (event: unknown) => Promise<unknown>
        )({});

        expect(mocks.setResponseStatus).toHaveBeenCalledWith({}, status);
        expect(result).toEqual(body);
        expect(mocks.googleFetch).not.toHaveBeenCalled();
      },
    );

    it("asks Gmail nothing more when the save carries only uploads", async () => {
      const upload = {
        id: "upload.pdf",
        filename: "upload.pdf",
        originalName: "upload.pdf",
        mimeType: "application/pdf",
        size: 6,
      };
      mocks.readBody.mockResolvedValue({
        to: "recipient@example.com",
        subject: "Edited draft",
        body: "Edited body",
        draftId: "r-draft-7",
        savedDraftBackend: "gmail",
        accountEmail: managedAccountEmail,
        attachments: [upload],
      });
      mocks.resolveComposeAttachments.mockResolvedValue([
        {
          ...upload,
          url: "/api/media/upload.pdf",
          data: Buffer.from("upload"),
        },
      ]);

      const result = await (saveDraft as (event: unknown) => Promise<unknown>)(
        {},
      );

      expect(result).toEqual({
        draftId: "r-draft-7",
        backend: "gmail",
        accountEmail: managedAccountEmail,
        updated: true,
      });
      expect(mocks.googleFetch).toHaveBeenCalledTimes(1);
      expect(mocks.googleFetch).toHaveBeenCalledWith(
        "https://gmail.googleapis.com/gmail/v1/users/me/drafts/r-draft-7",
        "test-access-token",
        expect.objectContaining({ method: "PUT" }),
      );
    });
  });

  it("returns a structured account error when refreshing before saving a draft fails", async () => {
    const refreshError = new Error("invalid_grant");
    mocks.readBody.mockResolvedValue({
      to: "recipient@example.com",
      subject: "Test draft",
      body: "",
      accountEmail: managedAccountEmail,
    });
    mocks.getClientForConnectedAccount.mockRejectedValue(refreshError);

    const result = await (saveDraft as (event: unknown) => Promise<unknown>)(
      {},
    );

    const accountErrors = [
      { email: managedAccountEmail, error: "invalid_grant" },
    ];
    expect(mocks.setResponseStatus).toHaveBeenCalledWith({}, 503);
    expect(mocks.googleFetch).not.toHaveBeenCalled();
    expect(result).toEqual({
      error: `${managedAccountEmail}: invalid_grant`,
      accountErrors,
    });
  });

  it("returns a structured account error when refreshing before deleting a draft fails", async () => {
    const refreshError = new Error("invalid_grant");
    mocks.getRouterParam.mockReturnValue("gmail-draft-id");
    mocks.readBody.mockResolvedValue({ accountEmail: managedAccountEmail });
    mocks.getClientForConnectedAccount.mockRejectedValue(refreshError);

    const result = await (deleteDraft as (event: unknown) => Promise<unknown>)(
      {},
    );

    const accountErrors = [
      { email: managedAccountEmail, error: "invalid_grant" },
    ];
    expect(mocks.setResponseStatus).toHaveBeenCalledWith({}, 503);
    expect(mocks.googleFetch).not.toHaveBeenCalled();
    expect(result).toEqual({
      error: `${managedAccountEmail}: invalid_grant`,
      accountErrors,
    });
  });

  it("sends from a usable OAuth account when managed account lookup fails", async () => {
    const oauthAccountEmail = "secondary@example.com";
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: [oauthAccountEmail],
      errors: [{ email: "workspace", error: "workspace lookup unavailable" }],
    });
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [
        {
          email: oauthAccountEmail,
          accessToken: "oauth-access-token",
          refreshToken: "oauth-refresh-token",
        },
      ],
      errors: [],
    });
    mocks.resolveGoogleSenderIdentity.mockResolvedValue({
      header: `Test <${oauthAccountEmail}>`,
      email: oauthAccountEmail,
      displayName: "Test",
    });
    mocks.googleFetch.mockResolvedValue({
      id: "gmail-message-id",
      threadId: "gmail-thread-id",
    });

    const result = await (sendEmail as (event: unknown) => Promise<unknown>)(
      {},
    );

    expect(mocks.getClientsWithErrors).toHaveBeenCalledWith(ownerEmail, [
      oauthAccountEmail,
    ]);
    expect(mocks.googleFetch).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      "oauth-access-token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.withLocalEmailMutationLock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "gmail-message-id",
      from: { email: oauthAccountEmail },
    });
  });

  it("skips an unusable first OAuth account when selecting a default", async () => {
    const firstAccountEmail = "broken@example.com";
    const usableAccountEmail = "usable@example.com";
    mocks.getClientsWithErrors
      .mockResolvedValueOnce({
        clients: [
          {
            email: usableAccountEmail,
            accessToken: "usable-access-token",
            refreshToken: "usable-refresh-token",
          },
        ],
        errors: [{ email: firstAccountEmail, error: "refresh failed" }],
      })
      .mockResolvedValueOnce({
        clients: [
          {
            email: usableAccountEmail,
            accessToken: "usable-access-token",
            refreshToken: "usable-refresh-token",
          },
        ],
        errors: [],
      });
    mocks.resolveGoogleSenderIdentity.mockResolvedValue({
      header: `Test <${usableAccountEmail}>`,
      email: usableAccountEmail,
      displayName: "Test",
    });
    mocks.googleFetch.mockResolvedValue({
      id: "gmail-message-id",
      threadId: "gmail-thread-id",
    });

    const result = await (sendEmail as (event: unknown) => Promise<unknown>)(
      {},
    );

    expect(mocks.getClientsWithErrors).toHaveBeenNthCalledWith(1, ownerEmail);
    expect(mocks.getClientsWithErrors).toHaveBeenNthCalledWith(2, ownerEmail, [
      usableAccountEmail,
    ]);
    expect(mocks.googleFetch).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      "usable-access-token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.withLocalEmailMutationLock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "gmail-message-id",
      from: { email: usableAccountEmail },
    });
  });

  it("returns account errors when no default OAuth account is usable", async () => {
    const brokenAccountEmail = "broken@example.com";
    const accountError = {
      email: brokenAccountEmail,
      error: "refresh failed",
    };
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [],
      errors: [accountError],
    });

    const result = await (sendEmail as (event: unknown) => Promise<unknown>)(
      {},
    );

    expect(mocks.setResponseStatus).toHaveBeenCalledWith({}, 503);
    expect(mocks.googleFetch).not.toHaveBeenCalled();
    expect(mocks.withLocalEmailMutationLock).not.toHaveBeenCalled();
    expect(result).toEqual({
      error: "broken@example.com: refresh failed",
      accountErrors: [accountError],
    });
  });

  it("sends through the selected managed account instead of local fallback", async () => {
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [
        {
          email: managedAccountEmail,
          accessToken: "test-managed-access-token",
          refreshToken: "",
        },
      ],
      errors: [],
    });
    mocks.resolveGoogleSenderIdentity.mockResolvedValue({
      header: `Test <${managedAccountEmail}>`,
      email: managedAccountEmail,
      displayName: "Test",
    });
    mocks.googleFetch.mockResolvedValue({
      id: "gmail-message-id",
      threadId: "gmail-thread-id",
    });

    const result = await (sendEmail as (event: unknown) => Promise<unknown>)(
      {},
    );

    expect(mocks.googleFetch).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      "test-managed-access-token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.withLocalEmailMutationLock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "gmail-message-id",
      from: { email: managedAccountEmail },
    });
  });

  it("uses the selected managed token when OAuth and managed accounts coexist", async () => {
    const oauthAccountEmail = "oauth@example.com";
    mocks.readBody.mockResolvedValue({
      to: "recipient@example.com",
      subject: "Mixed account test",
      body: "",
      accountEmail: managedAccountEmail,
    });
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: [oauthAccountEmail, managedAccountEmail],
      errors: [],
    });
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [
        {
          email: oauthAccountEmail,
          accessToken: "oauth-access-token",
          refreshToken: "oauth-refresh-token",
        },
        {
          email: managedAccountEmail,
          accessToken: "test-managed-access-token",
          refreshToken: "",
        },
      ],
      errors: [],
    });
    mocks.resolveGoogleSenderIdentity.mockResolvedValue({
      header: `Test <${managedAccountEmail}>`,
      email: managedAccountEmail,
      displayName: "Test",
    });
    mocks.googleFetch.mockResolvedValue({
      id: "gmail-message-id",
      threadId: "gmail-thread-id",
    });

    await (sendEmail as (event: unknown) => Promise<unknown>)({});

    expect(mocks.googleFetch).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      "test-managed-access-token",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
