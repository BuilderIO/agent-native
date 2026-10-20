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
  SCOPE,
  addEvents,
  addInboxItem,
  addReceipt,
  addRun,
  addWorkflow,
  closeClient,
  createWorld,
  type World,
} from "../server/workflow-host/testing/read-models-kit.js";
import { receiptKey } from "../server/workflow/contract.js";
import action from "./get-workflow-node-audit.js";

const run = kit.runOf(action);
const minute = (n: number) =>
  new Date(Date.parse("2026-10-18T09:00:00.000Z") + n * 60_000).toISOString();
const later = (base: string, seconds: number) =>
  new Date(Date.parse(base) + seconds * 1000).toISOString();

afterAll(closeClient);

let world: World;

beforeEach(async () => {
  world = await createWorld();
  kit.bind(world);
});

async function seed() {
  const workflow = await addWorkflow(world);
  const wf = workflow.id;
  await addInboxItem(world, { id: "item-a", title: "Alice report" });
  await addInboxItem(world, { id: "item-b", title: "Bob report" });
  const done = receiptKey({
    workflowId: wf,
    itemId: "item-a",
    nodeId: "reply",
    attempt: 0,
  });
  const runs = [];
  for (const [index, seconds] of [2, 4, 6].entries()) {
    const startedAt = minute(index * 10);
    const failed = index === 1;
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
            ports: { out: { count: 2, itemIds: ["item-a", "item-b"] } },
          },
          {
            nodeId: "assess",
            status: failed ? "failed" : "succeeded",
            finishedAt: later(startedAt, seconds),
            ports: {
              out: {
                count: failed ? 0 : 2,
                itemIds: failed ? [] : ["item-a", "item-b"],
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
          ...(index === 0
            ? [
                {
                  nodeId: "reply",
                  status: "succeeded" as const,
                  startedAt: later(startedAt, 1),
                  ports: { out: { count: 1, itemIds: ["item-a"] } },
                  receiptKeys: [done],
                },
              ]
            : []),
        ],
      }),
    );
  }
  await addEvents(world, SCOPE, [
    {
      workflowId: wf,
      runId: runs[2]!.id,
      itemId: "item-a",
      kind: "output",
      nodeId: "assess",
      at: minute(20.1),
      summary: "clear false",
    },
    {
      workflowId: wf,
      runId: runs[1]!.id,
      itemId: "item-b",
      kind: "error",
      code: "ai_invalid_output",
      nodeId: "assess",
      at: minute(10.1),
      summary: "ai_invalid_output: no result",
    },
  ]);
  await addReceipt(world, SCOPE, wf, {
    key: done,
    status: "done",
    externalRef: "ts-1",
    url: "https://slack.example.test/p1",
    at: minute(0.1),
  });
  return { wf, runs: runs.map((r) => r.id) };
}

describe("get-workflow-node-audit", () => {
  it("is a read-only GET with a limit of 20 by default and 50 at most", () => {
    const definition = action as unknown as {
      readOnly: boolean;
      http: { method: string };
    };
    expect(definition.readOnly).toBe(true);
    expect(definition.http.method).toBe("GET");
    const schema = kit.schemaOf(action);
    const base = {
      factoryId: kit.FACTORY_ID,
      workflowId: "wf",
      nodeId: "assess",
    };
    expect(schema.parse(base)).toMatchObject({ limit: 20 });
    expect(schema.parse({ ...base, limit: 50 })).toMatchObject({ limit: 50 });
    for (const bad of [
      { limit: 0 },
      { limit: 51 },
      { mode: "staging" },
      { nodeId: "" },
    ]) {
      expect(schema.safeParse({ ...base, ...bad }).success).toBe(false);
    }
  });

  it("reports the recent steps, failure rate, durations, samples, errors, and receipts", async () => {
    const { wf, runs } = await seed();
    const audit = await run({
      factoryId: kit.FACTORY_ID,
      workflowId: wf,
      nodeId: "assess",
    });
    expect(audit.node).toEqual({ id: "assess", name: "assess", kind: "ai" });
    expect(audit.summary).toMatchObject({
      steps: 3,
      statusCounts: { succeeded: 2, failed: 1 },
      failureRate: 1 / 3,
      durationMs: { p50: 4000, p95: 6000, samples: 3 },
    });
    expect(audit.steps.map((s: { runId: string }) => s.runId)).toEqual([
      runs[2],
      runs[1],
      runs[0],
    ]);
    expect(audit.latest.runId).toBe(runs[2]);
    expect(audit.latest.in[0]).toMatchObject({
      fromNodeId: "feedback",
      count: 2,
      items: [
        { itemId: "item-a", title: "Alice report" },
        { itemId: "item-b", title: "Bob report" },
      ],
    });
    expect(audit.latest.out[0].items[0]).toMatchObject({
      itemId: "item-a",
      summary: "clear false",
    });
    expect(audit.errors.byCode).toMatchObject([
      {
        code: "ai_invalid_output",
        steps: 1,
        lastMessage: "no result",
        lastRunId: runs[1],
      },
    ]);
    expect(audit.errors.recentItemErrors).toMatchObject([
      { itemId: "item-b", summary: "ai_invalid_output: no result" },
    ]);

    const reply = await run({
      factoryId: kit.FACTORY_ID,
      workflowId: wf,
      nodeId: "reply",
    });
    expect(reply.receipts).toMatchObject([
      {
        status: "done",
        externalRef: "ts-1",
        url: "https://slack.example.test/p1",
        itemId: "item-a",
      },
    ]);
  });

  it("limits the steps and says when there are more", async () => {
    const { wf } = await seed();
    const audit = await run({
      factoryId: kit.FACTORY_ID,
      workflowId: wf,
      nodeId: "assess",
      limit: 2,
    });
    expect(audit.steps).toHaveLength(2);
    expect(audit.hasMoreSteps).toBe(true);
  });

  it("reads one run's step when asked, and refuses a run that is not there", async () => {
    const { wf, runs } = await seed();
    const audit = await run({
      factoryId: kit.FACTORY_ID,
      workflowId: wf,
      nodeId: "assess",
      runId: runs[1],
    });
    expect(audit.runId).toBe(runs[1]);
    expect(audit.steps).toHaveLength(1);
    expect(
      await kit.failureOf(() =>
        run({
          factoryId: kit.FACTORY_ID,
          workflowId: wf,
          nodeId: "assess",
          runId: "wfr_nope",
        }),
      ),
    ).toMatchObject({ errorCode: "workflow_run_not_found", statusCode: 404 });
  });

  it("answers a node the graph lacks with a typed error, and a node that never ran with an empty audit", async () => {
    const { wf } = await seed();
    const missing = await kit.failureOf(() =>
      run({ factoryId: kit.FACTORY_ID, workflowId: wf, nodeId: "ghost" }),
    );
    expect(missing).toMatchObject({
      errorCode: "workflow_node_not_found",
      statusCode: 404,
      details: { nodeId: "ghost", graphVersion: 1 },
    });
    const idle = await run({
      factoryId: kit.FACTORY_ID,
      workflowId: wf,
      nodeId: "manual",
    });
    expect(idle.steps).toEqual([]);
    expect(idle.summary).toMatchObject({
      steps: 0,
      failureRate: null,
      durationMs: null,
    });
    expect(idle.latest).toBeNull();
    expect(
      await kit.failureOf(() =>
        run({
          factoryId: kit.FACTORY_ID,
          workflowId: "wf_nope",
          nodeId: "assess",
        }),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found" });
  });

  it("sees only its own factory and organization", async () => {
    const { wf } = await seed();
    const theirs = await addWorkflow(world, {
      scope: OTHER_FACTORY,
      name: "Theirs",
    });
    expect(
      await kit.failureOf(() =>
        run({
          factoryId: kit.FACTORY_ID,
          workflowId: theirs.id,
          nodeId: "assess",
        }),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found" });
    expect(
      await kit.failureOf(() =>
        run({
          factoryId: kit.OTHER_FACTORY_ID,
          workflowId: wf,
          nodeId: "assess",
        }),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found" });
    kit.callAsOrg("org-2");
    expect(
      await kit.failureOf(() =>
        run({ factoryId: "factory-1", workflowId: wf, nodeId: "assess" }),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found" });
  });

  it("fails with its own code when a stored step is damaged", async () => {
    const { wf } = await seed();
    await world.client.query(
      "UPDATE factory_workflow_steps SET ports_json = 'nope' WHERE node_id = 'assess'",
    );
    const error = await kit.failureOf(() =>
      run({ factoryId: kit.FACTORY_ID, workflowId: wf, nodeId: "assess" }),
    );
    expect(error).toMatchObject({
      errorCode: "stored_record_unreadable",
      statusCode: 500,
    });
    expect(error.message).toContain("factory_workflow_steps");
  });
});
