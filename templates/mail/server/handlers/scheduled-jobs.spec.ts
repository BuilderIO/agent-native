import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  readBody: vi.fn(),
  setResponseStatus: vi.fn(),
  scheduleEmailSend: vi.fn(),
  scheduleSnooze: vi.fn(),
  sendScheduledJobNowForOwner: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getSession: mocks.getSession,
  readBody: mocks.readBody,
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParam: vi.fn(),
  setResponseStatus: mocks.setResponseStatus,
}));

vi.mock("../lib/jobs.js", () => ({
  scheduleEmailSend: mocks.scheduleEmailSend,
  scheduleSnooze: mocks.scheduleSnooze,
  sendScheduledJobNowForOwner: mocks.sendScheduledJobNowForOwner,
}));

import { scheduleEmail } from "./scheduled-jobs.js";

const event = {} as never;

describe("scheduleEmail recipient validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ email: "owner@example.com" });
    mocks.scheduleEmailSend.mockResolvedValue({ id: "scheduled-1" });
  });

  it.each([
    {
      recipients: { to: "not-an-address", cc: "", bcc: "" },
      error: "Invalid recipient address",
    },
    {
      recipients: { to: "   ", cc: "", bcc: "" },
      error: "Missing required fields: to, subject, body",
    },
    {
      recipients: {
        to: "recipient@example.com\r\nBcc: attacker@example.com",
        cc: "",
        bcc: "",
      },
      error: "Invalid recipient address",
    },
    {
      recipients: { to: "recipient@example.com", cc: "bad-cc", bcc: "" },
      error: "Invalid recipient address",
    },
    {
      recipients: { to: "recipient@example.com", cc: 42, bcc: "" },
      error: "Invalid recipient address",
    },
    {
      recipients: { to: "recipient@example.com", cc: "", bcc: "bad-bcc" },
      error: "Invalid recipient address",
    },
  ])(
    "rejects malformed To/Cc/Bcc before creating a scheduled job",
    async ({ recipients, error }) => {
      mocks.readBody.mockResolvedValue({
        ...recipients,
        subject: "Scheduled",
        body: "body",
        runAt: Date.now() + 60_000,
      });

      await expect(scheduleEmail(event)).resolves.toEqual({
        error,
      });

      expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 400);
      expect(mocks.scheduleEmailSend).not.toHaveBeenCalled();
    },
  );

  it("accepts the same comma-separated and display-name address forms as immediate send", async () => {
    mocks.readBody.mockResolvedValue({
      to: "Recipient <recipient@example.com>, second@example.com",
      cc: "copy@example.com",
      bcc: "",
      subject: "Scheduled",
      body: "body",
      runAt: Date.now() + 60_000,
    });

    await expect(scheduleEmail(event)).resolves.toEqual({
      id: "scheduled-1",
    });

    expect(mocks.scheduleEmailSend).toHaveBeenCalledTimes(1);
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 201);
  });
});
