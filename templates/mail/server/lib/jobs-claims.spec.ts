import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  selectedCondition: null as any,
  claimCondition: null as any,
  updateValues: null as any,
  selectedRows: [] as unknown[],
  claimedRows: [] as unknown[],
}));

vi.mock("../db/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/index.js")>();
  return {
    ...actual,
    db: {
      select: () => ({
        from: () => ({
          where: (condition: unknown) => {
            captured.selectedCondition = condition;
            return Object.assign(Promise.resolve(captured.selectedRows), {
              orderBy: () => ({ limit: async () => captured.selectedRows }),
            });
          },
        }),
      }),
      update: () => ({
        set: (values: unknown) => {
          captured.updateValues = values;
          return {
            where: (condition: unknown) => {
              captured.claimCondition = condition;
              return { returning: async () => captured.claimedRows };
            },
          };
        },
      }),
    },
  };
});

import { PgDialect } from "drizzle-orm/pg-core";

import {
  cancelScheduledJobForOwner,
  getDuePendingJobs,
  markJobProcessing,
} from "./jobs.js";

describe("scheduled job lease claims", () => {
  it("selects pending and expired processing jobs while excluding dispatched sends", async () => {
    const now = 10_000;
    const jobs = [{ id: "stale-snooze", status: "processing" }];
    captured.selectedRows = jobs;

    await expect(getDuePendingJobs(now, 20)).resolves.toEqual(jobs);

    const query = new PgDialect().sqlToQuery(captured.selectedCondition);
    expect(query.sql).toContain('"run_at" <=');
    expect(query.sql).toContain('"status" =');
    expect(query.sql).toContain('"processing_lease_until" <=');
    expect(query.sql).toContain('"send_started_at" is null');
    expect(query.params).toContain("pending");
    expect(query.params).toContain("processing");
    expect(query.params).toContain("snooze");
    expect(query.params).toContain(now);
  });

  it("claims an expired job with a fresh token and deadline lease using compare-and-set", async () => {
    const now = 20_000;
    const leaseUntil = 260_000;
    captured.claimedRows = [{ id: "stale-snooze" }];

    const claimId = await markJobProcessing("stale-snooze", now, leaseUntil);

    expect(claimId).toEqual(expect.any(String));
    expect(captured.updateValues).toMatchObject({
      status: "processing",
      processingClaimId: claimId,
      processingLeaseUntil: leaseUntil,
      sendStartedAt: null,
    });
    const query = new PgDialect().sqlToQuery(captured.claimCondition);
    expect(query.sql).toContain('"id" =');
    expect(query.sql).toContain('"run_at" <=');
    expect(query.sql).toContain('"processing_lease_until" <=');
    expect(query.sql).toContain('"send_started_at" is null');
    expect(query.params).toContain("stale-snooze");
    expect(query.params).toContain(now);
  });

  it.each(["processing", "done", "cancelled"] as const)(
    "does not cancel a job that is already %s",
    async (status) => {
      captured.claimedRows = [];
      captured.selectedRows = [
        {
          id: "claimed-send",
          status,
          sendStartedAt: status === "processing" ? 1_000 : null,
        },
      ];

      await expect(
        cancelScheduledJobForOwner("alice@example.com", "claimed-send"),
      ).rejects.toThrow(`Scheduled email is already ${status}`);

      expect(captured.updateValues).toEqual({ status: "cancelled" });
      const query = new PgDialect().sqlToQuery(captured.claimCondition);
      expect(query.sql).toContain('"status" =');
      expect(query.params).toContain("pending");
    },
  );
});
