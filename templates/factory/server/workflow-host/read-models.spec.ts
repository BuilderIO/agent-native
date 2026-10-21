import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { WorkflowStoreError } from "../workflow/adapter.js";
import {
  receiptKey,
  type ItemEvent,
  type ItemEventKind,
} from "../workflow/contract.js";
import {
  READ_LIMITS,
  WorkflowReadError,
  clipText,
  decodeReceiptKey,
  durationMs,
  percentile,
} from "./read-models.js";
import {
  OTHER_FACTORY,
  OTHER_ORG,
  SCOPE,
  addEvents,
  addInboxItem,
  addItemState,
  addReceipt,
  addRun,
  addWorkflow,
  closeClient,
  createWorld,
  readGraph,
  rows,
  type World,
} from "./testing/read-models-kit.js";

afterAll(closeClient);

let world: World;

beforeEach(async () => {
  world = await createWorld();
});

async function failureOf(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the read to fail.");
}

const minute = (n: number) =>
  new Date(Date.parse("2026-10-18T09:00:00.000Z") + n * 60_000).toISOString();

describe("pure rules", () => {
  it("computes durations and nearest-rank percentiles, and says null for nothing", () => {
    expect(durationMs(minute(0), minute(2))).toBe(120_000);
    expect(durationMs(minute(2), minute(0))).toBeNull();
    expect(durationMs(minute(0), null)).toBeNull();
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([5], 0.95)).toBe(5);
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(20);
    expect(percentile([40, 10, 30, 20], 0.95)).toBe(40);
  });

  it("clips text and says so, without splitting a surrogate pair", () => {
    expect(clipText("short", 10)).toEqual({ text: "short", truncated: false });
    expect(clipText("0123456789", 4)).toEqual({
      text: "0123",
      truncated: true,
    });
    expect(clipText("ab\u{1f600}cd", 3)).toEqual({
      text: "ab",
      truncated: true,
    });
  });

  it("reads a receipt key back, and refuses one that is not ours", () => {
    const key = receiptKey({
      workflowId: "wf:1",
      itemId: "item:2",
      nodeId: "notify",
      attempt: 2,
    });
    expect(decodeReceiptKey(key)).toEqual({
      workflowId: "wf:1",
      itemId: "item:2",
      nodeId: "notify",
      attempt: 2,
    });
    expect(decodeReceiptKey("not-a-key")).toBeNull();
    expect(decodeReceiptKey("a:b:c:%E0%A4%A")).toBeNull();
  });

  it("reads a salted receipt key as the receipt of the item it names", () => {
    const key = receiptKey({
      workflowId: "wf:1",
      itemId: "group:digest:ab12",
      nodeId: "notify",
      attempt: 0,
      salt: "9f3c",
    });

    expect(key.split(":")).toHaveLength(5);
    expect(decodeReceiptKey(key)).toEqual({
      workflowId: "wf:1",
      itemId: "group:digest:ab12",
      nodeId: "notify",
      attempt: 0,
    });
    expect(decodeReceiptKey(`${key}:extra`)).toBeNull();
  });
});

describe("listRuns", () => {
  async function seedRuns() {
    const workflow = await addWorkflow(world);
    const ids: string[] = [];
    // Runs 3 and 4 share an instant, so the order of ties is exercised.
    const starts = [minute(0), minute(5), minute(10), minute(10), minute(15)];
    for (const [index, startedAt] of starts.entries()) {
      const run = await addRun(world, {
        workflowId: workflow.id,
        // Run 4 shares run 3's instant under a differently written, still scheduled, key.
        tickKey:
          index === 1
            ? "manual-1"
            : index === 3
              ? "2026-10-18T09:10:00Z"
              : startedAt,
        startedAt,
        ...(index === 1
          ? { triggerKind: "manual" as const, startedBy: "ana@example.test" }
          : {}),
        status: index === 2 ? "failed" : "succeeded",
        finishedAt: minute(index * 5 + 1),
        counts: { taken: index, done: 1 },
        ...(index === 2
          ? {
              error: {
                code: "provider_error" as const,
                message: "HubSpot returned 401",
              },
            }
          : {}),
      });
      ids.push(run.id);
    }
    return { workflow, ids };
  }

  it("pages newest first across a cursor without repeating or skipping a tie", async () => {
    const { workflow } = await seedRuns();
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await world.models.listRuns(SCOPE, {
        workflowId: workflow.id,
        limit: 2,
        ...(cursor === undefined ? {} : { cursor }),
      });
      pages += 1;
      seen.push(...page.items.map((run) => run.id));
      expect(page.hasMore).toBe(page.nextCursor !== null);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
    const everything = await world.models.listRuns(SCOPE, { limit: 100 });
    expect(seen).toEqual(everything.items.map((run) => run.id));
    expect(everything.items.map((run) => run.startedAt)).toEqual([
      minute(15),
      minute(10),
      minute(10),
      minute(5),
      minute(0),
    ]);
  });

  it("shows what the list needs for each run", async () => {
    const { workflow } = await seedRuns();
    const page = await world.models.listRuns(SCOPE, { limit: 100 });
    const failed = page.items.find((run) => run.status === "failed");
    expect(failed).toMatchObject({
      workflowId: workflow.id,
      workflowName: "Bug report to Builder",
      graphVersion: 1,
      mode: "live",
      triggerKind: "schedule",
      startedAt: minute(10),
      finishedAt: minute(11),
      error: { code: "provider_error", message: "HubSpot returned 401" },
      counts: { taken: 2, done: 1 },
    });
    expect(failed?.durationMs).toBe(60_000);
    const manual = page.items.find((run) => run.triggerKind === "manual");
    expect(manual).toMatchObject({
      tickKey: "manual-1",
      startedBy: "ana@example.test",
    });
    expect(failed).toMatchObject({ startedBy: "schedule" });
  });

  it("reports the trigger kind and starter a run recorded, whatever its tick key looks like", async () => {
    const workflow = await addWorkflow(world);
    await addRun(world, {
      workflowId: workflow.id,
      // The shape of a scheduled instant, on a run somebody started.
      tickKey: minute(0),
      triggerKind: "manual",
      startedBy: "ana@example.test",
      startedAt: minute(0),
    });
    await addRun(world, {
      workflowId: workflow.id,
      tickKey: "not-an-instant",
      triggerKind: "schedule",
      startedAt: minute(1),
    });

    const page = await world.models.listRuns(SCOPE, {});

    expect(
      page.items.map((run) => [run.tickKey, run.triggerKind, run.startedBy]),
    ).toEqual([
      ["not-an-instant", "schedule", "schedule"],
      [minute(0), "manual", "ana@example.test"],
    ]);
  });

  it("is unreadable, not manual or anonymous, for a run that never recorded its trigger kind or starter", async () => {
    const { ids } = await seedRuns();
    for (const column of ["trigger_kind", "started_by"]) {
      await world.client.query(
        `UPDATE factory_workflow_runs SET ${column} = NULL WHERE id = $1`,
        [ids[0]],
      );
      const error = await failureOf(() => world.models.listRuns(SCOPE, {}));
      expect(error).toBeInstanceOf(WorkflowStoreError);
      expect(error).toMatchObject({ code: "corrupt_record" });
      expect(error.message).toContain(ids[0]);
      await world.client.query(
        "UPDATE factory_workflow_runs SET trigger_kind = 'schedule', started_by = 'schedule' WHERE id = $1",
        [ids[0]],
      );
    }
  });

  it("filters by workflow, status, and mode", async () => {
    const { workflow } = await seedRuns();
    const other = await addWorkflow(world, { name: "Builder to merge" });
    await addRun(world, {
      workflowId: other.id,
      tickKey: "dry-1",
      mode: "dry",
      startedAt: minute(20),
      status: "paused",
      error: { code: "budget_paused", message: "Soft deadline" },
    });

    const all = await world.models.listRuns(SCOPE, {});
    expect(all.items).toHaveLength(6);
    expect(
      (await world.models.listRuns(SCOPE, { workflowId: other.id })).items,
    ).toHaveLength(1);
    expect(
      (await world.models.listRuns(SCOPE, { status: "failed" })).items,
    ).toHaveLength(1);
    expect(
      (await world.models.listRuns(SCOPE, { status: "paused", mode: "dry" }))
        .items[0],
    ).toMatchObject({
      workflowName: "Builder to merge",
      triggerKind: "dry_run",
    });
    expect(
      (
        await world.models.listRuns(SCOPE, {
          workflowId: workflow.id,
          mode: "dry",
        })
      ).items,
    ).toEqual([]);
  });

  it("lists a run that is still running with no finish time", async () => {
    const workflow = await addWorkflow(world);
    await addRun(world, {
      workflowId: workflow.id,
      tickKey: minute(0),
      startedAt: minute(0),
    });
    const [run] = (await world.models.listRuns(SCOPE, {})).items;
    expect(run).toMatchObject({
      status: "running",
      finishedAt: null,
      durationMs: null,
      error: null,
    });
  });

  it("tells an unknown workflow from one with no runs, and never leaks across scopes", async () => {
    const workflow = await addWorkflow(world);
    expect(
      await world.models.listRuns(SCOPE, { workflowId: workflow.id }),
    ).toMatchObject({ items: [], hasMore: false, nextCursor: null });

    const missing = await failureOf(() =>
      world.models.listRuns(SCOPE, { workflowId: "wf_nope" }),
    );
    expect(missing).toMatchObject({ code: "workflow_not_found" });

    await addRun(world, {
      workflowId: workflow.id,
      tickKey: minute(0),
      startedAt: minute(0),
      status: "succeeded",
    });
    for (const scope of [OTHER_FACTORY, OTHER_ORG]) {
      expect((await world.models.listRuns(scope, {})).items).toEqual([]);
      expect(
        await failureOf(() =>
          world.models.listRuns(scope, { workflowId: workflow.id }),
        ),
      ).toMatchObject({ code: "workflow_not_found" });
    }
  });

  it("rejects a cursor that is damaged, from another list, or too long", async () => {
    await seedRuns();
    const runs = await world.models.listRuns(SCOPE, { limit: 1 });
    const items = await world.models.listItems(SCOPE, { limit: 1 });
    expect(items.nextCursor).toBeNull();
    for (const cursor of [
      "not base64 json",
      Buffer.from("{}").toString("base64url"),
      "A".repeat(READ_LIMITS.cursorChars + 1),
    ]) {
      expect(
        await failureOf(() => world.models.listRuns(SCOPE, { cursor })),
      ).toMatchObject({ code: "bad_cursor" });
    }
    expect(runs.nextCursor).not.toBeNull();
    const otherKind = Buffer.from(
      JSON.stringify({ k: "items", at: minute(1), wf: "w", id: "i" }),
    ).toString("base64url");
    expect(
      await failureOf(() =>
        world.models.listRuns(SCOPE, { cursor: otherKind }),
      ),
    ).toBeInstanceOf(WorkflowReadError);
  });

  it("bounds the page size", async () => {
    for (const limit of [0, 101, 1.5]) {
      expect(
        await failureOf(() => world.models.listRuns(SCOPE, { limit })),
      ).toMatchObject({ code: "invalid_input" });
    }
  });

  it("names the table and run when a stored counts column is not JSON", async () => {
    const { ids } = await seedRuns();
    await world.client.query(
      "UPDATE factory_workflow_runs SET counts_json = 'not json' WHERE id = $1",
      [ids[0]],
    );
    const error = await failureOf(() => world.models.listRuns(SCOPE, {}));
    expect(error).toBeInstanceOf(WorkflowStoreError);
    expect(error).toMatchObject({ code: "corrupt_record" });
    expect(error.message).toContain("factory_workflow_runs");
    expect(error.message).toContain(ids[0]);
  });
});

describe("getRun", () => {
  async function seedRunWithSteps() {
    const workflow = await addWorkflow(world);
    const run = await addRun(world, {
      workflowId: workflow.id,
      tickKey: minute(0),
      startedAt: minute(0),
      status: "succeeded",
      finishedAt: minute(1),
      counts: { taken: 40 },
      steps: [
        {
          nodeId: "feedback",
          status: "succeeded",
          startedAt: minute(0),
          finishedAt: minute(0.5),
          ports: {
            out: {
              count: 40,
              itemIds: Array.from({ length: 30 }, (_, i) => `item-${i}`),
            },
          },
          fields: { taken: 40 },
          truncated: { totalAvailable: 120 },
        },
        {
          nodeId: "assess",
          status: "failed",
          startedAt: minute(0.2),
          finishedAt: minute(0.7),
          ports: { out: { count: 0, itemIds: [] } },
          fields: { note: "x".repeat(READ_LIMITS.runStepFieldsBytes + 10) },
          error: { code: "ai_invalid_output", message: "no result" },
          agentThreadId: "thread-9",
          receiptKeys: Array.from({ length: 30 }, (_, i) => `k${i}:a:b:0`),
        },
      ],
    });
    return { workflow, run };
  }

  it("returns the run with its steps, node names, and bounded lists", async () => {
    const { run } = await seedRunWithSteps();
    const detail = await world.models.getRun(SCOPE, run.id);
    expect(detail?.run).toMatchObject({
      id: run.id,
      status: "succeeded",
      counts: { taken: 40 },
      workflowName: "Bug report to Builder",
    });
    expect(detail?.stepsTruncated).toBe(false);
    const [feedback, assess] = detail?.steps ?? [];
    expect(feedback).toMatchObject({
      nodeId: "feedback",
      nodeName: "feedback",
      nodeKind: "source",
      status: "succeeded",
      fields: { taken: 40 },
      fieldsOmitted: false,
      truncated: { totalAvailable: 120 },
    });
    expect(feedback?.ports.out).toMatchObject({
      count: 40,
      itemIdsTruncated: true,
    });
    expect(feedback?.ports.out?.itemIds).toHaveLength(
      READ_LIMITS.runListPerStep,
    );
    expect(assess).toMatchObject({
      status: "failed",
      fields: null,
      fieldsOmitted: true,
      error: { code: "ai_invalid_output", message: "no result" },
      agentThreadId: "thread-9",
      receiptKeysTruncated: true,
    });
    expect(assess?.receiptKeys).toHaveLength(READ_LIMITS.runListPerStep);
  });

  it("reads an older run against the graph version it ran on", async () => {
    const { workflow, run } = await seedRunWithSteps();
    const next = readGraph();
    next.nodes = next.nodes.filter((node) => node.id !== "assess");
    next.edges = [];
    await world.store.saveWorkflowGraph(SCOPE, {
      workflowId: workflow.id,
      expectedVersion: 1,
      graph: next,
      source: "save",
      summary: "Dropped assess",
      createdBy: "owner@example.test",
    });
    const detail = await world.models.getRun(SCOPE, run.id);
    expect(
      detail?.steps.find((step) => step.nodeId === "assess"),
    ).toMatchObject({
      nodeName: "assess",
      nodeKind: "ai",
    });
  });

  it("separates an empty run from a missing one and from another scope", async () => {
    const workflow = await addWorkflow(world);
    const run = await addRun(world, {
      workflowId: workflow.id,
      tickKey: minute(0),
      startedAt: minute(0),
      status: "succeeded",
    });
    expect(await world.models.getRun(SCOPE, run.id)).toMatchObject({
      steps: [],
      stepsTruncated: false,
    });
    expect(await world.models.getRun(SCOPE, "wfr_missing")).toBeNull();
    expect(await world.models.getRun(OTHER_FACTORY, run.id)).toBeNull();
    expect(await world.models.getRun(OTHER_ORG, run.id)).toBeNull();
  });

  it("names the table, run, and node when a step column is not JSON", async () => {
    const { run } = await seedRunWithSteps();
    await world.client.query(
      "UPDATE factory_workflow_steps SET ports_json = '{oops' WHERE run_id = $1 AND node_id = 'assess'",
      [run.id],
    );
    const error = await failureOf(() => world.models.getRun(SCOPE, run.id));
    expect(error).toMatchObject({ code: "corrupt_record" });
    expect(error.message).toContain("factory_workflow_steps");
    expect(error.message).toContain(run.id);
    expect(error.message).toContain("assess");
  });

  it("fails loudly when the run's graph version row is gone", async () => {
    const { run, workflow } = await seedRunWithSteps();
    await world.client.query(
      "DELETE FROM factory_workflow_versions WHERE workflow_id = $1",
      [workflow.id],
    );
    expect(
      await failureOf(() => world.models.getRun(SCOPE, run.id)),
    ).toMatchObject({ code: "corrupt_record" });
  });
});

describe("listItems", () => {
  const reply = (due: string) => ({ wait: "reply" as const, dueAt: due });

  async function seedItems() {
    const workflow = await addWorkflow(world);
    const wf = workflow.id;
    const run = await addRun(world, {
      workflowId: wf,
      tickKey: minute(0),
      startedAt: minute(0),
      status: "succeeded",
    });
    const items = [
      {
        id: "item-alice",
        title: "Alice: Export button does nothing",
        status: "received",
        minute: 0,
      },
      {
        id: "item-bob",
        title: "Bob: Crash on login",
        status: "automation_started",
        minute: 1,
      },
      {
        id: "item-carol",
        title: "Carol: 100% dark_mode flicker",
        status: "dismissed",
        minute: 2,
      },
      {
        id: "item-dan",
        title: "Dan: Billing page returns 500",
        status: "needs_manual",
        minute: 2,
      },
      {
        id: "item-erin",
        title: "Erin: Typo on settings",
        status: "received",
        minute: 3,
      },
    ];
    for (const item of items) {
      await addInboxItem(world, {
        id: item.id,
        title: item.title,
        status: item.status,
        source: item.id === "item-bob" ? "github" : "slack",
      });
      world.at(minute(item.minute));
      await addItemState(world, {
        workflowId: wf,
        itemId: item.id,
        ...(item.id === "item-alice"
          ? { parkAt: { nodeId: "hold", wake: reply(minute(60)) } }
          : {}),
      });
    }
    return { workflow, wf, run };
  }

  it("pages by recent activity across a cursor, ties included", async () => {
    await seedItems();
    const everything = await world.models.listItems(SCOPE, { limit: 100 });
    // Dan and Carol share an instant, ordered by item id, newest first.
    expect(everything.items.map((row) => row.itemId)).toEqual([
      "item-erin",
      "item-dan",
      "item-carol",
      "item-bob",
      "item-alice",
    ]);

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await world.models.listItems(SCOPE, {
        limit: 2,
        ...(cursor === undefined ? {} : { cursor }),
      });
      seen.push(...page.items.map((row) => row.itemId));
      expect(page.hasMore).toBe(page.nextCursor !== null);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(seen).toEqual(everything.items.map((row) => row.itemId));
  });

  it("shows the title, source, status, where the item is, and its last event", async () => {
    const { wf, run } = await seedItems();
    await addEvents(world, SCOPE, [
      {
        workflowId: wf,
        runId: run.id,
        itemId: "item-alice",
        nodeId: "assess",
        kind: "output",
        at: minute(0.1),
        summary: "clear false",
      },
      {
        workflowId: wf,
        runId: run.id,
        itemId: "item-alice",
        nodeId: "hold",
        kind: "parked",
        at: minute(0.2),
        summary: "waiting for a reply",
      },
      // A dry run's event is not the item's latest live word.
      {
        workflowId: wf,
        runId: run.id,
        itemId: "item-alice",
        nodeId: "finish",
        kind: "ended",
        outcome: "done",
        at: minute(0.3),
        mode: "dry",
        summary: "done",
      },
    ]);
    const alice = (await world.models.listItems(SCOPE, { search: "Alice" }))
      .items[0];
    expect(alice).toMatchObject({
      workflowId: wf,
      workflowName: "Bug report to Builder",
      inbox: true,
      title: "Alice: Export button does nothing",
      source: "slack",
      status: "received",
      graphVersion: 1,
      attempts: 0,
      needsYouReasons: [],
      lease: null,
      parked: {
        nodeId: "hold",
        nodeName: "hold",
        nodeMissingFromGraph: false,
        wait: "reply",
        dueAt: minute(60),
        nextCheckAt: null,
        watching: null,
      },
      lastNode: { nodeId: "hold", nodeName: "hold" },
      lastEvent: {
        at: minute(0.2),
        kind: "parked",
        nodeId: "hold",
        summary: "waiting for a reply",
        summaryTruncated: false,
      },
      lastActivityAt: minute(0),
    });
  });

  it("says whether an item's lease is still live", async () => {
    const workflow = await addWorkflow(world);
    world.at(minute(0));
    await addItemState(world, {
      workflowId: workflow.id,
      itemId: "held",
      leasedBy: "seed",
    });
    const early = (await world.models.listItems(SCOPE, {})).items[0];
    expect(early?.lease).toMatchObject({ by: "seed", live: true });
    world.at(minute(120));
    const late = (await world.models.listItems(SCOPE, {})).items[0];
    expect(late?.lease).toMatchObject({ by: "seed", live: false });
  });

  it("filters by workflow, status set, source, parked, and search", async () => {
    const { workflow, wf } = await seedItems();
    const other = await addWorkflow(world, { name: "Builder to merge" });
    await addInboxItem(world, { id: "item-frank", title: "Frank: CSV header" });
    await addItemState(world, { workflowId: other.id, itemId: "item-frank" });

    const ids = async (filters: Parameters<typeof world.models.listItems>[1]) =>
      (await world.models.listItems(SCOPE, filters)).items
        .map((row) => row.itemId)
        .sort();

    expect(await ids({ workflowId: other.id })).toEqual(["item-frank"]);
    expect(await ids({ workflowId: wf })).toHaveLength(5);
    expect(await ids({ status: ["dismissed", "needs_manual"] })).toEqual([
      "item-carol",
      "item-dan",
    ]);
    expect(await ids({ source: "github" })).toEqual(["item-bob"]);
    expect(await ids({ parked: true })).toEqual(["item-alice"]);
    expect(await ids({ parked: false })).toHaveLength(5);
    // A search is a substring, and % and _ in it are letters, not wildcards.
    expect(await ids({ search: "dark_mode" })).toEqual(["item-carol"]);
    expect(await ids({ search: "100%" })).toEqual(["item-carol"]);
    expect(await ids({ search: "dark%mode" })).toEqual([]);
    expect(await ids({ search: "ITEM-ERIN" })).toEqual(["item-erin"]);
    expect(await ids({ search: "billing" })).toEqual(["item-dan"]);
    expect(
      await ids({
        workflowId: workflow.id,
        status: ["received"],
        search: "typo",
      }),
    ).toEqual(["item-erin"]);
  });

  it("flags the items a person has to look at, and clears them when the trail moves on", async () => {
    const { wf, run } = await seedItems();
    // The summary is deliberately no help: the flag is read from the outcome and the code.
    const event = (
      itemId: string,
      at: string,
      kind: "ended" | "error" | "taken" | "woke",
      detail: Pick<ItemEvent, "outcome" | "code"> = {},
    ) => ({
      workflowId: wf,
      runId: run.id,
      itemId,
      kind,
      at,
      summary: "see the journey",
      ...detail,
    });

    // 1. An inbox item answers by its status: Dan is `needs_manual`.
    // 2. A synthetic item has no status, so its last signal decides.
    for (const id of ["group-1", "group-2"]) {
      world.at(minute(10));
      await addItemState(world, { workflowId: wf, itemId: id });
    }
    await addEvents(world, SCOPE, [
      event("group-1", minute(10), "ended", { outcome: "needsManual" }),
      event("group-2", minute(10), "ended", { outcome: "needsManual" }),
      // A person reopened group-2 and the workflow took it again.
      event("group-2", minute(11), "taken"),
    ]);
    // 3. Attempts spent, last word an error.
    await addInboxItem(world, { id: "item-spent", title: "Spent" });
    await addInboxItem(world, { id: "item-recovered", title: "Recovered" });
    for (const id of ["item-spent", "item-recovered"]) {
      world.at(minute(12));
      await addItemState(world, { workflowId: wf, itemId: id, attempts: 3 });
    }
    await addEvents(world, SCOPE, [
      event("item-spent", minute(12), "error", { code: "provider_error" }),
      event("item-recovered", minute(12), "error", { code: "provider_error" }),
      event("item-recovered", minute(13), "ended", { outcome: "done" }),
    ]);
    // 4. A write that may have happened.
    await addInboxItem(world, { id: "item-check", title: "Check" });
    world.at(minute(14));
    await addItemState(world, { workflowId: wf, itemId: "item-check" });
    await addEvents(world, SCOPE, [
      event("item-check", minute(14), "error", { code: "effect_needs_check" }),
    ]);
    // 5. A person resolved Bob in the inbox, so an old needsManual end no longer counts.
    await addEvents(world, SCOPE, [
      event("item-bob", minute(1), "ended", { outcome: "needsManual" }),
    ]);
    // 6. Other ends and other errors flag nothing: a synthetic item that was
    // released, dismissed, or done, and one whose last word was an ordinary
    // failure with attempts to spare, whatever their summaries say.
    for (const id of ["group-done", "group-released", "group-failed"]) {
      world.at(minute(15));
      await addItemState(world, { workflowId: wf, itemId: id });
    }
    await addEvents(world, SCOPE, [
      {
        ...event("group-done", minute(15), "ended", { outcome: "done" }),
        summary: "needsManual: looks like a hand-off but is not",
      },
      {
        ...event("group-released", minute(15), "ended", {
          outcome: "released",
        }),
        summary: "ended:needsManual",
      },
      {
        ...event("group-failed", minute(15), "error", {
          code: "provider_error",
        }),
        summary: "effect_needs_check: not that either",
      },
    ]);

    const flagged = await world.models.listItems(SCOPE, {
      needsYou: true,
      limit: 100,
    });
    const byId = Object.fromEntries(
      flagged.items.map((row) => [row.itemId, row.needsYouReasons]),
    );
    expect(byId).toEqual({
      "item-dan": ["handed_off"],
      "group-1": ["handed_off"],
      "item-spent": ["attempts_exhausted"],
      "item-check": ["effect_needs_check"],
    });
    // The flag on an unfiltered list is the same one the filter used.
    const all = await world.models.listItems(SCOPE, { limit: 100 });
    expect(
      all.items
        .filter((row) => row.needsYouReasons.length > 0)
        .map((row) => row.itemId)
        .sort(),
    ).toEqual(Object.keys(byId).sort());
    expect(all.items.find((row) => row.itemId === "group-1")).toMatchObject({
      inbox: false,
      title: null,
      source: null,
      status: null,
    });
  });

  it.each([
    ["outcome", "ended", "finished"],
    ["code", "error", "no_such_code"],
  ])(
    "refuses to list an item whose newest event has a stored %s outside the contract, filtered or not, instead of reading it as nothing to see",
    async (column, kind, value) => {
      const { wf, run } = await seedItems();
      world.at(minute(10));
      await addItemState(world, { workflowId: wf, itemId: "group-1" });
      await addEvents(world, SCOPE, [
        {
          workflowId: wf,
          runId: run.id,
          itemId: "group-1",
          kind: kind as "ended" | "error",
          ...(kind === "ended"
            ? { outcome: "done" as const }
            : { code: "provider_error" as const }),
          at: minute(10),
          summary: "see the journey",
        },
      ]);
      await world.client.query(
        `UPDATE factory_workflow_item_events SET ${column} = $1 WHERE item_id = 'group-1'`,
        [value],
      );

      for (const needsYou of [undefined, true]) {
        const error = await failureOf(() =>
          world.models.listItems(SCOPE, {
            limit: 100,
            ...(needsYou === undefined ? {} : { needsYou }),
          }),
        );
        expect(error).toBeInstanceOf(WorkflowStoreError);
        expect(error).toMatchObject({ code: "corrupt_record" });
        expect(error.message).toContain("group-1");
      }
    },
  );
  it("tells an unknown workflow from one with no items, and never leaks across scopes", async () => {
    const { wf } = await seedItems();
    const empty = await addWorkflow(world, { name: "Empty" });
    expect(
      await world.models.listItems(SCOPE, { workflowId: empty.id }),
    ).toMatchObject({ items: [], hasMore: false });
    expect(
      await failureOf(() =>
        world.models.listItems(SCOPE, { workflowId: "wf_nope" }),
      ),
    ).toMatchObject({ code: "workflow_not_found" });
    for (const scope of [OTHER_FACTORY, OTHER_ORG]) {
      expect((await world.models.listItems(scope, {})).items).toEqual([]);
      expect(
        await failureOf(() =>
          world.models.listItems(scope, { workflowId: wf }),
        ),
      ).toMatchObject({ code: "workflow_not_found" });
    }
  });

  it("does not join another factory's inbox row to an item", async () => {
    const workflow = await addWorkflow(world);
    await addInboxItem(world, {
      id: "shared-id",
      scope: OTHER_FACTORY,
      title: "Not ours",
    });
    await addItemState(world, { workflowId: workflow.id, itemId: "shared-id" });
    const [row] = (await world.models.listItems(SCOPE, {})).items;
    expect(row).toMatchObject({ inbox: false, title: null, status: null });
  });

  it("names the table and item when stored counters or a parking row are damaged", async () => {
    const { wf } = await seedItems();
    await world.client.query(
      "UPDATE factory_workflow_item_state SET counters_json = '[1' WHERE item_id = 'item-bob'",
    );
    const error = await failureOf(() => world.models.listItems(SCOPE, {}));
    expect(error).toMatchObject({ code: "corrupt_record" });
    expect(error.message).toContain("factory_workflow_item_state");
    expect(error.message).toContain("item-bob");
    // The needs-you filter reads the counter as text, so a damaged row cannot
    // fail the query; it only fails a page that returns it.
    const flagged = await world.models.listItems(SCOPE, { needsYou: true });
    expect(flagged.items.map((row) => row.itemId)).toEqual(["item-dan"]);
    await world.client.query(
      "UPDATE factory_workflow_item_state SET counters_json = '{}' WHERE item_id = 'item-bob'",
    );
    await world.client.query(
      "UPDATE factory_workflow_item_state SET wake_json = NULL WHERE item_id = 'item-alice'",
    );
    const parked = await failureOf(() =>
      world.models.listItems(SCOPE, { workflowId: wf }),
    );
    expect(parked).toMatchObject({ code: "corrupt_record" });
    expect(parked.message).toContain("item-alice");
  });

  it("returns no large text: only the columns a row shows", async () => {
    const { wf } = await seedItems();
    await world.client.query(
      "UPDATE factory_workflow_item_state SET context_json = $1 WHERE item_id = 'item-alice'",
      [JSON.stringify({ big: "x".repeat(8000) })],
    );
    const alice = (
      await world.models.listItems(SCOPE, { workflowId: wf, search: "alice" })
    ).items[0];
    expect(JSON.stringify(alice).length).toBeLessThan(2000);
    expect(alice).not.toHaveProperty("context");
  });
});

describe("getItemJourney", () => {
  const keyOf = (wf: string, itemId: string, nodeId: string, attempt = 0) =>
    receiptKey({ workflowId: wf, itemId, nodeId, attempt });

  async function seedJourney() {
    const workflow = await addWorkflow(world);
    const wf = workflow.id;
    await addInboxItem(world, {
      id: "item-alice",
      title: "Alice: Export button does nothing",
      status: "automation_started",
      sourceUrl: "https://slack.example.test/p1",
    });
    world.at(minute(41));
    await addItemState(world, { workflowId: wf, itemId: "item-alice" });

    const keyReply = keyOf(wf, "item-alice", "reply");
    const keyTell = keyOf(wf, "item-alice", "tell");
    const keyOther = keyOf(wf, "item-bob", "reply");
    const runA = await addRun(world, {
      workflowId: wf,
      tickKey: minute(0),
      startedAt: minute(0),
      status: "succeeded",
      steps: [
        {
          nodeId: "feedback",
          status: "succeeded",
          ports: { out: { count: 2, itemIds: ["item-alice", "item-bob"] } },
        },
        {
          nodeId: "assess",
          status: "succeeded",
          startedAt: minute(0.1),
          ports: { out: { count: 1, itemIds: ["item-alice"] } },
        },
        {
          nodeId: "reply",
          status: "succeeded",
          startedAt: minute(0.2),
          ports: { out: { count: 2, itemIds: ["item-alice", "item-bob"] } },
          receiptKeys: [keyReply, keyOther],
        },
        {
          nodeId: "manual",
          status: "succeeded",
          startedAt: minute(0.4),
          ports: {},
        },
      ],
    });
    const runB = await addRun(world, {
      workflowId: wf,
      tickKey: minute(40),
      startedAt: minute(40),
      status: "succeeded",
      steps: [
        {
          nodeId: "assess",
          status: "succeeded",
          ports: { out: { count: 1, itemIds: ["item-alice"] } },
        },
        {
          nodeId: "tell",
          status: "succeeded",
          startedAt: minute(40.2),
          ports: { out: { count: 1, itemIds: ["item-alice"] } },
          receiptKeys: [keyTell],
        },
      ],
    });
    const at = (
      run: { id: string },
      n: number,
      event: {
        kind: ItemEventKind;
        nodeId: string;
        summary: string;
        receiptKey?: string;
        outcome?: ItemEvent["outcome"];
      },
    ) => ({
      workflowId: wf,
      runId: run.id,
      itemId: "item-alice",
      at: minute(n),
      ...event,
    });
    await addEvents(world, SCOPE, [
      at(runA, 0, {
        kind: "taken",
        nodeId: "feedback",
        summary: "taken from #feedback",
      }),
      at(runA, 0.1, {
        kind: "output",
        nodeId: "assess",
        summary: "clear false",
      }),
      at(runA, 0.2, {
        kind: "effect",
        nodeId: "reply",
        receiptKey: keyReply,
        summary: "asked a question",
      }),
      at(runA, 0.3, {
        kind: "parked",
        nodeId: "hold",
        summary: "waiting for a reply",
      }),
      at(runB, 40, {
        kind: "woke",
        nodeId: "hold",
        summary: "reply from Alice",
      }),
      at(runB, 40.1, {
        kind: "output",
        nodeId: "assess",
        summary: "clear true",
      }),
      at(runB, 40.2, {
        kind: "effect",
        nodeId: "tell",
        receiptKey: keyTell,
        summary: "told the thread",
      }),
      at(runB, 40.3, {
        kind: "ended",
        outcome: "done",
        nodeId: "finish",
        summary: "done (status resolved)",
      }),
      // Another item's trail on the same run never shows up.
      {
        workflowId: wf,
        runId: runA.id,
        itemId: "item-bob",
        at: minute(0.15),
        kind: "output" as const,
        nodeId: "assess",
        summary: "bob's",
      },
    ]);
    await addReceipt(world, SCOPE, wf, {
      key: keyReply,
      status: "done",
      externalRef: "1760000000.000100",
      url: "https://slack.example.test/p2",
      at: minute(0.25),
    });
    await addReceipt(world, SCOPE, wf, {
      key: keyTell,
      status: "done",
      externalRef: "1760000200.000200",
      at: minute(40.25),
    });
    await addReceipt(world, SCOPE, wf, {
      key: keyOther,
      status: "done",
      at: minute(0.25),
    });
    return { wf, runA, runB, keyReply, keyTell };
  }

  it("reads one item's whole path in order, with the route as node ids", async () => {
    const { wf, runA, runB, keyReply, keyTell } = await seedJourney();
    const journey = await world.models.getItemJourney(SCOPE, {
      workflowId: wf,
      itemId: "item-alice",
    });

    expect(journey.workflow).toMatchObject({ id: wf, version: 1 });
    expect(journey.item).toEqual({
      id: "item-alice",
      inbox: true,
      title: "Alice: Export button does nothing",
      source: "slack",
      sourceUrl: "https://slack.example.test/p1",
      status: "automation_started",
    });
    expect(journey.events.map((event) => [event.kind, event.nodeId])).toEqual([
      ["taken", "feedback"],
      ["output", "assess"],
      ["effect", "reply"],
      ["parked", "hold"],
      ["woke", "hold"],
      ["output", "assess"],
      ["effect", "tell"],
      ["ended", "finish"],
    ]);
    expect(journey.events[2]).toMatchObject({
      runId: runA.id,
      nodeName: "reply",
      receiptKey: keyReply,
      mode: "live",
      summary: "asked a question",
      summaryTruncated: false,
    });
    expect(journey.events[7]?.runId).toBe(runB.id);
    expect(journey.eventsHasMore).toBe(false);
    expect(journey.olderCursor).toBeNull();

    // `assess` and `hold` were reached in two different runs.
    expect(
      journey.path.map((node) => [node.nodeId, node.visits, node.nodeKind]),
    ).toEqual([
      ["feedback", 1, "source"],
      ["assess", 2, "ai"],
      ["reply", 1, "action"],
      ["hold", 2, "wait"],
      ["tell", 1, "action"],
      ["finish", 1, "end"],
    ]);
    expect(journey.path[1]).toMatchObject({
      firstAt: minute(0.1),
      lastAt: minute(40.1),
    });

    // Steps are the (run, node) pairs the item's events name, nothing more.
    expect(
      journey.steps.map((step) => [step.runId, step.nodeId, step.ports]),
    ).toEqual([
      [runA.id, "feedback", ["out"]],
      [runA.id, "assess", ["out"]],
      [runA.id, "reply", ["out"]],
      [runB.id, "assess", ["out"]],
      [runB.id, "tell", ["out"]],
    ]);
    expect(journey.steps[2]?.receiptKeys).toEqual([keyReply]);

    expect(journey.receipts.map((receipt) => receipt.key)).toEqual([
      keyReply,
      keyTell,
    ]);
    expect(journey.receipts[0]).toMatchObject({
      status: "done",
      externalRef: "1760000000.000100",
      url: "https://slack.example.test/p2",
      itemId: "item-alice",
      nodeId: "reply",
      attempt: 0,
    });
    expect(journey.state).toMatchObject({
      parked: null,
      lease: null,
      attempts: 0,
      needsYouReasons: [],
    });
  });

  it("pages older events behind a cursor, and the path still covers every event", async () => {
    const { wf } = await seedJourney();
    const newest = await world.models.getItemJourney(SCOPE, {
      workflowId: wf,
      itemId: "item-alice",
      limit: 3,
    });
    expect(newest.events.map((event) => event.kind)).toEqual([
      "output",
      "effect",
      "ended",
    ]);
    expect(newest.eventsHasMore).toBe(true);
    expect(newest.path).toHaveLength(6);

    const ids = newest.events.map((event) => event.id);
    let cursor = newest.olderCursor ?? undefined;
    while (cursor !== undefined) {
      const older = await world.models.getItemJourney(SCOPE, {
        workflowId: wf,
        itemId: "item-alice",
        limit: 3,
        cursor,
      });
      // Each older page reads oldest first, and lies wholly before the last.
      ids.unshift(...older.events.map((event) => event.id));
      cursor = older.olderCursor ?? undefined;
    }
    const whole = await world.models.getItemJourney(SCOPE, {
      workflowId: wf,
      itemId: "item-alice",
    });
    expect(ids).toEqual(whole.events.map((event) => event.id));
    expect(new Set(ids).size).toBe(8);
  });

  it("keeps dry-run events, badged, and an item that only ever ran dry has no state", async () => {
    const { wf, runA } = await seedJourney();
    await addEvents(world, SCOPE, [
      {
        workflowId: wf,
        runId: runA.id,
        itemId: "item-dry",
        kind: "output",
        nodeId: "assess",
        at: minute(5),
        mode: "dry",
        summary: "would call slack.postMessage",
      },
    ]);
    const journey = await world.models.getItemJourney(SCOPE, {
      workflowId: wf,
      itemId: "item-dry",
    });
    expect(journey.state).toBeNull();
    expect(journey.item).toMatchObject({
      inbox: false,
      title: null,
      status: null,
    });
    expect(journey.events).toMatchObject([{ mode: "dry" }]);
  });

  it("shows where a parked item waits and why a person has to look", async () => {
    const workflow = await addWorkflow(world);
    world.at(minute(0));
    await addItemState(world, {
      workflowId: workflow.id,
      itemId: "item-wait",
      parkAt: {
        nodeId: "hold",
        wake: {
          wait: "reply",
          dueAt: minute(60),
          nextCheckAt: minute(15),
          thread: { channelId: "C1", threadTs: "1760000000.000100" },
        },
      },
      attempts: 2,
    });
    const journey = await world.models.getItemJourney(SCOPE, {
      workflowId: workflow.id,
      itemId: "item-wait",
    });
    expect(journey.events).toEqual([]);
    expect(journey.state).toMatchObject({
      attempts: 2,
      parked: {
        nodeId: "hold",
        nodeName: "hold",
        wait: "reply",
        dueAt: minute(60),
        nextCheckAt: minute(15),
        watching: { channelId: "C1", threadTs: "1760000000.000100" },
      },
    });
  });

  it("tells a missing item from an empty one, and stays inside its scope", async () => {
    const { wf } = await seedJourney();
    const missing = await failureOf(() =>
      world.models.getItemJourney(SCOPE, {
        workflowId: wf,
        itemId: "item-nope",
      }),
    );
    expect(missing).toMatchObject({ code: "item_not_found" });
    expect(
      await failureOf(() =>
        world.models.getItemJourney(SCOPE, {
          workflowId: "wf_nope",
          itemId: "item-alice",
        }),
      ),
    ).toMatchObject({ code: "workflow_not_found" });
    for (const scope of [OTHER_FACTORY, OTHER_ORG]) {
      expect(
        await failureOf(() =>
          world.models.getItemJourney(scope, {
            workflowId: wf,
            itemId: "item-alice",
          }),
        ),
      ).toMatchObject({ code: "workflow_not_found" });
    }
  });

  it("bounds the page and refuses a damaged cursor", async () => {
    const { wf } = await seedJourney();
    for (const limit of [0, READ_LIMITS.journeyEventsMax + 1]) {
      expect(
        await failureOf(() =>
          world.models.getItemJourney(SCOPE, {
            workflowId: wf,
            itemId: "item-alice",
            limit,
          }),
        ),
      ).toMatchObject({ code: "invalid_input" });
    }
    expect(
      await failureOf(() =>
        world.models.getItemJourney(SCOPE, {
          workflowId: wf,
          itemId: "item-alice",
          cursor: "garbage",
        }),
      ),
    ).toMatchObject({ code: "bad_cursor" });
  });

  it("fails loudly on a damaged event or a step that lists a foreign receipt key", async () => {
    const { wf, runA } = await seedJourney();
    await world.client.query(
      "UPDATE factory_workflow_steps SET receipt_keys_json = '[\"nope\"]' WHERE run_id = $1 AND node_id = 'reply'",
      [runA.id],
    );
    const step = await failureOf(() =>
      world.models.getItemJourney(SCOPE, {
        workflowId: wf,
        itemId: "item-alice",
      }),
    );
    expect(step).toMatchObject({ code: "corrupt_record" });
    expect(step.message).toContain("factory_workflow_steps");

    await world.client.query(
      "UPDATE factory_workflow_steps SET receipt_keys_json = NULL WHERE run_id = $1 AND node_id = 'reply'",
      [runA.id],
    );
    const [event] = await rows(
      world,
      "SELECT id FROM factory_workflow_item_events WHERE item_id = 'item-alice' LIMIT 1",
    );
    await world.client.query(
      "UPDATE factory_workflow_item_events SET kind = 'bogus' WHERE id = $1",
      [event?.id],
    );
    const bad = await failureOf(() =>
      world.models.getItemJourney(SCOPE, {
        workflowId: wf,
        itemId: "item-alice",
      }),
    );
    expect(bad).toMatchObject({ code: "corrupt_record" });
    expect(bad.message).toContain("factory_workflow_item_events");
    expect(bad.message).toContain(String(event?.id));
  });
});

describe("listParked", () => {
  async function seedParked() {
    const workflow = await addWorkflow(world);
    const wf = workflow.id;
    const parkedAt = [
      ["p-late", "hold", 30],
      ["p-soon", "hold", 10],
      ["p-mid", "hold", 20],
      ["p-tie", "hold", 20],
      ["p-tell", "tell", 15],
      ["p-ghost", "ghost", 5],
    ] as const;
    for (const [itemId, nodeId, due] of parkedAt) {
      await addInboxItem(world, { id: itemId, title: `Report ${itemId}` });
      world.at(minute(0));
      await addItemState(world, {
        workflowId: wf,
        itemId,
        attempts: itemId === "p-soon" ? 1 : undefined,
        parkAt: {
          nodeId,
          wake: {
            wait: nodeId === "tell" ? "time" : "reply",
            dueAt: minute(due),
            ...(nodeId === "hold" ? { nextCheckAt: minute(due - 5) } : {}),
          },
        },
      });
    }
    await addItemState(world, { workflowId: wf, itemId: "not-parked" });
    return { wf };
  }

  it("lists parked items soonest first, with node, wake, and counters", async () => {
    const { wf } = await seedParked();
    const page = await world.models.listParked(SCOPE, { workflowId: wf });
    expect(page.items.map((row) => row.itemId)).toEqual([
      "p-ghost",
      "p-soon",
      "p-tell",
      "p-mid",
      "p-tie",
      "p-late",
    ]);
    expect(page.items[1]).toMatchObject({
      itemId: "p-soon",
      inbox: true,
      title: "Report p-soon",
      attempts: 1,
      counters: { attempts: 1 },
      parked: {
        nodeId: "hold",
        nodeName: "hold",
        wait: "reply",
        dueAt: minute(10),
        nextCheckAt: minute(5),
        nodeMissingFromGraph: false,
      },
    });
    expect(page.items[2]?.parked).toMatchObject({
      wait: "time",
      nextCheckAt: null,
    });
    // A node that left the graph while items waited at it is said so.
    expect(page.items[0]?.parked).toMatchObject({
      nodeId: "ghost",
      nodeName: null,
      nodeMissingFromGraph: true,
    });
  });

  it("pages across a cursor, ties included, and filters by node", async () => {
    const { wf } = await seedParked();
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await world.models.listParked(SCOPE, {
        workflowId: wf,
        limit: 2,
        ...(cursor === undefined ? {} : { cursor }),
      });
      seen.push(...page.items.map((row) => row.itemId));
      expect(page.hasMore).toBe(page.nextCursor !== null);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(seen).toEqual([
      "p-ghost",
      "p-soon",
      "p-tell",
      "p-mid",
      "p-tie",
      "p-late",
    ]);

    const onHold = await world.models.listParked(SCOPE, {
      workflowId: wf,
      nodeId: "hold",
    });
    expect(onHold.items.map((row) => row.itemId)).toEqual([
      "p-soon",
      "p-mid",
      "p-tie",
      "p-late",
    ]);
  });

  it("counts what waits at each node, and when the next one is due", async () => {
    const { wf } = await seedParked();
    const { byNode, byNodeTruncated } = await world.models.listParked(SCOPE, {
      workflowId: wf,
      limit: 1,
    });
    expect(byNodeTruncated).toBe(false);
    expect(byNode).toEqual([
      { nodeId: "ghost", nodeName: null, count: 1, nextDueAt: minute(5) },
      { nodeId: "hold", nodeName: "hold", count: 4, nextDueAt: minute(10) },
      { nodeId: "tell", nodeName: "tell", count: 1, nextDueAt: minute(15) },
    ]);
  });

  it("tells a workflow with nothing parked from one that does not exist, within scope", async () => {
    const workflow = await addWorkflow(world);
    expect(
      await world.models.listParked(SCOPE, { workflowId: workflow.id }),
    ).toMatchObject({ items: [], byNode: [], hasMore: false });
    expect(
      await failureOf(() =>
        world.models.listParked(SCOPE, { workflowId: "wf_nope" }),
      ),
    ).toMatchObject({ code: "workflow_not_found" });
    expect(
      await failureOf(() =>
        world.models.listParked(OTHER_FACTORY, { workflowId: workflow.id }),
      ),
    ).toMatchObject({ code: "workflow_not_found" });
  });

  it("names the table and item when a parked row's counters are damaged", async () => {
    const { wf } = await seedParked();
    await world.client.query(
      "UPDATE factory_workflow_item_state SET counters_json = 'x' WHERE item_id = 'p-mid'",
    );
    const error = await failureOf(() =>
      world.models.listParked(SCOPE, { workflowId: wf }),
    );
    expect(error).toMatchObject({ code: "corrupt_record" });
    expect(error.message).toContain("factory_workflow_item_state");
    expect(error.message).toContain("p-mid");
  });
});

describe("an item journey's structured events", () => {
  async function seedTrail() {
    const workflow = await addWorkflow(world);
    const wf = workflow.id;
    const run = await addRun(world, {
      workflowId: wf,
      tickKey: minute(0),
      startedAt: minute(0),
    });
    const base = { workflowId: wf, runId: run.id, itemId: "item-x" };
    await addEvents(world, SCOPE, [
      { ...base, kind: "taken", at: minute(0), summary: "taken" },
      {
        ...base,
        kind: "error",
        code: "provider_error",
        at: minute(1),
        summary: "provider_error: HubSpot returned 401",
      },
      {
        ...base,
        kind: "ended",
        outcome: "needsManual",
        at: minute(2),
        summary: "needsManual: gave up",
      },
    ]);
    return wf;
  }

  it("says how an item ended and why it failed in fields of their own", async () => {
    const wf = await seedTrail();

    const journey = await world.models.getItemJourney(SCOPE, {
      workflowId: wf,
      itemId: "item-x",
    });

    expect(
      journey.events.map((event) => [event.kind, event.outcome, event.code]),
    ).toEqual([
      ["taken", null, null],
      ["error", null, "provider_error"],
      ["ended", "needsManual", null],
    ]);
  });

  it.each([
    ["outcome", "ended", "finished"],
    ["code", "error", "no_such_code"],
  ])(
    "is unreadable, never skipped, when a stored %s is outside the contract",
    async (column, kind, value) => {
      const wf = await seedTrail();
      await world.client.query(
        `UPDATE factory_workflow_item_events SET ${column} = $1 WHERE kind = $2`,
        [value, kind],
      );

      const error = await failureOf(() =>
        world.models.getItemJourney(SCOPE, {
          workflowId: wf,
          itemId: "item-x",
        }),
      );

      expect(error).toBeInstanceOf(WorkflowStoreError);
      expect(error).toMatchObject({ code: "corrupt_record" });
      expect(error.message).toContain("factory_workflow_item_events");
      expect(error.message).toContain(column);
    },
  );
});

describe("getNodeAudit", () => {
  const keyOf = (wf: string, itemId: string, nodeId: string, attempt = 0) =>
    receiptKey({ workflowId: wf, itemId, nodeId, attempt });
  const seconds = (base: string, n: number) =>
    new Date(Date.parse(base) + n * 1000).toISOString();

  async function seedAudit() {
    const workflow = await addWorkflow(world);
    const wf = workflow.id;
    for (const [id, title] of [
      ["item-a", "Alice report"],
      ["item-b", "Bob report"],
      ["item-c", "Carol report"],
    ] as const) {
      await addInboxItem(world, { id, title });
    }
    const durations = [2, 4, 6, 8];
    const runs = [];
    for (const [index, seconds_] of durations.entries()) {
      const startedAt = minute(index * 10);
      const failed = index === 2;
      runs.push(
        await addRun(world, {
          workflowId: wf,
          tickKey: startedAt,
          startedAt,
          status: failed ? "failed" : "succeeded",
          ...(failed
            ? {
                error: {
                  code: "ai_invalid_output" as const,
                  message: "no result",
                },
              }
            : {}),
          steps: [
            {
              nodeId: "feedback",
              status: "succeeded",
              ports: {
                out: { count: 3, itemIds: ["item-a", "item-b", "item-c"] },
              },
            },
            {
              nodeId: "assess",
              status: failed ? "failed" : "succeeded",
              finishedAt: seconds(startedAt, seconds_),
              ports: {
                out: {
                  count: failed ? 0 : 3,
                  itemIds: failed ? [] : ["item-a", "item-b", "item-c"],
                },
              },
              ...(failed
                ? {
                    error: {
                      code: "ai_invalid_output" as const,
                      message: "no result",
                    },
                  }
                : {}),
            },
          ],
        }),
      );
    }
    const dryStart = minute(40);
    const dry = await addRun(world, {
      workflowId: wf,
      tickKey: "dry-1",
      mode: "dry",
      startedAt: dryStart,
      status: "succeeded",
      steps: [
        {
          nodeId: "assess",
          status: "succeeded",
          finishedAt: seconds(dryStart, 1),
          ports: { out: { count: 1, itemIds: ["item-a"] } },
        },
      ],
    });
    const [r1, r2, r3, r4] = runs;
    await addEvents(world, SCOPE, [
      {
        workflowId: wf,
        runId: r4!.id,
        itemId: "item-a",
        kind: "output",
        nodeId: "assess",
        at: minute(30.1),
        summary: "clear false",
      },
      {
        workflowId: wf,
        runId: r4!.id,
        itemId: "item-b",
        kind: "output",
        nodeId: "assess",
        at: minute(30.2),
        summary: "x".repeat(READ_LIMITS.shortSummaryChars + 50),
      },
      {
        workflowId: wf,
        runId: r3!.id,
        itemId: "item-c",
        kind: "error",
        code: "ai_invalid_output",
        nodeId: "assess",
        at: minute(20.1),
        summary: "ai_invalid_output: no result",
      },
    ]);
    return { wf, r1: r1!, r2: r2!, r3: r3!, r4: r4!, dry };
  }

  it("counts what the node did across its recent steps", async () => {
    const { wf } = await seedAudit();
    const audit = await world.models.getNodeAudit(SCOPE, {
      workflowId: wf,
      nodeId: "assess",
    });
    expect(audit.node).toEqual({ id: "assess", name: "assess", kind: "ai" });
    expect(audit.graphVersion).toBe(1);
    expect(audit.summary).toMatchObject({
      steps: 5,
      statusCounts: {
        succeeded: 4,
        failed: 1,
        running: 0,
        skipped: 0,
        needs_check: 0,
      },
      modeCounts: { live: 4, dry: 1, test: 0 },
      failureRate: 0.2,
      durationMs: { p50: 4000, p95: 8000, samples: 5 },
    });
    expect(audit.steps.map((step) => [step.mode, step.status])).toEqual([
      ["dry", "succeeded"],
      ["live", "succeeded"],
      ["live", "failed"],
      ["live", "succeeded"],
      ["live", "succeeded"],
    ]);
    expect(audit.steps[2]).toMatchObject({
      error: { code: "ai_invalid_output", message: "no result" },
      triggerKind: "schedule",
      ports: { out: 0 },
    });
    expect(audit.steps[0]?.triggerKind).toBe("dry_run");
    expect(audit.hasMoreSteps).toBe(false);

    const live = await world.models.getNodeAudit(SCOPE, {
      workflowId: wf,
      nodeId: "assess",
      mode: "live",
    });
    expect(live.summary).toMatchObject({
      steps: 4,
      failureRate: 0.25,
      durationMs: { p50: 4000, p95: 8000, samples: 4 },
    });
  });

  it("samples the items that went in and out of the newest step, with short summaries", async () => {
    const { wf, r4 } = await seedAudit();
    const audit = await world.models.getNodeAudit(SCOPE, {
      workflowId: wf,
      nodeId: "assess",
      mode: "live",
    });
    expect(audit.latest?.runId).toBe(r4.id);
    expect(audit.latest?.in).toEqual([
      {
        edgeId: "e2",
        fromNodeId: "feedback",
        fromPort: "out",
        count: 3,
        itemsTruncated: false,
        items: [
          {
            itemId: "item-a",
            title: "Alice report",
            summary: null,
            summaryTruncated: false,
          },
          {
            itemId: "item-b",
            title: "Bob report",
            summary: null,
            summaryTruncated: false,
          },
          {
            itemId: "item-c",
            title: "Carol report",
            summary: null,
            summaryTruncated: false,
          },
        ],
      },
    ]);
    const out = audit.latest?.out[0];
    expect(out).toMatchObject({ port: "out", count: 3, itemsTruncated: false });
    expect(out?.items[0]).toMatchObject({
      itemId: "item-a",
      title: "Alice report",
      summary: "clear false",
      summaryTruncated: false,
    });
    // A long note is clipped and says so.
    expect(out?.items[1]?.summary).toHaveLength(READ_LIMITS.shortSummaryChars);
    expect(out?.items[1]?.summaryTruncated).toBe(true);
    expect(out?.items[2]?.summary).toBeNull();
  });

  it("bounds the sample per port and says when it cut", async () => {
    const workflow = await addWorkflow(world);
    const ids = Array.from({ length: 12 }, (_, i) => `item-${i}`);
    await addRun(world, {
      workflowId: workflow.id,
      tickKey: minute(0),
      startedAt: minute(0),
      status: "succeeded",
      steps: [
        {
          nodeId: "assess",
          status: "succeeded",
          ports: { out: { count: 40, itemIds: ids } },
        },
      ],
    });
    const audit = await world.models.getNodeAudit(SCOPE, {
      workflowId: workflow.id,
      nodeId: "assess",
    });
    expect(audit.latest?.out[0]?.items).toHaveLength(
      READ_LIMITS.sampleItemsPerPort,
    );
    expect(audit.latest?.out[0]).toMatchObject({
      count: 40,
      itemsTruncated: true,
    });
  });

  it("groups error codes and lists the recent item-level errors", async () => {
    const { wf, r3 } = await seedAudit();
    const audit = await world.models.getNodeAudit(SCOPE, {
      workflowId: wf,
      nodeId: "assess",
    });
    expect(audit.errors.byCode).toEqual([
      {
        code: "ai_invalid_output",
        steps: 1,
        lastMessage: "no result",
        lastRunId: r3.id,
        lastAt: minute(20),
      },
    ]);
    expect(audit.errors.recentItemErrors).toEqual([
      {
        runId: r3.id,
        itemId: "item-c",
        at: minute(20.1),
        code: "ai_invalid_output",
        summary: "ai_invalid_output: no result",
        summaryTruncated: false,
      },
    ]);
  });

  it("lists the receipts a node produced, and the keys with no receipt row", async () => {
    const workflow = await addWorkflow(world);
    const wf = workflow.id;
    const done = keyOf(wf, "item-a", "reply");
    const failed = keyOf(wf, "item-b", "reply");
    const missing = keyOf(wf, "item-c", "reply");
    await addRun(world, {
      workflowId: wf,
      tickKey: minute(0),
      startedAt: minute(0),
      status: "succeeded",
      steps: [
        {
          nodeId: "reply",
          status: "succeeded",
          ports: { out: { count: 3, itemIds: ["item-a", "item-b", "item-c"] } },
          receiptKeys: [done, failed, missing],
          agentThreadId: "thread-1",
        },
      ],
    });
    await addReceipt(world, SCOPE, wf, {
      key: done,
      status: "done",
      externalRef: "ts-1",
      url: "https://slack.example.test/p1",
      summary: "slack.postMessage at reply",
      at: minute(0.1),
    });
    await addReceipt(world, SCOPE, wf, {
      key: failed,
      status: "failed",
      summary: "channel_not_found",
      at: minute(0.2),
    });
    const audit = await world.models.getNodeAudit(SCOPE, {
      workflowId: wf,
      nodeId: "reply",
    });
    expect(audit.receipts.map((receipt) => receipt.key)).toEqual([
      failed,
      done,
    ]);
    expect(audit.receipts[1]).toMatchObject({
      status: "done",
      externalRef: "ts-1",
      url: "https://slack.example.test/p1",
      itemId: "item-a",
      nodeId: "reply",
    });
    expect(audit.missingReceiptKeys).toEqual([missing]);
    expect(audit.receiptsTruncated).toBe(false);
    expect(audit.steps[0]).toMatchObject({
      receiptKeyCount: 3,
      agentThreadId: "thread-1",
    });
  });

  it("bounds the receipts it reads and says when there were more", async () => {
    const workflow = await addWorkflow(world);
    const keys = Array.from({ length: 60 }, (_, i) =>
      keyOf(workflow.id, `item-${i}`, "reply"),
    );
    await addRun(world, {
      workflowId: workflow.id,
      tickKey: minute(0),
      startedAt: minute(0),
      status: "succeeded",
      steps: [
        {
          nodeId: "reply",
          status: "succeeded",
          ports: {},
          receiptKeys: keys,
        },
      ],
    });
    const audit = await world.models.getNodeAudit(SCOPE, {
      workflowId: workflow.id,
      nodeId: "reply",
    });
    expect(audit.receiptsTruncated).toBe(true);
    expect(audit.missingReceiptKeys).toHaveLength(
      READ_LIMITS.nodeAuditReceipts,
    );
  });

  it("pages its steps by limit and says when there are more", async () => {
    const { wf } = await seedAudit();
    const audit = await world.models.getNodeAudit(SCOPE, {
      workflowId: wf,
      nodeId: "assess",
      limit: 2,
    });
    expect(audit.steps).toHaveLength(2);
    expect(audit.hasMoreSteps).toBe(true);
    expect(audit.summary.steps).toBe(2);
    for (const limit of [0, READ_LIMITS.nodeAuditMax + 1]) {
      expect(
        await failureOf(() =>
          world.models.getNodeAudit(SCOPE, {
            workflowId: wf,
            nodeId: "assess",
            limit,
          }),
        ),
      ).toMatchObject({ code: "invalid_input" });
    }
  });

  it("reads one run's step when a run is named, and refuses a run that is not this workflow's", async () => {
    const { wf, r2 } = await seedAudit();
    const audit = await world.models.getNodeAudit(SCOPE, {
      workflowId: wf,
      nodeId: "assess",
      runId: r2.id,
    });
    expect(audit.runId).toBe(r2.id);
    expect(audit.steps.map((step) => step.runId)).toEqual([r2.id]);
    expect(
      await failureOf(() =>
        world.models.getNodeAudit(SCOPE, {
          workflowId: wf,
          nodeId: "assess",
          runId: "wfr_nope",
        }),
      ),
    ).toMatchObject({ code: "run_not_found" });
    const other = await addWorkflow(world, { name: "Other" });
    expect(
      await failureOf(() =>
        world.models.getNodeAudit(SCOPE, {
          workflowId: other.id,
          nodeId: "assess",
          runId: r2.id,
        }),
      ),
    ).toMatchObject({ code: "run_not_found" });
  });

  it("reports a node the graph does not have, instead of an empty audit", async () => {
    const { wf, r1 } = await seedAudit();
    const missing = await failureOf(() =>
      world.models.getNodeAudit(SCOPE, { workflowId: wf, nodeId: "ghost" }),
    );
    expect(missing).toMatchObject({ code: "node_not_found" });
    expect((missing as WorkflowReadError).details).toMatchObject({
      nodeId: "ghost",
      graphVersion: 1,
    });

    // Version 2 drops `assess`: the current graph refuses it, the old run still reads it.
    const next = readGraph();
    next.nodes = next.nodes.filter((node) => node.id !== "assess");
    next.edges = [];
    await world.store.saveWorkflowGraph(SCOPE, {
      workflowId: wf,
      expectedVersion: 1,
      graph: next,
      source: "save",
      summary: "Dropped assess",
      createdBy: "owner@example.test",
    });
    expect(
      await failureOf(() =>
        world.models.getNodeAudit(SCOPE, { workflowId: wf, nodeId: "assess" }),
      ),
    ).toMatchObject({ code: "node_not_found" });
    const old = await world.models.getNodeAudit(SCOPE, {
      workflowId: wf,
      nodeId: "assess",
      runId: r1.id,
    });
    expect(old.graphVersion).toBe(1);
    expect(old.node.id).toBe("assess");
  });

  it("says nothing happened for a node that never ran, with no rate and no sample", async () => {
    const { wf } = await seedAudit();
    const audit = await world.models.getNodeAudit(SCOPE, {
      workflowId: wf,
      nodeId: "manual",
    });
    expect(audit.summary).toMatchObject({
      steps: 0,
      failureRate: null,
      durationMs: null,
    });
    expect(audit).toMatchObject({
      steps: [],
      latest: null,
      receipts: [],
      errors: { byCode: [], recentItemErrors: [] },
    });
  });

  it("stays inside its scope and names the table when a step is damaged", async () => {
    const { wf, r4 } = await seedAudit();
    for (const scope of [OTHER_FACTORY, OTHER_ORG]) {
      expect(
        await failureOf(() =>
          world.models.getNodeAudit(scope, {
            workflowId: wf,
            nodeId: "assess",
          }),
        ),
      ).toMatchObject({ code: "workflow_not_found" });
    }
    await world.client.query(
      "UPDATE factory_workflow_steps SET ports_json = 'nope' WHERE run_id = $1 AND node_id = 'assess'",
      [r4.id],
    );
    const error = await failureOf(() =>
      world.models.getNodeAudit(SCOPE, { workflowId: wf, nodeId: "assess" }),
    );
    expect(error).toMatchObject({ code: "corrupt_record" });
    expect(error.message).toContain("factory_workflow_steps");
    expect(error.message).toContain(r4.id);
  });
});
