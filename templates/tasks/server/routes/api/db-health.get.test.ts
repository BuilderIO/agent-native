import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  setResponseStatus: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  setResponseStatus: (...args: unknown[]) => mocks.setResponseStatus(...args),
}));

vi.mock("../../db/index.js", () => ({
  getDb: () => mocks.getDb(),
}));

import handler from "./db-health.get.js";

describe("database health route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a generic 503 response without exposing database errors", async () => {
    const databaseError = new Error(
      "connect ECONNREFUSED internal-database.example",
    );
    mocks.getDb.mockReturnValue({
      run: vi.fn().mockRejectedValue(databaseError),
    });
    const event = {};
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(handler(event as never)).resolves.toEqual({
      ok: false,
      error: "Database health check failed",
    });
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 503);
    expect(consoleError).toHaveBeenCalledWith(
      "[tasks] Database health check failed",
      databaseError,
    );

    consoleError.mockRestore();
  });
});
