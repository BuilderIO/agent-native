import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOAuthTokens: vi.fn(),
  saveOAuthTokens: vi.fn(),
  listOAuthAccounts: vi.fn(),
  listOAuthAccountsByOwner: vi.fn(),
  setOAuthDisplayName: vi.fn(),
  isConnected: vi.fn(),
  createOAuth2Client: vi.fn(),
  getOAuth2Credentials: vi.fn(),
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
  db: {},
  schema: {},
}));

vi.mock("./google-api.js", () => ({
  createOAuth2Client: mocks.createOAuth2Client,
  gmailGetMessage: vi.fn(),
  gmailGetThread: vi.fn(),
  gmailListLabels: vi.fn(),
  gmailModifyMessage: vi.fn(),
  gmailModifyThread: vi.fn(),
  googleFetch: mocks.googleFetch,
}));

vi.mock("./google-auth.js", () => ({
  getAccountDisplayName: vi.fn(() => undefined),
  isConnected: mocks.isConnected,
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

import { sendScheduledEmail } from "./jobs.js";

const OWNER = "owner@example.com";
const SELECTED = "selected@example.com";
const OTHER = "other@example.com";

describe("sendScheduledEmail account selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isConnected.mockResolvedValue(true);
    mocks.listOAuthAccountsByOwner.mockResolvedValue([{ accountId: OTHER }]);
    mocks.getOAuthTokens.mockImplementation(async (_provider, email) => {
      if (email === OTHER) return { access_token: "other-token" };
      return undefined;
    });
    mocks.resolveComposeAttachments.mockResolvedValue([]);
    mocks.buildRawEmail.mockReturnValue("raw-message");
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

    expect(mocks.getOAuthTokens).toHaveBeenCalledTimes(1);
    expect(mocks.getOAuthTokens).toHaveBeenCalledWith("google", SELECTED);
    expect(mocks.listOAuthAccountsByOwner).not.toHaveBeenCalled();
    expect(mocks.googleFetch).not.toHaveBeenCalled();
    expect(mocks.writeLocalEmails).not.toHaveBeenCalled();
  });

  it("does not write a local synthetic send when an explicit account is disconnected", async () => {
    mocks.isConnected.mockResolvedValue(false);

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

    expect(mocks.getOAuthTokens).toHaveBeenCalledWith("google", SELECTED);
    expect(mocks.listOAuthAccountsByOwner).not.toHaveBeenCalled();
    expect(mocks.googleFetch).not.toHaveBeenCalled();
    expect(mocks.writeLocalEmails).not.toHaveBeenCalled();
  });

  it("does not use a stale selected token after refresh fails", async () => {
    mocks.getOAuthTokens.mockResolvedValue({
      access_token: "expired-token",
      refresh_token: "refresh-token",
      expiry_date: Date.now() - 1,
    });
    mocks.getOAuth2Credentials.mockResolvedValue({
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    mocks.createOAuth2Client.mockReturnValue({
      refreshToken: vi.fn().mockRejectedValue(new Error("refresh failed")),
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
    ).rejects.toThrow(
      `No valid access token for selected Gmail account ${SELECTED}`,
    );

    expect(mocks.listOAuthAccountsByOwner).not.toHaveBeenCalled();
    expect(mocks.googleFetch).not.toHaveBeenCalled();
    expect(mocks.writeLocalEmails).not.toHaveBeenCalled();
  });

  it("does not use an expired selected token that has no refresh token", async () => {
    mocks.getOAuthTokens.mockResolvedValue({
      access_token: "expired-token",
      expiry_date: Date.now() - 1,
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
    ).rejects.toThrow(
      `No valid access token for selected Gmail account ${SELECTED}`,
    );

    expect(mocks.listOAuthAccountsByOwner).not.toHaveBeenCalled();
    expect(mocks.googleFetch).not.toHaveBeenCalled();
  });

  it("retains account fallback when no sender account was selected", async () => {
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

    expect(mocks.listOAuthAccountsByOwner).toHaveBeenCalledWith(
      "google",
      OWNER,
    );
    expect(mocks.getOAuthTokens).toHaveBeenCalledWith("google", OTHER);
    expect(mocks.googleFetch).toHaveBeenCalledTimes(1);
    expect(mocks.googleFetch).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      "other-token",
      expect.any(Object),
    );
  });
});
