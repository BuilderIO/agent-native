import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ notify: vi.fn() }));

vi.mock("@agent-native/core/notifications", () => ({ notify: mocks.notify }));
vi.mock("./google-api.js", () => ({}));
vi.mock("./inbox-store-sync.js", () => ({ syncInboxLabelDelta: vi.fn() }));
vi.mock("./inbox-store.js", () => ({ findThreadIdsByMessageIds: vi.fn() }));

import { executeAction } from "./automation-actions.js";

describe("automation notification action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notify.mockResolvedValue({ id: "notification-1" });
  });

  it("sends a core notification with exact Mailbox and message context", async () => {
    const result = await executeAction(
      { type: "notify" },
      {
        accessToken: "google-access-token",
        messageId: "message-1",
        ownerEmail: "owner@example.com",
        accountEmail: "mailbox@example.com",
        labelCache: new Map(),
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
      },
      { owner: "owner@example.com" },
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
});
