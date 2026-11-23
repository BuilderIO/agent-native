import { describe, expect, it, vi } from "vitest";

const ensure = vi.hoisted(() => vi.fn());

vi.mock("../model/database.js", () => ({ ensureAnalyticsDatabase: ensure }));

import registerAnalyticsDatabase from "./db.js";

describe("analytics database plugin", () => {
  it("returns at boot without waiting for the database to migrate", () => {
    ensure.mockReturnValue(new Promise<void>(() => {}));
    expect(registerAnalyticsDatabase()).toBeUndefined();
    expect(ensure).toHaveBeenCalledOnce();
  });

  it("logs a failed setup instead of crashing boot", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    ensure.mockRejectedValue(new Error("down"));
    registerAnalyticsDatabase();
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    error.mockRestore();
  });
});
