import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildDeepLink: vi.fn(),
  getRequestUserEmail: vi.fn(),
  createScheduledJobRecord: vi.fn(),
  resolveScheduledSendAccountEmail: vi.fn(),
  requiresEmailSendApproval: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: mocks.buildDeepLink,
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
    mocks.buildDeepLink.mockReturnValue(
      "/_agent-native/open?app=mail&view=scheduled",
    );
    mocks.requiresEmailSendApproval.mockResolvedValue(true);
    mocks.createScheduledJobRecord.mockImplementation(async (input) => ({
      id: "job-1",
      type: input.type,
      ownerEmail: input.ownerEmail,
      emailId: input.emailId ?? null,
      threadId: input.threadId ?? null,
      accountEmail: input.accountEmail ?? null,
      payload: JSON.stringify(input.payload ?? {}),
      runAt: input.runAt,
      status: "pending",
      createdAt: 1,
    }));
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

  it("rejects future run times outside the JavaScript Date range", async () => {
    await expect(
      action.run({
        runAt: 8_640_000_000_000_001,
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

  it("returns a scheduled confirmation without recipients or body", async () => {
    const runAt = Date.UTC(2027, 0, 3, 4, 5);
    const payload = {
      to: "recipient@example.com",
      subject: "Private subject",
      body: "Private body",
    };
    mocks.createScheduledJobRecord.mockResolvedValueOnce({
      id: "job-1",
      type: "send_later",
      ownerEmail: "owner@example.com",
      emailId: null,
      threadId: null,
      accountEmail: null,
      runAt,
      status: "pending",
      createdAt: 1,
      payload: JSON.stringify(payload),
    });

    const result = await action.run({ runAt, payload });

    expect(result).toMatchObject({
      id: "job-1",
      type: "send_later",
      ownerEmail: "owner@example.com",
      runAt,
      status: "pending",
      payload: JSON.stringify(payload),
    });
    expect(result.change).toEqual({
      verb: "scheduled",
      kind: "scheduled-email",
      title: "Private subject",
      detail: new Date(runAt).toISOString(),
      url: "/_agent-native/open?app=mail&view=scheduled",
    });
    expect(mocks.buildDeepLink).toHaveBeenCalledWith({
      app: "mail",
      view: "scheduled",
    });
    expect(JSON.stringify(result.change)).not.toContain(payload.to);
    expect(JSON.stringify(result.change)).toContain(payload.subject);
    expect(JSON.stringify(result.change)).not.toContain(payload.body);
  });

  it("does not return a scheduled change when persistence fails", async () => {
    mocks.createScheduledJobRecord.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(
      action.run({
        runAt: Date.now() + 60_000,
        payload: {
          to: "recipient@example.com",
          subject: "Scheduled",
          body: "body",
        },
      }),
    ).rejects.toThrow("database unavailable");
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
