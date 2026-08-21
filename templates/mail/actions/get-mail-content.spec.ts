import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  getUserSetting: vi.fn(),
  isConnected: vi.fn(),
  gmailToEmailMessage: vi.fn(),
  getAccessTokens: vi.fn(),
  fetchLabelMap: vi.fn(),
  gmailGetMessage: vi.fn(),
  gmailGetThread: vi.fn(),
  gmailModifyMessage: vi.fn(),
  gmailModifyThread: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: vi.fn(() => "https://mail.example.test/thread"),
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
}));

vi.mock("../server/lib/google-auth.js", () => ({
  isConnected: mocks.isConnected,
  gmailToEmailMessage: mocks.gmailToEmailMessage,
}));

vi.mock("../server/lib/google-api.js", () => ({
  gmailGetMessage: mocks.gmailGetMessage,
  gmailGetThread: mocks.gmailGetThread,
  gmailModifyMessage: mocks.gmailModifyMessage,
  gmailModifyThread: mocks.gmailModifyThread,
}));

vi.mock("./helpers.js", () => ({
  getAccessTokens: mocks.getAccessTokens,
  fetchLabelMap: mocks.fetchLabelMap,
}));

import getEmail from "./get-email";
import getThread from "./get-thread";

const OWNER = "owner@example.com";
const OTHER = "other@example.com";

function rawMessage(id: string, threadId: string) {
  return {
    id,
    threadId,
    labelIds: ["INBOX", "UNREAD", "IMPORTANT"],
    payload: { headers: [] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestUserEmail.mockReturnValue(OWNER);
  mocks.isConnected.mockResolvedValue(true);
  mocks.getAccessTokens.mockResolvedValue([
    { email: OWNER, accessToken: "owner-token" },
    { email: OTHER, accessToken: "other-token" },
  ]);
  mocks.fetchLabelMap.mockResolvedValue(new Map());
  mocks.gmailToEmailMessage.mockImplementation((message, accountEmail) => ({
    id: message.id,
    threadId: message.threadId,
    accountEmail,
    labelIds: [...message.labelIds],
  }));
});

describe("exact Mail body reads", () => {
  it("requires an account-scoped coordinate in both public schemas", () => {
    expect(getEmail.schema.safeParse({ id: "message-1" }).success).toBe(false);
    expect(getThread.schema.safeParse({ id: "thread-1" }).success).toBe(false);
    expect(
      getEmail.schema.safeParse({ accountEmail: OWNER, id: "message-1" })
        .success,
    ).toBe(true);
    expect(
      getThread.schema.safeParse({ accountEmail: OWNER, id: "thread-1" })
        .success,
    ).toBe(true);
    expect(
      getEmail.schema.safeParse({ accountEmail: "local", id: "message-1" })
        .success,
    ).toBe(true);
    expect(
      getThread.schema.safeParse({ accountEmail: "local", id: "thread-1" })
        .success,
    ).toBe(true);
  });

  it("reads one message from only the requested account and preserves all labels", async () => {
    const message = rawMessage("message-1", "thread-1");
    const labelsBefore = [...message.labelIds];
    mocks.gmailGetMessage.mockResolvedValue(message);

    const result = JSON.parse(
      await getEmail.run(
        { accountEmail: OWNER, id: message.id },
        { caller: "mcp", userEmail: OWNER },
      ),
    );

    expect(mocks.fetchLabelMap).toHaveBeenCalledOnce();
    expect(mocks.fetchLabelMap).toHaveBeenCalledWith("owner-token");
    expect(mocks.gmailGetMessage).toHaveBeenCalledWith(
      "owner-token",
      message.id,
      "full",
    );
    expect(mocks.gmailGetMessage).toHaveBeenCalledTimes(1);
    expect(message.labelIds).toEqual(labelsBefore);
    expect(result).toMatchObject({
      accountEmail: OWNER,
      email: { id: message.id, accountEmail: OWNER },
      readOnlyGuarantee: {
        mailboxLabels: "preserved",
        gmailModifyOperations: 0,
      },
    });
    expect(mocks.gmailModifyMessage).not.toHaveBeenCalled();
    expect(mocks.gmailModifyThread).not.toHaveBeenCalled();
  });

  it("reads one thread from only the requested account and preserves every message label", async () => {
    const messages = [
      rawMessage("message-1", "thread-1"),
      rawMessage("message-2", "thread-1"),
    ];
    const labelsBefore = messages.map((message) => [...message.labelIds]);
    mocks.gmailGetThread.mockResolvedValue({ messages });

    const result = JSON.parse(
      await getThread.run(
        { accountEmail: OTHER, id: "thread-1" },
        { caller: "mcp", userEmail: OWNER },
      ),
    );

    expect(mocks.fetchLabelMap).toHaveBeenCalledOnce();
    expect(mocks.fetchLabelMap).toHaveBeenCalledWith("other-token");
    expect(mocks.gmailGetThread).toHaveBeenCalledWith(
      "other-token",
      "thread-1",
      "full",
    );
    expect(mocks.gmailGetThread).toHaveBeenCalledTimes(1);
    expect(messages.map((message) => message.labelIds)).toEqual(labelsBefore);
    expect(result).toMatchObject({
      accountEmail: OTHER,
      messages: [
        { id: "message-1", accountEmail: OTHER },
        { id: "message-2", accountEmail: OTHER },
      ],
      readOnlyGuarantee: {
        mailboxLabels: "preserved",
        gmailModifyOperations: 0,
      },
    });
    expect(mocks.gmailModifyMessage).not.toHaveBeenCalled();
    expect(mocks.gmailModifyThread).not.toHaveBeenCalled();
  });

  it("fails a mismatched account without probing any mailbox", async () => {
    await expect(
      getEmail.run({
        accountEmail: "missing@example.com",
        id: "message-1",
      }),
    ).rejects.toThrow("Requested Google account is not connected.");
    await expect(
      getThread.run({
        accountEmail: "missing@example.com",
        id: "thread-1",
      }),
    ).rejects.toThrow("Requested Google account is not connected.");

    expect(mocks.fetchLabelMap).not.toHaveBeenCalled();
    expect(mocks.gmailGetMessage).not.toHaveBeenCalled();
    expect(mocks.gmailGetThread).not.toHaveBeenCalled();
    expect(mocks.gmailModifyMessage).not.toHaveBeenCalled();
    expect(mocks.gmailModifyThread).not.toHaveBeenCalled();
  });

  it("uses the inventory-compatible local coordinate for unscoped synthetic mail", async () => {
    mocks.isConnected.mockResolvedValue(false);
    mocks.getUserSetting.mockResolvedValue({
      emails: [rawMessage("message-1", "thread-1")],
    });

    const email = JSON.parse(
      await getEmail.run(
        { accountEmail: "local", id: "message-1" },
        { caller: "mcp", userEmail: OWNER },
      ),
    );
    const thread = JSON.parse(
      await getThread.run(
        { accountEmail: "local", id: "thread-1" },
        { caller: "mcp", userEmail: OWNER },
      ),
    );

    expect(email).toMatchObject({
      accountEmail: "local",
      email: { id: "message-1", accountEmail: "local" },
    });
    expect(thread).toMatchObject({
      accountEmail: "local",
      messages: [{ id: "message-1" }],
    });
  });

  it("does not let unscoped synthetic mail match a scoped account", async () => {
    mocks.isConnected.mockResolvedValue(false);
    mocks.getUserSetting.mockResolvedValue({
      emails: [
        rawMessage("local-message", "local-thread"),
        {
          ...rawMessage("other-message", "other-thread"),
          accountEmail: OTHER,
        },
      ],
    });

    await expect(
      getEmail.run({ accountEmail: OTHER, id: "local-message" }),
    ).rejects.toThrow("Email not found.");
    await expect(
      getThread.run({ accountEmail: OTHER, id: "local-thread" }),
    ).rejects.toThrow("Thread not found.");

    expect(mocks.getAccessTokens).not.toHaveBeenCalled();
    expect(mocks.gmailGetMessage).not.toHaveBeenCalled();
    expect(mocks.gmailGetThread).not.toHaveBeenCalled();
  });
});
