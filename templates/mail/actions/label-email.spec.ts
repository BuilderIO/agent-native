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

import action from "./label-email";

describe("label-email action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.writeAppState.mockResolvedValue(undefined);
    mocks.getAccessTokens.mockResolvedValue([
      { email: "account@example.com", accessToken: "test-token" },
    ]);
    mocks.gmailListLabels.mockResolvedValue({
      labels: [{ id: "Label_1", name: "Project" }],
    });
    mocks.gmailModifyThread.mockResolvedValue({ historyId: "42" });
    mocks.syncInboxLabelDelta.mockResolvedValue(undefined);
    mocks.withLocalEmailMutationLock.mockImplementation((_owner, fn) => fn());
  });

  it("adds the Gmail label without taking the thread out of Inbox", async () => {
    mocks.isConnected.mockResolvedValue(true);

    const result = await action.run({
      id: "email-1",
      label: "project",
      threadId: "thread-1",
    });

    expect(result).toMatchObject({
      status: "complete",
      succeeded: ["email-1"],
    });
    expect(mocks.gmailModifyThread).toHaveBeenCalledWith(
      "test-token",
      "thread-1",
      ["Label_1"],
      [],
    );
    expect(mocks.syncInboxLabelDelta).toHaveBeenCalledWith(
      "owner@example.com",
      "account@example.com",
      ["thread-1"],
      { add: ["Label_1"], remove: [], providerHistoryId: "42" },
    );
  });

  it("keeps a local email in Inbox and unarchived", async () => {
    mocks.isConnected.mockResolvedValue(false);
    mocks.readLocalEmails.mockResolvedValue([
      {
        id: "email-1",
        threadId: "thread-1",
        labelIds: ["inbox"],
        isArchived: false,
      },
    ]);

    await action.run({ id: "email-1", label: "project" });

    expect(mocks.writeLocalEmails).toHaveBeenCalledWith("owner@example.com", [
      {
        id: "email-1",
        threadId: "thread-1",
        labelIds: ["inbox", "project"],
        isArchived: false,
      },
    ]);
  });
});
