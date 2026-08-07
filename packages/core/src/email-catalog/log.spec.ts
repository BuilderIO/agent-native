import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn(async () => ({ rows: [] }));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute }),
  getDialect: () => "sqlite",
  isPostgres: () => false,
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureTableExists: vi.fn(async () => undefined),
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
        args: ["org-1", "calendar", "calendar.booking-confirmed", 25],
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
});
