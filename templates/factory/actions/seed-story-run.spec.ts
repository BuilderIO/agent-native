import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@agent-native/core/action", async () => {
  const kit = await import("../server/workflow-host/testing/action-module.js");
  return kit.actionModule;
});
vi.mock("@agent-native/core/resources", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.resourcesModule;
});
vi.mock("@agent-native/core/jobs", async (importActual) => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.jobsModule(await importActual<Record<string, unknown>>());
});
vi.mock("../server/lib/require-workspace-member.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.memberModule;
});
vi.mock("../server/lib/factory-definitions.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.factoryDefinitionsModule;
});
vi.mock("../server/db/index.js", () => ({
  getDb: () => current().db,
}));
vi.mock("../server/workflow-host/factory-store.js", () => ({
  getWorkflowStore: () => current().store,
}));
vi.mock("../server/workflow-host/factory-read-models.js", () => ({
  getWorkflowReadModels: () => current().models,
}));

import {
  addInboxItem,
  closeClient,
  createWorld,
  type World,
} from "../server/workflow-host/testing/read-models-kit.js";
import * as actionsKit from "../server/workflow-host/testing/workflow-actions-kit.js";
import { buildGraph } from "../server/workflow/story-graphs.fixture.js";
import getItemJourney from "./get-item-journey.js";
import getNodeAudit from "./get-workflow-node-audit.js";
import listWorkflowItems from "./list-workflow-items.js";
import seed from "./seed-story-run.js";

let world: World | undefined;
function current(): World {
  if (!world) throw new Error("no world");
  return world;
}

const FACTORY_ID = actionsKit.FACTORY_ID;
const scope = { orgId: actionsKit.ORG_ID, factoryId: FACTORY_ID };
const call = (action: unknown, input: Record<string, unknown>) =>
  actionsKit.runOf(action)(
    { factoryId: FACTORY_ID, ...input },
    actionsKit.context,
  );
const seedStory = (storyId: string | number, extra = {}) =>
  call(seed, { storyId, purge: false, ...extra });

beforeEach(async () => {
  world = await createWorld();
  actionsKit.reset();
  vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "local");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(closeClient);

describe("seed-story-run", () => {
  it("refuses outside a local dev server and writes nothing", async () => {
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "production");
    const failure = await actionsKit.failureOf(() => seedStory(3));
    expect(failure.errorCode).toBe("seed_story_run_not_allowed");
    expect((await current().store.listWorkflows(scope)).items).toHaveLength(0);
  });

  it("replays a story into the real store, reads back, runs once, and purges only its own rows", async () => {
    const fetchStub = vi.fn(() => {
      throw new Error("the replay must not touch the network");
    });
    vi.stubGlobal("fetch", fetchStub);

    const first = await seedStory(9);
    expect(first).toMatchObject({
      created: { workflow: true, runs: 5, items: 1 },
      ticks: { total: 5, ran: 5, reused: 0 },
    });
    const workflowId = first.workflowId as string;
    const stored = await current().store.getWorkflow(scope, workflowId);
    expect(stored?.enabled).toBe(false);

    const items = await call(listWorkflowItems, { workflowId });
    expect(
      items.items.map((item: { itemId: string }) => item.itemId),
    ).toContain("sub_nadia");
    const journey = await call(getItemJourney, {
      workflowId,
      itemId: "sub_nadia",
    });
    const kinds = journey.events.map((event: { kind: string }) => event.kind);
    expect(kinds).toEqual(expect.arrayContaining(["parked", "woke", "ended"]));
    const audit = await call(getNodeAudit, { workflowId, nodeId: "pause" });
    expect(audit.summary).toBeDefined();

    const again = await seedStory(9);
    expect(again).toMatchObject({
      created: { workflow: false, runs: 0, items: 0 },
      reused: { workflow: true, runs: 5, items: 1 },
      ticks: { ran: 0, reused: 5 },
    });

    await seedStory(3);
    await addInboxItem(current(), { id: "real-item", scope });
    const real = await current().store.createWorkflow(scope, {
      name: "A real workflow",
      graph: buildGraph({
        nodes: [
          ["start", "trigger", { schedule: { every: "15m" } }],
          ["finish", "end", { outcome: "done" }],
        ],
        edges: [["start", "out", "finish"]],
      }),
      ownerEmail: "owner@example.test",
    });

    const purged = await seedStory(9, { purge: true });
    expect(purged.purged).toMatchObject({ workflows: 1, runs: 5, items: 1 });
    const left = (await current().store.listWorkflows(scope)).items.map(
      (workflow) => workflow.name,
    );
    expect(left.sort()).toEqual(
      ["A real workflow", "Seeded story 03: Morning digest"].sort(),
    );
    expect(await current().store.getWorkflow(scope, real.id)).not.toBeNull();
    const rows = await current().client.query(
      "select id from factory_items order by id",
    );
    expect(rows.rows).toEqual([{ id: "real-item" }]);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("names a scenario that does not exist instead of replaying nothing", async () => {
    const failure = await actionsKit.failureOf(() =>
      seedStory(3, { scenario: "nope" }),
    );
    expect(failure.errorCode).toBe("seed_story_scenario_not_found");
    expect((await current().store.listWorkflows(scope)).items).toHaveLength(0);
  });
});
