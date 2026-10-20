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

vi.mock("../server/triage/audit.js", () => ({
  recordFactoryGovernanceAudit: vi.fn().mockResolvedValue(undefined),
}));

import * as kit from "../server/workflow-host/testing/workflow-actions-kit.js";
import list from "./list-factory-workflows.js";
import save from "./save-factory-workflow.js";

const runSave = kit.runOf(save);
const run = kit.runOf(list);
const scope = { orgId: kit.ORG_ID, factoryId: kit.FACTORY_ID };

const create = (name: string) =>
  runSave(
    { factoryId: kit.FACTORY_ID, name, graph: kit.simpleGraph() },
    kit.context,
  );

beforeEach(() => {
  kit.reset();
});

describe("list-factory-workflows", () => {
  it("lists workflows without their graphs, each with its job's health", async () => {
    const created = await create("Morning digest");

    const result = await run(
      { factoryId: kit.FACTORY_ID, limit: 50 },
      kit.context,
    );

    expect(result.hasMore).toBe(false);
    expect(result.workflows).toHaveLength(1);
    const [row] = result.workflows;
    expect(row).toMatchObject({
      id: created.workflowId,
      name: "Morning digest",
      version: 1,
      enabled: false,
      lastCleanDryRunVersion: null,
      dryRunCurrent: false,
      ownerEmail: kit.USER_EMAIL,
      job: {
        exists: true,
        enabled: false,
        runner: "workflow",
        schedule: "*/15 * * * *",
        drift: [],
      },
    });
    expect(row).not.toHaveProperty("graph");
  });

  it("marks a workflow whose job file is gone, instead of listing it as healthy", async () => {
    const created = await create("Digest");
    kit.removeJob(created.job.path);

    const result = await run(
      { factoryId: kit.FACTORY_ID, limit: 50 },
      kit.context,
    );

    expect(result.workflows[0].job).toMatchObject({
      exists: false,
      drift: ["missing"],
    });
  });

  it("says when the current version has a clean dry run", async () => {
    const created = await create("Digest");
    await kit.currentStore().recordCleanDryRun(scope, {
      workflowId: created.workflowId,
      version: 1,
    });

    const result = await run(
      { factoryId: kit.FACTORY_ID, limit: 50 },
      kit.context,
    );

    expect(result.workflows[0]).toMatchObject({
      lastCleanDryRunVersion: 1,
      dryRunCurrent: true,
    });
  });

  it("pages, and says when the list was cut", async () => {
    await create("One");
    await create("Two");
    await create("Three");

    const result = await run(
      { factoryId: kit.FACTORY_ID, limit: 2 },
      kit.context,
    );

    expect(result.workflows).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it("lists only the factory it was asked about", async () => {
    kit.addFactory("other-factory");
    await create("Mine");
    await kit.currentStore().createWorkflow(
      { orgId: kit.ORG_ID, factoryId: "other-factory" },
      {
        name: "Theirs",
        graph: kit.simpleGraph(),
        ownerEmail: kit.USER_EMAIL,
      },
    );

    const result = await run(
      { factoryId: kit.FACTORY_ID, limit: 50 },
      kit.context,
    );

    expect(result.workflows.map((row: { name: string }) => row.name)).toEqual([
      "Mine",
    ]);
  });

  it("is empty for a factory with no workflows, and fails for one that does not exist", async () => {
    expect(
      await run({ factoryId: kit.FACTORY_ID, limit: 50 }, kit.context),
    ).toEqual({ workflows: [], hasMore: false });
    expect(
      await kit.failureOf(() =>
        run({ factoryId: "nowhere", limit: 50 }, kit.context),
      ),
    ).toMatchObject({ errorCode: "factory_not_found" });
  });

  it("pauses a retired seeded agent job on the landing read, even before any workflow exists", async () => {
    const path = "jobs/factories/support-triage/factory-slack-feedback.md";
    kit.seedJob(
      path,
      "---\nschedule: '*/5 * * * *'\nenabled: true\ntriggerType: schedule\ndomain: factory\nappId: factory\norgId: org-1\ncreatedBy: teammate@example.test\nrunAs: creator\nsource: slack\n---\nCall get-slack-feedback-context for each item.\n",
    );

    const result = await run(
      { factoryId: kit.FACTORY_ID, limit: 50 },
      kit.context,
    );

    expect(result.workflows).toEqual([]);
    expect(kit.readJob(path)).toMatch(/^enabled: false$/m);
    expect(kit.readJob(path)).toMatch(/^pausedReason: replaced_by_workflows$/m);
  });

  it("writes nothing when an agent lists, so the call stays the read it declares", async () => {
    const path = "jobs/factories/support-triage/factory-slack-feedback.md";
    const seeded =
      "---\nschedule: '*/5 * * * *'\nenabled: true\ntriggerType: schedule\ndomain: factory\nappId: factory\norgId: org-1\ncreatedBy: teammate@example.test\nrunAs: creator\nsource: slack\n---\nCall get-slack-feedback-context for each item.\n";
    kit.seedJob(path, seeded);

    await run({ factoryId: kit.FACTORY_ID, limit: 50 }, kit.agentContext);

    expect(kit.readJob(path)).toBe(seeded);

    // The person's own screen still retires it, once.
    await run({ factoryId: kit.FACTORY_ID, limit: 50 }, kit.context);
    expect(kit.readJob(path)).toMatch(/^pausedReason: replaced_by_workflows$/m);
  });

  it("does not touch a workflow's job file while pausing the retired ones", async () => {
    const created = await create("Digest");
    const before = kit.readJob(created.job.path);

    await run({ factoryId: kit.FACTORY_ID, limit: 50 }, kit.context);

    expect(kit.readJob(created.job.path)).toBe(before);
  });
});
