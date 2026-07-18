import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDbExec, getDbExec } from "../db/client.js";
import {
  __resetWorkflowSchemaForTests,
  claimNextWorkflowExecution,
  ensureWorkflowSchema,
  finalizeWorkflowExecution,
  insertWorkflowEvent,
  materializeWorkflowExecutions,
  upsertWorkflowSubscription,
} from "./store.js";

const postgresUrl = process.env.WORKFLOW_POSTGRES_TEST_URL;
const describePostgres = postgresUrl ? describe : describe.skip;

const workflowTables = [
  "notification_delivery_attempts",
  "workflow_effects",
  "workflow_scheduled_work",
  "workflow_executions",
  "workflow_materialization_backlog",
  "workflow_subscription_versions",
  "workflow_subscriptions",
  "workflow_events",
  "workflow_virtual_provider_state",
  "workflow_runtime_controls",
  "workflow_sequence_counters",
] as const;

async function clearWorkflowTables(): Promise<void> {
  await getDbExec().execute(
    `TRUNCATE TABLE ${workflowTables.join(", ")} RESTART IDENTITY CASCADE`,
  );
}

async function seedSubscription(id: string): Promise<void> {
  await upsertWorkflowSubscription({
    id,
    kind: "deterministic",
    eventPattern: "content.item.changed",
    ownerEmail: "owner@example.com",
    config: { domain: "content" },
  });
}

async function seedEvent(id: string, subjectId = "item-1"): Promise<void> {
  await insertWorkflowEvent({
    id,
    topic: "content.item.changed",
    subjectType: "content.item",
    subjectId,
    ownerEmail: "owner@example.com",
    payload: { id },
    actorContext: { kind: "user", userId: "user-1" },
    occurredAt: 100,
  });
}

describePostgres("workflow store on Postgres", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = postgresUrl;
    await closeDbExec();
    __resetWorkflowSchemaForTests();
    await ensureWorkflowSchema();
  });

  beforeEach(async () => {
    await clearWorkflowTables();
    __resetWorkflowSchemaForTests();
    await ensureWorkflowSchema();
  });

  afterAll(async () => {
    if (postgresUrl) await clearWorkflowTables();
    await closeDbExec();
  });

  it("claims each subject in event order under concurrent workers", async () => {
    await seedSubscription("ordered-rule");
    await seedEvent("event-a");
    await seedEvent("event-b");

    const [firstWorker, secondWorker] = await Promise.all([
      claimNextWorkflowExecution({ workerId: "worker-a", now: 200 }),
      claimNextWorkflowExecution({ workerId: "worker-b", now: 200 }),
    ]);
    const firstClaim = firstWorker ?? secondWorker;

    expect([firstWorker, secondWorker].filter(Boolean)).toHaveLength(1);
    expect(firstClaim?.eventId).toBe("event-a");
    expect(
      await finalizeWorkflowExecution({
        executionId: firstClaim!.id,
        leaseToken: firstClaim!.leaseToken,
        fenceVersion: firstClaim!.fenceVersion,
        status: "succeeded",
        now: 201,
      }),
    ).toBe(true);

    const nextClaim = await claimNextWorkflowExecution({
      workerId: "worker-c",
      now: 202,
    });
    expect(nextClaim?.eventId).toBe("event-b");
  });

  it("rejects a stale worker after a lease is fenced and reclaimed", async () => {
    await seedSubscription("fencing-rule");
    await seedEvent("fenced-event");

    const staleClaim = await claimNextWorkflowExecution({
      workerId: "stale-worker",
      leaseMs: 1_000,
      now: 200,
    });
    const currentClaim = await claimNextWorkflowExecution({
      workerId: "current-worker",
      leaseMs: 1_000,
      now: 1_201,
    });

    expect(currentClaim?.id).toBe(staleClaim?.id);
    expect(currentClaim?.fenceVersion).toBe(
      (staleClaim?.fenceVersion ?? 0) + 1,
    );
    expect(
      await finalizeWorkflowExecution({
        executionId: staleClaim!.id,
        leaseToken: staleClaim!.leaseToken,
        fenceVersion: staleClaim!.fenceVersion,
        status: "succeeded",
        now: 1_202,
      }),
    ).toBe(false);
    expect(
      await finalizeWorkflowExecution({
        executionId: currentClaim!.id,
        leaseToken: currentClaim!.leaseToken,
        fenceVersion: currentClaim!.fenceVersion,
        status: "succeeded",
        now: 1_203,
      }),
    ).toBe(true);
  });

  it("materializes a transactionally appended event only after commit", async () => {
    await seedSubscription("commit-rule");
    const db = getDbExec();
    let markInserted!: () => void;
    let releaseCommit!: () => void;
    const inserted = new Promise<void>((resolve) => {
      markInserted = resolve;
    });
    const canCommit = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });

    const transaction = db.transaction!(async (tx) => {
      await insertWorkflowEvent(
        {
          id: "commit-event",
          topic: "content.item.changed",
          subjectType: "content.item",
          subjectId: "item-commit",
          ownerEmail: "owner@example.com",
          actorContext: { kind: "agent", model: "test-model" },
          occurredAt: 300,
        },
        { db: tx, now: 300 },
      );
      markInserted();
      await canCommit;
    });

    await inserted;
    expect(
      await materializeWorkflowExecutions({
        eventId: "commit-event",
        now: 301,
      }),
    ).toBe(0);
    releaseCommit();
    await transaction;

    const [firstMaterialization, duplicateMaterialization] = await Promise.all([
      materializeWorkflowExecutions({ eventId: "commit-event", now: 302 }),
      materializeWorkflowExecutions({ eventId: "commit-event", now: 302 }),
    ]);
    expect(firstMaterialization + duplicateMaterialization).toBe(1);
  });
});
