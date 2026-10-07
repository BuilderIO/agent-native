import { afterAll, describe, expect, it } from "vitest";

import { createDbExec, withDbExec } from "../db/client.js";
import {
  acquireAutomationSchedulerLease,
  renewAutomationSchedulerLease,
  releaseAutomationSchedulerLease,
} from "./scheduler-health.js";

const db = await createDbExec({ url: "pglite:memory://" });
afterAll(async () => {
  await db.close?.();
});

describe("scheduler lease after a worker stops", () => {
  it("cannot revive an expired lease even before another scheduler acquires it", async () => {
    await withDbExec(db, async () => {
      const now = Date.now();
      const owner = await acquireAutomationSchedulerLease({
        appId: "expired",
        now,
      });
      expect(owner).not.toBeNull();
      expect(
        await renewAutomationSchedulerLease({
          appId: "expired",
          owner: owner!,
          now: now + 120_000,
        }),
      ).toBe(false);
      expect(
        await acquireAutomationSchedulerLease({
          appId: "expired",
          now: now + 120_000,
        }),
      ).not.toBeNull();
    });
  });
  it("lets a restarted scheduler take over in two minutes while renewals protect a live scheduler", async () => {
    await withDbExec(db, async () => {
      const now = Date.now();
      const stopped = await acquireAutomationSchedulerLease({
        appId: "stopped",
        now,
      });
      expect(stopped).not.toBeNull();
      expect(
        await acquireAutomationSchedulerLease({
          appId: "stopped",
          now: now + 60_000,
        }),
      ).toBeNull();
      const restarted = await acquireAutomationSchedulerLease({
        appId: "stopped",
        now: now + 120_000,
      });
      expect(restarted).not.toBeNull();
      expect(
        await renewAutomationSchedulerLease({
          appId: "stopped",
          owner: stopped!,
          now: now + 120_001,
        }),
      ).toBe(false);
      await releaseAutomationSchedulerLease({
        appId: "stopped",
        owner: stopped!,
      });
      expect(
        await acquireAutomationSchedulerLease({
          appId: "stopped",
          now: now + 121_000,
        }),
      ).toBeNull();

      const alive = await acquireAutomationSchedulerLease({
        appId: "alive",
        now,
      });
      expect(
        await renewAutomationSchedulerLease({
          appId: "alive",
          owner: alive!,
          now: now + 60_000,
        }),
      ).toBe(true);
      expect(
        await acquireAutomationSchedulerLease({
          appId: "alive",
          now: now + 120_000,
        }),
      ).toBeNull();
      expect(
        await acquireAutomationSchedulerLease({
          appId: "alive",
          now: now + 180_000,
        }),
      ).not.toBeNull();
    });
  });
});
