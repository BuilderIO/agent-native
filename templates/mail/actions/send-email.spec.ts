import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  getAppProductionUrl: vi.fn(),
  writeAppState: vi.fn(),
  getUserSetting: vi.fn(),
  emit: vi.fn(),
  gmailGetMessage: vi.fn(),
  gmailSendMessage: vi.fn(),
  getAccountDisplayName: vi.fn(),
  invalidateListCacheForOwner: vi.fn(),
  setAccountDisplayName: vi.fn(),
  getAccessTokens: vi.fn(),
  resolveGoogleSenderIdentity: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getAppProductionUrl: mocks.getAppProductionUrl,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/event-bus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/event-bus")>()),
  emit: mocks.emit,
}));

vi.mock("@agent-native/core/oauth-tokens", () => ({
  setOAuthDisplayName: vi.fn(),
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
}));

vi.mock("../server/lib/email-tracking.js", () => ({
  collectLinks: vi.fn(() => []),
  newClickToken: vi.fn(),
  newPixelToken: vi.fn(),
  persistTracking: vi.fn(),
}));

vi.mock("../server/lib/google-api.js", () => ({
  gmailGetMessage: mocks.gmailGetMessage,
  gmailSendMessage: mocks.gmailSendMessage,
}));

vi.mock("../server/lib/google-auth.js", () => ({
  getAccountDisplayName: mocks.getAccountDisplayName,
  invalidateListCacheForOwner: mocks.invalidateListCacheForOwner,
  setAccountDisplayName: mocks.setAccountDisplayName,
}));

vi.mock("../server/lib/local-email-store.js", () => ({
  readLocalEmails: vi.fn(),
  withLocalEmailMutationLock: vi.fn(),
  writeLocalEmails: vi.fn(),
}));

vi.mock("../server/lib/outgoing-email.js", () => ({
  bodyToHtml: vi.fn(() => "<div>Body</div>"),
  buildRawEmail: vi.fn(() => "raw-email"),
  resolveComposeAttachments: vi.fn(),
  splitReplyQuote: vi.fn(),
}));

vi.mock("../server/lib/sender-identity.js", () => ({
  resolveGoogleSenderIdentity: mocks.resolveGoogleSenderIdentity,
}));

vi.mock("./helpers.js", () => ({
  getAccessTokens: mocks.getAccessTokens,
}));

import action from "./send-email";

const OWNER = "sharon@builder.io";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue(OWNER);
  mocks.getAppProductionUrl.mockReturnValue("https://mail.agent-native.com");
  mocks.getUserSetting.mockResolvedValue(null);
  mocks.writeAppState.mockResolvedValue(undefined);
  mocks.getAccountDisplayName.mockReturnValue(undefined);
  mocks.getAccessTokens.mockResolvedValue([
    {
      email: OWNER,
      accessToken: "access-token",
    },
  ]);
  mocks.resolveGoogleSenderIdentity.mockResolvedValue({
    displayName: "Sharon Rosenblum",
    email: OWNER,
    header: `Sharon Rosenblum <${OWNER}>`,
  });
  mocks.gmailSendMessage.mockResolvedValue({
    id: "gmail-message-1",
    threadId: "gmail-thread-1",
    labelIds: ["SENT"],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("send-email action", () => {
  it("refreshes the Mail workspace after a connected Gmail send", async () => {
    const result = await action.run({
      to: "recipient@example.com",
      subject: "A test message",
      body: "Body",
    });

    expect(result).toBe("Email sent successfully (id: gmail-message-1)");
    expect(mocks.gmailSendMessage).toHaveBeenCalledWith(
      "access-token",
      "raw-email",
      undefined,
    );
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ ts: expect.any(Number) }),
    );
  });

  it("does not report an accepted Gmail send as failed when refresh signaling fails", async () => {
    const refreshError = new Error("state store unavailable");
    mocks.writeAppState.mockRejectedValueOnce(refreshError);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const result = await action.run({
      to: "recipient@example.com",
      subject: "A test message",
      body: "Body",
    });

    expect(result).toBe("Email sent successfully (id: gmail-message-1)");
    expect(consoleError).toHaveBeenCalledWith(
      "[send-email] refresh signal failed:",
      refreshError,
    );
  });
});
