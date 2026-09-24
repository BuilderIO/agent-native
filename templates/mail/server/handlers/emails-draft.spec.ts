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
  resolveComposeAttachments: mocks.resolveComposeAttachments,
  splitReplyQuote: vi.fn(),
}));
vi.mock("../lib/saved-draft-ownership.js", () => ({
  resolveExistingSavedDraftOwnership: vi.fn(),
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
