import { saveRevisionOf } from "@agent-native/core/save-conflict";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppState: vi.fn(),
  getRequestUserEmail: vi.fn(),
  getConnectedAccountsWithErrors: vi.fn(),
  readSettings: vi.fn(),
  getEmailRun: vi.fn(),
  getThreadRun: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
}));
vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: () => "/_agent-native/open?deep-link",
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("../server/lib/google-auth.js", () => ({
  getConnectedAccountsWithErrors: mocks.getConnectedAccountsWithErrors,
}));
vi.mock("../server/lib/mail-settings.js", () => ({
  readSettings: mocks.readSettings,
}));
vi.mock("./get-email.js", () => ({ default: { run: mocks.getEmailRun } }));
vi.mock("./get-thread.js", () => ({ default: { run: mocks.getThreadRun } }));

import action from "./get-draft-card.js";

const compose = {
  id: "draft-1",
  to: "sam@example.com",
  subject: "Lunch",
  body: "Free Friday?",
  mode: "compose",
};
const reply = {
  ...compose,
  mode: "reply",
  replyToId: "message-1",
  accountEmail: "me@example.com",
};

describe("get-draft-card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getRequestUserEmail.mockReturnValue("me@example.com");
    mocks.readSettings.mockResolvedValue({
      signature: "Sam",
      imagePolicy: "block-all",
      trustedSenders: ["secret@example.com"],
    });
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: ["me@example.com"],
      errors: [],
    });
    mocks.getThreadRun.mockResolvedValue([
      { id: "message-1", subject: "Lunch" },
      { id: "draft-copy", isDraft: true },
    ]);
  });

  it("is a private read no agent can call", () => {
    expect(action.readOnly).toBe(true);
    expect(action.http).toEqual({ method: "GET" });
    expect(action.agentTool).toBe(false);
    expect(action.toolCallable).toBe(false);
  });

  it("takes only a well-formed draft ID", () => {
    const schema = action.schema as {
      safeParse: (value: unknown) => { success: boolean };
    };
    expect(schema.safeParse({ id: "draft-1" }).success).toBe(true);
    expect(schema.safeParse({ id: "compose-../other" }).success).toBe(false);
  });

  it("refuses a caller with no user", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);
    await expect(action.run({ id: "draft-1" })).rejects.toThrow(
      "Unauthenticated",
    );
    expect(mocks.readAppState).not.toHaveBeenCalled();
  });

  it("answers plainly when the draft is gone", async () => {
    mocks.readAppState.mockResolvedValue(null);
    await expect(action.run({ id: "draft-1" })).resolves.toEqual({
      draft: null,
    });
    expect(mocks.readAppState).toHaveBeenCalledWith("compose-draft-1");
    expect(mocks.getThreadRun).not.toHaveBeenCalled();
  });

  it("reads no conversation for a new email", async () => {
    mocks.readAppState.mockResolvedValue(compose);
    await expect(action.run({ id: "draft-1" })).resolves.toEqual({
      draft: compose,
      revision: saveRevisionOf(compose),
      accounts: [],
      thread: { messages: [], status: "none" },
      // Only what the card shows; the rest of the settings stay out.
      settings: { signature: "Sam", imagePolicy: "block-all" },
      deepLink: "/_agent-native/open?deep-link",
    });
    expect(mocks.getThreadRun).not.toHaveBeenCalled();
  });

  it("keeps who queued a draft, and why, out of the card", async () => {
    mocks.readAppState.mockResolvedValue({
      ...compose,
      queuedDraftId: "queued-1",
      queuedDraftRequesterEmail: "lee@example.com",
      queuedDraftContext: "Lee asked for this after standup",
    });
    const result = (await action.run({ id: "draft-1" })) as {
      draft: Record<string, unknown>;
    };
    expect(result.draft).toEqual({ ...compose, queuedDraftId: "queued-1" });
  });

  it("returns the revision manage-draft checks, of the draft as stored", async () => {
    const stored = {
      ...compose,
      queuedDraftRequesterEmail: "lee@example.com",
      queuedDraftContext: "Follow up",
    };
    mocks.readAppState.mockResolvedValue(stored);

    const result = (await action.run({ id: "draft-1" })) as {
      revision: string;
    };

    expect(result.revision).toBe(saveRevisionOf(stored));
    expect(result.revision).not.toBe(saveRevisionOf(compose));
  });

  it("offers only the account the draft is saved to", async () => {
    mocks.readAppState.mockResolvedValue({
      ...compose,
      accountEmail: "other@example.com",
      savedDraftAccountEmail: "saved@example.com",
    });
    const result = (await action.run({ id: "draft-1" })) as {
      accounts: unknown;
    };
    expect(result.accounts).toEqual([{ email: "saved@example.com" }]);
    expect(mocks.getConnectedAccountsWithErrors).not.toHaveBeenCalled();
  });

  it("reads the thread stored on the draft, without its draft copies", async () => {
    mocks.readAppState.mockResolvedValue({
      ...reply,
      replyToThreadId: "thread-1",
    });
    const result = (await action.run({ id: "draft-1" })) as {
      thread: unknown;
    };
    expect(mocks.getEmailRun).not.toHaveBeenCalled();
    expect(mocks.getThreadRun).toHaveBeenCalledWith({
      accountEmail: "me@example.com",
      id: "thread-1",
    });
    expect(result.thread).toEqual({
      messages: [{ id: "message-1", subject: "Lunch", labelIds: [] }],
      status: "ready",
    });
  });

  it("keeps labels, unsubscribe links and attachment links out of the card", async () => {
    mocks.readAppState.mockResolvedValue(reply);
    mocks.getThreadRun.mockResolvedValue([
      {
        id: "message-1",
        labelIds: ["INBOX"],
        unsubscribe: { url: "https://example.test/unsubscribe" },
        attachments: [
          {
            id: "attachment-1",
            filename: "plan.pdf",
            mimeType: "application/pdf",
            size: 10,
            url: "/api/attachments?id=attachment-1",
          },
        ],
      },
    ]);
    const result = (await action.run({ id: "draft-1" })) as {
      thread: { messages: unknown[] };
    };
    expect(result.thread.messages).toEqual([
      {
        id: "message-1",
        labelIds: [],
        attachments: [
          {
            id: "attachment-1",
            filename: "plan.pdf",
            mimeType: "application/pdf",
            size: 10,
          },
        ],
      },
    ]);
  });

  it("finds a reply's thread from the message it answers", async () => {
    mocks.readAppState.mockResolvedValue(reply);
    mocks.getEmailRun.mockResolvedValue({ threadId: "thread-2" });
    await action.run({ id: "draft-1" });
    expect(mocks.getEmailRun).toHaveBeenCalledWith({
      accountEmail: "me@example.com",
      id: "message-1",
    });
    expect(mocks.getThreadRun).toHaveBeenCalledWith({
      accountEmail: "me@example.com",
      id: "thread-2",
    });
  });

  it("tries the message's own ID when the lookup fails", async () => {
    mocks.readAppState.mockResolvedValue(reply);
    mocks.getEmailRun.mockRejectedValue(new Error("not found"));
    await action.run({ id: "draft-1" });
    expect(mocks.getThreadRun).toHaveBeenCalledWith({
      accountEmail: "me@example.com",
      id: "message-1",
    });
  });

  it.each([
    ["the only connected account", ["only@example.com"], "only@example.com"],
    ['"local" with no Google account', [], "local"],
  ])("uses %s for a draft with no account", async (_name, accounts, used) => {
    mocks.readAppState.mockResolvedValue({
      ...reply,
      accountEmail: undefined,
      replyToThreadId: "thread-1",
    });
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts,
      errors: [],
    });
    await action.run({ id: "draft-1" });
    expect(mocks.getThreadRun).toHaveBeenCalledWith({
      accountEmail: used,
      id: "thread-1",
    });
  });

  it("doesn't guess among several accounts", async () => {
    mocks.readAppState.mockResolvedValue({
      ...reply,
      accountEmail: undefined,
      replyToThreadId: "thread-1",
    });
    mocks.getConnectedAccountsWithErrors.mockResolvedValue({
      accounts: ["a@example.com", "b@example.com"],
      errors: [],
    });
    const result = (await action.run({ id: "draft-1" })) as {
      thread: unknown;
    };
    expect(mocks.getThreadRun).not.toHaveBeenCalled();
    expect(result.thread).toEqual({ messages: [], status: "unavailable" });
  });

  it("still shows the draft when the conversation can't be read", async () => {
    mocks.readAppState.mockResolvedValue({
      ...reply,
      replyToThreadId: "thread-1",
    });
    mocks.getThreadRun.mockRejectedValue(new Error("Gmail is cooling down"));
    const result = (await action.run({ id: "draft-1" })) as {
      draft: unknown;
      thread: unknown;
    };
    expect(result.draft).toMatchObject({ id: "draft-1" });
    expect(result.thread).toEqual({ messages: [], status: "unavailable" });
  });
});
