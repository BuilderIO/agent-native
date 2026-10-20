import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createActivityFeed,
  type ActivityEntry,
  type ActivityFeed,
  type ActivityInput,
} from "./activity-feed.js";
import {
  OTHER_FACTORY,
  OTHER_ORG,
  SCOPE,
  FakeAudit,
  addEvents,
  addInboxItem,
  addRun,
  addWorkflow,
  closeClient,
  createWorld,
  type World,
} from "./testing/read-models-kit.js";

afterAll(closeClient);

const minute = (n: number) =>
  new Date(Date.parse("2026-10-18T09:00:00.000Z") + n * 60_000).toISOString();
const ms = (n: number) => Date.parse(minute(n));

let world: World;
let audit: FakeAudit;
let feed: ActivityFeed;

beforeEach(async () => {
  world = await createWorld();
  audit = new FakeAudit();
  feed = createActivityFeed({
    readModels: world.models,
    readAudit: audit.readAudit,
    readAuditEvent: audit.readAuditEvent,
  });
});

async function failureOf(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the feed to fail.");
}

async function everything(
  input: ActivityInput,
  scope = SCOPE,
): Promise<ActivityEntry[]> {
  const entries: ActivityEntry[] = [];
  let cursor: string | undefined;
  do {
    const page = await feed.list(scope, {
      ...input,
      ...(cursor === undefined ? {} : { cursor }),
    });
    entries.push(...page.entries);
    expect(page.hasMore).toBe(page.nextCursor !== null);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return entries;
}

async function seed() {
  const workflow = await addWorkflow(world);
  const wf = workflow.id;
  await addInboxItem(world, {
    id: "item-dan",
    title: "Dan: Billing page returns 500",
    status: "needs_manual",
  });

  // Runs: a scheduled one that ties with a change, a failed one, a manual one, a dry one.
  const scheduled = await addRun(world, {
    workflowId: wf,
    tickKey: minute(10),
    startedAt: minute(10),
    status: "succeeded",
    finishedAt: minute(11),
    counts: { taken: 3, done: 2 },
  });
  const failed = await addRun(world, {
    workflowId: wf,
    tickKey: minute(5),
    startedAt: minute(5),
    status: "failed",
    error: { code: "provider_error", message: "HubSpot returned 401" },
  });
  const manual = await addRun(world, {
    workflowId: wf,
    tickKey: "manual-1",
    triggerKind: "manual",
    startedBy: "ana@example.test",
    startedAt: minute(7),
    status: "paused",
    error: { code: "budget_paused", message: "Soft deadline" },
  });
  const dry = await addRun(world, {
    workflowId: wf,
    tickKey: "dry-1",
    mode: "dry",
    startedBy: "ben@example.test",
    startedAt: minute(3),
    status: "succeeded",
  });

  // Hand-offs: one live (ties with the restore below), one dry, one that ended done.
  await addEvents(world, SCOPE, [
    {
      workflowId: wf,
      runId: scheduled.id,
      itemId: "item-dan",
      nodeId: "manual",
      kind: "ended",
      outcome: "needsManual",
      at: minute(9.5),
      summary: "needsManual: risky change (status needs_manual)",
    },
    {
      workflowId: wf,
      runId: failed.id,
      itemId: "group-1",
      nodeId: "manual",
      kind: "ended",
      outcome: "needsManual",
      at: minute(6),
      summary:
        "needsManual: Failed 3 times; last: provider_error (status needs_manual)",
    },
    {
      workflowId: wf,
      runId: dry.id,
      itemId: "item-dry",
      nodeId: "manual",
      kind: "ended",
      outcome: "needsManual",
      at: minute(3),
      mode: "dry",
      summary: "needsManual: would hand off",
    },
    {
      workflowId: wf,
      runId: scheduled.id,
      itemId: "item-ok",
      nodeId: "finish",
      kind: "ended",
      outcome: "done",
      at: minute(9),
      summary: "done (status resolved)",
    },
  ]);

  // Changes in the audit log.
  const wfName = "Bug report to Builder";
  audit.add({
    action: "save-factory-workflow",
    targetId: wf,
    createdAt: ms(10),
    summary: `Saved workflow ${wf} "${wfName}" as version 14`,
  });
  audit.add({
    action: "set-factory-workflow-enabled",
    targetId: wf,
    createdAt: ms(8),
    summary: `Enabled workflow ${wf}`,
  });
  audit.add({
    action: "save-factory-workflow",
    targetId: wf,
    createdAt: ms(9),
    actorKind: "agent",
    actorEmail: "teammate@example.test",
    caller: "tool",
    summary: `Saved workflow ${wf} "${wfName}" as version 15`,
  });
  audit.add({
    action: "restore-factory-workflow-version",
    targetId: wf,
    createdAt: ms(6),
    summary: `Restored workflow ${wf} version 11 as version 16`,
  });
  audit.add({
    action: "set-factory-workflow-enabled",
    targetId: wf,
    createdAt: ms(2),
    actorKind: "system",
    actorEmail: null,
    summary: `Disabled workflow ${wf}`,
  });
  audit.add({
    action: "save-factory-workflow",
    targetId: wf,
    createdAt: ms(1),
    summary: `Created workflow ${wf} "${wfName}" as version 1`,
  });
  // A refused save is not a change.
  audit.add({
    action: "save-factory-workflow",
    targetId: wf,
    createdAt: ms(7),
    status: "error",
    summary: "Workflow save refused",
  });
  return { wf, scheduled, failed, manual, dry };
}

describe("createActivityFeed", () => {
  it("merges runs, changes, and hand-offs newest first, each with what links to it", async () => {
    const { wf, scheduled, failed } = await seed();
    const entries = await everything({ limit: 100 });
    expect(entries.map((entry) => entry.at)).toEqual([
      minute(10),
      minute(10),
      minute(9.5),
      minute(9),
      minute(8),
      minute(7),
      minute(6),
      minute(6),
      minute(5),
      minute(3),
      minute(2),
      minute(1),
    ]);
    expect(entries).toHaveLength(12);

    const run = entries.find((entry) => entry.id === `run:${scheduled.id}`);
    expect(run).toMatchObject({
      kind: "run",
      workflowId: wf,
      workflowName: "Bug report to Builder",
      status: "succeeded",
      mode: "live",
      triggerKind: "schedule",
      counts: { taken: 3, done: 2 },
      error: null,
      actor: { kind: "schedule", email: null },
      link: { type: "run", workflowId: wf, runId: scheduled.id },
    });
    expect(
      entries.find((entry) => entry.id === `run:${failed.id}`),
    ).toMatchObject({
      status: "failed",
      error: { code: "provider_error", message: "HubSpot returned 401" },
    });

    const save = entries.find(
      (entry) => entry.kind === "change" && entry.at === minute(10),
    );
    expect(save).toMatchObject({
      change: "saved",
      version: 14,
      action: "save-factory-workflow",
      actor: { kind: "person", email: "teammate@example.test" },
      link: { type: "version", workflowId: wf, version: 14 },
    });
    const handedOff = entries.find(
      (entry) => entry.kind === "needs_you" && entry.at === minute(9.5),
    );
    expect(handedOff).toMatchObject({
      workflowName: "Bug report to Builder",
      actor: { kind: "schedule" },
      item: {
        id: "item-dan",
        inbox: true,
        title: "Dan: Billing page returns 500",
        status: "needs_manual",
      },
      nodeId: "manual",
      link: { type: "item", workflowId: wf, itemId: "item-dan" },
    });
    // A dry run's hand-off and a hand-off that ended done are not "needs you".
    expect(
      entries
        .filter((entry) => entry.kind === "needs_you")
        .map((entry) => entry.at),
    ).toEqual([minute(9.5), minute(6)]);
  });

  it("names who made each change and what kind it was", async () => {
    await seed();
    const changes = await everything({ kind: "change", limit: 100 });
    expect(
      changes.map((entry) =>
        entry.kind === "change"
          ? [entry.change, entry.version, entry.actor.kind]
          : null,
      ),
    ).toEqual([
      ["saved", 14, "person"],
      ["saved", 15, "agent"],
      ["enabled", null, "person"],
      ["restored", 16, "person"],
      ["disabled", null, "schedule"],
      ["created", 1, "person"],
    ]);
  });

  it("attributes a manual or dry run to whoever started it, and a scheduled run to the schedule", async () => {
    await seed();
    const runs = await everything({ kind: "run", limit: 100 });
    expect(
      runs.map((entry) =>
        entry.kind === "run"
          ? [entry.triggerKind, entry.actor.kind, entry.actor.email]
          : null,
      ),
    ).toEqual([
      ["schedule", "schedule", null],
      ["manual", "person", "ana@example.test"],
      ["schedule", "schedule", null],
      ["dry_run", "person", "ben@example.test"],
    ]);
  });

  it("attributes a hand-off to whoever started the run it happened in", async () => {
    const workflow = await addWorkflow(world);
    const wf = workflow.id;
    const byHand = await addRun(world, {
      workflowId: wf,
      tickKey: "manual-1",
      triggerKind: "manual",
      startedBy: "ana@example.test",
      startedAt: minute(2),
      status: "succeeded",
    });
    const scheduled = await addRun(world, {
      workflowId: wf,
      tickKey: minute(1),
      startedAt: minute(1),
      status: "succeeded",
    });
    const handOff = (runId: string, itemId: string, at: string) => ({
      workflowId: wf,
      runId,
      itemId,
      kind: "ended" as const,
      outcome: "needsManual" as const,
      nodeId: "manual",
      at,
      summary: "needsManual: risky",
    });
    await addEvents(world, SCOPE, [
      handOff(byHand.id, "item-1", minute(2.5)),
      handOff(scheduled.id, "item-2", minute(1.5)),
    ]);

    const handOffs = async (input: Parameters<typeof everything>[0]) =>
      (await everything({ kind: "needs_you", ...input })).flatMap((entry) =>
        entry.kind === "needs_you"
          ? [[entry.item.id, entry.actor] as const]
          : [],
      );
    expect(await handOffs({})).toEqual([
      ["item-1", { kind: "person", email: "ana@example.test" }],
      ["item-2", { kind: "schedule", email: null }],
    ]);
    expect((await handOffs({ who: "person" })).map(([id]) => id)).toEqual([
      "item-1",
    ]);
    expect((await handOffs({ who: "schedule" })).map(([id]) => id)).toEqual([
      "item-2",
    ]);
  });

  it("pages through everything without repeating or skipping an entry, whatever the page size", async () => {
    await seed();
    const whole = (await everything({ limit: 100 })).map((entry) => entry.id);
    expect(new Set(whole).size).toBe(whole.length);
    for (const limit of [1, 2, 11]) {
      const paged = (await everything({ limit })).map((entry) => entry.id);
      expect(paged).toEqual(whole);
    }
  });

  it("pages through a pile of entries that share one millisecond", async () => {
    const workflow = await addWorkflow(world);
    for (let i = 0; i < 7; i += 1) {
      await addRun(world, {
        workflowId: workflow.id,
        tickKey: `manual-${i}`,
        startedAt: minute(1),
        status: "succeeded",
      });
      audit.add({
        action: "save-factory-workflow",
        targetId: workflow.id,
        createdAt: ms(1),
        summary: `Saved workflow ${workflow.id} "x" as version ${i + 2}`,
      });
    }
    const whole = (await everything({ limit: 100 })).map((entry) => entry.id);
    expect(whole).toHaveLength(14);
    for (const limit of [1, 3]) {
      const paged = (await everything({ limit })).map((entry) => entry.id);
      expect(paged).toEqual(whole);
    }
  });

  it("filters by workflow, kind, who, and time range", async () => {
    const { wf } = await seed();
    const other = await addWorkflow(world, { name: "Builder to merge" });
    await addRun(world, {
      workflowId: other.id,
      tickKey: minute(12),
      startedAt: minute(12),
      status: "succeeded",
    });
    audit.add({
      action: "save-factory-workflow",
      targetId: other.id,
      createdAt: ms(11),
      summary: `Saved workflow ${other.id} "x" as version 2`,
    });

    const ofOther = await everything({ workflowId: other.id });
    expect(ofOther.map((entry) => entry.kind)).toEqual(["run", "change"]);
    expect(ofOther.every((entry) => entry.workflowId === other.id)).toBe(true);
    expect((await everything({ workflowId: wf })).length).toBe(12);

    expect(
      new Set((await everything({ kind: "run" })).map((e) => e.kind)),
    ).toEqual(new Set(["run"]));
    expect((await everything({ kind: "needs_you" })).length).toBe(2);
    // Six saved, enabled, restored, or disabled for the first, one for the second.
    expect((await everything({ kind: "change" })).length).toBe(7);

    // who: a person's changes and the runs they started; the agent's changes only; the schedule's runs, hand-offs, and system changes.
    const person = await everything({ who: "person" });
    expect(person.every((entry) => entry.actor.kind === "person")).toBe(true);
    expect(person.some((entry) => entry.kind === "change")).toBe(true);
    expect(
      person
        .filter((entry) => entry.kind === "run")
        .map((entry) => entry.at)
        .sort(),
    ).toEqual([minute(3), minute(7)]);
    const agent = await everything({ who: "agent" });
    expect(
      agent.map((entry) => entry.kind === "change" && entry.version),
    ).toEqual([15]);
    const schedule = await everything({ who: "schedule" });
    expect(schedule.every((entry) => entry.actor.kind === "schedule")).toBe(
      true,
    );
    // Scheduled runs and their hand-offs only: no manual run, no dry run.
    expect(
      schedule
        .filter((entry) => entry.kind === "run")
        .map((entry) => entry.at)
        .sort(),
    ).toEqual([minute(5), minute(10), minute(12)]);
    expect(schedule.some((entry) => entry.kind === "change")).toBe(true);

    // since is inclusive, until exclusive.
    const window = await everything({ since: minute(5), until: minute(9) });
    expect(window.map((entry) => entry.at).sort()).toEqual(
      [minute(5), minute(6), minute(6), minute(7), minute(8)].sort(),
    );
  });

  it("keeps another factory's and another organization's changes out", async () => {
    const { wf } = await seed();
    const elsewhere = await addWorkflow(world, {
      scope: OTHER_FACTORY,
      name: "Theirs",
    });
    audit.add({
      action: "save-factory-workflow",
      targetId: elsewhere.id,
      createdAt: ms(20),
      summary: `Saved workflow ${elsewhere.id} "Theirs" as version 2`,
    });
    audit.add({
      action: "save-factory-workflow",
      targetId: wf,
      orgId: OTHER_ORG.orgId,
      createdAt: ms(21),
      summary: `Saved workflow ${wf} "x" as version 99`,
    });
    audit.add({
      action: "save-factory-workflow",
      targetId: "wf_unknown",
      createdAt: ms(22),
      summary: "Saved workflow wf_unknown",
    });

    const changes = await everything({ kind: "change" });
    expect(changes).toHaveLength(6);
    expect(changes.every((entry) => entry.workflowId === wf)).toBe(true);
    expect(
      changes.some((entry) => entry.kind === "change" && entry.version === 99),
    ).toBe(false);

    // The other scopes see none of this scope's runs or hand-offs either.
    for (const scope of [OTHER_FACTORY, OTHER_ORG]) {
      const seen = await everything({}, scope);
      expect(seen.filter((entry) => entry.workflowId === wf)).toEqual([]);
    }
  });

  it("attributes a deleted workflow's change through the input its delete recorded", async () => {
    await seed();
    audit.add({
      action: "delete-factory-workflow",
      targetId: "wf_gone",
      createdAt: ms(4),
      summary: "Deleted workflow wf_gone",
      input: JSON.stringify({
        factoryId: SCOPE.factoryId,
        workflowId: "wf_gone",
      }),
    });
    audit.add({
      action: "delete-factory-workflow",
      targetId: "wf_theirs",
      createdAt: ms(4),
      summary: "Deleted workflow wf_theirs",
      input: JSON.stringify({
        factoryId: OTHER_FACTORY.factoryId,
        workflowId: "wf_theirs",
      }),
    });
    audit.add({
      action: "delete-factory-workflow",
      targetId: "wf_unreadable",
      createdAt: ms(4),
      summary: "Deleted workflow wf_unreadable",
      input: "{not json",
    });
    const deleted = (await everything({ kind: "change" })).filter(
      (entry) => entry.kind === "change" && entry.change === "deleted",
    );
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({
      workflowId: "wf_gone",
      workflowName: null,
      summary: "Deleted workflow wf_gone",
    });
    // Only deletes of workflows this scope no longer has cost a by-id read.
    expect(audit.byIdCalls).toHaveLength(3);
  });

  it("still reaches the changes behind a long run of other factories' audit rows", async () => {
    const workflow = await addWorkflow(world);
    audit.add({
      action: "save-factory-workflow",
      targetId: workflow.id,
      createdAt: ms(1),
      summary: `Saved workflow ${workflow.id} "x" as version 2`,
    });
    const elsewhere = await addWorkflow(world, {
      scope: OTHER_FACTORY,
      name: "Theirs",
    });
    for (let i = 0; i < 650; i += 1) {
      audit.add({
        action: "save-factory-workflow",
        targetId: elsewhere.id,
        createdAt: ms(100) + i,
        summary: "Saved",
      });
    }
    const first = await feed.list(SCOPE, { kind: "change", limit: 25 });
    // The scan is bounded, so the first page can be empty while more remain.
    expect(first.entries).toEqual([]);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    expect(audit.pageCalls.length).toBeLessThanOrEqual(6);

    const all = await everything({ kind: "change", limit: 25 });
    expect(all.map((entry) => entry.workflowId)).toEqual([workflow.id]);
  });

  it("tells an unknown workflow from a quiet one", async () => {
    const workflow = await addWorkflow(world);
    expect(await feed.list(SCOPE, { workflowId: workflow.id })).toEqual({
      entries: [],
      hasMore: false,
      nextCursor: null,
    });
    expect(
      await failureOf(() => feed.list(SCOPE, { workflowId: "wf_nope" })),
    ).toMatchObject({ code: "workflow_not_found" });
    expect(
      await failureOf(() =>
        feed.list(OTHER_FACTORY, { workflowId: workflow.id }),
      ),
    ).toMatchObject({ code: "workflow_not_found" });
  });

  it("refuses a bad cursor, a bad limit, and a bad date", async () => {
    await seed();
    for (const cursor of [
      "garbage",
      Buffer.from('{"k":"runs","at":"x","id":"y"}').toString("base64url"),
    ]) {
      expect(await failureOf(() => feed.list(SCOPE, { cursor }))).toMatchObject(
        {
          code: "bad_cursor",
        },
      );
    }
    for (const limit of [0, 101]) {
      expect(await failureOf(() => feed.list(SCOPE, { limit }))).toMatchObject({
        code: "invalid_input",
      });
    }
    expect(
      await failureOf(() => feed.list(SCOPE, { since: "yesterday" })),
    ).toMatchObject({ code: "invalid_input" });
  });
});
