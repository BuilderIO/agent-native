import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const { PGlite } = createRequire(
  new URL("../../package.json", import.meta.url),
)("@electric-sql/pglite");

import { factoryMigrations } from "../plugins/factory-migrations.js";
import type { WorkflowScope, WorkflowStore } from "../workflow/adapter.js";
import { workflowGraphSchema } from "../workflow/contract.js";
import { createDrizzleWorkflowStore } from "./store.js";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const SCOPE: WorkflowScope = { orgId: "org-1", factoryId: "factory-1" };
const OWNER = "owner@example.test";
const AUTOMATION = "job-1";

const graph = (every: "5m" | "15m") =>
  workflowGraphSchema.parse({
    nodes: [
      {
        id: "trigger",
        kind: "trigger",
        name: "Every",
        position: { x: 0, y: 0 },
        settings: { schedule: { every } },
      },
    ],
    edges: [],
    settings: {},
  });

let client: PGliteClient;
let store: WorkflowStore;

beforeAll(async () => {
  client = await PGlite.create("memory://");
  for (const migration of factoryMigrations) {
    if (typeof migration.sql === "string") await client.exec(migration.sql);
  }
  const db = drizzle(client);
  store = createDrizzleWorkflowStore({ getDatabase: () => db });
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.exec("TRUNCATE factory_workflows, factory_workflow_versions");
});

async function enabledWorkflow() {
  const created = await store.createWorkflow(SCOPE, {
    name: "Digest",
    automationId: AUTOMATION,
    graph: graph("15m"),
    ownerEmail: OWNER,
  });
  await store.recordCleanDryRun(SCOPE, {
    workflowId: created.id,
    version: 1,
  });
  await store.setWorkflowEnabled(SCOPE, created.id, true);
  return created.id;
}

async function storedFlag(workflowId: string) {
  const { rows } = await client.query(
    "SELECT enabled, version FROM factory_workflows WHERE id = $1",
    [workflowId],
  );
  return rows[0] as { enabled: number; version: number };
}

// What the job runner and the engine read before a live tick.
async function readsEnabled(workflowId: string) {
  return [
    (await store.getWorkflow(SCOPE, workflowId))?.enabled,
    (await store.getWorkflowByAutomation(SCOPE, AUTOMATION))?.enabled,
    (await store.listWorkflows(SCOPE)).items.find(
      (item) => item.id === workflowId,
    )?.enabled,
  ];
}

describe("saving into an enabled workflow", () => {
  it("never leaves a state a tick can read as enabled for the new version", async () => {
    const id = await enabledWorkflow();
    expect(await readsEnabled(id)).toEqual([true, true, true]);

    const saved = await store.saveWorkflowGraph(SCOPE, {
      workflowId: id,
      expectedVersion: 1,
      graph: graph("5m"),
      source: "save",
      summary: "edit",
      createdBy: OWNER,
    });

    // No second write has happened: the save alone left the row off.
    expect(saved).toMatchObject({ enabled: false, version: 2 });
    expect(await storedFlag(id)).toEqual({ enabled: 0, version: 2 });
    expect(await readsEnabled(id)).toEqual([false, false, false]);
  });

  it("reads a row that says on for a version without a clean dry run as off", async () => {
    const id = await enabledWorkflow();
    await store.saveWorkflowGraph(SCOPE, {
      workflowId: id,
      expectedVersion: 1,
      graph: graph("5m"),
      source: "save",
      summary: "edit",
      createdBy: OWNER,
    });
    // The state the two-write save used to pass through: on, version 2, dry
    // run of version 1.
    await client.query(
      "UPDATE factory_workflows SET enabled = 1 WHERE id = $1",
      [id],
    );

    expect(await storedFlag(id)).toEqual({ enabled: 1, version: 2 });
    expect(await readsEnabled(id)).toEqual([false, false, false]);
  });

  it("is enabled again only by enabling the new version after its own dry run", async () => {
    const id = await enabledWorkflow();
    await store.saveWorkflowGraph(SCOPE, {
      workflowId: id,
      expectedVersion: 1,
      graph: graph("5m"),
      source: "save",
      summary: "edit",
      createdBy: OWNER,
    });

    await store.recordCleanDryRun(SCOPE, { workflowId: id, version: 2 });
    expect(await readsEnabled(id)).toEqual([false, false, false]);

    await store.setWorkflowEnabled(SCOPE, id, true);
    expect(await readsEnabled(id)).toEqual([true, true, true]);
  });
});
