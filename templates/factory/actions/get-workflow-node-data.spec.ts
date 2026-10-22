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

import { triageItems } from "../server/db/schema.js";
import { READ_LIMITS } from "../server/workflow-host/read-models.js";
import * as kit from "../server/workflow-host/testing/read-actions-kit.js";
import {
  OTHER_FACTORY,
  OWNER,
  SCOPE,
  addInboxItem,
  addRun,
  addWorkflow,
  closeClient,
  createWorld,
  type World,
} from "../server/workflow-host/testing/read-models-kit.js";
import type { WorkflowScope } from "../server/workflow/adapter.js";
import action from "./get-workflow-node-data.js";

const run = kit.runOf(action);
const { failureOf } = kit;
const minute = (n: number) =>
  new Date(Date.parse("2026-10-18T09:00:00.000Z") + n * 60_000).toISOString();
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

afterAll(closeClient);

let world: World;

beforeEach(async () => {
  world = await createWorld();
  kit.bind(world);
});

async function addItem(
  id: string,
  fields: {
    scope?: WorkflowScope;
    summary?: string;
    sourceUrl?: string;
    metadata?: Record<string, unknown>;
  } = {},
) {
  const scope = fields.scope ?? SCOPE;
  await world.db.insert(triageItems).values({
    id,
    source: "slack",
    externalId: id,
    sourceUrl: fields.sourceUrl ?? null,
    title: `Report ${id}`,
    summary: fields.summary ?? null,
    channelId: "C1",
    threadTs: "1700000000.000100",
    status: "received",
    dedupeKey: `${scope.orgId}:${scope.factoryId}:${id}`,
    metadataJson: JSON.stringify(fields.metadata ?? {}),
    createdAt: world.now(),
    updatedAt: world.now(),
    ownerEmail: OWNER,
    orgId: scope.orgId,
    factoryId: scope.factoryId,
  });
}

/** Two runs of the read graph; the newer one carries itemIds on `feedback` and `assess`. */
async function seed(itemIds: string[] = ["item-a", "item-b"]) {
  const workflow = await addWorkflow(world);
  const wf = workflow.id;
  const first = await addRun(world, {
    workflowId: wf,
    tickKey: "t1",
    startedAt: minute(0),
    status: "succeeded",
    steps: [
      {
        nodeId: "feedback",
        status: "succeeded",
        ports: { out: { count: 1, itemIds: ["item-a"] } },
      },
      {
        nodeId: "assess",
        status: "succeeded",
        ports: { out: { count: 1, itemIds: ["item-a"] } },
      },
    ],
  });
  const second = await addRun(world, {
    workflowId: wf,
    tickKey: "t2",
    startedAt: minute(10),
    status: "succeeded",
    steps: [
      {
        nodeId: "feedback",
        status: "succeeded",
        ports: { out: { count: itemIds.length, itemIds } },
      },
      {
        nodeId: "assess",
        status: "succeeded",
        ports: { out: { count: itemIds.length, itemIds } },
      },
    ],
  });
  return { wf, first: first.id, second: second.id };
}

const base = (wf: string, extra: Record<string, unknown> = {}) => ({
  factoryId: kit.FACTORY_ID,
  workflowId: wf,
  nodeId: "assess",
  ...extra,
});

describe("get-workflow-node-data", () => {
  it("is a read-only GET with a port limit of 10 by default and 25 at most", () => {
    const definition = action as unknown as {
      readOnly: boolean;
      http: { method: string };
      description: string;
    };
    expect(definition.readOnly).toBe(true);
    expect(definition.http.method).toBe("GET");
    expect(definition.description).toContain("Not included: lookup and action");
    const schema = kit.schemaOf(action);
    const ok = {
      factoryId: kit.FACTORY_ID,
      workflowId: "wf",
      nodeId: "assess",
    };
    expect(schema.parse(ok)).toMatchObject({ portLimit: 10 });
    expect(schema.parse({ ...ok, portLimit: 25 })).toMatchObject({
      portLimit: 25,
    });
    for (const bad of [{ portLimit: 0 }, { portLimit: 26 }, { side: "both" }]) {
      expect(schema.safeParse({ ...ok, ...bad }).success).toBe(false);
    }
  });

  it("reads the newest run's incoming items from the upstream step and the node's own output", async () => {
    await addItem("item-a", {
      summary: "Alice says the export button is broken",
      sourceUrl: "https://slack.example.test/p1",
      metadata: { author: "alice", extras: { channel: "bugs" } },
    });
    await addItem("item-b");
    const { wf, second } = await seed(["item-a", "item-b", "group:1"]);
    const data = await run(base(wf));
    expect(data.run).toMatchObject({ id: second, mode: "live" });
    expect(data.step).toMatchObject({ status: "succeeded" });
    expect(data.in).toHaveLength(1);
    expect(data.in[0]).toMatchObject({
      fromNodeId: "feedback",
      fromPort: "out",
      upstreamStatus: "succeeded",
      count: 3,
      itemsTruncated: false,
    });
    expect(data.in[0].items[0]).toMatchObject({
      itemId: "item-a",
      synthetic: false,
      title: "Report item-a",
      text: "Alice says the export button is broken",
      url: "https://slack.example.test/p1",
      author: "alice",
      thread: { channelId: "C1", threadTs: "1700000000.000100" },
      extras: { channel: "bugs", status: "received" },
      truncated: false,
    });
    expect(data.in[0].items[2]).toEqual({ itemId: "group:1", synthetic: true });
    expect(data.out[0].port).toBe("out");
    expect(data.out[0].items.map((i: { itemId: string }) => i.itemId)).toEqual([
      "item-a",
      "item-b",
      "group:1",
    ]);
    expect(data.truncated).toBe(false);
  });

  it("reads one side only, and an older run when asked", async () => {
    await addItem("item-a");
    await addItem("item-b");
    const { wf, first } = await seed();
    const out = await run(base(wf, { side: "out", runId: first }));
    expect(out.in).toBeNull();
    expect(out.run.id).toBe(first);
    expect(out.out[0].items.map((i: { itemId: string }) => i.itemId)).toEqual([
      "item-a",
    ]);
    const incoming = await run(base(wf, { side: "in", runId: first }));
    expect(incoming.out).toBeNull();
    expect(incoming.in[0].count).toBe(1);
  });

  it("lists at most portLimit items and says it left some out", async () => {
    await addItem("item-a");
    await addItem("item-b");
    const { wf } = await seed();
    const data = await run(base(wf, { side: "out", portLimit: 1 }));
    expect(data.out[0].count).toBe(2);
    expect(data.out[0].items).toHaveLength(1);
    expect(data.out[0].itemsTruncated).toBe(true);
  });

  it("returns an empty read, not an error, for a node that never ran or whose upstream has no step", async () => {
    const workflow = await addWorkflow(world);
    const data = await run(base(workflow.id));
    expect(data).toMatchObject({ run: null, step: null, truncated: false });
    expect(data.in).toEqual([
      expect.objectContaining({
        fromNodeId: "feedback",
        upstreamStatus: null,
        count: 0,
        items: [],
        itemsTruncated: false,
      }),
    ]);
    expect(data.out).toEqual([]);
  });

  it("does not find a node, run, or workflow of another factory", async () => {
    const mine = await seed();
    const other = await addWorkflow(world, { scope: OTHER_FACTORY });
    await addRun(world, {
      scope: OTHER_FACTORY,
      workflowId: other.id,
      tickKey: "o1",
      startedAt: minute(0),
      status: "succeeded",
      steps: [
        {
          nodeId: "assess",
          status: "succeeded",
          ports: { out: { count: 1, itemIds: ["item-x"] } },
        },
      ],
    });
    const workflow = await failureOf(() => run(base(other.id)));
    expect(workflow.errorCode).toBe("workflow_not_found");
    expect(workflow.statusCode).toBe(404);
    const missingNode = await failureOf(() =>
      run(base(mine.wf, { nodeId: "nope" })),
    );
    expect(missingNode.errorCode).toBe("workflow_node_not_found");
    const runOfOther = await failureOf(() =>
      run(base(mine.wf, { runId: "run-from-elsewhere" })),
    );
    expect(runOfOther.errorCode).toBe("workflow_run_not_found");
    const unknownFactory = await failureOf(() =>
      run({ ...base(mine.wf), factoryId: "factory-9" }),
    );
    expect(unknownFactory.errorCode).toBe("factory_not_found");
  });

  it("treats another factory's item row as not stored here", async () => {
    await addItem("item-a", { scope: OTHER_FACTORY, summary: "secret text" });
    const { wf } = await seed(["item-a"]);
    const data = await run(base(wf, { side: "out" }));
    expect(data.out[0].items).toEqual([{ itemId: "item-a", synthetic: true }]);
  });

  it("redacts secrets in text, urls, extras and the author", async () => {
    await addItem("item-a", {
      summary:
        "deploy failed with token ghp_abcdefghijklmnop1234 for anna@example.test",
      sourceUrl: "https://hooks.example.test/p1?api_key=abc123def456",
      metadata: {
        // guard:allow-secret-literal — fake token shape, the test proves redaction removes it
        author: "xoxb-1234-abcdef-secretvalue",
        extras: { note: "password=hunter2hunter2" },
      },
    });
    const { wf } = await seed(["item-a"]);
    const data = await run(base(wf, { side: "out" }));
    const item = data.out[0].items[0];
    const text = JSON.stringify(item);
    expect(text).not.toContain("ghp_abcdefghijklmnop1234");
    expect(text).not.toContain("anna@example.test");
    expect(text).not.toContain("abc123def456");
    expect(text).not.toContain("secretvalue");
    expect(text).not.toContain("hunter2hunter2");
    expect(item.url).toBe("https://hooks.example.test/p1?[redacted]");
    expect(item.itemId).toBe("item-a");
  });

  it("caps one item at 8 KB, flagging it", async () => {
    await addItem("item-a", {
      summary: "word ".repeat(1000),
      metadata: {
        extras: Object.fromEntries(
          Array.from({ length: 200 }, (_, i) => [`k${i}`, "v".repeat(100)]),
        ),
      },
    });
    const { wf } = await seed(["item-a"]);
    const data = await run(base(wf, { side: "out" }));
    const item = data.out[0].items[0];
    expect(bytes(item)).toBeLessThanOrEqual(READ_LIMITS.nodeDataItemBytes);
    expect(item.truncated).toBe(true);
    expect(item.title).toBe("Report item-a");
    expect(item.text.length).toBeGreaterThan(0);
  });

  it("caps the whole response at 64 KB and flags the ports that lost items", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `item-${i}`);
    for (const id of ids) {
      await addItem(id, {
        summary: "word ".repeat(400),
        metadata: {
          extras: Object.fromEntries(
            Array.from({ length: 60 }, (_, i) => [`k${i}`, "v".repeat(100)]),
          ),
        },
      });
    }
    const { wf } = await seed(ids);
    const data = await run(base(wf, { portLimit: 25 }));
    expect(bytes(data)).toBeLessThanOrEqual(READ_LIMITS.nodeDataResponseBytes);
    expect(data.truncated).toBe(true);
    expect(data.in[0].itemsTruncated).toBe(true);
    expect(data.out[0].itemsTruncated).toBe(true);
    expect(data.in[0].items.length).toBeGreaterThan(0);
    expect(data.out[0].items.length).toBeGreaterThan(0);
    expect(data.in[0].items.length).toBeLessThan(25);
  });
});
