import { isActionContractError } from "@agent-native/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  writeAppState: vi.fn(),
  isConnected: vi.fn(),
  gmailGetMessage: vi.fn(),
  gmailListLabels: vi.fn(),
  gmailModifyThread: vi.fn(),
  syncInboxLabelDelta: vi.fn(),
  readLocalEmails: vi.fn(),
  withLocalEmailMutationLock: vi.fn(),
  writeLocalEmails: vi.fn(),
  getAccessTokens: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("../server/lib/google-api.js", () => ({
  gmailGetMessage: mocks.gmailGetMessage,
  gmailListLabels: mocks.gmailListLabels,
  gmailModifyThread: mocks.gmailModifyThread,
}));

vi.mock("../server/lib/google-auth.js", () => ({
  isConnected: mocks.isConnected,
}));

vi.mock("../server/lib/inbox-store-sync.js", () => ({
  syncInboxLabelDelta: mocks.syncInboxLabelDelta,
}));

vi.mock("../server/lib/local-email-store.js", () => ({
  readLocalEmails: mocks.readLocalEmails,
  withLocalEmailMutationLock: mocks.withLocalEmailMutationLock,
  writeLocalEmails: mocks.writeLocalEmails,
}));

vi.mock("./helpers.js", () => ({
  getAccessTokens: mocks.getAccessTokens,
}));

import action from "./move-email";

describe("move-email action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.writeAppState.mockResolvedValue(undefined);
    mocks.isConnected.mockResolvedValue(true);
    mocks.getAccessTokens.mockResolvedValue([
      { email: "account@example.com", accessToken: "test-token" },
    ]);
    mocks.gmailGetMessage.mockImplementation(async (token, id) => ({
      id,
      threadId: `thread-${id}`,
    }));
    mocks.gmailListLabels.mockResolvedValue({
      labels: [{ id: "Label_1", name: "Project" }],
    });
    mocks.gmailModifyThread.mockResolvedValue(undefined);
    mocks.syncInboxLabelDelta.mockResolvedValue(undefined);
  });

  it("returns explicit per-email success and failure for a partial provider result", async () => {
    mocks.gmailGetMessage.mockImplementation(async (_token, id) => {
      if (id === "email-2") throw new Error("provider unavailable");
      return { id, threadId: `thread-${id}` };
    });

    const result = await action.run({
      id: "email-1,email-2",
      label: "Project",
    });

    expect(result).toEqual({
      status: "partial",
      requested: ["email-1", "email-2"],
      succeeded: ["email-1"],
      failed: [{ id: "email-2", error: "provider unavailable" }],
      targetLabel: "Project",
    });
    expect(mocks.gmailModifyThread).toHaveBeenCalledTimes(1);
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "refresh-signal",
      expect.objectContaining({ ts: expect.any(Number) }),
    );
    expect(mocks.getAccessTokens).toHaveBeenCalledWith("owner@example.com");
  });

  it("tries the managed mailbox after OAuth and preserves its account provenance", async () => {
    mocks.getAccessTokens.mockResolvedValue([
      { email: "oauth@example.com", accessToken: "oauth-token" },
      { email: "managed@example.com", accessToken: "managed-token" },
    ]);
    mocks.gmailGetMessage.mockImplementation(async (token, id) => {
      if (token === "oauth-token") throw new Error("message not found");
      return { id, threadId: "managed-thread" };
    });

    const result = await action.run({
      id: "managed-message",
      label: "Project",
    });

    expect(result).toMatchObject({
      status: "complete",
      succeeded: ["managed-message"],
      failed: [],
    });
    expect(mocks.getAccessTokens).toHaveBeenCalledWith("owner@example.com");
    expect(mocks.gmailModifyThread).toHaveBeenCalledWith(
      "managed-token",
      "managed-thread",
      ["Label_1"],
      ["INBOX"],
    );
    expect(mocks.syncInboxLabelDelta).toHaveBeenCalledWith(
      "owner@example.com",
      "managed@example.com",
      ["managed-thread"],
      { add: ["Label_1"], remove: ["INBOX"] },
    );
  });

  it("uses the explicitly selected account without probing another mailbox", async () => {
    mocks.getAccessTokens.mockResolvedValue([
      { email: "first@example.com", accessToken: "first-token" },
      { email: "second@example.com", accessToken: "second-token" },
    ]);
    mocks.gmailGetMessage.mockImplementation(async (token, id) => {
      if (token !== "second-token") throw new Error("wrong mailbox probed");
      return { id, threadId: `thread-${id}` };
    });

    const result = await action.run({
      id: "email-1",
      label: "Project",
      accountEmail: "SECOND@EXAMPLE.COM",
    });

    expect(result).toMatchObject({
      status: "complete",
      succeeded: ["email-1"],
      failed: [],
    });
    expect(mocks.gmailGetMessage).toHaveBeenCalledTimes(1);
    expect(mocks.gmailGetMessage).toHaveBeenCalledWith(
      "second-token",
      "email-1",
      "minimal",
    );
    expect(mocks.gmailModifyThread).toHaveBeenCalledWith(
      "second-token",
      "thread-email-1",
      ["Label_1"],
      ["INBOX"],
    );
    expect(mocks.syncInboxLabelDelta).toHaveBeenCalledWith(
      "owner@example.com",
      "second@example.com",
      ["thread-email-1"],
      { add: ["Label_1"], remove: ["INBOX"] },
    );
  });

  it("routes bulk targets to their positional accounts", async () => {
    mocks.getAccessTokens.mockResolvedValue([
      { email: "first@example.com", accessToken: "first-token" },
      { email: "second@example.com", accessToken: "second-token" },
    ]);
    mocks.gmailGetMessage.mockImplementation(async (token, id) => ({
      id,
      threadId: `${token}-thread`,
    }));

    const result = await action.run({
      id: "email-1,email-2",
      label: "Project",
      accountEmails: "first@example.com,second@example.com",
    });

    expect(result).toMatchObject({
      status: "complete",
      succeeded: ["email-1", "email-2"],
      failed: [],
    });
    expect(mocks.gmailGetMessage).toHaveBeenNthCalledWith(
      1,
      "first-token",
      "email-1",
      "minimal",
    );
    expect(mocks.gmailGetMessage).toHaveBeenNthCalledWith(
      2,
      "second-token",
      "email-2",
      "minimal",
    );
    expect(mocks.gmailModifyThread).toHaveBeenNthCalledWith(
      1,
      "first-token",
      "first-token-thread",
      ["Label_1"],
      ["INBOX"],
    );
    expect(mocks.gmailModifyThread).toHaveBeenNthCalledWith(
      2,
      "second-token",
      "second-token-thread",
      ["Label_1"],
      ["INBOX"],
    );
    expect(mocks.syncInboxLabelDelta).toHaveBeenNthCalledWith(
      1,
      "owner@example.com",
      "first@example.com",
      ["first-token-thread"],
      { add: ["Label_1"], remove: ["INBOX"] },
    );
    expect(mocks.syncInboxLabelDelta).toHaveBeenNthCalledWith(
      2,
      "owner@example.com",
      "second@example.com",
      ["second-token-thread"],
      { add: ["Label_1"], remove: ["INBOX"] },
    );
  });

  it("throws a typed action failure when every provider attempt fails", async () => {
    mocks.gmailGetMessage.mockRejectedValue(new Error("provider unavailable"));

    let thrown: unknown;
    try {
      await action.run({ id: "email-1", label: "Project" });
    } catch (error) {
      thrown = error;
    }

    expect(isActionContractError(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      errorCode: "move_failed",
      statusCode: 502,
      details: {
        requested: ["email-1"],
        failed: [{ id: "email-1", error: "provider unavailable" }],
      },
    });
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });
});
