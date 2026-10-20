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
  addRun,
  addWorkflow,
  closeClient,
  createWorld,
  type World,
} from "../server/workflow-host/testing/read-models-kit.js";
import action from "./get-factory-workflow-run.js";

const run = kit.runOf(action);
const minute = (n: number) =>
  new Date(Date.parse("2026-10-18T09:00:00.000Z") + n * 60_000).toISOString();

afterAll(closeClient);

let world: World;

beforeEach(async () => {
  world = await createWorld();
  kit.bind(world);
});

describe("get-factory-workflow-run", () => {
  it("is a read-only GET that needs a run id", () => {
    const definition = action as unknown as {
      readOnly: boolean;
      http: { method: string };
    };
    expect(definition.readOnly).toBe(true);
    expect(definition.http.method).toBe("GET");
    expect(
      kit.schemaOf(action).safeParse({ factoryId: kit.FACTORY_ID }).success,
    ).toBe(false);
  });

  it("returns the run with its steps, names, counts, errors, and bounded lists", async () => {
    const workflow = await addWorkflow(world);
    const created = await addRun(world, {
      workflowId: workflow.id,
      tickKey: minute(0),
      startedAt: minute(0),
      status: "failed",
      error: { code: "ai_invalid_output", message: "no result" },
      steps: [
        {
          nodeId: "feedback",
          status: "succeeded",
          startedAt: minute(0),
          ports: {
            out: {
              count: 40,
              itemIds: Array.from({ length: 30 }, (_, i) => `item-${i}`),
            },
          },
        },
        {
          nodeId: "assess",
          status: "failed",
          startedAt: minute(0.2),
          ports: { out: { count: 0, itemIds: [] } },
          error: { code: "ai_invalid_output", message: "no result" },
          agentThreadId: "thread-1",
        },
      ],
    });
    const result = await run({ factoryId: kit.FACTORY_ID, runId: created.id });
    expect(result.run).toMatchObject({
      id: created.id,
      status: "failed",
      error: { code: "ai_invalid_output" },
    });
    expect(result.stepsTruncated).toBe(false);
    expect(result.steps.map((s: { nodeId: string }) => s.nodeId)).toEqual([
      "feedback",
      "assess",
    ]);
    expect(result.steps[0]).toMatchObject({
      nodeName: "feedback",
      nodeKind: "source",
      ports: { out: { count: 40, itemIdsTruncated: true } },
    });
    expect(result.steps[0].ports.out.itemIds).toHaveLength(25);
    expect(result.steps[1]).toMatchObject({
      status: "failed",
      agentThreadId: "thread-1",
      error: { code: "ai_invalid_output", message: "no result" },
    });
  });

  it("answers an empty run with no steps, and a missing run with a typed not-found", async () => {
    const workflow = await addWorkflow(world);
    const empty = await addRun(world, {
      workflowId: workflow.id,
      tickKey: minute(0),
      startedAt: minute(0),
      status: "succeeded",
    });
    expect(
      await run({ factoryId: kit.FACTORY_ID, runId: empty.id }),
    ).toMatchObject({
      steps: [],
      stepsTruncated: false,
    });
    expect(
      await kit.failureOf(() =>
        run({ factoryId: kit.FACTORY_ID, runId: "wfr_missing" }),
      ),
    ).toMatchObject({ errorCode: "workflow_run_not_found", statusCode: 404 });
  });

  it("does not return another factory's or organization's run", async () => {
    const theirs = await addWorkflow(world, {
      scope: OTHER_FACTORY,
      name: "Theirs",
    });
    const theirRun = await addRun(world, {
      scope: OTHER_FACTORY,
      workflowId: theirs.id,
      tickKey: minute(0),
      startedAt: minute(0),
      status: "succeeded",
    });
    expect(
      await kit.failureOf(() =>
        run({ factoryId: kit.FACTORY_ID, runId: theirRun.id }),
      ),
    ).toMatchObject({ errorCode: "workflow_run_not_found" });
    expect(
      await run({ factoryId: kit.OTHER_FACTORY_ID, runId: theirRun.id }),
    ).toMatchObject({
      run: { id: theirRun.id },
    });
    kit.callAsOrg("org-2");
    expect(
      await kit.failureOf(() =>
        run({ factoryId: "factory-1", runId: theirRun.id }),
      ),
    ).toMatchObject({ errorCode: "workflow_run_not_found" });
  });

  it("fails with its own code when a step's stored JSON is damaged", async () => {
    const workflow = await addWorkflow(world);
    const created = await addRun(world, {
      workflowId: workflow.id,
      tickKey: minute(0),
      startedAt: minute(0),
      status: "succeeded",
      steps: [{ nodeId: "assess", status: "succeeded", ports: {} }],
    });
    await world.client.query(
      "UPDATE factory_workflow_steps SET ports_json = '{oops'",
    );
    const error = await kit.failureOf(() =>
      run({ factoryId: kit.FACTORY_ID, runId: created.id }),
    );
    expect(error).toMatchObject({
      errorCode: "stored_record_unreadable",
      statusCode: 500,
    });
    expect(error.message).toContain("factory_workflow_steps");
    expect(error.message).toContain(created.id);
  });
});
