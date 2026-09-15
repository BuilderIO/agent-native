import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  createScheduledJobRecord: vi.fn(),
  resolveScheduledSendAccountEmail: vi.fn(),
  requiresEmailSendApproval: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/automation-settings.js", () => ({
  requiresEmailSendApproval: mocks.requiresEmailSendApproval,
}));

vi.mock("../server/lib/jobs.js", () => ({
  createScheduledJobRecord: mocks.createScheduledJobRecord,
  resolveScheduledSendAccountEmail: mocks.resolveScheduledSendAccountEmail,
}));

import snoozeAction from "./create-scheduled-job.js";
import action from "./create-scheduled-send.js";

describe("scheduled mail actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.requiresEmailSendApproval.mockResolvedValue(true);
    mocks.createScheduledJobRecord.mockResolvedValue({ id: "job-1" });
    mocks.resolveScheduledSendAccountEmail.mockImplementation(
      async (_ownerEmail, requestedEmail) => requestedEmail,
    );
  });

  it("keeps snooze page-local and exposes scheduled sends behind approval", async () => {
    expect(snoozeAction.needsApproval).toBeUndefined();
    expect(
      snoozeAction.schema.safeParse({
        type: "send_later",
        runAt: Date.now() + 60_000,
      }).success,
    ).toBe(false);
    expect(typeof action.needsApproval).toBe("function");
    if (typeof action.needsApproval !== "function") return;
    await expect(
      action.needsApproval({ runAt: Date.now() + 60_000 }, { caller: "mcp" }),
    ).resolves.toBe(true);
  });

  it("does not persist an unapproved automation schedule", async () => {
    await expect(
      action.run(
        {
          runAt: Date.now() + 60_000,
          payload: {
            to: "recipient@example.com",
            subject: "Scheduled",
            body: "body",
          },
        },
        { caller: "automation", userEmail: "owner@example.com" },
      ),
    ).rejects.toThrow("Automation email sending is disabled");
    expect(mocks.createScheduledJobRecord).not.toHaveBeenCalled();
  });

  it("rejects a schedule without a complete send payload", async () => {
    expect(
      action.schema.safeParse({ runAt: Date.now() + 60_000 }).success,
    ).toBe(false);
    expect(
      action.schema.safeParse({
        runAt: Date.now() + 60_000,
        payload: { to: "recipient@example.com" },
      }).success,
    ).toBe(false);

    expect(mocks.createScheduledJobRecord).not.toHaveBeenCalled();
  });

  it("rejects malformed scheduled attachments before persistence", async () => {
    expect(
      action.schema.safeParse({
        runAt: Date.now() + 60_000,
        payload: {
          to: "recipient@example.com",
          subject: "Scheduled",
          body: "body",
          attachments: [{ originalName: "missing-upload-key.pdf" }],
        },
      }).success,
    ).toBe(false);

    expect(mocks.createScheduledJobRecord).not.toHaveBeenCalled();
  });

  it("rejects a non-future run time before persistence", async () => {
    await expect(
      action.run({
        runAt: Date.now() - 1,
        payload: {
          to: "recipient@example.com",
          subject: "Scheduled",
          body: "body",
        },
      }),
    ).rejects.toThrow("runAt must be a future timestamp");

    expect(mocks.createScheduledJobRecord).not.toHaveBeenCalled();
  });

  it("owner-scopes the selected sender and persists its canonical identity", async () => {
    mocks.resolveScheduledSendAccountEmail.mockResolvedValue(
      "Selected@example.com",
    );

    await action.run({
      runAt: Date.now() + 60_000,
      accountEmail: "selected@example.com",
      payload: {
        to: "recipient@example.com",
        subject: "Scheduled",
        body: "body",
      },
    });

    expect(mocks.resolveScheduledSendAccountEmail).toHaveBeenCalledWith(
      "owner@example.com",
      "selected@example.com",
    );
    expect(mocks.createScheduledJobRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.com",
        accountEmail: "Selected@example.com",
        payload: expect.objectContaining({
          accountEmail: "Selected@example.com",
        }),
      }),
    );
  });

  it("rejects a non-string payload sender at the action boundary", async () => {
    expect(
      action.schema.safeParse({
        runAt: Date.now() + 60_000,
        payload: {
          to: "recipient@example.com",
          subject: "Scheduled",
          body: "body",
          accountEmail: 42,
        },
      }).success,
    ).toBe(false);

    expect(mocks.resolveScheduledSendAccountEmail).not.toHaveBeenCalled();
    expect(mocks.createScheduledJobRecord).not.toHaveBeenCalled();
  });

  it.each([
    { to: "bad-recipient", cc: "", bcc: "" },
    { to: "   ", cc: "", bcc: "" },
    { to: "recipient@example.com", cc: "bad-cc", bcc: "" },
    { to: "recipient@example.com", cc: "", bcc: "bad-bcc" },
  ])("rejects malformed scheduled recipients", async (recipients) => {
    await expect(
      action.run({
        runAt: Date.now() + 60_000,
        payload: {
          ...recipients,
          subject: "Scheduled",
          body: "body",
        },
      }),
    ).rejects.toThrow("Invalid recipient address");

    expect(mocks.createScheduledJobRecord).not.toHaveBeenCalled();
  });

  it("rejects a non-string scheduled recipient at the action boundary", async () => {
    expect(
      action.schema.safeParse({
        runAt: Date.now() + 60_000,
        payload: {
          to: "recipient@example.com",
          cc: 42,
          subject: "Scheduled",
          body: "body",
        },
      }).success,
    ).toBe(false);

    expect(mocks.createScheduledJobRecord).not.toHaveBeenCalled();
  });
});
