import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/action", async () => {
  const mod = await import("../server/workflow-host/testing/action-module.js");
  return mod.actionModule;
});
vi.mock("@agent-native/core/audit", async () => {
  const kit =
    await import("../server/workflow-host/testing/read-actions-kit.js");
  return kit.auditModule;
});
vi.mock("../server/workflow-host/factory-read-models.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/read-actions-kit.js");
  return kit.readModelsModule;
});
vi.mock("../server/lib/require-workspace-member.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/read-actions-kit.js");
  return kit.memberModule;
});
vi.mock("../server/lib/factory-definitions.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/read-actions-kit.js");
  return kit.factoryDefinitionsModule;
});

import * as kit from "../server/workflow-host/testing/read-actions-kit.js";
import {
  OTHER_FACTORY,
  SCOPE,
  addEvents,
  addInboxItem,
  addRun,
  addWorkflow,
  closeClient,
  createWorld,
  type FakeAudit,
  type World,
} from "../server/workflow-host/testing/read-models-kit.js";
import action from "./list-factory-activity.js";

const run = kit.runOf(action);
const minute = (n: number) =>
  new Date(Date.parse("2026-10-18T09:00:00.000Z") + n * 60_000).toISOString();
const ms = (n: number) => Date.parse(minute(n));

afterAll(closeClient);

let world: World;
let audit: FakeAudit;

beforeEach(async () => {
  world = await createWorld();
  audit = kit.bind(world);
});

type Entry = { id: string; kind: string; at: string };

async function seed() {
  const workflow = await addWorkflow(world);
  const wf = workflow.id;
  await addInboxItem(world, {
    id: "item-dan",
    title: "Dan: Billing 500",
    status: "needs_manual",
  });
  const scheduled = await addRun(world, {
    workflowId: wf,
    tickKey: minute(10),
    startedAt: minute(10),
    status: "succeeded",
    counts: { taken: 3 },
  });
  await addRun(world, {
    workflowId: wf,
    tickKey: "manual-1",
    triggerKind: "manual",
    startedBy: "ana@example.test",
    startedAt: minute(7),
    status: "failed",
    error: { code: "provider_error", message: "HubSpot returned 401" },
  });
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
  ]);
  audit.add({
    action: "save-factory-workflow",
    targetId: wf,
    createdAt: ms(9),
    summary: `Saved workflow ${wf} "x" as version 14`,
  });
  audit.add({
    action: "set-factory-workflow-enabled",
    targetId: wf,
    createdAt: ms(8),
    actorKind: "agent",
    caller: "tool",
    summary: `Enabled workflow ${wf}`,
  });
  return { wf };
}

describe("list-factory-activity", () => {
  it("is a read-only GET with a bounded page and typed filters", () => {
    const definition = action as unknown as {
      readOnly: boolean;
      http: { method: string };
    };
    expect(definition.readOnly).toBe(true);
    expect(definition.http.method).toBe("GET");
    const schema = kit.schemaOf(action);
    expect(schema.parse({ factoryId: kit.FACTORY_ID })).toMatchObject({
      limit: 25,
    });
    for (const bad of [
      { limit: 101 },
      { who: "robot" },
      { kind: "audit" },
      { since: "yesterday" },
      { until: "2026-10-18" },
    ]) {
      expect(
        schema.safeParse({ factoryId: kit.FACTORY_ID, ...bad }).success,
      ).toBe(false);
    }
    expect(
      schema.safeParse({
        factoryId: kit.FACTORY_ID,
        since: "2026-10-18T09:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("merges runs, changes, and hand-offs newest first behind one cursor", async () => {
    const { wf } = await seed();
    const first = await run({ factoryId: kit.FACTORY_ID, limit: 2 });
    expect(first.entries.map((e: Entry) => e.kind)).toEqual([
      "run",
      "needs_you",
    ]);
    expect(first.hasMore).toBe(true);
    const second = await run({
      factoryId: kit.FACTORY_ID,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.entries.map((e: Entry) => e.kind)).toEqual([
      "change",
      "change",
    ]);
    const third = await run({
      factoryId: kit.FACTORY_ID,
      limit: 2,
      cursor: second.nextCursor,
    });
    expect(third.entries.map((e: Entry) => e.kind)).toEqual(["run"]);
    expect(third).toMatchObject({ hasMore: false, nextCursor: null });

    const everything = [first, second, third].flatMap((page) => page.entries);
    expect(new Set(everything.map((e: Entry) => e.id)).size).toBe(5);
    expect(everything[2]).toMatchObject({
      kind: "change",
      change: "saved",
      version: 14,
      workflowName: "Bug report to Builder",
      actor: { kind: "person" },
      link: { type: "version", workflowId: wf, version: 14 },
    });
    expect(everything[3]).toMatchObject({
      change: "enabled",
      actor: { kind: "agent" },
    });
  });

  it("filters by workflow, kind, who, and time range", async () => {
    const { wf } = await seed();
    const kinds = async (input: Record<string, unknown>) =>
      (await run({ factoryId: kit.FACTORY_ID, ...input })).entries.map(
        (e: Entry) => e.kind,
      );
    expect(await kinds({ kind: "run" })).toEqual(["run", "run"]);
    expect(await kinds({ kind: "needs_you" })).toEqual(["needs_you"]);
    expect(await kinds({ kind: "change" })).toEqual(["change", "change"]);
    expect(await kinds({ who: "agent" })).toEqual(["change"]);
    // A person's: their save, and the run they started by hand.
    expect(await kinds({ who: "person" })).toEqual(["change", "run"]);
    // The schedule's: the scheduled run and its hand-off, not the manual run.
    expect(await kinds({ who: "schedule" })).toEqual(["run", "needs_you"]);
    expect(await kinds({ workflowId: wf })).toHaveLength(5);
    expect(await kinds({ since: minute(8), until: minute(10) })).toEqual([
      "needs_you",
      "change",
      "change",
    ]);
  });

  it("attributes a run to the schedule or to the person the run recorded as its starter", async () => {
    await seed();
    const runs = (await run({ factoryId: kit.FACTORY_ID, kind: "run" }))
      .entries;
    expect(
      runs.map((e: { actor: { kind: string; email: string | null } }) => [
        e.actor.kind,
        e.actor.email,
      ]),
    ).toEqual([
      ["schedule", null],
      ["person", "ana@example.test"],
    ]);
  });

  it("answers an unknown workflow, a bad cursor, and an unknown factory with typed failures", async () => {
    await seed();
    expect(
      await kit.failureOf(() =>
        run({ factoryId: kit.FACTORY_ID, workflowId: "wf_nope" }),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found", statusCode: 404 });
    expect(
      await kit.failureOf(() =>
        run({ factoryId: kit.FACTORY_ID, cursor: "garbage" }),
      ),
    ).toMatchObject({ errorCode: "bad_cursor", statusCode: 400 });
    expect(
      await kit.failureOf(() => run({ factoryId: "no-such-factory" })),
    ).toMatchObject({ errorCode: "factory_not_found", statusCode: 404 });
    const quiet = await addWorkflow(world, { name: "Quiet" });
    expect(
      await run({ factoryId: kit.FACTORY_ID, workflowId: quiet.id }),
    ).toEqual({
      entries: [],
      hasMore: false,
      nextCursor: null,
    });
  });

  it("keeps another factory's and organization's runs and changes out", async () => {
    const { wf } = await seed();
    const theirs = await addWorkflow(world, {
      scope: OTHER_FACTORY,
      name: "Theirs",
    });
    await addRun(world, {
      scope: OTHER_FACTORY,
      workflowId: theirs.id,
      tickKey: minute(30),
      startedAt: minute(30),
      status: "succeeded",
    });
    audit.add({
      action: "save-factory-workflow",
      targetId: theirs.id,
      createdAt: ms(31),
      summary: "Saved workflow theirs as version 2",
    });
    audit.add({
      action: "save-factory-workflow",
      targetId: wf,
      orgId: "org-2",
      createdAt: ms(32),
      summary: "Saved workflow x as version 99",
    });

    const ours = (await run({ factoryId: kit.FACTORY_ID, limit: 100 })).entries;
    expect(ours).toHaveLength(5);
    expect(ours.every((e: { workflowId: string }) => e.workflowId === wf)).toBe(
      true,
    );
    const theirsOnly = (await run({ factoryId: kit.OTHER_FACTORY_ID })).entries;
    expect(theirsOnly.map((e: Entry) => e.kind).sort()).toEqual([
      "change",
      "run",
    ]);
    kit.callAsOrg("org-2");
    expect((await run({ factoryId: "factory-1" })).entries).toEqual([]);
  });
});
