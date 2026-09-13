import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  readBody: vi.fn(),
  readSettings: vi.fn(),
  isConnected: vi.fn(),
  getConnectedAccountsWithErrors: vi.fn(),
  getClientForConnectedAccount: vi.fn(),
  getClientsWithErrors: vi.fn(),
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
  getRouterParam: () => undefined,
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

const { saveDraft, sendEmail } = await import("./emails.js");

describe("saveDraft with a workspace-managed Gmail account", () => {
  const ownerEmail = "owner@example.com";
  const managedAccountEmail = "mailbox@example.com";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ email: ownerEmail });
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
    mocks.getClientsWithErrors.mockResolvedValue({ clients: [], errors: [] });
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

    expect(mocks.getConnectedAccountsWithErrors).toHaveBeenCalledWith(
      ownerEmail,
    );
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
