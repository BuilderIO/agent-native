import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  gmailCreateLabel: vi.fn(),
  gmailListLabels: vi.fn(),
  gmailModifyMessage: vi.fn(),
  gmailTrashMessage: vi.fn(),
  syncInboxLabelDelta: vi.fn(),
  findThreadIdsByMessageIds: vi.fn(),
}));

vi.mock("@agent-native/core/notifications", () => ({ notify: mocks.notify }));
vi.mock("./google-api.js", () => ({
  gmailCreateLabel: mocks.gmailCreateLabel,
  gmailListLabels: mocks.gmailListLabels,
  gmailModifyMessage: mocks.gmailModifyMessage,
  gmailTrashMessage: mocks.gmailTrashMessage,
}));
vi.mock("./inbox-store-sync.js", () => ({
  syncInboxLabelDelta: mocks.syncInboxLabelDelta,
}));
vi.mock("./inbox-store.js", () => ({
  findThreadIdsByMessageIds: mocks.findThreadIdsByMessageIds,
}));

import { executeAction, executeActions } from "./automation-actions.js";

describe("automation notification action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notify.mockResolvedValue({ id: "notification-1" });
    mocks.gmailModifyMessage.mockResolvedValue({ historyId: "history-1" });
    mocks.gmailTrashMessage.mockResolvedValue({ historyId: "history-1" });
    mocks.findThreadIdsByMessageIds.mockResolvedValue(new Map());
  });

  it("sends a core notification with exact Mailbox and message context", async () => {
    const controller = new AbortController();
    const result = await executeAction(
      { type: "notify" },
      {
        accessToken: "google-access-token",
        messageId: "message-1",
        ownerEmail: "owner@example.com",
        accountEmail: "mailbox@example.com",
        labelCache: new Map(),
        signal: controller.signal,
        notificationIdempotencyKey:
          "mail-rule:rule-1:mailbox@example.com:message-1",
        from: "person@example.test",
        subject: "School update",
        snippet: "Field trip forms are due Friday.",
      },
    );

    expect(result).toEqual({ success: true });
    expect(mocks.notify).toHaveBeenCalledWith(
      {
        severity: "info",
        channels: ["inbox"],
        title: "School update",
        body: "person@example.test · Field trip forms are due Friday.",
        metadata: {
          accountEmail: "mailbox@example.com",
          messageId: "message-1",
        },
        idempotencyKey: "mail-rule:rule-1:mailbox@example.com:message-1",
      },
      { owner: "owner@example.com" },
      { signal: controller.signal },
    );
  });

  it("reports a failed notification when persistence returns no row", async () => {
    mocks.notify.mockResolvedValueOnce(undefined);

    const result = await executeAction(
      { type: "notify" },
      {
        accessToken: "google-access-token",
        messageId: "message-1",
        ownerEmail: "owner@example.com",
        accountEmail: "mailbox@example.com",
        labelCache: new Map(),
      },
    );

    expect(result).toEqual({
      success: false,
      error: "Mail notification was not persisted.",
    });
  });

  it("uses the sender as the notification title when the email has no subject", async () => {
    await executeAction(
      { type: "notify" },
      {
        accessToken: "google-access-token",
        messageId: "message-1",
        ownerEmail: "owner@example.com",
        accountEmail: "mailbox@example.com",
        labelCache: new Map(),
        from: "School <school@example.test>",
        subject: "  ",
      },
    );

    expect(mocks.notify.mock.calls[0]?.[0].title).toBe(
      "School <school@example.test>",
    );
  });

  it("propagates aborts and stops before later Gmail actions", async () => {
    const controller = new AbortController();
    mocks.gmailModifyMessage.mockImplementationOnce(
      async (
        _accessToken: string,
        _messageId: string,
        _addLabelIds: string[] | undefined,
        _removeLabelIds: string[] | undefined,
        signal?: AbortSignal,
      ) => {
        expect(signal).toBe(controller.signal);
        controller.abort();
        signal?.throwIfAborted();
      },
    );

    await expect(
      executeActions([{ type: "archive" }, { type: "trash" }], {
        accessToken: "google-access-token",
        messageId: "message-1",
        ownerEmail: "owner@example.com",
        accountEmail: "mailbox@example.com",
        labelCache: new Map(),
        signal: controller.signal,
      }),
    ).rejects.toBe(controller.signal.reason);

    expect(mocks.gmailModifyMessage).toHaveBeenCalledOnce();
    expect(mocks.gmailTrashMessage).not.toHaveBeenCalled();
    expect(mocks.findThreadIdsByMessageIds).not.toHaveBeenCalled();
    expect(mocks.syncInboxLabelDelta).not.toHaveBeenCalled();
  });
});
