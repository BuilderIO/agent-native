import { describe, expect, it } from "vitest";

import {
  createInMemoryStoreState,
  createInMemoryWorkflowStore,
} from "./in-memory-store.js";
import { runStoreConformance } from "./store-conformance.js";

runStoreConformance("in-memory store", (clock) => ({
  store: createInMemoryWorkflowStore({ clock }),
}));

describe("in-memory store", () => {
  it("numbers its own ids and moves its own clock the same way every run", async () => {
    const make = () => createInMemoryWorkflowStore();
    const create = async (store: ReturnType<typeof make>) =>
      store.createWorkflow(
        { orgId: "org-1", factoryId: "factory-1" },
        {
          name: "First",
          ownerEmail: "owner@example.test",
          graph: {
            nodes: [],
            edges: [],
            settings: { checkCadenceMinutes: 15, modelCallCap: 50 },
          },
        },
      );

    const first = await create(make());
    const second = await create(make());

    expect(first.id).toBe("workflow-1");
    expect(first).toEqual(second);
  });

  it("does not let a caller change stored state through what it was handed", async () => {
    const store = createInMemoryWorkflowStore();
    const scope = { orgId: "org-1", factoryId: "factory-1" };
    const created = await store.createWorkflow(scope, {
      name: "First",
      ownerEmail: "owner@example.test",
      graph: {
        nodes: [],
        edges: [],
        settings: { checkCadenceMinutes: 15, modelCallCap: 50 },
      },
    });

    created.graph.settings.modelCallCap = 999;
    created.name = "Changed";

    const reread = await store.getWorkflow(scope, created.id);
    expect(reread?.graph.settings.modelCallCap).toBe(50);
    expect(reread?.name).toBe("First");
  });
});

describe("two in-memory stores over one state", () => {
  it("are two processes over one database: what the first wrote, the second reads", async () => {
    const state = createInMemoryStoreState();
    const first = createInMemoryWorkflowStore({ state });
    const second = createInMemoryWorkflowStore({ state });
    const scope = { orgId: "org-1", factoryId: "factory-1" };

    const created = await first.createWorkflow(scope, {
      name: "Shared",
      ownerEmail: "owner@example.test",
      graph: {
        nodes: [],
        edges: [],
        settings: { checkCadenceMinutes: 15, modelCallCap: 50 },
      },
    });

    expect((await second.getWorkflow(scope, created.id))?.name).toBe("Shared");
    // Ids keep counting across them instead of starting over.
    const next = await second.createWorkflow(scope, {
      name: "Second",
      ownerEmail: "owner@example.test",
      graph: created.graph,
    });
    expect(next.id).not.toBe(created.id);
  });
});
