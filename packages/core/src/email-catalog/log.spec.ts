import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn(async () => ({ rows: [] }));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute }),
  getDialect: () => "sqlite",
  isPostgres: () => false,
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureTableExists: vi.fn(async () => undefined),
  ensureColumnExists: vi.fn(async () => undefined),
  ensureIndexExists: vi.fn(async () => undefined),
}));

import { getEmailSendStats, listEmailLog, recordEmailSend } from "./log.js";

describe("email log app scoping", () => {
  beforeEach(() => {
    execute.mockClear();
  });

  it("scopes aggregate stats to one organization and app", async () => {
    await getEmailSendStats(1234, "calendar", "org-1");

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("WHERE org_id = ? AND app = ?"),
        args: ["org-1", "calendar", 1234],
      }),
    );
  });

  it("scopes activity to organization, app, and template", async () => {
    await listEmailLog({
      orgId: "org-1",
      app: "calendar",
      templateId: "calendar.booking-confirmed",
      limit: 25,
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining(
          "WHERE org_id = ? AND app = ? AND template_id = ?",
        ),
        args: ["org-1", "calendar", "calendar.booking-confirmed", 25, 0],
      }),
    );
  });

  it("combines status, provider, recipient, and date-range filters", async () => {
    await listEmailLog({
      orgId: "org-1",
      app: "calendar",
      status: "failed",
      provider: "resend",
      to: "guest@",
      from: "calendar@",
      sinceMs: 1000,
      untilMs: 2000,
      limit: 10,
      offset: 20,
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining(
          "WHERE org_id = ? AND app = ? AND status = ? AND provider = ? " +
            "AND recipient LIKE ? AND sender LIKE ? AND created_at >= ? AND created_at <= ?",
        ),
        args: [
          "org-1",
          "calendar",
          "failed",
          "resend",
          "%guest@%",
          "%calendar@%",
          1000,
          2000,
          10,
          20,
        ],
      }),
    );
  });

  it("persists the organization scope on each send", async () => {
    await recordEmailSend({
      orgId: "org-1",
      app: "calendar",
      recipient: "guest@example.com",
      sender: "calendar@example.com",
      subject: "Booking confirmed",
      status: "sent",
      provider: "sendgrid",
    });

    const insertCall = execute.mock.calls.find(
      ([input]) =>
        typeof input === "object" &&
        input !== null &&
        "sql" in input &&
        String(input.sql).includes("INSERT INTO email_log"),
    );
    expect(insertCall?.[0]).toEqual(
      expect.objectContaining({
        args: expect.arrayContaining(["org-1"]),
      }),
    );
  });

  it("persists the raw request/response fields on each send", async () => {
    await recordEmailSend({
      orgId: "org-1",
      app: "calendar",
      recipient: "guest@example.com",
      sender: "calendar@example.com",
      subject: "Booking confirmed",
      status: "failed",
      provider: "resend",
      error: "Resend error 422: invalid recipient",
      requestPayload: '{"to":"guest@example.com"}',
      responseStatus: 422,
      responseBody: '{"message":"invalid recipient"}',
    });

    const insertCall = execute.mock.calls.find(
      ([input]) =>
        typeof input === "object" &&
        input !== null &&
        "sql" in input &&
        String(input.sql).includes("INSERT INTO email_log"),
    );
    expect(insertCall?.[0]).toEqual(
      expect.objectContaining({
        args: expect.arrayContaining([
          '{"to":"guest@example.com"}',
          422,
          '{"message":"invalid recipient"}',
        ]),
      }),
    );
  });
});
