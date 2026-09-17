import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOAuthTokens: vi.fn(),
  saveOAuthTokens: vi.fn(),
  listOAuthAccounts: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  setOAuthDisplayName: vi.fn(),
  isConnected: vi.fn(),
  getClientForConnectedAccount: vi.fn(),
  getClientsWithErrors: vi.fn(),
  getConnectedAccountsWithErrors: vi.fn(),
  insertScheduledJob: vi.fn(),
  createOAuth2Client: vi.fn(),
  getOAuth2Credentials: vi.fn(),
  gmailGetMessage: vi.fn(),
  googleFetch: vi.fn(),
  resolveComposeAttachments: vi.fn(),
  buildRawEmail: vi.fn(),
  resolveGoogleSenderIdentity: vi.fn(),
  readLocalEmails: vi.fn(),
  writeLocalEmails: vi.fn(),
  withLocalEmailMutationLock: vi.fn(),
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  getOAuthTokens: mocks.getOAuthTokens,
  saveOAuthTokens: mocks.saveOAuthTokens,
  listOAuthAccounts: mocks.listOAuthAccounts,
  listOAuthAccountsByOwner: mocks.listOAuthAccountsByOwner,
  setOAuthDisplayName: mocks.setOAuthDisplayName,
}));

vi.mock("../db/index.js", () => ({
  db: { insert: vi.fn(() => ({ values: mocks.insertScheduledJob })) },
  schema: { scheduledJobs: "scheduled_jobs" },
}));

vi.mock("./google-api.js", () => ({
  createOAuth2Client: mocks.createOAuth2Client,
  gmailGetMessage: mocks.gmailGetMessage,
  gmailGetThread: vi.fn(),
  gmailListLabels: vi.fn(),
  gmailModifyMessage: vi.fn(),
  gmailModifyThread: vi.fn(),
  googleFetch: mocks.googleFetch,
}));

vi.mock("./google-auth.js", () => ({
  getAccountDisplayName: vi.fn(() => undefined),
  isConnected: mocks.isConnected,
  getClientForConnectedAccount: mocks.getClientForConnectedAccount,
  getClientsWithErrors: mocks.getClientsWithErrors,
  getConnectedAccountsWithErrors: mocks.getConnectedAccountsWithErrors,
  gmailToEmailMessage: vi.fn(),
  getOAuth2Credentials: mocks.getOAuth2Credentials,
  setAccountDisplayName: vi.fn(),
}));

vi.mock("./local-email-store.js", () => ({
  readLocalEmails: mocks.readLocalEmails,
  withLocalEmailMutationLock: mocks.withLocalEmailMutationLock,
  writeLocalEmails: mocks.writeLocalEmails,
}));

vi.mock("./outgoing-email.js", () => ({
  bodyToHtml: vi.fn(() => "<p>body</p>"),
  buildRawEmail: mocks.buildRawEmail,
  resolveComposeAttachments: mocks.resolveComposeAttachments,
}));

vi.mock("./sender-identity.js", () => ({
  resolveGoogleSenderIdentity: mocks.resolveGoogleSenderIdentity,
}));

import { scheduleEmailSend, sendScheduledEmail } from "./jobs.js";

const OWNER = "owner@example.com";
const SELECTED = "selected@example.com";
const OTHER = "other@example.com";

describe("scheduled send account selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientForConnectedAccount.mockResolvedValue(null);
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [{ email: OTHER, accessToken: "other-token", refreshToken: "" }],
      errors: [],
    });
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: [SELECTED],
      errors: [],
    });
    mocks.insertScheduledJob.mockResolvedValue(undefined);
    mocks.listOAuthAccountsByOwner.mockResolvedValue([{ accountId: OTHER }]);
    mocks.getOAuthTokens.mockImplementation(async (_provider, email) => {
      if (email === OTHER) return { access_token: "other-token" };
      return undefined;
    });
    mocks.resolveComposeAttachments.mockResolvedValue([]);
    mocks.buildRawEmail.mockReturnValue("raw-message");
    mocks.gmailGetMessage.mockResolvedValue({ payload: { headers: [] } });
    mocks.resolveGoogleSenderIdentity.mockResolvedValue({
      header: "Owner <owner@example.com>",
    });
    mocks.googleFetch.mockResolvedValue({ id: "sent-message" });
    mocks.withLocalEmailMutationLock.mockImplementation(
      async (_owner, callback) => callback(),
    );
    mocks.readLocalEmails.mockResolvedValue([]);
    mocks.writeLocalEmails.mockResolvedValue(undefined);
  });

  it("validates and stores the canonical selected account before persisting", async () => {
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: ["Selected@example.com"],
      errors: [],
    });

    const job = await scheduleEmailSend({
      ownerEmail: OWNER,
      runAt: Date.now() + 60_000,
      payload: {
        to: "recipient@example.com",
        subject: "Scheduled",
        body: "body",
        accountEmail: SELECTED,
      },
    });

    expect(mocks.getConnectedAccountsWithErrors).toHaveBeenCalledWith(OWNER);
    expect(job.accountEmail).toBe("Selected@example.com");
    expect(JSON.parse(job.payload).accountEmail).toBe("Selected@example.com");
    expect(mocks.insertScheduledJob).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: OWNER,
        accountEmail: "Selected@example.com",
      }),
    );
  });

  it("rejects a sender account not owned by the scheduled job owner", async () => {
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: [OTHER],
      errors: [],
    });

    await expect(
      scheduleEmailSend({
        ownerEmail: OWNER,
        runAt: Date.now() + 60_000,
        payload: {
          to: "recipient@example.com",
          subject: "Scheduled",
          body: "body",
          accountEmail: SELECTED,
        },
      }),
    ).rejects.toThrow("Selected Gmail account is not connected to this user");

    expect(mocks.insertScheduledJob).not.toHaveBeenCalled();
  });

  it("does not send through another account when the selected account has no token", async () => {
    await expect(
      sendScheduledEmail(
        {
          to: "recipient@example.com",
          subject: "Scheduled",
          body: "body",
        },
        SELECTED,
        OWNER,
      ),
    ).rejects.toThrow(
      `No valid access token for selected Gmail account ${SELECTED}`,
    );

    expect(mocks.getClientForConnectedAccount).toHaveBeenCalledWith(
      OWNER,
      SELECTED,
    );
    expect(mocks.getClientsWithErrors).not.toHaveBeenCalled();
    expect(mocks.googleFetch).not.toHaveBeenCalled();
    expect(mocks.writeLocalEmails).not.toHaveBeenCalled();
  });

  it("does not write a local synthetic send when an explicit account is disconnected", async () => {
    await expect(
      sendScheduledEmail(
        {
          to: "recipient@example.com",
          subject: "Scheduled",
          body: "body",
        },
        SELECTED,
        OWNER,
      ),
    ).rejects.toThrow(
      `No valid access token for selected Gmail account ${SELECTED}`,
    );

    expect(mocks.googleFetch).not.toHaveBeenCalled();
    expect(mocks.writeLocalEmails).not.toHaveBeenCalled();
  });

  it("routes an explicitly selected managed account through the owner-scoped resolver", async () => {
    mocks.getClientForConnectedAccount.mockResolvedValue({
      email: SELECTED,
      accessToken: "managed-token",
    });

    await expect(
      sendScheduledEmail(
        {
          to: "recipient@example.com",
          subject: "Scheduled",
          body: "body",
        },
        SELECTED,
        OWNER,
      ),
    ).resolves.toBeUndefined();

    expect(mocks.getClientForConnectedAccount).toHaveBeenCalledWith(
      OWNER,
      SELECTED,
    );
    expect(mocks.googleFetch).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      "managed-token",
      expect.any(Object),
    );
  });

  it("does not send a reply when its original message headers cannot be read", async () => {
    mocks.getClientForConnectedAccount.mockResolvedValue({
      email: SELECTED,
      accessToken: "selected-token",
    });
    mocks.gmailGetMessage.mockRejectedValue(new Error("metadata unavailable"));

    await expect(
      sendScheduledEmail(
        {
          to: "recipient@example.com",
          subject: "Reply",
          body: "body",
          replyToId: "original-message-id",
        },
        SELECTED,
        OWNER,
      ),
    ).rejects.toThrow("metadata unavailable");

    expect(mocks.gmailGetMessage).toHaveBeenCalledWith(
      "selected-token",
      "original-message-id",
      "metadata",
    );
    expect(mocks.googleFetch).not.toHaveBeenCalled();
    expect(mocks.writeLocalEmails).not.toHaveBeenCalled();
  });

  it("treats the payload accountEmail as an explicit sender selection", async () => {
    await expect(
      sendScheduledEmail(
        {
          to: "recipient@example.com",
          subject: "Scheduled",
          body: "body",
          accountEmail: SELECTED,
        },
        undefined,
        OWNER,
      ),
    ).rejects.toThrow(
      `No valid access token for selected Gmail account ${SELECTED}`,
    );

    expect(mocks.getClientForConnectedAccount).toHaveBeenCalledWith(
      OWNER,
      SELECTED,
    );
    expect(mocks.getClientsWithErrors).not.toHaveBeenCalled();
    expect(mocks.googleFetch).not.toHaveBeenCalled();
    expect(mocks.writeLocalEmails).not.toHaveBeenCalled();
  });

  it("does not use a stale selected token after refresh fails", async () => {
    mocks.getClientForConnectedAccount.mockRejectedValue(
      new Error("refresh failed"),
    );

    await expect(
      sendScheduledEmail(
        {
          to: "recipient@example.com",
          subject: "Scheduled",
          body: "body",
        },
        SELECTED,
        OWNER,
      ),
    ).rejects.toThrow("refresh failed");

    expect(mocks.getClientsWithErrors).not.toHaveBeenCalled();
    expect(mocks.googleFetch).not.toHaveBeenCalled();
    expect(mocks.writeLocalEmails).not.toHaveBeenCalled();
  });

  it("does not fall back to an account ID when the scheduled owner is missing", async () => {
    await expect(
      sendScheduledEmail(
        {
          to: "recipient@example.com",
          subject: "Scheduled",
          body: "body",
        },
        SELECTED,
      ),
    ).rejects.toThrow("Scheduled send is missing its owner account context");

    expect(mocks.getClientForConnectedAccount).not.toHaveBeenCalled();
    expect(mocks.googleFetch).not.toHaveBeenCalled();
  });

  it("uses the next usable owner account when the default account refresh fails", async () => {
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [{ email: OTHER, accessToken: "other-token", refreshToken: "" }],
      errors: [{ email: SELECTED, error: "refresh failed" }],
    });

    await expect(
      sendScheduledEmail(
        {
          to: "recipient@example.com",
          subject: "Scheduled",
          body: "body",
        },
        undefined,
        OWNER,
      ),
    ).resolves.toBeUndefined();

    expect(mocks.getClientsWithErrors).toHaveBeenCalledWith(OWNER);
    expect(mocks.getClientForConnectedAccount).not.toHaveBeenCalled();
    expect(mocks.googleFetch).toHaveBeenCalledTimes(1);
    expect(mocks.googleFetch).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      "other-token",
      expect.any(Object),
    );
  });

  it("does not fall back to a local send when all connected-account refreshes fail", async () => {
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [],
      errors: [{ email: SELECTED, error: "refresh failed" }],
    });

    await expect(
      sendScheduledEmail(
        {
          to: "recipient@example.com",
          subject: "Scheduled",
          body: "body",
        },
        undefined,
        OWNER,
      ),
    ).rejects.toThrow("No usable connected Gmail account for scheduled send");

    expect(mocks.writeLocalEmails).not.toHaveBeenCalled();
    expect(mocks.googleFetch).not.toHaveBeenCalled();
  });
});
