import { beforeEach, afterEach, describe, expect, it } from "vitest";

import {
  WORKFLOW_STORE_LIMITS,
  WorkflowStoreError,
  type StoreClock,
  type WorkflowRecord,
  type WorkflowScope,
  type WorkflowStore,
  type WorkflowStoreErrorCode,
} from "../adapter.js";
import {
  WorkflowError,
  receiptKey,
  workflowGraphSchema,
  type ItemEvent,
  type Receipt,
  type StepRecord,
  type WorkflowGraph,
  type WorkflowGraphInput,
} from "../contract.js";

interface ConformanceHarness {
  store: WorkflowStore;
  close?: () => Promise<void>;
}

/** A clock a test can move. Stores use it for `createdAt` and `updatedAt`. */
interface ConformanceClock extends StoreClock {
  advance(ms: number): void;
}

type MakeStore = (
  clock: ConformanceClock,
) => Promise<ConformanceHarness> | ConformanceHarness;

const SCOPE: WorkflowScope = { orgId: "org-1", factoryId: "factory-1" };
const OTHER_FACTORY: WorkflowScope = { orgId: "org-1", factoryId: "factory-2" };
const OTHER_ORG: WorkflowScope = { orgId: "org-2", factoryId: "factory-1" };
const OWNER = "owner@example.test";
const T0 = Date.parse("2026-10-18T10:00:00.000Z");

function at(minutes: number, seconds = 0): string {
  return new Date(T0 + minutes * 60_000 + seconds * 1000).toISOString();
}

function makeClock(): ConformanceClock {
  let now = T0;
  const clock = (() => new Date(now)) as ConformanceClock;
  clock.advance = (ms) => {
    now += ms;
  };
  return clock;
}

function graphInput(revision = 1): WorkflowGraphInput {
  return {
    nodes: [
      {
        id: "trigger",
        kind: "trigger",
        name: "Every15",
        position: { x: 0, y: 0 },
        settings: { schedule: { every: "15m" } },
      },
      {
        id: "finish",
        kind: "end",
        name: "Done",
        position: { x: 200, y: 0 },
        settings: { outcome: "done" },
      },
    ],
    edges: [
      {
        id: "edge-1",
        from: { node: "trigger", port: "out" },
        to: { node: "finish" },
      },
    ],
    settings: { extras: { revision } },
  };
}

function graph(revision = 1): WorkflowGraph {
  return workflowGraphSchema.parse(graphInput(revision));
}

function oversizedGraph(): WorkflowGraph {
  const nodes = Array.from({ length: 30 }, (_, index) => ({
    id: `ai-${index}`,
    kind: "ai" as const,
    name: `Assess${index}`,
    position: { x: index, y: 0 },
    settings: {
      instruction: "x".repeat(10_000),
      result: { risk: { type: "string" as const } },
      mode: "perItem" as const,
    },
  }));
  return workflowGraphSchema.parse({
    nodes,
    edges: [],
    settings: {},
  });
}

function step(overrides: Partial<StepRecord> = {}): StepRecord {
  return {
    runId: "run-1",
    nodeId: "assess",
    status: "succeeded",
    mode: "live",
    startedAt: at(0),
    finishedAt: at(1),
    ports: { out: { count: 2, itemIds: ["item-1", "item-2"] } },
    ...overrides,
  };
}

function event(
  workflowId: string,
  overrides: Partial<ItemEvent> = {},
): ItemEvent {
  return {
    workflowId,
    runId: "run-1",
    itemId: "item-1",
    kind: "taken",
    at: at(0),
    mode: "live",
    summary: "took the item",
    ...overrides,
  };
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected the call to fail, but it resolved");
    },
    (error: unknown) => error,
  );
}

async function expectStoreError(
  promise: Promise<unknown>,
  code: WorkflowStoreErrorCode,
): Promise<WorkflowStoreError> {
  const error = await failureOf(promise);
  expect(error).toBeInstanceOf(WorkflowStoreError);
  expect((error as WorkflowStoreError).code).toBe(code);
  return error as WorkflowStoreError;
}

async function expectOverCap(promise: Promise<unknown>): Promise<void> {
  const error = await failureOf(promise);
  expect(error).toBeInstanceOf(WorkflowError);
  expect((error as WorkflowError).code).toBe("output_over_cap");
}

/**
 * The behavior every `WorkflowStore` must have. The engine is written against
 * the interface, so a store that passes this is interchangeable with any other.
 */
export function runStoreConformance(name: string, makeStore: MakeStore): void {
  describe(`${name} conforms to WorkflowStore`, () => {
    let clock: ConformanceClock;
    let harness: ConformanceHarness;
    let store: WorkflowStore;

    beforeEach(async () => {
      clock = makeClock();
      harness = await makeStore(clock);
      store = harness.store;
    });

    afterEach(async () => {
      await harness.close?.();
    });

    async function createWorkflow(
      overrides: Partial<Parameters<WorkflowStore["createWorkflow"]>[1]> = {},
      scope: WorkflowScope = SCOPE,
    ): Promise<WorkflowRecord> {
      return store.createWorkflow(scope, {
        name: "Bug report to Builder",
        graph: graph(),
        ownerEmail: OWNER,
        ...overrides,
      });
    }

    async function startedRun(workflowId: string, tickKey = "tick-1") {
      const { run } = await store.startRun(SCOPE, {
        workflowId,
        tickKey,
        mode: "live",
        triggerKind: "manual",
        startedBy: OWNER,
        graphVersion: 1,
        startedAt: at(0),
      });
      return run;
    }

    describe("workflows", () => {
      it("creates version 1 disabled and returns the graph it was given", async () => {
        const created = await createWorkflow({ automationId: "factory-bugs" });

        expect(created).toMatchObject({
          automationId: "factory-bugs",
          name: "Bug report to Builder",
          version: 1,
          enabled: false,
          lastCleanDryRunVersion: null,
          lastTriggerAt: null,
          ownerEmail: OWNER,
        });
        expect(created.graph).toEqual(graph());
        expect(await store.getWorkflow(SCOPE, created.id)).toEqual(created);
        expect(
          await store.getWorkflowByAutomation(SCOPE, "factory-bugs"),
        ).toEqual(created);
      });

      it("rejects a taken id or automation, and allows the same automation in another factory", async () => {
        const first = await createWorkflow({
          id: "wf-1",
          automationId: "factory-bugs",
        });
        await expectStoreError(
          createWorkflow({ id: first.id }),
          "already_exists",
        );
        await expectStoreError(
          createWorkflow({ id: "wf-2", automationId: "factory-bugs" }),
          "already_exists",
        );
        const elsewhere = await createWorkflow(
          { id: "wf-3", automationId: "factory-bugs" },
          OTHER_FACTORY,
        );
        expect(elsewhere.automationId).toBe("factory-bugs");
      });

      it("lets exactly one of two concurrent creates of one id win", async () => {
        const results = await Promise.allSettled([
          createWorkflow({ id: "wf-race" }),
          createWorkflow({ id: "wf-race" }),
        ]);

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const rejected = results.find((r) => r.status === "rejected");
        expect((rejected as PromiseRejectedResult).reason).toMatchObject({
          code: "already_exists",
        });
      });

      it("rejects a malformed or over-cap graph instead of storing part of it", async () => {
        const huge = await failureOf(
          createWorkflow({ graph: oversizedGraph() }),
        );
        expect(huge).toBeInstanceOf(WorkflowStoreError);
        expect((huge as WorkflowStoreError).code).toBe("invalid_record");
        expect((huge as WorkflowStoreError).details).toMatchObject({
          maxBytes: WORKFLOW_STORE_LIMITS.graphJsonBytes,
        });

        await expectStoreError(
          createWorkflow({
            graph: { nodes: "nope" } as unknown as WorkflowGraph,
          }),
          "invalid_record",
        );
        expect((await store.listWorkflows(SCOPE)).items).toEqual([]);
      });

      it("saves a new version only against the current one", async () => {
        const created = await createWorkflow();
        const saved = await store.saveWorkflowGraph(SCOPE, {
          workflowId: created.id,
          expectedVersion: 1,
          graph: graph(2),
          source: "save",
          summary: "second revision",
          createdBy: OWNER,
        });
        expect(saved.version).toBe(2);
        expect(saved.graph).toEqual(graph(2));

        const stale = await expectStoreError(
          store.saveWorkflowGraph(SCOPE, {
            workflowId: created.id,
            expectedVersion: 1,
            graph: graph(3),
            source: "save",
            summary: "from a stale tab",
            createdBy: OWNER,
          }),
          "stale_version",
        );
        expect(stale.details).toMatchObject({
          expectedVersion: 1,
          currentVersion: 2,
        });
        await expectStoreError(
          store.saveWorkflowGraph(SCOPE, {
            workflowId: created.id,
            expectedVersion: 9,
            graph: graph(4),
            source: "save",
            summary: "from the future",
            createdBy: OWNER,
          }),
          "stale_version",
        );

        const current = await store.getWorkflow(SCOPE, created.id);
        expect(current?.version).toBe(2);
        expect(current?.graph).toEqual(graph(2));
      });

      it("lets exactly one of two concurrent saves of one version win", async () => {
        const created = await createWorkflow();
        const save = (revision: number) =>
          store.saveWorkflowGraph(SCOPE, {
            workflowId: created.id,
            expectedVersion: 1,
            graph: graph(revision),
            source: "agent",
            summary: `revision ${revision}`,
            createdBy: OWNER,
          });

        const results = await Promise.allSettled([save(2), save(3)]);

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const rejected = results.find((r) => r.status === "rejected");
        expect((rejected as PromiseRejectedResult).reason).toMatchObject({
          code: "stale_version",
        });
        const versions = await store.listWorkflowVersions(SCOPE, created.id);
        expect(versions.items.map((v) => v.version)).toEqual([2, 1]);
      });

      it("keeps every version and returns them newest first without graphs", async () => {
        const created = await createWorkflow();
        await store.saveWorkflowGraph(SCOPE, {
          workflowId: created.id,
          expectedVersion: 1,
          graph: graph(2),
          source: "restore",
          summary: "restored",
          createdBy: "agent@example.test",
        });

        expect(
          (await store.getWorkflowVersion(SCOPE, created.id, 1))?.graph,
        ).toEqual(graph(1));
        expect(await store.getWorkflowVersion(SCOPE, created.id, 3)).toBeNull();
        const page = await store.listWorkflowVersions(SCOPE, created.id);
        expect(page.hasMore).toBe(false);
        expect(page.items).toEqual([
          expect.objectContaining({
            version: 2,
            source: "restore",
            summary: "restored",
            createdBy: "agent@example.test",
          }),
          expect.objectContaining({ version: 1, source: "save" }),
        ]);
        expect(page.items[0]).not.toHaveProperty("graph");
        expect(
          (await store.listWorkflowVersions(SCOPE, created.id, { limit: 1 }))
            .hasMore,
        ).toBe(true);
      });

      it("enables only a version that had a clean dry run", async () => {
        const created = await createWorkflow();
        const refused = await expectStoreError(
          store.setWorkflowEnabled(SCOPE, created.id, true),
          "dry_run_required",
        );
        expect(refused.details).toMatchObject({ currentVersion: 1 });

        await expectStoreError(
          store.recordCleanDryRun(SCOPE, {
            workflowId: created.id,
            version: 2,
          }),
          "stale_version",
        );
        await store.recordCleanDryRun(SCOPE, {
          workflowId: created.id,
          version: 1,
        });
        expect(
          (await store.setWorkflowEnabled(SCOPE, created.id, true)).enabled,
        ).toBe(true);

        await store.saveWorkflowGraph(SCOPE, {
          workflowId: created.id,
          expectedVersion: 1,
          graph: graph(2),
          source: "save",
          summary: "edit",
          createdBy: OWNER,
        });
        // The new version has had no dry run, so the save switches the workflow
        // off in the same write: no tick may find it on.
        const afterSave = await store.getWorkflow(SCOPE, created.id);
        expect(afterSave).toMatchObject({
          version: 2,
          enabled: false,
          lastCleanDryRunVersion: 1,
        });

        await expectStoreError(
          store.setWorkflowEnabled(SCOPE, created.id, true),
          "dry_run_required",
        );
      });

      it("keeps the latest trigger instant when told out of order", async () => {
        const created = await createWorkflow();
        await store.recordTriggerRun(SCOPE, {
          workflowId: created.id,
          at: at(30),
        });
        await store.recordTriggerRun(SCOPE, {
          workflowId: created.id,
          at: at(15),
        });
        expect(
          (await store.getWorkflow(SCOPE, created.id))?.lastTriggerAt,
        ).toBe(at(30));
      });

      it("lists workflows newest first and says when the list was cut", async () => {
        const first = await createWorkflow({ id: "wf-a", name: "A" });
        clock.advance(1000);
        const second = await createWorkflow({ id: "wf-b", name: "B" });

        const all = await store.listWorkflows(SCOPE);
        expect(all.items.map((w) => w.id)).toEqual([second.id, first.id]);
        expect(all.hasMore).toBe(false);
        expect(all.items[0]).not.toHaveProperty("graph");

        const cut = await store.listWorkflows(SCOPE, { limit: 1 });
        expect(cut.items.map((w) => w.id)).toEqual([second.id]);
        expect(cut.hasMore).toBe(true);
        await expectStoreError(
          store.listWorkflows(SCOPE, {
            limit: WORKFLOW_STORE_LIMITS.workflowsPageMax + 1,
          }),
          "invalid_record",
        );
      });

      it("deletes the workflow and everything under it, only in its own scope", async () => {
        const created = await createWorkflow();
        const run = await startedRun(created.id);
        await store.putStep(SCOPE, step({ runId: run.id }));
        await store.leaseItems(SCOPE, {
          workflowId: created.id,
          graphVersion: 1,
          itemIds: ["item-1"],
          leasedBy: "tick-1",
          now: at(0),
        });
        await store.appendItemEvent(SCOPE, event(created.id));
        const key = receiptKey({
          workflowId: created.id,
          itemId: "item-1",
          nodeId: "post",
          attempt: 1,
        });
        await store.putReceipt(SCOPE, created.id, {
          key,
          status: "started",
          at: at(0),
        });
        await store.setSourceCursor(SCOPE, {
          workflowId: created.id,
          nodeId: "intake",
          value: "cursor-1",
          ownerEmail: OWNER,
        });

        expect(await store.deleteWorkflow(OTHER_FACTORY, created.id)).toBe(
          false,
        );
        expect(await store.getWorkflow(SCOPE, created.id)).not.toBeNull();

        expect(await store.deleteWorkflow(SCOPE, created.id)).toBe(true);
        expect(await store.deleteWorkflow(SCOPE, created.id)).toBe(false);
        expect(await store.getWorkflow(SCOPE, created.id)).toBeNull();
        expect(await store.getRun(SCOPE, run.id)).toBeNull();
        expect(
          await store.getItemState(SCOPE, created.id, "item-1"),
        ).toBeNull();
        expect(await store.getReceipt(SCOPE, key)).toBeNull();
        expect(
          await store.getSourceCursor(SCOPE, {
            workflowId: created.id,
            nodeId: "intake",
          }),
        ).toBeNull();
        await expectStoreError(
          store.listRuns(SCOPE, { workflowId: created.id }),
          "not_found",
        );
      });
    });

    describe("runs", () => {
      it("starts one run for two concurrent calls with the same tick key", async () => {
        const created = await createWorkflow();
        const start = () =>
          store.startRun(SCOPE, {
            workflowId: created.id,
            tickKey: "2026-10-18T10:00:00.000Z",
            mode: "live",
            triggerKind: "manual",
            startedBy: OWNER,
            graphVersion: 1,
            startedAt: at(0),
          });

        const results = await Promise.all([start(), start(), start()]);

        expect(results.filter((r) => r.created)).toHaveLength(1);
        expect(new Set(results.map((r) => r.run.id)).size).toBe(1);
        expect(results[0].run).toMatchObject({
          status: "running",
          tickKey: "2026-10-18T10:00:00.000Z",
          mode: "live",
          triggerKind: "manual",
          startedBy: OWNER,
          graphVersion: 1,
          counts: {},
        });
        const page = await store.listRuns(SCOPE, { workflowId: created.id });
        expect(page.items).toHaveLength(1);
      });

      it("records what started a run and who, and reads both back", async () => {
        const created = await createWorkflow();
        const starts = [
          ["schedule", "live", "schedule"],
          ["manual", "live", OWNER],
          ["dry_run", "dry", OWNER],
          ["test", "test", OWNER],
        ] as const;
        for (const [triggerKind, mode, startedBy] of starts) {
          const { run } = await store.startRun(SCOPE, {
            workflowId: created.id,
            tickKey: `key-${triggerKind}`,
            mode,
            triggerKind,
            startedBy,
            graphVersion: 1,
          });
          expect(run).toMatchObject({ mode, triggerKind, startedBy });
          expect((await store.getRun(SCOPE, run.id))?.run).toMatchObject({
            triggerKind,
            startedBy,
          });
        }
        const listed = await store.listRuns(SCOPE, { workflowId: created.id });
        expect(
          listed.items.map((run) => [run.triggerKind, run.startedBy]).sort(),
        ).toEqual([
          ["dry_run", OWNER],
          ["manual", OWNER],
          ["schedule", "schedule"],
          ["test", OWNER],
        ]);
      });

      it("refuses a start whose trigger kind does not fit its mode or whose starter does not fit its trigger kind", async () => {
        const created = await createWorkflow();
        const bad = [
          { mode: "live", triggerKind: "dry_run", startedBy: OWNER },
          { mode: "dry", triggerKind: "manual", startedBy: OWNER },
          { mode: "test", triggerKind: "schedule", startedBy: "schedule" },
          { mode: "live", triggerKind: "schedule", startedBy: OWNER },
          { mode: "live", triggerKind: "manual", startedBy: "schedule" },
          { mode: "live", triggerKind: "manual", startedBy: "" },
          { mode: "live", triggerKind: "sometimes", startedBy: OWNER },
        ] as const;
        for (const [index, input] of bad.entries()) {
          await expectStoreError(
            store.startRun(SCOPE, {
              workflowId: created.id,
              tickKey: `bad-${index}`,
              graphVersion: 1,
              ...(input as unknown as {
                mode: "live";
                triggerKind: "manual";
                startedBy: string;
              }),
            }),
            "invalid_record",
          );
        }
        expect(
          (await store.listRuns(SCOPE, { workflowId: created.id })).items,
        ).toEqual([]);
      });

      it("returns the run that holds a key even after it finished", async () => {
        const created = await createWorkflow();
        const first = await startedRun(created.id, "tick-a");
        await store.finishRun(SCOPE, { runId: first.id, status: "succeeded" });

        const again = await store.startRun(SCOPE, {
          workflowId: created.id,
          tickKey: "tick-a",
          mode: "live",
          triggerKind: "manual",
          startedBy: OWNER,
          graphVersion: 1,
        });

        expect(again.created).toBe(false);
        expect(again.run).toMatchObject({ id: first.id, status: "succeeded" });
        expect((await startedRun(created.id, "tick-b")).id).not.toBe(first.id);
      });

      it("keeps tick keys separate per workflow", async () => {
        const a = await createWorkflow({ id: "wf-a" });
        const b = await createWorkflow({ id: "wf-b" });
        const first = await store.startRun(SCOPE, {
          workflowId: a.id,
          tickKey: "tick",
          mode: "live",
          triggerKind: "manual",
          startedBy: OWNER,
          graphVersion: 1,
        });
        const second = await store.startRun(SCOPE, {
          workflowId: b.id,
          tickKey: "tick",
          mode: "live",
          triggerKind: "manual",
          startedBy: OWNER,
          graphVersion: 1,
        });
        expect(first.created && second.created).toBe(true);
      });

      it("refuses a run for a workflow or version that does not exist", async () => {
        const created = await createWorkflow();
        await expectStoreError(
          store.startRun(SCOPE, {
            workflowId: "missing",
            tickKey: "tick",
            mode: "live",
            triggerKind: "manual",
            startedBy: OWNER,
            graphVersion: 1,
          }),
          "not_found",
        );
        await expectStoreError(
          store.startRun(OTHER_FACTORY, {
            workflowId: created.id,
            tickKey: "tick",
            mode: "live",
            triggerKind: "manual",
            startedBy: OWNER,
            graphVersion: 1,
          }),
          "not_found",
        );
        await expectStoreError(
          store.startRun(SCOPE, {
            workflowId: created.id,
            tickKey: "tick",
            mode: "live",
            triggerKind: "manual",
            startedBy: OWNER,
            graphVersion: 7,
          }),
          "invalid_record",
        );
      });

      it("finishes a run once, and a failure always says why", async () => {
        const created = await createWorkflow();
        const run = await startedRun(created.id);

        await expectStoreError(
          store.finishRun(SCOPE, { runId: run.id, status: "failed" }),
          "invalid_record",
        );
        await expectStoreError(
          store.finishRun(SCOPE, {
            runId: run.id,
            status: "succeeded",
            error: { code: "provider_error", message: "boom" },
          }),
          "invalid_record",
        );
        expect((await store.getRun(SCOPE, run.id))?.run.status).toBe("running");

        const finished = await store.finishRun(SCOPE, {
          runId: run.id,
          status: "paused",
          counts: { taken: 3, parked: 1 },
          error: { code: "budget_paused", message: "soft timeout reached" },
          finishedAt: at(14),
        });
        expect(finished).toMatchObject({
          status: "paused",
          counts: { taken: 3, parked: 1 },
          error: { code: "budget_paused", message: "soft timeout reached" },
          finishedAt: at(14),
        });

        await expectStoreError(
          store.finishRun(SCOPE, { runId: run.id, status: "succeeded" }),
          "invalid_transition",
        );
        expect((await store.getRun(SCOPE, run.id))?.run.status).toBe("paused");
        await expectStoreError(
          store.finishRun(SCOPE, { runId: "missing", status: "succeeded" }),
          "not_found",
        );
        await expectStoreError(
          store.finishRun(OTHER_FACTORY, {
            runId: run.id,
            status: "succeeded",
          }),
          "not_found",
        );
      });

      it("lists runs newest first, filters them, and tells an empty workflow from a missing one", async () => {
        const created = await createWorkflow();
        expect(await store.listRuns(SCOPE, { workflowId: created.id })).toEqual(
          {
            items: [],
            hasMore: false,
          },
        );
        await expectStoreError(
          store.listRuns(SCOPE, { workflowId: "missing" }),
          "not_found",
        );

        const live = await store.startRun(SCOPE, {
          workflowId: created.id,
          tickKey: "live-1",
          mode: "live",
          triggerKind: "manual",
          startedBy: OWNER,
          graphVersion: 1,
          startedAt: at(0),
        });
        const dry = await store.startRun(SCOPE, {
          workflowId: created.id,
          tickKey: "dry-1",
          mode: "dry",
          triggerKind: "dry_run",
          startedBy: OWNER,
          graphVersion: 1,
          startedAt: at(5),
        });
        await store.finishRun(SCOPE, {
          runId: live.run.id,
          status: "succeeded",
        });
        const newest = await store.startRun(SCOPE, {
          workflowId: created.id,
          tickKey: "live-2",
          mode: "live",
          triggerKind: "manual",
          startedBy: OWNER,
          graphVersion: 1,
          startedAt: at(10),
        });

        const all = await store.listRuns(SCOPE, { workflowId: created.id });
        expect(all.items.map((r) => r.id)).toEqual([
          newest.run.id,
          dry.run.id,
          live.run.id,
        ]);
        expect(
          (
            await store.listRuns(SCOPE, {
              workflowId: created.id,
              mode: "dry",
            })
          ).items.map((r) => r.id),
        ).toEqual([dry.run.id]);
        expect(
          (
            await store.listRuns(SCOPE, {
              workflowId: created.id,
              status: "succeeded",
            })
          ).items.map((r) => r.id),
        ).toEqual([live.run.id]);
        const cut = await store.listRuns(SCOPE, {
          workflowId: created.id,
          limit: 2,
        });
        expect(cut.items).toHaveLength(2);
        expect(cut.hasMore).toBe(true);
        await expectStoreError(
          store.listRuns(SCOPE, {
            workflowId: created.id,
            limit: WORKFLOW_STORE_LIMITS.runsPageMax + 1,
          }),
          "invalid_record",
        );
      });
    });

    describe("steps", () => {
      it("records a step per node, replaces it on update, and returns them with the run", async () => {
        const created = await createWorkflow();
        const run = await startedRun(created.id);
        await store.putStep(
          SCOPE,
          step({
            runId: run.id,
            nodeId: "assess",
            status: "running",
            finishedAt: undefined,
            ports: {},
          }),
        );
        await store.putStep(
          SCOPE,
          step({
            runId: run.id,
            nodeId: "post",
            startedAt: at(2),
            finishedAt: at(3),
            receiptKeys: ["receipt-1"],
            agentThreadId: "thread-1",
            fields: { sent: 2 },
            truncated: { totalAvailable: 140 },
            inputTruncated: true,
          }),
        );
        const finished = step({
          runId: run.id,
          nodeId: "assess",
          startedAt: at(0),
          finishedAt: at(1),
          fields: { risk: "low" },
        });
        await store.putStep(SCOPE, finished);

        const loaded = await store.getRun(SCOPE, run.id);
        expect(loaded?.steps).toHaveLength(2);
        expect(loaded?.steps[0]).toEqual(finished);
        expect(loaded?.steps[1]).toMatchObject({
          nodeId: "post",
          receiptKeys: ["receipt-1"],
          agentThreadId: "thread-1",
          truncated: { totalAvailable: 140 },
          inputTruncated: true,
        });
      });

      it("stores a failed step with its typed error", async () => {
        const created = await createWorkflow();
        const run = await startedRun(created.id);
        const failed = step({
          runId: run.id,
          status: "failed",
          error: { code: "lookup_failed", message: "thread not found" },
        });
        await store.putStep(SCOPE, failed);
        expect((await store.getRun(SCOPE, run.id))?.steps).toEqual([failed]);
      });

      it("rejects output over the step caps and leaves the stored step alone", async () => {
        const created = await createWorkflow();
        const run = await startedRun(created.id);
        const original = step({ runId: run.id });
        await store.putStep(SCOPE, original);

        const manyIds = Array.from({ length: 101 }, (_, i) => `item-${i}`);
        await expectOverCap(
          store.putStep(
            SCOPE,
            step({
              runId: run.id,
              ports: { out: { count: 101, itemIds: manyIds } },
            }),
          ),
        );
        await expectOverCap(
          store.putStep(
            SCOPE,
            step({ runId: run.id, fields: { note: "x".repeat(9000) } }),
          ),
        );
        const longIds = (port: string) => ({
          count: 100,
          itemIds: Array.from({ length: 100 }, (_, i) =>
            `${port}-${i}-${"y".repeat(190)}`.slice(0, 200),
          ),
        });
        await expectOverCap(
          store.putStep(
            SCOPE,
            step({
              runId: run.id,
              ports: {
                a: longIds("a"),
                b: longIds("b"),
                c: longIds("c"),
                d: longIds("d"),
              },
            }),
          ),
        );

        expect((await store.getRun(SCOPE, run.id))?.steps).toEqual([original]);
      });

      it("rejects a malformed step, and a step for a run that is not there", async () => {
        const created = await createWorkflow();
        const run = await startedRun(created.id);
        await expectStoreError(
          store.putStep(
            SCOPE,
            step({
              runId: run.id,
              ports: { out: { count: 1, itemIds: ["a", "b"] } },
            }),
          ),
          "invalid_record",
        );
        await expectStoreError(
          store.putStep(
            SCOPE,
            step({ runId: run.id, status: "weird" as StepRecord["status"] }),
          ),
          "invalid_record",
        );
        await expectStoreError(
          store.putStep(SCOPE, step({ runId: "missing" })),
          "not_found",
        );
        await expectStoreError(
          store.putStep(OTHER_FACTORY, step({ runId: run.id })),
          "not_found",
        );
        expect((await store.getRun(SCOPE, run.id))?.steps).toEqual([]);
      });
    });

    describe("leases", () => {
      async function lease(
        workflowId: string,
        leasedBy: string,
        itemIds: string[],
        now = at(0),
        extra: { ttlMs?: number; skipParked?: boolean } = {},
      ) {
        return store.leaseItems(SCOPE, {
          workflowId,
          graphVersion: 1,
          itemIds,
          leasedBy,
          now,
          ...extra,
        });
      }

      it("creates state for a new item and leases it for fifteen minutes", async () => {
        const created = await createWorkflow();
        const won = await lease(created.id, "tick-1", ["item-1"]);

        expect(won).toEqual([
          {
            workflowId: created.id,
            graphVersion: 1,
            itemId: "item-1",
            context: {},
            counters: {},
            leasedBy: "tick-1",
            leaseUntil: at(15),
            updatedAt: expect.any(String),
          },
        ]);
        expect(await store.getItemState(SCOPE, created.id, "item-1")).toEqual(
          won[0],
        );
      });

      it("gives each item to exactly one of several concurrent callers", async () => {
        const created = await createWorkflow();
        const itemIds = Array.from({ length: 12 }, (_, i) => `item-${i}`);

        const results = await Promise.all(
          ["tick-a", "tick-b", "tick-c", "tick-d", "tick-e"].map((leasedBy) =>
            lease(created.id, leasedBy, itemIds),
          ),
        );

        const wonIds = results.flatMap((won) => won.map((s) => s.itemId));
        expect(wonIds).toHaveLength(itemIds.length);
        expect(new Set(wonIds)).toEqual(new Set(itemIds));
        for (const [index, won] of results.entries()) {
          for (const state of won) {
            expect(state.leasedBy).toBe(
              ["tick-a", "tick-b", "tick-c", "tick-d", "tick-e"][index],
            );
          }
        }
      });

      it("returns only the items it won, in the order asked", async () => {
        const created = await createWorkflow();
        await lease(created.id, "tick-a", ["item-2"]);

        const won = await lease(created.id, "tick-b", [
          "item-3",
          "item-2",
          "item-1",
          "item-3",
        ]);

        expect(won.map((s) => s.itemId)).toEqual(["item-3", "item-1"]);
        expect(
          (await store.getItemState(SCOPE, created.id, "item-2"))?.leasedBy,
        ).toBe("tick-a");
      });

      it("frees a lease at its expiry, and the old holder can no longer park", async () => {
        const created = await createWorkflow();
        await lease(created.id, "tick-a", ["item-1"], at(0));

        expect(
          await lease(created.id, "tick-b", ["item-1"], at(14, 59)),
        ).toEqual([]);
        const takeover = await lease(created.id, "tick-b", ["item-1"], at(15));
        expect(takeover.map((s) => s.leasedBy)).toEqual(["tick-b"]);
        expect(takeover[0].leaseUntil).toBe(at(30));

        await expectStoreError(
          store.parkItem(SCOPE, {
            workflowId: created.id,
            itemId: "item-1",
            leasedBy: "tick-a",
            graphVersion: 1,
            nodeId: "wait",
            wake: { wait: "time", dueAt: at(60) },
            context: {},
          }),
          "lease_lost",
        );
        expect(
          await store.releaseLeases(SCOPE, {
            workflowId: created.id,
            itemIds: ["item-1"],
            leasedBy: "tick-a",
          }),
        ).toBe(0);
        expect(
          (await store.getItemState(SCOPE, created.id, "item-1"))?.leasedBy,
        ).toBe("tick-b");
      });

      it("honors a shorter ttl and rejects an out-of-range one", async () => {
        const created = await createWorkflow();
        const [won] = await lease(created.id, "tick-a", ["item-1"], at(0), {
          ttlMs: 60_000,
        });
        expect(won.leaseUntil).toBe(at(1));
        await expectStoreError(
          lease(created.id, "tick-a", ["item-2"], at(0), { ttlMs: 10 }),
          "invalid_record",
        );
      });

      it("releases only what the caller holds, and the item is free at once", async () => {
        const created = await createWorkflow();
        await lease(created.id, "tick-a", ["item-1", "item-2"]);

        expect(
          await store.releaseLeases(SCOPE, {
            workflowId: created.id,
            itemIds: ["item-1", "item-2"],
            leasedBy: "tick-other",
          }),
        ).toBe(0);
        expect(
          await store.releaseLeases(SCOPE, {
            workflowId: created.id,
            itemIds: ["item-1", "unknown"],
            leasedBy: "tick-a",
          }),
        ).toBe(1);
        expect(
          (await lease(created.id, "tick-b", ["item-1", "item-2"])).map(
            (s) => s.itemId,
          ),
        ).toEqual(["item-1"]);
      });

      it("refuses an empty or oversized batch", async () => {
        const created = await createWorkflow();
        await expectStoreError(
          lease(created.id, "tick-a", []),
          "invalid_record",
        );
        await expectStoreError(
          lease(
            created.id,
            "tick-a",
            Array.from(
              { length: WORKFLOW_STORE_LIMITS.itemBatchMax + 1 },
              (_, i) => `item-${i}`,
            ),
          ),
          "invalid_record",
        );
      });
    });

    describe("parking", () => {
      async function leased(workflowId: string, itemId = "item-1") {
        const [state] = await store.leaseItems(SCOPE, {
          workflowId,
          graphVersion: 1,
          itemIds: [itemId],
          leasedBy: "tick-1",
          now: at(0),
        });
        return state;
      }

      function park(
        workflowId: string,
        overrides: Partial<Parameters<WorkflowStore["parkItem"]>[1]> = {},
      ) {
        return store.parkItem(SCOPE, {
          workflowId,
          itemId: "item-1",
          leasedBy: "tick-1",
          graphVersion: 1,
          nodeId: "wait-reply",
          wake: { wait: "reply", dueAt: at(60), nextCheckAt: at(15) },
          context: {
            item: { title: "Export fails" },
            nodes: { assess: { risk: "low" } },
          },
          ...overrides,
        });
      }

      it("parks a leased item with its wake and context, and ends the lease", async () => {
        const created = await createWorkflow();
        await leased(created.id);

        const parked = await park(created.id, {
          wake: {
            wait: "reply",
            dueAt: at(60),
            nextCheckAt: at(15),
            thread: { channelId: "C1", threadTs: "1700000000.1" },
          },
          counters: { attempts: 1 },
        });

        expect(parked).toMatchObject({
          itemId: "item-1",
          graphVersion: 1,
          parkedAtNode: "wait-reply",
          wake: {
            wait: "reply",
            dueAt: at(60),
            nextCheckAt: at(15),
            thread: { channelId: "C1", threadTs: "1700000000.1" },
          },
          context: {
            item: { title: "Export fails" },
            nodes: { assess: { risk: "low" } },
          },
          counters: { attempts: 1 },
        });
        expect(parked).not.toHaveProperty("leasedBy");
        expect(parked).not.toHaveProperty("leaseUntil");
        expect(await store.getItemState(SCOPE, created.id, "item-1")).toEqual(
          parked,
        );
      });

      it("returns wake times as UTC whatever offset they were given", async () => {
        const created = await createWorkflow();
        await leased(created.id);
        const parked = await park(created.id, {
          wake: { wait: "time", dueAt: "2026-10-18T13:00:00+02:00" },
        });
        expect(parked.wake?.dueAt).toBe("2026-10-18T11:00:00.000Z");
      });

      it("keeps counters unless new ones are given", async () => {
        const created = await createWorkflow();
        await leased(created.id);
        await store.incrementCounter(SCOPE, {
          workflowId: created.id,
          itemId: "item-1",
          counter: "attempts",
        });

        expect((await park(created.id)).counters).toEqual({ attempts: 1 });
        await store.leaseItems(SCOPE, {
          workflowId: created.id,
          graphVersion: 1,
          itemIds: ["item-1"],
          leasedBy: "tick-2",
          now: at(1),
        });
        expect(
          (
            await park(created.id, {
              leasedBy: "tick-2",
              counters: { attempts: 0, nudges: 2 },
            })
          ).counters,
        ).toEqual({ attempts: 0, nudges: 2 });
      });

      it("refuses a caller that does not hold the lease, and an item with no state", async () => {
        const created = await createWorkflow();
        await leased(created.id);
        await expectStoreError(
          park(created.id, { leasedBy: "tick-intruder" }),
          "lease_lost",
        );
        await expectStoreError(
          park(created.id, { itemId: "never-seen" }),
          "not_found",
        );
        expect(
          await store.getItemState(SCOPE, created.id, "item-1"),
        ).not.toHaveProperty("parkedAtNode");
      });

      it("rejects context over 8 KB instead of cutting it, and keeps the old state", async () => {
        const created = await createWorkflow();
        const before = await leased(created.id);
        await expectOverCap(
          park(created.id, { context: { note: "z".repeat(9000) } }),
        );
        expect(await store.getItemState(SCOPE, created.id, "item-1")).toEqual(
          before,
        );
      });

      it("selects due items by dueAt or by nextCheckAt, earliest first", async () => {
        const created = await createWorkflow();
        const ids = ["by-limit", "by-check", "not-due", "never-parked"];
        for (const id of ids) await leased(created.id, id);
        await park(created.id, {
          itemId: "by-limit",
          wake: { wait: "time", dueAt: at(10) },
        });
        await park(created.id, {
          itemId: "by-check",
          wake: { wait: "reply", dueAt: at(90), nextCheckAt: at(5) },
        });
        await park(created.id, {
          itemId: "not-due",
          wake: { wait: "reply", dueAt: at(90), nextCheckAt: at(45) },
        });
        await store.releaseLeases(SCOPE, {
          workflowId: created.id,
          itemIds: ["never-parked"],
          leasedBy: "tick-1",
        });

        const due = await store.listDueParked(SCOPE, {
          workflowId: created.id,
          now: at(20),
        });
        expect(due.map((s) => s.itemId)).toEqual(["by-check", "by-limit"]);
        expect(
          (
            await store.listDueParked(SCOPE, {
              workflowId: created.id,
              now: at(4),
            })
          ).length,
        ).toBe(0);
        expect(
          (
            await store.listDueParked(SCOPE, {
              workflowId: created.id,
              now: at(10),
            })
          ).map((s) => s.itemId),
        ).toEqual(["by-check", "by-limit"]);
      });

      it("returns at most 20 due items, oldest first, and refuses a bigger limit", async () => {
        const created = await createWorkflow();
        const ids = Array.from(
          { length: 25 },
          (_, i) => `item-${String(i).padStart(2, "0")}`,
        );
        await store.leaseItems(SCOPE, {
          workflowId: created.id,
          graphVersion: 1,
          itemIds: ids,
          leasedBy: "tick-1",
          now: at(0),
        });
        for (const [index, itemId] of ids.entries()) {
          await park(created.id, {
            itemId,
            wake: { wait: "time", dueAt: at(60 - index) },
          });
        }

        const due = await store.listDueParked(SCOPE, {
          workflowId: created.id,
          now: at(120),
        });
        expect(due).toHaveLength(WORKFLOW_STORE_LIMITS.dueParkedMax);
        expect(due[0].itemId).toBe("item-24");
        expect(
          (
            await store.listDueParked(SCOPE, {
              workflowId: created.id,
              now: at(120),
              limit: 3,
            })
          ).map((s) => s.itemId),
        ).toEqual(["item-24", "item-23", "item-22"]);
        await expectStoreError(
          store.listDueParked(SCOPE, {
            workflowId: created.id,
            now: at(120),
            limit: 21,
          }),
          "invalid_record",
        );
      });

      it("skips an item another run holds, and takes it again once the lease ends", async () => {
        const created = await createWorkflow();
        await leased(created.id);
        await park(created.id, { wake: { wait: "time", dueAt: at(10) } });
        const resume = {
          workflowId: created.id,
          now: at(20),
        };
        expect(await store.listDueParked(SCOPE, resume)).toHaveLength(1);

        await store.leaseItems(SCOPE, {
          workflowId: created.id,
          graphVersion: 1,
          itemIds: ["item-1"],
          leasedBy: "tick-2",
          now: at(20),
        });
        expect(await store.listDueParked(SCOPE, resume)).toHaveLength(0);
        expect(
          await store.listDueParked(SCOPE, { ...resume, now: at(36) }),
        ).toHaveLength(1);
      });

      it("keeps a source from taking an item parked at a Wait", async () => {
        const created = await createWorkflow();
        await leased(created.id);
        await park(created.id, { wake: { wait: "time", dueAt: at(10) } });

        const skipped = await store.leaseItems(SCOPE, {
          workflowId: created.id,
          graphVersion: 1,
          itemIds: ["item-1", "item-2"],
          leasedBy: "tick-2",
          now: at(20),
          skipParked: true,
        });
        expect(skipped.map((s) => s.itemId)).toEqual(["item-2"]);

        const resumed = await store.leaseItems(SCOPE, {
          workflowId: created.id,
          graphVersion: 1,
          itemIds: ["item-1"],
          leasedBy: "tick-3",
          now: at(20),
        });
        expect(resumed[0]).toMatchObject({
          itemId: "item-1",
          parkedAtNode: "wait-reply",
          leasedBy: "tick-3",
        });
      });

      it("clears parking but keeps counters, and only for the holder", async () => {
        const created = await createWorkflow();
        await leased(created.id);
        await park(created.id, { counters: { attempts: 2 } });
        await store.leaseItems(SCOPE, {
          workflowId: created.id,
          graphVersion: 1,
          itemIds: ["item-1"],
          leasedBy: "tick-2",
          now: at(70),
        });

        await expectStoreError(
          store.clearParking(SCOPE, {
            workflowId: created.id,
            itemId: "item-1",
            leasedBy: "tick-intruder",
          }),
          "lease_lost",
        );
        const cleared = await store.clearParking(SCOPE, {
          workflowId: created.id,
          itemId: "item-1",
          leasedBy: "tick-2",
        });

        expect(cleared).toMatchObject({
          context: {},
          counters: { attempts: 2 },
        });
        expect(cleared).not.toHaveProperty("parkedAtNode");
        expect(cleared).not.toHaveProperty("wake");
        expect(cleared).not.toHaveProperty("leasedBy");
        expect(
          await store.listDueParked(SCOPE, {
            workflowId: created.id,
            now: at(500),
          }),
        ).toEqual([]);
      });
    });

    describe("counters", () => {
      it("loses no increment when many callers add at once", async () => {
        const created = await createWorkflow();
        await store.leaseItems(SCOPE, {
          workflowId: created.id,
          graphVersion: 1,
          itemIds: ["item-1"],
          leasedBy: "tick-1",
          now: at(0),
        });

        const values = await Promise.all(
          Array.from({ length: 25 }, () =>
            store.incrementCounter(SCOPE, {
              workflowId: created.id,
              itemId: "item-1",
              counter: "attempts",
            }),
          ),
        );

        expect([...values].sort((a, b) => a - b)).toEqual(
          Array.from({ length: 25 }, (_, i) => i + 1),
        );
        expect(
          (await store.getItemState(SCOPE, created.id, "item-1"))?.counters,
        ).toEqual({ attempts: 25 });
      });

      it("counts each name on its own and adds the amount asked", async () => {
        const created = await createWorkflow();
        await store.leaseItems(SCOPE, {
          workflowId: created.id,
          graphVersion: 1,
          itemIds: ["item-1"],
          leasedBy: "tick-1",
          now: at(0),
        });
        const bump = (counter: string, by?: number) =>
          store.incrementCounter(SCOPE, {
            workflowId: created.id,
            itemId: "item-1",
            counter,
            by,
          });

        expect(await bump("attempts")).toBe(1);
        expect(await bump("loop:edge-1", 3)).toBe(3);
        expect(await bump("attempts", 2)).toBe(3);
        expect(
          (await store.getItemState(SCOPE, created.id, "item-1"))?.counters,
        ).toEqual({ attempts: 3, "loop:edge-1": 3 });
      });

      it("refuses an item with no state and a nonsense amount", async () => {
        const created = await createWorkflow();
        await expectStoreError(
          store.incrementCounter(SCOPE, {
            workflowId: created.id,
            itemId: "never-seen",
            counter: "attempts",
          }),
          "not_found",
        );
        await store.leaseItems(SCOPE, {
          workflowId: created.id,
          graphVersion: 1,
          itemIds: ["item-1"],
          leasedBy: "tick-1",
          now: at(0),
        });
        for (const by of [0, -1, 1.5, 1001]) {
          await expectStoreError(
            store.incrementCounter(SCOPE, {
              workflowId: created.id,
              itemId: "item-1",
              counter: "attempts",
              by,
            }),
            "invalid_record",
          );
        }
      });

      it("takes the named counters back to zero and leaves the rest", async () => {
        const created = await createWorkflow();
        await store.leaseItems(SCOPE, {
          workflowId: created.id,
          graphVersion: 1,
          itemIds: ["item-1"],
          leasedBy: "tick-1",
          now: at(0),
        });
        const bump = (counter: string, by?: number) =>
          store.incrementCounter(SCOPE, {
            workflowId: created.id,
            itemId: "item-1",
            counter,
            by,
          });
        await bump("attempts", 2);
        await bump("rounds", 4);
        await bump("loop:edge-1", 3);

        await store.clearCounters(SCOPE, {
          workflowId: created.id,
          itemId: "item-1",
          counters: ["attempts", "loop:edge-1", "never-counted", "attempts"],
        });

        expect(
          (await store.getItemState(SCOPE, created.id, "item-1"))?.counters,
        ).toEqual({ rounds: 4 });
        // Counting starts again from nothing.
        expect(await bump("attempts")).toBe(1);
      });

      it("refuses an item with no state, no names, and a name that is not an id", async () => {
        const created = await createWorkflow();
        await expectStoreError(
          store.clearCounters(SCOPE, {
            workflowId: created.id,
            itemId: "never-seen",
            counters: ["attempts"],
          }),
          "not_found",
        );
        await store.leaseItems(SCOPE, {
          workflowId: created.id,
          graphVersion: 1,
          itemIds: ["item-1"],
          leasedBy: "tick-1",
          now: at(0),
        });
        for (const counters of [[], [""]]) {
          await expectStoreError(
            store.clearCounters(SCOPE, {
              workflowId: created.id,
              itemId: "item-1",
              counters,
            }),
            "invalid_record",
          );
        }
      });
    });

    describe("item events", () => {
      it("returns an item's journey oldest first, whatever order it was written in", async () => {
        const created = await createWorkflow();
        await store.appendItemEvent(
          SCOPE,
          event(created.id, {
            kind: "ended",
            outcome: "needsManual",
            at: at(3),
            summary: "end",
          }),
        );
        await store.appendItemEvents(SCOPE, [
          event(created.id, { kind: "taken", at: at(0), summary: "first" }),
          event(created.id, {
            kind: "entered",
            at: at(1),
            nodeId: "assess",
            summary: "second",
          }),
          event(created.id, {
            kind: "output",
            at: at(1),
            nodeId: "assess",
            port: "out",
            summary: "third",
          }),
          event(created.id, {
            kind: "effect",
            at: at(2),
            nodeId: "post",
            receiptKey: "receipt-1",
            threadId: "thread-1",
            mode: "dry",
            summary: "fourth",
          }),
          event(created.id, { itemId: "item-2", summary: "someone else" }),
        ]);

        const page = await store.listItemEvents(SCOPE, {
          workflowId: created.id,
          itemId: "item-1",
        });

        expect(page.hasMore).toBe(false);
        expect(page.items.map((e) => e.summary)).toEqual([
          "first",
          "second",
          "third",
          "fourth",
          "end",
        ]);
        expect(page.items[3]).toMatchObject({
          mode: "dry",
          receiptKey: "receipt-1",
          threadId: "thread-1",
          nodeId: "post",
        });
      });

      it("stores how an item ended and why it failed in fields of their own, and nowhere else", async () => {
        const created = await createWorkflow();
        await store.appendItemEvents(SCOPE, [
          event(created.id, {
            kind: "error",
            code: "effect_needs_check",
            at: at(0),
            summary: "effect_needs_check: the post may have gone out",
          }),
          event(created.id, {
            kind: "ended",
            outcome: "dismissed",
            at: at(1),
            summary: "dismissed: not a bug",
          }),
          event(created.id, { kind: "taken", at: at(2) }),
        ]);

        const page = await store.listItemEvents(SCOPE, {
          workflowId: created.id,
          itemId: "item-1",
        });

        expect(page.items.map((e) => [e.kind, e.outcome, e.code])).toEqual([
          ["error", undefined, "effect_needs_check"],
          ["ended", "dismissed", undefined],
          ["taken", undefined, undefined],
        ]);
        expect(page.items[2]).not.toHaveProperty("outcome");
        expect(page.items[2]).not.toHaveProperty("code");
      });

      it("refuses an ended event with no outcome, an error with no code, and either on any other kind", async () => {
        const created = await createWorkflow();
        const bad: Partial<ItemEvent>[] = [
          { kind: "ended" },
          { kind: "error" },
          { kind: "taken", outcome: "done" },
          { kind: "taken", code: "provider_error" },
          { kind: "ended", outcome: "done", code: "provider_error" },
          { kind: "error", code: "provider_error", outcome: "done" },
          { kind: "ended", outcome: "finished" as never },
          { kind: "error", code: "no_such_code" as never },
        ];
        for (const overrides of bad) {
          await expectStoreError(
            store.appendItemEvent(SCOPE, event(created.id, overrides)),
            "invalid_record",
          );
        }
        expect(
          (
            await store.listItemEvents(SCOPE, {
              workflowId: created.id,
              itemId: "item-1",
            })
          ).items,
        ).toEqual([]);
      });

      it("says when a journey was cut, and tells an empty one from a missing workflow", async () => {
        const created = await createWorkflow();
        expect(
          await store.listItemEvents(SCOPE, {
            workflowId: created.id,
            itemId: "item-1",
          }),
        ).toEqual({ items: [], hasMore: false });
        await expectStoreError(
          store.listItemEvents(SCOPE, {
            workflowId: "missing",
            itemId: "item-1",
          }),
          "not_found",
        );

        await store.appendItemEvents(
          SCOPE,
          [0, 1, 2].map((minute) =>
            event(created.id, { at: at(minute), summary: `e${minute}` }),
          ),
        );
        const cut = await store.listItemEvents(SCOPE, {
          workflowId: created.id,
          itemId: "item-1",
          limit: 2,
        });
        expect(cut.items.map((e) => e.summary)).toEqual(["e0", "e1"]);
        expect(cut.hasMore).toBe(true);
      });

      it("writes nothing when any event in a batch is bad", async () => {
        const created = await createWorkflow();
        await expectStoreError(
          store.appendItemEvents(SCOPE, [
            event(created.id, { summary: "fine" }),
            event(created.id, { summary: "s".repeat(2049) }),
          ]),
          "invalid_record",
        );
        await expectStoreError(
          store.appendItemEvents(SCOPE, [
            event(created.id, { summary: "fine" }),
            event("missing", { summary: "orphan" }),
          ]),
          "not_found",
        );
        expect(
          (
            await store.listItemEvents(SCOPE, {
              workflowId: created.id,
              itemId: "item-1",
            })
          ).items,
        ).toEqual([]);
      });
    });

    describe("receipts", () => {
      async function setup() {
        const created = await createWorkflow();
        const key = receiptKey({
          workflowId: created.id,
          itemId: "item-1",
          nodeId: "post",
          attempt: 1,
        });
        return { workflowId: created.id, key };
      }

      const started = (key: string): Receipt => ({
        key,
        status: "started",
        at: at(0),
      });

      it("moves from started to done with the external reference", async () => {
        const { workflowId, key } = await setup();
        expect(await store.getReceipt(SCOPE, key)).toBeNull();

        await store.putReceipt(SCOPE, workflowId, started(key));
        expect(await store.getReceipt(SCOPE, key)).toEqual(started(key));

        const done: Receipt = {
          key,
          status: "done",
          externalRef: "1700000000.5",
          url: "https://example.test/archives/C1/p1700000000000500",
          summary: "posted to #bugs",
          at: at(1),
        };
        await store.putReceipt(SCOPE, workflowId, done);
        expect(await store.getReceipt(SCOPE, key)).toEqual(done);
      });

      it("keeps the response a done receipt was closed with, and whether it was cut", async () => {
        const { workflowId, key } = await setup();
        await store.putReceipt(SCOPE, workflowId, started(key));

        const done: Receipt = {
          key,
          status: "done",
          externalRef: "1700000000.5",
          output: {
            channel: "C1",
            ts: "1700000000.5",
            ok: true,
            ids: [1, 2, null],
            key: "héllo ✓",
          },
          outputTruncated: true,
          at: at(1),
        };
        await store.putReceipt(SCOPE, workflowId, done);

        expect(await store.getReceipt(SCOPE, key)).toEqual(done);
      });

      it("reads a done receipt closed without a response as having none, not as an empty one", async () => {
        const { workflowId, key } = await setup();
        await store.putReceipt(SCOPE, workflowId, started(key));
        await store.putReceipt(SCOPE, workflowId, {
          key,
          status: "done",
          externalRef: "r",
          at: at(1),
        });

        const read = await store.getReceipt(SCOPE, key);

        expect(read).not.toHaveProperty("output");
        expect(read).not.toHaveProperty("outputTruncated");
      });

      it("keeps an empty response and an untruncated flag as what they are", async () => {
        const { workflowId, key } = await setup();
        await store.putReceipt(SCOPE, workflowId, started(key));
        const done: Receipt = {
          key,
          status: "done",
          output: {},
          outputTruncated: false,
          at: at(1),
        };
        await store.putReceipt(SCOPE, workflowId, done);

        expect(await store.getReceipt(SCOPE, key)).toEqual(done);
      });

      it("takes a response of exactly the limit and refuses one byte more, leaving the receipt started", async () => {
        const { workflowId, key } = await setup();
        await store.putReceipt(SCOPE, workflowId, started(key));
        const limit = WORKFLOW_STORE_LIMITS.receiptOutputBytes;
        // {"ids":[1,1,...]} is 9 bytes plus two for each number; one two-digit number takes the odd byte.
        const outputOf = (bytes: number) => {
          const wide = bytes % 2 === 0;
          const entries = wide ? (bytes - 10) / 2 : (bytes - 9) / 2;
          return {
            ids: [
              ...Array(wide ? entries - 1 : entries).fill(1),
              ...(wide ? [10] : []),
            ],
          };
        };

        const refused = await expectStoreError(
          store.putReceipt(SCOPE, workflowId, {
            key,
            status: "done",
            output: outputOf(limit + 1),
            at: at(1),
          }),
          "invalid_record",
        );
        expect(refused.details).toMatchObject({
          bytes: limit + 1,
          maxBytes: limit,
        });
        expect(await store.getReceipt(SCOPE, key)).toEqual(started(key));

        const done: Receipt = {
          key,
          status: "done",
          output: outputOf(limit),
          at: at(2),
        };
        await store.putReceipt(SCOPE, workflowId, done);
        expect(await store.getReceipt(SCOPE, key)).toEqual(done);
      });

      it("refuses a response that holds more than identifiers, and keeps the receipt started", async () => {
        const { workflowId, key } = await setup();
        await store.putReceipt(SCOPE, workflowId, started(key));

        for (const output of [
          { text: "the customer's words" },
          { channel: "C1", message: { ts: "1.1" } },
          { ids: ["a", { id: "b" }] },
          { url: `https://example.test/${"a".repeat(300)}` },
        ]) {
          await expectStoreError(
            store.putReceipt(SCOPE, workflowId, {
              key,
              status: "done",
              output,
              at: at(1),
            }),
            "invalid_record",
          );
        }
        expect(await store.getReceipt(SCOPE, key)).toEqual(started(key));
      });

      it("moves from started to failed, and failed is final", async () => {
        const { workflowId, key } = await setup();
        await store.putReceipt(SCOPE, workflowId, started(key));
        const failed: Receipt = {
          key,
          status: "failed",
          summary: "403 from provider",
          at: at(1),
        };
        await store.putReceipt(SCOPE, workflowId, failed);

        await expectStoreError(
          store.putReceipt(SCOPE, workflowId, { ...failed, status: "done" }),
          "invalid_transition",
        );
        await expectStoreError(
          store.putReceipt(SCOPE, workflowId, started(key)),
          "receipt_conflict",
        );
        expect(await store.getReceipt(SCOPE, key)).toEqual(failed);
      });

      it("reports a second started receipt as a conflict and keeps the first", async () => {
        const { workflowId, key } = await setup();
        await store.putReceipt(SCOPE, workflowId, started(key));

        const conflict = await expectStoreError(
          store.putReceipt(SCOPE, workflowId, {
            ...started(key),
            at: at(5),
          }),
          "receipt_conflict",
        );
        expect(conflict.details).toMatchObject({
          key,
          existingStatus: "started",
        });
        expect(await store.getReceipt(SCOPE, key)).toEqual(started(key));
      });

      it("lets exactly one of two concurrent started receipts through", async () => {
        const { workflowId, key } = await setup();
        const results = await Promise.allSettled([
          store.putReceipt(SCOPE, workflowId, started(key)),
          store.putReceipt(SCOPE, workflowId, started(key)),
        ]);

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const rejected = results.find((r) => r.status === "rejected");
        expect((rejected as PromiseRejectedResult).reason).toMatchObject({
          code: "receipt_conflict",
        });
      });

      it("refuses to close a receipt that was never started or is already closed", async () => {
        const { workflowId, key } = await setup();
        await expectStoreError(
          store.putReceipt(SCOPE, workflowId, {
            key,
            status: "done",
            at: at(0),
          }),
          "invalid_transition",
        );
        expect(await store.getReceipt(SCOPE, key)).toBeNull();

        await store.putReceipt(SCOPE, workflowId, started(key));
        await store.putReceipt(SCOPE, workflowId, {
          key,
          status: "done",
          at: at(1),
        });
        await expectStoreError(
          store.putReceipt(SCOPE, workflowId, {
            key,
            status: "done",
            at: at(2),
          }),
          "invalid_transition",
        );
        await expectStoreError(
          store.putReceipt(SCOPE, workflowId, {
            key,
            status: "failed",
            at: at(2),
          }),
          "invalid_transition",
        );
      });

      it("hides a receipt from another scope", async () => {
        const { workflowId, key } = await setup();
        await store.putReceipt(SCOPE, workflowId, started(key));
        expect(await store.getReceipt(OTHER_FACTORY, key)).toBeNull();
        expect(await store.getReceipt(OTHER_ORG, key)).toBeNull();
        await expectStoreError(
          store.putReceipt(OTHER_FACTORY, workflowId, {
            key,
            status: "done",
            at: at(1),
          }),
          "not_found",
        );
      });
    });

    describe("source cursors", () => {
      it("has no cursor until one is set, then keeps the latest per node", async () => {
        const created = await createWorkflow();
        const ref = { workflowId: created.id, nodeId: "intake" };
        expect(await store.getSourceCursor(SCOPE, ref)).toBeNull();

        await store.setSourceCursor(SCOPE, {
          ...ref,
          value: "1700000000.1",
          ownerEmail: OWNER,
        });
        clock.advance(5000);
        await store.setSourceCursor(SCOPE, {
          ...ref,
          value: "1700000000.9",
          ownerEmail: OWNER,
        });
        await store.setSourceCursor(SCOPE, {
          workflowId: created.id,
          nodeId: "other-source",
          value: "elsewhere",
          ownerEmail: OWNER,
        });

        expect(await store.getSourceCursor(SCOPE, ref)).toEqual({
          value: "1700000000.9",
          updatedAt: new Date(T0 + 5000).toISOString(),
        });
        expect(
          (
            await store.getSourceCursor(SCOPE, {
              workflowId: created.id,
              nodeId: "other-source",
            })
          )?.value,
        ).toBe("elsewhere");
      });

      it("rejects an over-cap value, an empty one, and a workflow that is not there", async () => {
        const created = await createWorkflow();
        const ref = { workflowId: created.id, nodeId: "intake" };
        await expectStoreError(
          store.setSourceCursor(SCOPE, {
            ...ref,
            value: "c".repeat(WORKFLOW_STORE_LIMITS.cursorValueBytes + 1),
            ownerEmail: OWNER,
          }),
          "invalid_record",
        );
        await expectStoreError(
          store.setSourceCursor(SCOPE, {
            ...ref,
            value: "",
            ownerEmail: OWNER,
          }),
          "invalid_record",
        );
        await expectStoreError(
          store.setSourceCursor(SCOPE, {
            workflowId: "missing",
            nodeId: "intake",
            value: "x",
            ownerEmail: OWNER,
          }),
          "not_found",
        );
        expect(await store.getSourceCursor(SCOPE, ref)).toBeNull();
      });
    });

    describe("run requests", () => {
      const TTL_MS = WORKFLOW_STORE_LIMITS.runRequestTtlMs;

      async function request(
        workflowId: string,
        overrides: Partial<
          Parameters<WorkflowStore["createRunRequest"]>[1]
        > = {},
      ) {
        return store.createRunRequest(SCOPE, {
          workflowId,
          mode: "dry",
          requestedBy: OWNER,
          ...overrides,
        });
      }

      it("stores what a click asked for and reads it back unclaimed", async () => {
        const created = await createWorkflow();
        const dry = await request(created.id);
        const test = await request(created.id, {
          mode: "test",
          testNodeId: "assess",
          sampleItemIds: ["item-1", "item-2", "item-1"],
        });

        expect(dry).toMatchObject({
          workflowId: created.id,
          mode: "dry",
          testNodeId: null,
          sampleItemIds: [],
          requestedBy: OWNER,
          createdAt: at(0),
          claimedAt: null,
          claimedByHistoryId: null,
        });
        expect(test).toMatchObject({
          mode: "test",
          testNodeId: "assess",
          sampleItemIds: ["item-1", "item-2"],
        });
        expect(dry.id).not.toBe(test.id);
        expect(await store.getRunRequest(SCOPE, test.id)).toEqual(test);
        expect(await store.getRunRequest(SCOPE, "missing")).toBeNull();
      });

      it("refuses a request whose mode and node do not fit, and one for a workflow that is not there", async () => {
        const created = await createWorkflow();
        await expectStoreError(
          request(created.id, { mode: "test" }),
          "invalid_record",
        );
        await expectStoreError(
          request(created.id, { mode: "dry", testNodeId: "assess" }),
          "invalid_record",
        );
        await expectStoreError(
          request(created.id, { mode: "live", sampleItemIds: ["item-1"] }),
          "invalid_record",
        );
        await expectStoreError(
          request(created.id, {
            mode: "test",
            testNodeId: "assess",
            sampleItemIds: Array.from(
              { length: WORKFLOW_STORE_LIMITS.runRequestSampleItemsMax + 1 },
              (_, index) => `item-${index}`,
            ),
          }),
          "invalid_record",
        );
        await expectStoreError(request("nope"), "not_found");
      });

      it("hands out the oldest request first, each exactly once, and says when none is left", async () => {
        const created = await createWorkflow();
        const first = await request(created.id, { mode: "live" });
        clock.advance(1000);
        const second = await request(created.id, { mode: "dry" });

        clock.advance(1000);
        const one = await store.claimRunRequest(SCOPE, {
          workflowId: created.id,
          historyId: "history-1",
        });
        const two = await store.claimRunRequest(SCOPE, {
          workflowId: created.id,
          historyId: "history-2",
        });
        const none = await store.claimRunRequest(SCOPE, {
          workflowId: created.id,
          historyId: "history-3",
        });

        expect(one.claimed).toMatchObject({
          id: first.id,
          mode: "live",
          claimedAt: at(0, 2),
          claimedByHistoryId: "history-1",
        });
        expect(two.claimed).toMatchObject({
          id: second.id,
          claimedByHistoryId: "history-2",
        });
        expect(none).toEqual({ claimed: null, expired: [] });
        expect(await store.getRunRequest(SCOPE, first.id)).toEqual(one.claimed);
      });

      it("gives one request to exactly one of several concurrent ticks", async () => {
        const created = await createWorkflow();
        await request(created.id, { mode: "live" });

        const claims = await Promise.all(
          Array.from({ length: 6 }, (_, index) =>
            store.claimRunRequest(SCOPE, {
              workflowId: created.id,
              historyId: `history-${index}`,
            }),
          ),
        );

        const winners = claims.filter((claim) => claim.claimed !== null);
        expect(winners).toHaveLength(1);
        expect(winners[0]?.claimed?.claimedByHistoryId).toMatch(/^history-/);
      });

      it("sends a tick that loses the race to the next request, not to nothing", async () => {
        const created = await createWorkflow();
        const ids = new Set<string>();
        for (let index = 0; index < 4; index += 1) {
          ids.add((await request(created.id, { mode: "dry" })).id);
          clock.advance(10);
        }

        const claims = await Promise.all(
          Array.from({ length: 4 }, (_, index) =>
            store.claimRunRequest(SCOPE, {
              workflowId: created.id,
              historyId: `history-${index}`,
            }),
          ),
        );

        const claimedIds = claims.map((claim) => claim.claimed?.id);
        expect(claimedIds.every((id) => id !== undefined)).toBe(true);
        expect(new Set(claimedIds)).toEqual(ids);
      });

      it("ignores a request that waited more than ten minutes, reports it once, and never runs it late", async () => {
        const created = await createWorkflow();
        const stale = await request(created.id, { mode: "live" });

        clock.advance(TTL_MS);
        const atTheLimit = await store.claimRunRequest(SCOPE, {
          workflowId: created.id,
          historyId: "history-edge",
        });
        expect(atTheLimit.claimed?.id).toBe(stale.id);

        const late = await request(created.id, { mode: "live" });
        clock.advance(TTL_MS + 1);
        const fresh = await request(created.id, { mode: "dry" });
        const claim = await store.claimRunRequest(SCOPE, {
          workflowId: created.id,
          historyId: "history-late",
        });
        expect(claim.claimed?.id).toBe(fresh.id);
        expect(claim.expired.map((expired) => expired.id)).toEqual([late.id]);
        expect(claim.expired[0]).toMatchObject({
          mode: "live",
          claimedAt: null,
        });

        expect(await store.getRunRequest(SCOPE, late.id)).toBeNull();
        expect(
          await store.claimRunRequest(SCOPE, {
            workflowId: created.id,
            historyId: "history-again",
          }),
        ).toEqual({ claimed: null, expired: [] });
      });

      it("reports an expired request even when nothing else is waiting", async () => {
        const created = await createWorkflow();
        const stale = await request(created.id, { mode: "live" });
        clock.advance(TTL_MS + 1);

        const claim = await store.claimRunRequest(SCOPE, {
          workflowId: created.id,
          historyId: "history-1",
        });

        expect(claim.claimed).toBeNull();
        expect(claim.expired.map((expired) => expired.id)).toEqual([stale.id]);
      });

      it("cancels a request nobody claimed, and only that", async () => {
        const created = await createWorkflow();
        const unclaimed = await request(created.id);
        clock.advance(1000);
        const taken = await request(created.id);
        await store.claimRunRequest(SCOPE, {
          workflowId: created.id,
          historyId: "history-1",
        });

        expect(await store.cancelRunRequest(OTHER_FACTORY, unclaimed.id)).toBe(
          false,
        );
        expect(await store.cancelRunRequest(SCOPE, "missing")).toBe(false);
        // The oldest was claimed above; cancelling it now is too late.
        expect(await store.cancelRunRequest(SCOPE, unclaimed.id)).toBe(false);
        expect(await store.cancelRunRequest(SCOPE, taken.id)).toBe(true);
        expect(await store.getRunRequest(SCOPE, taken.id)).toBeNull();
        expect(await store.cancelRunRequest(SCOPE, taken.id)).toBe(false);
      });

      it("keeps requests inside their scope and removes them with the workflow", async () => {
        const created = await createWorkflow();
        const pending = await request(created.id);

        expect(await store.getRunRequest(OTHER_FACTORY, pending.id)).toBeNull();
        expect(await store.getRunRequest(OTHER_ORG, pending.id)).toBeNull();
        await expectStoreError(
          store.claimRunRequest(OTHER_FACTORY, {
            workflowId: created.id,
            historyId: "history-1",
          }),
          "not_found",
        );
        await expectStoreError(
          store.createRunRequest(OTHER_FACTORY, {
            workflowId: created.id,
            mode: "dry",
            requestedBy: OWNER,
          }),
          "not_found",
        );
        expect(await store.getRunRequest(SCOPE, pending.id)).toEqual(pending);

        expect(await store.deleteWorkflow(SCOPE, created.id)).toBe(true);
        expect(await store.getRunRequest(SCOPE, pending.id)).toBeNull();
      });
    });

    describe("scoping", () => {
      it("shows another factory or org nothing, and lets it change nothing", async () => {
        const created = await createWorkflow({ automationId: "factory-bugs" });
        const run = await startedRun(created.id);
        const [leased] = await store.leaseItems(SCOPE, {
          workflowId: created.id,
          graphVersion: 1,
          itemIds: ["item-1"],
          leasedBy: "tick-1",
          now: at(0),
        });

        for (const outsider of [OTHER_FACTORY, OTHER_ORG]) {
          expect(await store.getWorkflow(outsider, created.id)).toBeNull();
          expect(
            await store.getWorkflowByAutomation(outsider, "factory-bugs"),
          ).toBeNull();
          expect(
            await store.getWorkflowVersion(outsider, created.id, 1),
          ).toBeNull();
          expect(await store.listWorkflows(outsider)).toEqual({
            items: [],
            hasMore: false,
          });
          expect(await store.getRun(outsider, run.id)).toBeNull();
          expect(
            await store.getItemState(outsider, created.id, "item-1"),
          ).toBeNull();

          await expectStoreError(
            store.leaseItems(outsider, {
              workflowId: created.id,
              graphVersion: 1,
              itemIds: ["item-1", "item-2"],
              leasedBy: "tick-outsider",
              now: at(60),
            }),
            "not_found",
          );
          await expectStoreError(
            store.listDueParked(outsider, {
              workflowId: created.id,
              now: at(60),
            }),
            "not_found",
          );
          await expectStoreError(
            store.listRuns(outsider, { workflowId: created.id }),
            "not_found",
          );
          await expectStoreError(
            store.listItemEvents(outsider, {
              workflowId: created.id,
              itemId: "item-1",
            }),
            "not_found",
          );
          await expectStoreError(
            store.saveWorkflowGraph(outsider, {
              workflowId: created.id,
              expectedVersion: 1,
              graph: graph(2),
              source: "save",
              summary: "hijack",
              createdBy: OWNER,
            }),
            "not_found",
          );
          await expectStoreError(
            store.recordCleanDryRun(outsider, {
              workflowId: created.id,
              version: 1,
            }),
            "not_found",
          );
          await expectStoreError(
            store.incrementCounter(outsider, {
              workflowId: created.id,
              itemId: "item-1",
              counter: "attempts",
            }),
            "not_found",
          );
          await expectStoreError(
            store.clearCounters(outsider, {
              workflowId: created.id,
              itemId: "item-1",
              counters: ["attempts"],
            }),
            "not_found",
          );
          await expectStoreError(
            store.releaseLeases(outsider, {
              workflowId: created.id,
              itemIds: ["item-1"],
              leasedBy: "tick-1",
            }),
            "not_found",
          );
        }

        const still = await store.getItemState(SCOPE, created.id, "item-1");
        expect(still).toEqual(leased);
        expect((await store.getWorkflow(SCOPE, created.id))?.version).toBe(1);
      });
    });

    describe("not found is not empty", () => {
      it("returns null for a read of something that is not there", async () => {
        const created = await createWorkflow();
        expect(await store.getWorkflow(SCOPE, "missing")).toBeNull();
        expect(
          await store.getWorkflowByAutomation(SCOPE, "missing"),
        ).toBeNull();
        expect(await store.getWorkflowVersion(SCOPE, created.id, 9)).toBeNull();
        expect(await store.getRun(SCOPE, "missing")).toBeNull();
        expect(
          await store.getItemState(SCOPE, created.id, "missing"),
        ).toBeNull();
        expect(await store.getReceipt(SCOPE, "missing")).toBeNull();
        expect(
          await store.getSourceCursor(SCOPE, {
            workflowId: created.id,
            nodeId: "missing",
          }),
        ).toBeNull();
      });

      it("throws for a write or a list under a workflow that is not there", async () => {
        await expectStoreError(
          store.setWorkflowEnabled(SCOPE, "missing", false),
          "not_found",
        );
        await expectStoreError(
          store.recordTriggerRun(SCOPE, { workflowId: "missing", at: at(0) }),
          "not_found",
        );
        await expectStoreError(
          store.listWorkflowVersions(SCOPE, "missing"),
          "not_found",
        );
        await expectStoreError(
          store.listDueParked(SCOPE, { workflowId: "missing", now: at(0) }),
          "not_found",
        );
        await expectStoreError(
          store.putReceipt(SCOPE, "missing", {
            key: "k",
            status: "started",
            at: at(0),
          }),
          "not_found",
        );
      });
    });
  });
}
