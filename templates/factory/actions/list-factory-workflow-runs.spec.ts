import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/action", async () => {
  const mod = await import("../server/workflow-host/testing/action-module.js");
  return mod.actionModule;
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
  OTHER_ORG,
  SCOPE,
  addRun,
  addWorkflow,
  closeClient,
  createWorld,
  type World,
} from "../server/workflow-host/testing/read-models-kit.js";
import action from "./list-factory-workflow-runs.js";

const run = kit.runOf(action);
const minute = (n: number) =>
  new Date(Date.parse("2026-10-18T09:00:00.000Z") + n * 60_000).toISOString();

afterAll(closeClient);

let world: World;

beforeEach(async () => {
  world = await createWorld();
  kit.bind(world);
});

async function seed() {
  const workflow = await addWorkflow(world);
  for (let index = 0; index < 5; index += 1) {
    await addRun(world, {
      workflowId: workflow.id,
      tickKey: minute(index * 5),
      startedAt: minute(index * 5),
      status: index === 3 ? "failed" : "succeeded",
      ...(index === 3
        ? {
            error: {
              code: "provider_error" as const,
              message: "HubSpot returned 401",
            },
          }
        : {}),
      counts: { taken: index },
    });
  }
  return workflow;
}

describe("list-factory-workflow-runs", () => {
  it("is a read-only GET with a bounded page and a status and mode enum", () => {
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
      { limit: 0 },
      { limit: 101 },
      { status: "done" },
      { mode: "staging" },
    ]) {
      expect(
        schema.safeParse({ factoryId: kit.FACTORY_ID, ...bad }).success,
      ).toBe(false);
    }
  });

  it("lists runs newest first, one page at a time, and says if more exist", async () => {
    await seed();
    const first = await run({ factoryId: kit.FACTORY_ID, limit: 2 });
    expect(first.runs.map((r: { startedAt: string }) => r.startedAt)).toEqual([
      minute(20),
      minute(15),
    ]);
    expect(first).toMatchObject({ hasMore: true });
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await run({
      factoryId: kit.FACTORY_ID,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.runs.map((r: { startedAt: string }) => r.startedAt)).toEqual([
      minute(10),
      minute(5),
    ]);
    const third = await run({
      factoryId: kit.FACTORY_ID,
      limit: 2,
      cursor: second.nextCursor,
    });
    expect(third).toMatchObject({ hasMore: false, nextCursor: null });
    expect(third.runs).toHaveLength(1);
  });

  it("shows what a row needs and filters by workflow, status, and mode", async () => {
    const workflow = await seed();
    const other = await addWorkflow(world, { name: "Builder to merge" });
    await addRun(world, {
      workflowId: other.id,
      tickKey: "dry-1",
      mode: "dry",
      startedAt: minute(30),
      status: "paused",
      error: { code: "budget_paused", message: "Soft deadline" },
    });
    const failed = await run({ factoryId: kit.FACTORY_ID, status: "failed" });
    expect(failed.runs).toHaveLength(1);
    expect(failed.runs[0]).toMatchObject({
      workflowId: workflow.id,
      workflowName: "Bug report to Builder",
      graphVersion: 1,
      mode: "live",
      status: "failed",
      triggerKind: "schedule",
      counts: { taken: 3 },
      error: { code: "provider_error", message: "HubSpot returned 401" },
    });
    expect(
      (await run({ factoryId: kit.FACTORY_ID, workflowId: other.id })).runs,
    ).toHaveLength(1);
    expect(
      (await run({ factoryId: kit.FACTORY_ID, mode: "dry" })).runs[0],
    ).toMatchObject({ triggerKind: "dry_run", status: "paused" });
  });

  it("answers an unknown workflow, factory, or cursor with a typed failure, not an empty list", async () => {
    const workflow = await seed();
    expect(
      await kit.failureOf(() =>
        run({ factoryId: kit.FACTORY_ID, workflowId: "wf_nope" }),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found", statusCode: 404 });
    expect(
      await kit.failureOf(() => run({ factoryId: "no-such-factory" })),
    ).toMatchObject({ errorCode: "factory_not_found", statusCode: 404 });
    expect(
      await kit.failureOf(() =>
        run({ factoryId: kit.FACTORY_ID, cursor: "garbage" }),
      ),
    ).toMatchObject({ errorCode: "bad_cursor", statusCode: 400 });
    // A quiet workflow is an empty list.
    const quiet = await addWorkflow(world, { name: "Quiet" });
    expect(
      await run({ factoryId: kit.FACTORY_ID, workflowId: quiet.id }),
    ).toEqual({
      runs: [],
      hasMore: false,
      nextCursor: null,
    });
    expect(workflow.id).not.toBe(quiet.id);
  });

  it("sees only its own factory and organization", async () => {
    const workflow = await seed();
    const elsewhere = await addWorkflow(world, {
      scope: OTHER_FACTORY,
      name: "Theirs",
    });
    await addRun(world, {
      scope: OTHER_FACTORY,
      workflowId: elsewhere.id,
      tickKey: minute(50),
      startedAt: minute(50),
      status: "succeeded",
    });
    const ours = await run({ factoryId: kit.FACTORY_ID });
    expect(
      ours.runs.every(
        (r: { workflowId: string }) => r.workflowId === workflow.id,
      ),
    ).toBe(true);
    expect(
      await kit.failureOf(() =>
        run({ factoryId: kit.FACTORY_ID, workflowId: elsewhere.id }),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found" });
    expect((await run({ factoryId: kit.OTHER_FACTORY_ID })).runs).toHaveLength(
      1,
    );

    // A member of another organization sees nothing of this one.
    kit.callAsOrg(OTHER_ORG.orgId);
    expect(await run({ factoryId: OTHER_ORG.factoryId })).toMatchObject({
      runs: [],
    });
    expect(SCOPE.orgId).not.toBe(OTHER_ORG.orgId);
  });

  it("fails with its own code when a stored column cannot be read", async () => {
    await seed();
    await world.client.query(
      "UPDATE factory_workflow_runs SET counts_json = 'not json'",
    );
    const error = await kit.failureOf(() => run({ factoryId: kit.FACTORY_ID }));
    expect(error).toMatchObject({
      errorCode: "stored_record_unreadable",
      statusCode: 500,
    });
    expect(error.message).toContain("factory_workflow_runs");
  });
});
