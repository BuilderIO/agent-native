import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({
  selectedCondition: null as any,
  claimCondition: null as any,
  updateValues: null as any,
  selectedRows: [] as unknown[],
  claimedRows: [] as unknown[],
  insertedRows: [] as unknown[],
}));

vi.mock("../db/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/index.js")>();
  const mockDb = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          captured.selectedCondition = condition;
          return Object.assign(Promise.resolve(captured.selectedRows), {
            limit: async () => captured.selectedRows,
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
    insert: () => ({
      values: async (values: unknown) => {
        captured.insertedRows.push(values);
      },
    }),
    transaction: async (callback: (tx: any) => unknown) => callback(mockDb),
  };
  return {
    ...actual,
    db: mockDb,
  };
});

import { PgDialect } from "drizzle-orm/pg-core";

import {
  cancelScheduledJobForOwner,
  confirmUncertainScheduledJobSentForOwner,
  getDuePendingJobs,
  getSyntheticEmailsForView,
  listPendingJobs,
  markExpiredScheduledSendsUncertain,
  markJobUncertain,
  markJobProcessing,
  retryUncertainScheduledJobForOwner,
  sendScheduledJobNowForOwner,
} from "./jobs.js";

describe("scheduled job lease claims", () => {
  it("keeps scheduled-view reads owner-scoped and free of lease-recovery writes", async () => {
    const ownerEmail = "alice@example.com";
    captured.updateValues = null;
    captured.selectedRows = [];

    await expect(
      getSyntheticEmailsForView(ownerEmail, "scheduled"),
    ).resolves.toEqual([]);

    expect(captured.updateValues).toBeNull();
    const query = new PgDialect().sqlToQuery(captured.selectedCondition);
    expect(query.params).toContain(ownerEmail);
  });

  it("does not expose scheduled sends without a proven owner", async () => {
    captured.selectedRows = [];

    await expect(listPendingJobs("alice@example.com")).resolves.toEqual([]);

    const query = new PgDialect().sqlToQuery(captured.selectedCondition);
    expect(query.sql).toContain('"status" in');
    expect(query.sql).toContain('"status" =');
    expect(query.sql).toContain('"owner_email" is null');
    expect(query.sql).toContain('"account_email" =');
    expect(query.params).toEqual(
      expect.arrayContaining([
        "pending",
        "processing",
        "uncertain",
        "alice@example.com",
      ]),
    );
    expect(query.sql).not.toContain('"account_email" is null');
  });

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
    expect(query.params).not.toContain("uncertain");
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

  it("expires only dispatched send jobs after their processing lease expires", async () => {
    captured.claimedRows = [{ id: "scheduled-send" }];

    await expect(markExpiredScheduledSendsUncertain(25_000)).resolves.toBe(1);

    expect(captured.updateValues).toMatchObject({
      status: "uncertain",
      processingClaimId: null,
      processingLeaseUntil: null,
    });
    const query = new PgDialect().sqlToQuery(captured.claimCondition);
    expect(query.sql).toContain('"type" =');
    expect(query.sql).toContain('"status" =');
    expect(query.sql).toContain('"send_started_at" is not null');
    expect(query.sql).toContain('"processing_lease_until" <=');
    expect(query.params).toEqual(
      expect.arrayContaining(["send_later", "processing", 25_000]),
    );
  });

  it("marks an uncertain send done only for its owner after Sent confirmation", async () => {
    captured.claimedRows = [{ id: "scheduled-send", status: "done" }];

    await expect(
      confirmUncertainScheduledJobSentForOwner(
        "alice@example.com",
        "scheduled-send",
      ),
    ).resolves.toMatchObject({ status: "done" });

    expect(captured.updateValues).toEqual({ status: "done" });
    const query = new PgDialect().sqlToQuery(captured.claimCondition);
    expect(query.sql).toContain('"owner_email" =');
    expect(query.params).toEqual(
      expect.arrayContaining([
        "scheduled-send",
        "alice@example.com",
        "send_later",
        "uncertain",
      ]),
    );
  });

  it("marks a dispatched processing send uncertain using its active claim", async () => {
    captured.claimedRows = [{ id: "scheduled-send" }];

    await expect(
      markJobUncertain("scheduled-send", "send-claim"),
    ).resolves.toBe(true);

    expect(captured.updateValues).toMatchObject({
      status: "uncertain",
      processingClaimId: null,
      processingLeaseUntil: null,
    });
    const query = new PgDialect().sqlToQuery(captured.claimCondition);
    expect(query.sql).toContain('"processing_claim_id" =');
    expect(query.sql).toContain('"send_started_at" is not null');
    expect(query.params).toContain("scheduled-send");
    expect(query.params).toContain("send-claim");
  });

  it("creates a separate pending job for explicit retry and retains the source record", async () => {
    const original = {
      id: "scheduled-send",
      type: "send_later",
      ownerEmail: "alice@example.com",
      payload: JSON.stringify({ to: "recipient@example.com" }),
      status: "uncertain",
      runAt: 10_000,
      createdAt: 1_000,
      sendStartedAt: 9_000,
    };
    captured.selectedRows = [original];
    captured.claimedRows = [{ id: original.id }];
    captured.insertedRows = [];

    const retry = await retryUncertainScheduledJobForOwner(
      "alice@example.com",
      original.id,
    );

    expect(retry.id).not.toBe(original.id);
    expect(retry).toMatchObject({
      type: "send_later",
      ownerEmail: "alice@example.com",
      status: "processing",
      sendStartedAt: null,
    });
    expect(retry.processingClaimId).toEqual(expect.any(String));
    expect(retry.processingLeaseUntil).toBeGreaterThan(Date.now());
    expect(captured.updateValues).toEqual({ status: "retry_queued" });
    expect(captured.insertedRows).toEqual([retry]);
    expect(original.status).toBe("uncertain");
  });

  it("does not mark a job resolved when the owner-scoped CAS finds no row", async () => {
    captured.claimedRows = [];

    await expect(
      confirmUncertainScheduledJobSentForOwner(
        "mallory@example.com",
        "scheduled-send",
      ),
    ).resolves.toBeNull();

    const query = new PgDialect().sqlToQuery(captured.claimCondition);
    expect(query.params).toContain("mallory@example.com");
    expect(query.params).toContain("uncertain");
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

  it("scopes legacy ownerless scheduled rows to their matching account for cancel and send", async () => {
    captured.claimedRows = [];
    captured.selectedRows = [
      {
        id: "legacy-send",
        type: "send_later",
        ownerEmail: null,
        accountEmail: "alice@example.com",
        payload: "{}",
        runAt: 1_000,
        status: "done",
        createdAt: 0,
      },
    ];

    await expect(
      cancelScheduledJobForOwner("alice@example.com", "legacy-send"),
    ).rejects.toThrow("Scheduled email is already done");
    let query = new PgDialect().sqlToQuery(captured.selectedCondition);
    expect(query.sql).toContain('"owner_email" is null');
    expect(query.sql).toContain('"account_email" =');
    expect(query.sql).not.toContain('"account_email" is null');
    query = new PgDialect().sqlToQuery(captured.claimCondition);
    expect(query.sql).toContain('"owner_email" is null');
    expect(query.sql).toContain('"account_email" =');
    expect(query.sql).not.toContain('"account_email" is null');

    await expect(
      sendScheduledJobNowForOwner("alice@example.com", "legacy-send"),
    ).rejects.toThrow("Scheduled email is already done");
    query = new PgDialect().sqlToQuery(captured.selectedCondition);
    expect(query.sql).toContain('"owner_email" is null');
    expect(query.sql).toContain('"account_email" =');
    expect(query.sql).not.toContain('"account_email" is null');
  });
});
