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

import { getEmailSendStats, listEmailLog } from "./log.js";

describe("email log app scoping", () => {
  beforeEach(() => {
    execute.mockClear();
  });

  it("scopes aggregate stats to one app", async () => {
    await getEmailSendStats(1234, "calendar");

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("WHERE app = ?"),
        args: ["calendar", 1234],
      }),
    );
  });

  it("scopes activity to app and template", async () => {
    await listEmailLog({
      app: "calendar",
      templateId: "calendar.booking-confirmed",
      limit: 25,
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("WHERE app = ? AND template_id = ?"),
        args: ["calendar", "calendar.booking-confirmed", 25],
      }),
    );
  });
});
