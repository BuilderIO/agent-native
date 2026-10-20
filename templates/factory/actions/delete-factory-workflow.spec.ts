import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/action", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
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
vi.mock("../server/workflow-host/factory-store.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/workflow-actions-kit.js");
  return kit.workflowStoreModule;
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

import * as kit from "../server/workflow-host/testing/workflow-actions-kit.js";
import remove from "./delete-factory-workflow.js";
import save from "./save-factory-workflow.js";

const runSave = kit.runOf(save);
const run = kit.runOf(remove);
const scope = { orgId: kit.ORG_ID, factoryId: kit.FACTORY_ID };

const destroy = (workflowId: string, force?: boolean) =>
  run(
    { factoryId: kit.FACTORY_ID, workflowId, force: force ?? false },
    kit.context,
  );

async function create() {
  return runSave(
    {
      factoryId: kit.FACTORY_ID,
      name: "Digest",
      graph: kit.simpleGraph(),
    },
    kit.context,
  );
}

/** An item parked at a Wait, the way the engine leaves it between ticks. */
async function park(workflowId: string, itemId: string, dueAt: string) {
  const store = kit.currentStore();
  const now = "2026-10-18T10:00:00.000Z";
  await store.leaseItems(scope, {
    workflowId,
    graphVersion: 1,
    itemIds: [itemId],
    leasedBy: "run-1",
    now,
  });
  await store.parkItem(scope, {
    workflowId,
    itemId,
    leasedBy: "run-1",
    graphVersion: 1,
    nodeId: "pause",
    wake: { wait: "time", dueAt },
    context: {},
  });
}

beforeEach(() => {
  kit.reset();
});

describe("delete-factory-workflow", () => {
  it("deletes the rows, the job file and the job's run history", async () => {
    const created = await create();

    const result = await destroy(created.workflowId);

    expect(result).toEqual({
      workflowId: created.workflowId,
      deleted: true,
      jobRemoved: true,
      parkedItems: 0,
    });
    expect(
      await kit.currentStore().getWorkflow(scope, created.workflowId),
    ).toBeNull();
    expect(kit.jobFiles()).toEqual([]);
    expect(kit.removedHistories).toEqual([
      {
        owner: kit.orgOwner(),
        automation: created.job.path
          .replace(/^jobs\//, "")
          .replace(/\.md$/, ""),
      },
    ]);
  });

  it("refuses while items are parked, and deletes nothing", async () => {
    const created = await create();
    await park(created.workflowId, "item-1", "2099-01-01T00:00:00.000Z");

    const failure = await kit.failureOf(() => destroy(created.workflowId));

    expect(failure).toMatchObject({
      errorCode: "parked_items_exist",
      statusCode: 409,
      details: {
        workflowId: created.workflowId,
        parkedItems: 1,
        atLeast: false,
      },
    });
    expect(
      await kit.currentStore().getWorkflow(scope, created.workflowId),
    ).not.toBeNull();
    expect(kit.jobFiles()).toHaveLength(1);
  });

  it("counts an item parked for years ahead, and one a run holds a lease on", async () => {
    const created = await create();
    await park(created.workflowId, "item-1", "2999-01-01T00:00:00.000Z");
    await park(created.workflowId, "item-2", "2026-10-19T10:00:00.000Z");
    await kit.currentStore().leaseItems(scope, {
      workflowId: created.workflowId,
      graphVersion: 1,
      itemIds: ["item-2"],
      leasedBy: "run-2",
      now: "2026-10-18T10:05:00.000Z",
    });

    const failure = await kit.failureOf(() => destroy(created.workflowId));

    expect(failure.details).toMatchObject({ parkedItems: 2 });
  });

  it("deletes anyway when force is passed, and says how many items it dropped", async () => {
    const created = await create();
    await park(created.workflowId, "item-1", "2099-01-01T00:00:00.000Z");

    const result = await destroy(created.workflowId, true);

    expect(result).toMatchObject({ deleted: true, parkedItems: 1 });
    expect(
      await kit.currentStore().getWorkflow(scope, created.workflowId),
    ).toBeNull();
    expect(kit.jobFiles()).toEqual([]);
  });

  it("still deletes the rows when the job file is already gone", async () => {
    const created = await create();
    kit.removeJob(created.job.path);

    const result = await destroy(created.workflowId);

    expect(result).toMatchObject({ deleted: true, jobRemoved: false });
    expect(
      await kit.currentStore().getWorkflow(scope, created.workflowId),
    ).toBeNull();
  });

  it("fails for a workflow that does not exist, or one in another factory", async () => {
    expect(await kit.failureOf(() => destroy("missing"))).toMatchObject({
      errorCode: "workflow_not_found",
      statusCode: 404,
    });
    kit.addFactory("other-factory");
    const created = await create();
    expect(
      await kit.failureOf(() =>
        run(
          {
            factoryId: "other-factory",
            workflowId: created.workflowId,
            force: false,
          },
          kit.context,
        ),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found" });
    expect(kit.jobFiles()).toHaveLength(1);
  });
});

describe("delete-factory-workflow: declarations", () => {
  const declared = remove as unknown as {
    audit: {
      target: (args: unknown) => unknown;
      summary: (args: unknown, result: unknown) => string;
    };
    mcpAnnotations: Record<string, boolean>;
  };

  it("is declared destructive and audited for the whole organization", () => {
    expect(declared.mcpAnnotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(declared.audit.target({ workflowId: "wf-1" })).toEqual({
      type: "factory-workflow",
      id: "wf-1",
      visibility: "org",
    });
    expect(
      declared.audit.summary({ workflowId: "wf-1" }, { parkedItems: 2 }),
    ).toBe("Deleted workflow wf-1 with 2 parked item(s)");
  });
});
