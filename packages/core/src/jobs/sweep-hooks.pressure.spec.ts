import { afterEach, describe, expect, it, vi } from "vitest";

import { dbConnectGateRemainingMs } from "../db/client.js";
import {
  registerRecurringSweepHandler,
  runRecurringSweepHandlers,
} from "./sweep-hooks.js";

describe("recurring sweep under database pressure", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()?.();
  });

  it("stands down while the database is in connect cooldown instead of piling on", async () => {
    // The hosted database pooler answered "Too many connections" to hundreds of requests
    // a minute, and every registered handler retried it. A sweep that starts during
    // the cooldown must skip cleanly, leaving the work for the next tick.
    const db = await import("../db/client.js");
    const gate = vi
      .spyOn(db, "dbConnectGateRemainingMs")
      .mockReturnValue(1_500);
    const ran = vi.fn(async () => {});
    cleanups.push(registerRecurringSweepHandler("qa-gate-a", ran));
    cleanups.push(registerRecurringSweepHandler("qa-gate-b", ran));

    const result = await runRecurringSweepHandlers({
      deadlineAt: Date.now() + 5_000,
    });

    expect(ran).not.toHaveBeenCalled();
    expect(result.failed).toEqual([]);
    expect(result.skipped).toBe("db-connect-cooldown");
    expect(result.registered).toBeGreaterThanOrEqual(2);
    gate.mockRestore();

    const second = await runRecurringSweepHandlers({
      deadlineAt: Date.now() + 5_000,
    });
    expect(second.skipped).toBeUndefined();
    expect(ran).toHaveBeenCalledTimes(2);
  });

  it("reports no gate when no connect cooldown is running", () => {
    expect(dbConnectGateRemainingMs()).toBe(0);
  });

  it("also stands down for a moment after the database times a query out", async () => {
    // 11/5 evening: the pool was no longer exhausted but queries still timed out ~6
    // times a minute, and each sweep started right after another failure.
    const db = await import("../db/client.js");
    const recent = vi.spyOn(db, "dbRecentTimeoutMs").mockReturnValue(1_000);
    const gate = vi.spyOn(db, "dbConnectGateRemainingMs").mockReturnValue(0);
    const ran = vi.fn(async () => {});
    cleanups.push(registerRecurringSweepHandler("qa-timeout-a", ran));

    const result = await runRecurringSweepHandlers({
      deadlineAt: Date.now() + 5_000,
    });

    expect(ran).not.toHaveBeenCalled();
    expect(result.skipped).toBe("db-timeout");
    recent.mockReturnValue(Number.POSITIVE_INFINITY);
    gate.mockRestore();
    recent.mockRestore();
    const after = await runRecurringSweepHandlers({
      deadlineAt: Date.now() + 5_000,
    });
    expect(after.skipped).toBeUndefined();
    expect(ran).toHaveBeenCalledTimes(1);
  });
});
