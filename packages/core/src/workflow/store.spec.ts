import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  exec: undefined as
    | {
        execute(
          statement: string | { sql: string; args?: unknown[] },
        ): Promise<{ rows: unknown[]; rowsAffected: number }>;
      }
    | undefined,
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => state.exec,
  intType: () => "INTEGER",
  isPostgres: () => false,
  safeJsonParse: <T>(value: unknown, fallback: T): T => {
    try {
      return JSON.parse(String(value)) as T;
    } catch {
      return fallback;
    }
  },
}));

import {
  __resetWorkflowExecutionHandlers,
  processNextWorkflowExecution,
  processNextWorkflowWork,
  registerScheduledWorkflowHandler,
  registerWorkflowExecutionHandler,
  startWorkflowWakeProcessor,
} from "./runtime.js";
import {
  __resetWorkflowSchemaForTests,
  acknowledgeWorkflowExecution,
  cancelWorkflowWork,
  claimWorkflowEffectRetry,
  claimNextScheduledWork,
  claimNextWorkflowExecution,
  ensureWorkflowSchema,
  finalizeWorkflowEffect,
  finalizeWorkflowExecution,
  getWorkflowExecution,
  getWorkflowEvent,
  getWorkflowEffectByIdempotencyKey,
  getWorkflowRuntimeControls,
  getWorkflowSubscription,
  insertWorkflowEvent,
  listWorkflowExecutions,
  materializeWorkflowExecutions,
  recordNotificationDeliveryAttempt,
  recordWorkflowEffect,
  retryWorkflowExecution,
  scheduleWorkflowWork,
  setWorkflowRuntimeControl,
  upsertWorkflowSubscription,
} from "./store.js";
import {
  __resetVirtualWorkflowSubscriptionProviders,
  registerVirtualWorkflowSubscriptionProvider,
} from "./virtual-subscriptions.js";
import {
  __resetWorkflowWakeBus,
  emitWorkflowWake,
  subscribeWorkflowWake,
} from "./wake.js";

let sqlite: Database.Database;

beforeEach(async () => {
  sqlite = new Database(":memory:");
  state.exec = {
    async execute(statement) {
      const sql = typeof statement === "string" ? statement : statement.sql;
      const args = typeof statement === "string" ? [] : (statement.args ?? []);
      const prepared = sqlite.prepare(sql);
      if (prepared.reader) {
        return { rows: prepared.all(...args), rowsAffected: 0 };
      }
      const result = prepared.run(...args);
      return { rows: [], rowsAffected: result.changes };
    },
  };
  __resetWorkflowSchemaForTests();
  __resetWorkflowWakeBus();
  __resetWorkflowExecutionHandlers();
  __resetVirtualWorkflowSubscriptionProviders();
  await ensureWorkflowSchema();
});

afterEach(() => sqlite.close());

async function seedTwoOrderedEvents(): Promise<void> {
  await upsertWorkflowSubscription({
    id: "content-ready",
    kind: "deterministic",
    eventPattern: "content.item.*",
    ownerEmail: "owner@example.com",
    config: { domain: "content" },
  });
  await insertWorkflowEvent({
    id: "event-a",
    topic: "content.item.changed",
    subjectType: "content.item",
    subjectId: "item-1",
    ownerEmail: "owner@example.com",
    occurredAt: 100,
  });
  await insertWorkflowEvent({
    id: "event-b",
    topic: "content.item.changed",
    subjectType: "content.item",
    subjectId: "item-1",
    ownerEmail: "owner@example.com",
    occurredAt: 101,
  });
}

describe("workflow runtime controls", () => {
  const context = {
    ownerEmail: "owner@example.com",
    orgId: "org-1",
    domain: "content",
    resourceId: "database-1",
  } as const;

  async function seedControlledEvent(id = "paused-event") {
    await upsertWorkflowSubscription({
      id: "controlled-rule",
      kind: "deterministic",
      eventPattern: "content.item.changed",
      ownerEmail: context.ownerEmail,
      orgId: context.orgId,
      config: { domain: context.domain, resourceId: context.resourceId },
    });
    await insertWorkflowEvent({
      id,
      topic: "content.item.changed",
      subjectType: "content.item",
      subjectId: "item-1",
      ownerEmail: context.ownerEmail,
      orgId: context.orgId,
      occurredAt: 100,
    });
  }

  it("holds evaluator-paused events before materialization and materializes once on resume", async () => {
    await setWorkflowRuntimeControl({
      ...context,
      scope: "resource",
      evaluatorPaused: true,
      effectsPaused: false,
      now: 90,
    });
    await seedControlledEvent();
    expect(await materializeWorkflowExecutions({ now: 200 })).toBe(0);
    expect(await listWorkflowExecutions()).toHaveLength(0);

    await setWorkflowRuntimeControl({
      ...context,
      scope: "resource",
      evaluatorPaused: false,
      effectsPaused: false,
      now: 201,
    });
    expect(await materializeWorkflowExecutions({ now: 202 })).toBe(1);
    expect(await materializeWorkflowExecutions({ now: 203 })).toBe(0);
    expect(await listWorkflowExecutions()).toHaveLength(1);
  });

  it("rotates a paused backlog so another tenant cannot be starved", async () => {
    await setWorkflowRuntimeControl({
      ownerEmail: "paused@example.com",
      orgId: null,
      domain: "content",
      scope: "global",
      evaluatorPaused: true,
      effectsPaused: false,
      now: 90,
    });
    await upsertWorkflowSubscription({
      id: "paused-large-rule",
      kind: "deterministic",
      eventPattern: "paused.item.changed",
      ownerEmail: "paused@example.com",
      config: { domain: "content" },
    });
    for (let index = 0; index < 101; index += 1) {
      await insertWorkflowEvent({
        id: `paused-large-${index}`,
        topic: "paused.item.changed",
        subjectType: "content.item",
        subjectId: `paused-${index}`,
        ownerEmail: "paused@example.com",
        occurredAt: 100 + index,
      });
    }
    expect(await materializeWorkflowExecutions({ now: 500 })).toBe(0);
    expect(await materializeWorkflowExecutions({ now: 500 })).toBe(0);

    await upsertWorkflowSubscription({
      id: "active-rule",
      kind: "deterministic",
      eventPattern: "active.item.changed",
      ownerEmail: "active@example.com",
      config: { domain: "content" },
    });
    await insertWorkflowEvent({
      id: "active-after-paused-prefix",
      topic: "active.item.changed",
      subjectType: "content.item",
      subjectId: "active-item",
      ownerEmail: "active@example.com",
      occurredAt: 250,
    });

    await materializeWorkflowExecutions({ now: 600 });
    await materializeWorkflowExecutions({ now: 601 });
    expect(
      (await listWorkflowExecutions({ limit: 200 })).some(
        (execution) => execution.eventId === "active-after-paused-prefix",
      ),
    ).toBe(true);
  });

  it("keeps effect-paused executions pending and claims them once after resume", async () => {
    await seedControlledEvent();
    await setWorkflowRuntimeControl({
      ...context,
      scope: "resource",
      evaluatorPaused: false,
      effectsPaused: true,
    });
    await materializeWorkflowExecutions({ now: 200 });
    expect(
      await claimNextWorkflowExecution({ workerId: "paused", now: 201 }),
    ).toBeNull();
    expect(await listWorkflowExecutions()).toEqual([
      expect.objectContaining({ status: "pending", attempt: 0 }),
    ]);

    await setWorkflowRuntimeControl({
      ...context,
      scope: "resource",
      evaluatorPaused: false,
      effectsPaused: false,
    });
    const claim = await claimNextWorkflowExecution({
      workerId: "resumed",
      now: 202,
    });
    expect(claim).toMatchObject({ eventId: "paused-event", attempt: 1 });
    await finalizeWorkflowExecution({
      executionId: claim!.id,
      leaseToken: claim!.leaseToken,
      fenceVersion: claim!.fenceVersion,
      status: "succeeded",
      now: 203,
    });
    expect(
      await claimNextWorkflowExecution({ workerId: "again", now: 204 }),
    ).toBeNull();
    expect(await listWorkflowExecutions()).toEqual([
      expect.objectContaining({ status: "succeeded", attempt: 1 }),
    ]);
  });

  it("does not revoke an in-flight lease when effects are paused", async () => {
    await seedControlledEvent("in-flight-event");
    const claim = await claimNextWorkflowExecution({
      workerId: "leased",
      now: 200,
    });
    await setWorkflowRuntimeControl({
      ...context,
      scope: "resource",
      evaluatorPaused: false,
      effectsPaused: true,
      now: 201,
    });
    expect(
      await finalizeWorkflowExecution({
        executionId: claim!.id,
        leaseToken: claim!.leaseToken,
        fenceVersion: claim!.fenceVersion,
        status: "succeeded",
        now: 202,
      }),
    ).toBe(true);
    expect(await listWorkflowExecutions()).toEqual([
      expect.objectContaining({ status: "succeeded", attempt: 1 }),
    ]);
  });

  it("isolates global and resource controls by owner and organization", async () => {
    await setWorkflowRuntimeControl({
      ...context,
      scope: "resource",
      evaluatorPaused: true,
      effectsPaused: false,
    });
    expect(
      (await getWorkflowRuntimeControls(context)).effective.evaluatorPaused,
    ).toBe(true);
    expect(
      (
        await getWorkflowRuntimeControls({
          ...context,
          orgId: "org-2",
        })
      ).effective.evaluatorPaused,
    ).toBe(false);
    expect(
      (
        await getWorkflowRuntimeControls({
          ...context,
          ownerEmail: "other@example.com",
        })
      ).effective.evaluatorPaused,
    ).toBe(false);

    await setWorkflowRuntimeControl({
      ...context,
      scope: "global",
      evaluatorPaused: false,
      effectsPaused: true,
    });
    expect(
      (
        await getWorkflowRuntimeControls({
          ...context,
          resourceId: "database-2",
        })
      ).effective.effectsPaused,
    ).toBe(true);
  });

  it("keeps scheduled effect work pending until controls resume", async () => {
    await upsertWorkflowSubscription({
      id: "scheduled-controlled-rule",
      kind: "deterministic",
      eventPattern: "content.item.changed",
      ownerEmail: context.ownerEmail,
      orgId: context.orgId,
      config: { domain: context.domain, resourceId: context.resourceId },
    });
    await scheduleWorkflowWork({
      id: "paused-timer",
      workType: "content_hook_timing",
      subjectKey: "content.item:item-1",
      subscriptionId: "scheduled-controlled-rule",
      payload: {},
      dueAt: 100,
      now: 90,
    });
    await setWorkflowRuntimeControl({
      ...context,
      scope: "resource",
      evaluatorPaused: false,
      effectsPaused: true,
    });
    expect(
      await claimNextScheduledWork({ workerId: "paused", now: 200 }),
    ).toBeNull();
    await setWorkflowRuntimeControl({
      ...context,
      scope: "resource",
      evaluatorPaused: false,
      effectsPaused: false,
    });
    expect(
      await claimNextScheduledWork({ workerId: "resumed", now: 201 }),
    ).toMatchObject({
      id: "paused-timer",
      attempt: 1,
    });
  });
});

describe("durable workflow claim engine", () => {
  it("replaces a pre-portability wake bus during hot reload", () => {
    const globalWakeState = globalThis as typeof globalThis & {
      [key: symbol]: unknown;
    };
    globalWakeState[Symbol.for("@agent-native/core/workflow.wake-bus")] = {
      emitter: {},
    };
    const handler = vi.fn();
    const unsubscribe = subscribeWorkflowWake(handler);

    emitWorkflowWake({
      topic: "workflow.event.available",
      rowId: "hot-reload-event",
    });

    expect(handler).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("produces equivalent execution truth with wake hints disabled or repeated", async () => {
    const executedTopics: string[] = [];
    registerWorkflowExecutionHandler({
      kind: "deterministic",
      domain: "content",
      async execute(claim) {
        executedTopics.push(claim.event.topic);
        return { status: "succeeded" };
      },
    });

    await upsertWorkflowSubscription({
      id: "bus-off-rule",
      kind: "deterministic",
      eventPattern: "content.item.bus-off",
      ownerEmail: "owner@example.com",
      config: { domain: "content" },
    });
    await insertWorkflowEvent({
      id: "bus-off-event",
      topic: "content.item.bus-off",
      subjectType: "content.item",
      subjectId: "bus-off-item",
      ownerEmail: "owner@example.com",
    });
    await processNextWorkflowExecution({ workerId: "bus-off-worker" });

    await upsertWorkflowSubscription({
      id: "wake-storm-rule",
      kind: "deterministic",
      eventPattern: "content.item.wake-storm",
      ownerEmail: "owner@example.com",
      config: { domain: "content" },
    });
    await insertWorkflowEvent({
      id: "wake-storm-event",
      topic: "content.item.wake-storm",
      subjectType: "content.item",
      subjectId: "wake-storm-item",
      ownerEmail: "owner@example.com",
    });
    const wakeHandler = async ({ rowId }: { rowId: string }) => {
      await materializeWorkflowExecutions({ eventId: rowId });
    };
    const unsubscribe = subscribeWorkflowWake(wakeHandler);
    for (let index = 0; index < 8; index += 1) {
      emitWorkflowWake({
        topic: "workflow.event.available",
        rowId: "wake-storm-event",
      });
    }
    await vi.waitFor(() => {
      const count = sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM workflow_executions WHERE subscription_id = ?",
        )
        .get("wake-storm-rule") as { count: number };
      expect(count.count).toBe(1);
    });
    unsubscribe();
    await processNextWorkflowExecution({ workerId: "wake-storm-worker" });

    const normalizedExecution = (subscriptionId: string) =>
      sqlite
        .prepare(
          `SELECT subscription_version, status, attempt, error_message,
            completed_at IS NOT NULL AS completed
           FROM workflow_executions WHERE subscription_id = ?`,
        )
        .get(subscriptionId);
    expect(normalizedExecution("wake-storm-rule")).toEqual(
      normalizedExecution("bus-off-rule"),
    );
    expect(executedTopics).toEqual([
      "content.item.bus-off",
      "content.item.wake-storm",
    ]);
  });

  it("coalesces wake hints while retaining the durable safety sweep", async () => {
    await upsertWorkflowSubscription({
      id: "wake-rule",
      kind: "deterministic",
      eventPattern: "content.item.changed",
      ownerEmail: "owner@example.com",
      config: { domain: "content" },
    });
    let executions = 0;
    registerWorkflowExecutionHandler({
      kind: "deterministic",
      domain: "content",
      async execute() {
        executions += 1;
        return { status: "succeeded" };
      },
    });
    const stop = startWorkflowWakeProcessor({
      workerId: "wake-worker",
      wakeDelayMs: 10,
      pollIntervalMs: 60_000,
    });
    await insertWorkflowEvent({
      id: "wake-event",
      topic: "content.item.changed",
      subjectType: "content.item",
      subjectId: "wake-item",
      ownerEmail: "owner@example.com",
    });
    emitWorkflowWake({
      topic: "workflow.event.available",
      rowId: "wake-event",
    });
    emitWorkflowWake({
      topic: "workflow.event.available",
      rowId: "wake-event",
    });

    await vi.waitFor(() => expect(executions).toBe(1));
    stop();
  });

  it("reads one committed event by its durable id", async () => {
    await insertWorkflowEvent({
      id: "event-readable",
      topic: "content.item.changed",
      subjectType: "content.item",
      subjectId: "item-readable",
      ownerEmail: "owner@example.com",
      payload: { after: "ready" },
      actorContext: { executor: { kind: "agent", model: "example-model" } },
      causalEventId: "event-parent",
      occurredAt: 123,
    });

    await expect(getWorkflowEvent("event-readable")).resolves.toMatchObject({
      id: "event-readable",
      subjectKey: "content.item:item-readable",
      payload: { after: "ready" },
      actorContext: {
        executor: { kind: "agent", model: "example-model" },
      },
      causalEventId: "event-parent",
    });
    await expect(getWorkflowEvent("missing")).resolves.toBeNull();
  });

  it("pins executions to the subscription version active when the event committed", async () => {
    await upsertWorkflowSubscription(
      {
        id: "versioned-rule",
        kind: "deterministic",
        eventPattern: "content.item.changed",
        ownerEmail: "owner@example.com",
        config: { message: "before" },
      },
      { now: 100 },
    );
    await insertWorkflowEvent(
      {
        id: "event-before-edit",
        topic: "content.item.changed",
        subjectType: "content.item",
        subjectId: "item-before",
        ownerEmail: "owner@example.com",
        occurredAt: 150,
      },
      { now: 150 },
    );
    await upsertWorkflowSubscription(
      {
        id: "versioned-rule",
        kind: "deterministic",
        eventPattern: "content.item.changed",
        ownerEmail: "owner@example.com",
        config: { message: "after" },
      },
      { now: 200 },
    );
    await insertWorkflowEvent(
      {
        id: "event-after-edit",
        topic: "content.item.changed",
        subjectType: "content.item",
        subjectId: "item-after",
        ownerEmail: "owner@example.com",
        occurredAt: 250,
      },
      { now: 250 },
    );

    await materializeWorkflowExecutions({ now: 300 });
    const before = await claimNextWorkflowExecution({
      workerId: "worker",
      now: 300,
    });
    expect(before).toMatchObject({
      eventId: "event-before-edit",
      subscriptionVersion: 1,
      subscription: { version: 1, config: { message: "before" } },
    });
    await finalizeWorkflowExecution({
      executionId: before!.id,
      leaseToken: before!.leaseToken,
      fenceVersion: before!.fenceVersion,
      status: "succeeded",
      now: 301,
    });
    const after = await claimNextWorkflowExecution({
      workerId: "worker",
      now: 302,
    });
    expect(after).toMatchObject({
      eventId: "event-after-edit",
      subscriptionVersion: 2,
      subscription: { version: 2, config: { message: "after" } },
    });
  });

  it("does not create a version for an idempotent identical upsert", async () => {
    await upsertWorkflowSubscription(
      {
        id: "idempotent-rule",
        kind: "deterministic",
        eventPattern: "content.item.changed",
        ownerEmail: "owner@example.com",
        config: { nested: { b: 2, a: 1 } },
      },
      { now: 100 },
    );
    const subscription = await upsertWorkflowSubscription(
      {
        id: "idempotent-rule",
        kind: "deterministic",
        eventPattern: "content.item.changed",
        ownerEmail: "owner@example.com",
        config: { nested: { a: 1, b: 2 } },
      },
      { now: 200 },
    );
    const row = sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM workflow_subscription_versions WHERE subscription_id = ?",
      )
      .get("idempotent-rule") as { count: number };
    expect(row.count).toBe(1);
    expect(subscription.version).toBe(1);
    expect(subscription.updatedAt).toBe(100);
  });

  it("preserves pre-disable events while later events see the disabled version", async () => {
    await upsertWorkflowSubscription(
      {
        id: "disable-rule",
        kind: "deterministic",
        eventPattern: "content.item.changed",
        ownerEmail: "owner@example.com",
      },
      { now: 100 },
    );
    await insertWorkflowEvent(
      {
        id: "event-before-disable",
        topic: "content.item.changed",
        subjectType: "content.item",
        subjectId: "item-before-disable",
        ownerEmail: "owner@example.com",
        occurredAt: 150,
      },
      { now: 150 },
    );
    await upsertWorkflowSubscription(
      {
        id: "disable-rule",
        kind: "deterministic",
        eventPattern: "content.item.changed",
        ownerEmail: "owner@example.com",
        enabled: false,
      },
      { now: 200 },
    );
    await insertWorkflowEvent(
      {
        id: "event-after-disable",
        topic: "content.item.changed",
        subjectType: "content.item",
        subjectId: "item-after-disable",
        ownerEmail: "owner@example.com",
        occurredAt: 250,
      },
      { now: 250 },
    );

    await materializeWorkflowExecutions({ now: 300 });
    const executionRows = sqlite
      .prepare(
        "SELECT event_id, subscription_version FROM workflow_executions ORDER BY event_id",
      )
      .all();
    expect(executionRows).toEqual([
      { event_id: "event-before-disable", subscription_version: 1 },
    ]);
    const claim = await claimNextWorkflowExecution({
      workerId: "worker",
      now: 300,
    });
    expect(claim).toMatchObject({
      eventId: "event-before-disable",
      subscriptionVersion: 1,
      subscription: { enabled: true, version: 1 },
    });
  });

  it("uses durable sequence rather than wall-clock time for evaluation start", async () => {
    await insertWorkflowEvent(
      {
        id: "same-ms-before",
        topic: "content.item.same-ms",
        subjectType: "content.item",
        subjectId: "before",
        ownerEmail: "owner@example.com",
        occurredAt: 500,
        availableAt: 500,
      },
      { now: 500 },
    );
    await upsertWorkflowSubscription(
      {
        id: "same-ms-rule",
        kind: "deterministic",
        eventPattern: "content.item.same-ms",
        ownerEmail: "owner@example.com",
        config: { domain: "content", revision: "first" },
      },
      { now: 500 },
    );
    await insertWorkflowEvent(
      {
        id: "same-ms-after-first",
        topic: "content.item.same-ms",
        subjectType: "content.item",
        subjectId: "after-first",
        ownerEmail: "owner@example.com",
        occurredAt: 500,
        availableAt: 500,
      },
      { now: 500 },
    );
    await upsertWorkflowSubscription(
      {
        id: "same-ms-rule",
        kind: "deterministic",
        eventPattern: "content.item.same-ms",
        ownerEmail: "owner@example.com",
        config: { domain: "content", revision: "second" },
      },
      { now: 500 },
    );
    await insertWorkflowEvent(
      {
        id: "same-ms-after-second",
        topic: "content.item.same-ms",
        subjectType: "content.item",
        subjectId: "after-second",
        ownerEmail: "owner@example.com",
        occurredAt: 500,
        availableAt: 500,
      },
      { now: 500 },
    );

    await materializeWorkflowExecutions({ now: 500 });
    expect(
      sqlite
        .prepare(
          `SELECT event_id, subscription_version FROM workflow_executions
           WHERE subscription_id = ? ORDER BY event_id`,
        )
        .all("same-ms-rule"),
    ).toEqual([
      { event_id: "same-ms-after-first", subscription_version: 1 },
      { event_id: "same-ms-after-second", subscription_version: 2 },
    ]);
  });

  it("materializes virtual subscriptions only for events after their durable evaluation boundary", async () => {
    await insertWorkflowEvent({
      id: "virtual-before-registration",
      topic: "content.person.changed",
      subjectType: "content.item",
      subjectId: "before-registration",
      ownerEmail: "owner@example.com",
      occurredAt: 500,
    });
    let virtualVersion = 1;
    let virtualEnabled = true;
    registerVirtualWorkflowSubscriptionProvider({
      id: "content.default-person.v1",
      evaluationStartSequence: 1,
      subscriptionsForEvent(event) {
        if (event.topic !== "content.person.changed") return [];
        return [
          {
            id: "content-default-person:database-1",
            version: virtualVersion,
            kind: "deterministic",
            eventPattern: "content.person.changed",
            ownerEmail: event.ownerEmail,
            orgId: event.orgId,
            enabled: virtualEnabled,
            config: { domain: "content", resourceId: "database-1" },
          },
        ];
      },
    });
    await insertWorkflowEvent({
      id: "virtual-after-registration",
      topic: "content.person.changed",
      subjectType: "content.item",
      subjectId: "after-registration",
      ownerEmail: "owner@example.com",
      occurredAt: 500,
    });

    expect(await materializeWorkflowExecutions({ now: 500 })).toBe(1);
    expect(await materializeWorkflowExecutions({ now: 500 })).toBe(0);
    expect(
      sqlite
        .prepare(
          `SELECT event_id, subscription_id FROM workflow_executions
           ORDER BY event_id`,
        )
        .all(),
    ).toEqual([
      {
        event_id: "virtual-after-registration",
        subscription_id: "content-default-person:database-1",
      },
    ]);

    virtualVersion = 2;
    virtualEnabled = false;
    await insertWorkflowEvent({
      id: "virtual-after-policy-change",
      topic: "content.person.changed",
      subjectType: "content.item",
      subjectId: "after-policy-change",
      ownerEmail: "owner@example.com",
      occurredAt: 501,
    });
    expect(await materializeWorkflowExecutions({ now: 501 })).toBe(0);
    await expect(
      getWorkflowSubscription("content-default-person:database-1"),
    ).resolves.toMatchObject({ version: 2, enabled: false });
  });

  it("deduplicates repeated wakes and enforces per-subject ordering", async () => {
    await seedTwoOrderedEvents();
    const wakeHandler = vi.fn(async ({ rowId }: { rowId: string }) => {
      await materializeWorkflowExecutions({ eventId: rowId, now: 200 });
    });
    const unsubscribe = subscribeWorkflowWake(wakeHandler);
    for (let index = 0; index < 5; index += 1) {
      emitWorkflowWake({ topic: "workflow.event.available", rowId: "event-a" });
    }
    await vi.waitFor(() => expect(wakeHandler).toHaveBeenCalledTimes(5));
    await materializeWorkflowExecutions({ now: 200 });

    const executionCount = sqlite
      .prepare("SELECT COUNT(*) AS count FROM workflow_executions")
      .get() as { count: number };
    expect(executionCount.count).toBe(2);

    const first = await claimNextWorkflowExecution({
      workerId: "worker-a",
      now: 200,
    });
    expect(first?.eventId).toBe("event-a");
    await expect(
      claimNextWorkflowExecution({ workerId: "worker-b", now: 200 }),
    ).resolves.toBeNull();
    await finalizeWorkflowExecution({
      executionId: first!.id,
      leaseToken: first!.leaseToken,
      fenceVersion: first!.fenceVersion,
      status: "succeeded",
      now: 201,
    });
    const second = await claimNextWorkflowExecution({
      workerId: "worker-b",
      now: 202,
    });
    expect(second?.eventId).toBe("event-b");
    unsubscribe();
  });

  it("advances materialization beyond the oldest event window", async () => {
    await upsertWorkflowSubscription({
      id: "large-log-rule",
      kind: "deterministic",
      eventPattern: "content.item.changed",
      ownerEmail: "owner@example.com",
      config: { domain: "content" },
    });
    for (let index = 0; index < 150; index += 1) {
      await insertWorkflowEvent({
        id: `large-event-${index}`,
        topic: "content.item.changed",
        subjectType: "content.item",
        subjectId: `item-${index}`,
        ownerEmail: "owner@example.com",
        occurredAt: 100 + index,
      });
    }

    expect(await materializeWorkflowExecutions({ now: 500 })).toBe(100);
    expect(await materializeWorkflowExecutions({ now: 500 })).toBe(50);
    expect(await materializeWorkflowExecutions({ now: 500 })).toBe(0);
    expect(await listWorkflowExecutions({ limit: 200 })).toHaveLength(150);
  });

  it("uses fencing to reject a stale worker after a lease is reclaimed", async () => {
    await seedTwoOrderedEvents();
    const first = await claimNextWorkflowExecution({
      workerId: "worker-a",
      leaseMs: 1_000,
      now: 200,
    });
    const replay = await claimNextWorkflowExecution({
      workerId: "worker-b",
      leaseMs: 1_000,
      now: 1_201,
    });
    expect(replay?.id).toBe(first?.id);
    expect(replay!.fenceVersion).toBe(first!.fenceVersion + 1);
    await expect(
      finalizeWorkflowExecution({
        executionId: first!.id,
        leaseToken: first!.leaseToken,
        fenceVersion: first!.fenceVersion,
        status: "succeeded",
      }),
    ).resolves.toBe(false);
  });

  it("allows only eligible explicit retry and acknowledgement transitions", async () => {
    await seedTwoOrderedEvents();
    const unknown = await claimNextWorkflowExecution({
      workerId: "operator-test",
      now: 200,
    });
    await finalizeWorkflowExecution({
      executionId: unknown!.id,
      leaseToken: unknown!.leaseToken,
      fenceVersion: unknown!.fenceVersion,
      status: "unknown",
      now: 201,
    });
    await expect(
      acknowledgeWorkflowExecution({ executionId: unknown!.id, now: 202 }),
    ).resolves.toBe(true);
    await expect(
      acknowledgeWorkflowExecution({ executionId: unknown!.id, now: 203 }),
    ).resolves.toBe(false);
    await expect(
      retryWorkflowExecution({ executionId: unknown!.id, now: 204 }),
    ).resolves.toBe(false);
    await expect(getWorkflowExecution(unknown!.id)).resolves.toMatchObject({
      status: "acknowledged",
      attempt: 1,
    });

    const failed = await claimNextWorkflowExecution({
      workerId: "operator-test",
      now: 205,
    });
    await finalizeWorkflowExecution({
      executionId: failed!.id,
      leaseToken: failed!.leaseToken,
      fenceVersion: failed!.fenceVersion,
      status: "failed",
      now: 206,
    });
    await expect(
      retryWorkflowExecution({ executionId: failed!.id, now: 207 }),
    ).resolves.toBe(true);
    await expect(
      retryWorkflowExecution({ executionId: failed!.id, now: 208 }),
    ).resolves.toBe(false);
    const replay = await claimNextWorkflowExecution({
      workerId: "operator-test",
      now: 209,
    });
    expect(replay).toMatchObject({ id: failed!.id, attempt: 2 });
  });

  it("reuses a delivered effect during crash replay", async () => {
    await seedTwoOrderedEvents();
    const first = await claimNextWorkflowExecution({
      workerId: "worker-a",
      leaseMs: 1_000,
      now: 200,
    });
    const reserved = await recordWorkflowEffect({
      executionId: first!.id,
      kind: "notification",
      idempotencyKey: `${first!.eventId}:${first!.subscriptionId}:notification`,
    });
    await finalizeWorkflowEffect({
      effectId: reserved.effect.id,
      status: "delivered",
      result: { notificationId: "notification-1" },
    });

    const replay = await claimNextWorkflowExecution({
      workerId: "worker-b",
      leaseMs: 1_000,
      now: 1_201,
    });
    const duplicate = await recordWorkflowEffect({
      executionId: replay!.id,
      kind: "notification",
      idempotencyKey: `${replay!.eventId}:${replay!.subscriptionId}:notification`,
    });
    expect(duplicate.created).toBe(false);
    expect(duplicate.effect.status).toBe("delivered");
  });

  it("allows only one worker to claim a known-failed effect retry", async () => {
    await seedTwoOrderedEvents();
    const execution = await claimNextWorkflowExecution({
      workerId: "worker-a",
      now: 200,
    });
    const { effect } = await recordWorkflowEffect({
      executionId: execution!.id,
      kind: "webhook",
      idempotencyKey: "failed-effect-retry",
    });
    await finalizeWorkflowEffect({
      effectId: effect.id,
      status: "failed",
      errorMessage: "provider rejected the request",
      now: 201,
    });

    const claims = await Promise.all([
      claimWorkflowEffectRetry({ effectId: effect.id, now: 202 }),
      claimWorkflowEffectRetry({ effectId: effect.id, now: 202 }),
    ]);

    expect(claims.sort()).toEqual([false, true]);
    await expect(
      getWorkflowEffectByIdempotencyKey("failed-effect-retry"),
    ).resolves.toMatchObject({
      status: "unknown",
      errorMessage: null,
      result: null,
    });
  });
});

describe("scheduled work and delivery truth", () => {
  it("supersedes debounce work in one timer store and can cancel it", async () => {
    const first = await scheduleWorkflowWork({
      workType: "debounce",
      subjectKey: "content.item:item-1",
      dedupeKey: "rule-1:item-1",
      dueAt: 1_000,
    });
    const second = await scheduleWorkflowWork({
      workType: "debounce",
      subjectKey: "content.item:item-1",
      dedupeKey: "rule-1:item-1",
      dueAt: 2_000,
    });
    expect(second).toBe(first);
    await expect(cancelWorkflowWork(first)).resolves.toBe(true);
    await expect(
      claimNextScheduledWork({ workerId: "timer", now: 3_000 }),
    ).resolves.toBeNull();
  });

  it("does not reclaim a failed execution until its retry timer is due", async () => {
    await seedTwoOrderedEvents();
    registerWorkflowExecutionHandler({
      kind: "deterministic",
      domain: "content",
      execute: async () => {
        throw new Error("temporary failure");
      },
    });

    const first = await processNextWorkflowWork({
      workerId: "worker",
      now: 200,
      retryPolicy: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000 },
    });
    expect(first?.kind).toBe("execution");
    expect(await getWorkflowExecution(first!.claim.id)).toMatchObject({
      status: "retrying",
      attempt: 1,
    });
    await expect(
      processNextWorkflowWork({ workerId: "worker", now: 299 }),
    ).resolves.toBeNull();

    const timer = await processNextWorkflowWork({
      workerId: "worker",
      now: 300,
    });
    expect(timer).toMatchObject({ kind: "scheduled" });
    expect(await getWorkflowExecution(first!.claim.id)).toMatchObject({
      status: "pending",
      attempt: 1,
    });
  });

  it("survives a crash between scheduling a retry and releasing the execution lease", async () => {
    await seedTwoOrderedEvents();
    const claim = await claimNextWorkflowExecution({
      workerId: "crashing-worker",
      leaseMs: 1_000,
      now: 200,
    });
    await scheduleWorkflowWork({
      workType: "execution_retry",
      subjectKey: claim!.event.subjectKey,
      eventId: claim!.eventId,
      subscriptionId: claim!.subscriptionId,
      payload: { executionId: claim!.id, expectedAttempt: claim!.attempt },
      dedupeKey: `execution_retry:${claim!.id}`,
      dueAt: 300,
      now: 200,
    });

    await processNextWorkflowWork({ workerId: "timer", now: 300 });
    expect(
      sqlite
        .prepare(
          "SELECT status, due_at FROM workflow_scheduled_work WHERE dedupe_key = ?",
        )
        .get(`execution_retry:${claim!.id}`),
    ).toMatchObject({ status: "pending", due_at: 1_200 });
    await processNextWorkflowWork({ workerId: "timer", now: 1_200 });
    expect(await getWorkflowExecution(claim!.id)).toMatchObject({
      status: "pending",
      attempt: 1,
    });
  });

  it("dead-letters exhausted retries and unblocks the next subject event", async () => {
    await seedTwoOrderedEvents();
    registerWorkflowExecutionHandler({
      kind: "deterministic",
      domain: "content",
      execute: async () => {
        throw new Error("permanent failure");
      },
    });
    const policy = { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 1_000 };
    const first = await processNextWorkflowWork({
      workerId: "worker",
      now: 200,
      retryPolicy: policy,
    });
    await processNextWorkflowWork({ workerId: "worker", now: 300 });
    await processNextWorkflowWork({
      workerId: "worker",
      now: 300,
      retryPolicy: policy,
    });
    expect(await getWorkflowExecution(first!.claim.id)).toMatchObject({
      status: "failed",
      attempt: 2,
      errorMessage: "permanent failure",
    });

    const successor = await claimNextWorkflowExecution({
      workerId: "successor",
      now: 301,
    });
    expect(successor?.eventId).toBe("event-b");
  });

  it("dispatches debounce and escalation work through the shared processor", async () => {
    const handled: string[] = [];
    registerScheduledWorkflowHandler({
      workType: "debounce",
      execute: async (claim) => {
        handled.push(claim.id);
      },
    });
    const id = await scheduleWorkflowWork({
      workType: "debounce",
      subjectKey: "content.item:item-1",
      dedupeKey: "debounce:item-1",
      dueAt: 1_000,
      now: 100,
    });
    await scheduleWorkflowWork({
      workType: "debounce",
      subjectKey: "content.item:item-1",
      dedupeKey: "debounce:item-1",
      dueAt: 2_000,
      now: 200,
    });
    await expect(
      processNextWorkflowWork({ workerId: "timer", now: 1_500 }),
    ).resolves.toBeNull();
    await processNextWorkflowWork({ workerId: "timer", now: 2_000 });
    expect(handled).toEqual([id]);
  });

  it("retries scheduled handlers with backoff before dead-lettering", async () => {
    registerScheduledWorkflowHandler({
      workType: "escalation",
      execute: async () => {
        throw new Error("destination unavailable");
      },
    });
    const id = await scheduleWorkflowWork({
      workType: "escalation",
      subjectKey: "content.item:item-1",
      dueAt: 100,
      now: 0,
    });
    const policy = { maxAttempts: 2, baseDelayMs: 50, maxDelayMs: 500 };
    await processNextWorkflowWork({
      workerId: "timer",
      now: 100,
      retryPolicy: policy,
    });
    expect(
      sqlite
        .prepare(
          "SELECT status, due_at FROM workflow_scheduled_work WHERE id = ?",
        )
        .get(id),
    ).toMatchObject({ status: "pending", due_at: 150 });
    await processNextWorkflowWork({
      workerId: "timer",
      now: 150,
      retryPolicy: policy,
    });
    expect(
      sqlite
        .prepare(
          "SELECT status, error_message FROM workflow_scheduled_work WHERE id = ?",
        )
        .get(id),
    ).toMatchObject({
      status: "dead_letter",
      error_message: "destination unavailable",
    });
  });

  it("records explicit unknown, retrying, and skipped delivery attempts", async () => {
    await seedTwoOrderedEvents();
    const claim = await claimNextWorkflowExecution({
      workerId: "worker",
      now: 200,
    });
    const { effect } = await recordWorkflowEffect({
      executionId: claim!.id,
      kind: "notification",
      idempotencyKey: "delivery-ledger-test",
    });
    await recordNotificationDeliveryAttempt({
      effectId: effect.id,
      channel: "slack",
      attempt: 1,
      status: "unknown",
    });
    await recordNotificationDeliveryAttempt({
      effectId: effect.id,
      channel: "slack",
      attempt: 1,
      status: "retrying",
    });
    await recordNotificationDeliveryAttempt({
      effectId: effect.id,
      channel: "email",
      attempt: 1,
      status: "skipped",
      errorMessage: "No recipient configured",
    });
    const row = sqlite
      .prepare(
        "SELECT status FROM notification_delivery_attempts WHERE effect_id = ? AND channel = 'slack'",
      )
      .get(effect.id) as { status: string };
    expect(row.status).toBe("retrying");
    expect(
      sqlite
        .prepare(
          "SELECT status, error_message FROM notification_delivery_attempts WHERE effect_id = ? AND channel = 'email'",
        )
        .get(effect.id),
    ).toMatchObject({
      status: "skipped",
      error_message: "No recipient configured",
    });
    expect(
      await getWorkflowEffectByIdempotencyKey("delivery-ledger-test"),
    ).toMatchObject({
      status: "unknown",
    });
  });
});
