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

import { readAutomationDisplayName } from "../server/lib/factory-scope.js";
import * as kit from "../server/workflow-host/testing/workflow-actions-kit.js";
import rename from "./rename-factory-workflow.js";
import save from "./save-factory-workflow.js";

const runSave = kit.runOf(save);
const run = kit.runOf(rename);
const scope = { orgId: kit.ORG_ID, factoryId: kit.FACTORY_ID };

const renameTo = (workflowId: string, name: string) =>
  run({ factoryId: kit.FACTORY_ID, workflowId, name }, kit.context);

async function create() {
  return runSave(
    { factoryId: kit.FACTORY_ID, name: "Digest", graph: kit.simpleGraph() },
    kit.context,
  );
}

beforeEach(() => {
  kit.reset();
});

describe("rename-factory-workflow", () => {
  it("changes only the name and returns the updated summary", async () => {
    const created = await create();
    const before = await kit
      .currentStore()
      .getWorkflow(scope, created.workflowId);

    const result = await renameTo(created.workflowId, "Weekly digest");

    expect(result).toMatchObject({
      id: created.workflowId,
      name: "Weekly digest",
      previousName: "Digest",
      changed: true,
      version: 1,
      enabled: false,
    });
    const after = await kit
      .currentStore()
      .getWorkflow(scope, created.workflowId);
    expect(after).toMatchObject({ name: "Weekly digest", version: 1 });
    expect(after?.graph).toEqual(before?.graph);
    expect(
      readAutomationDisplayName(kit.readJob(created.job.path) as string),
    ).toBe("Weekly digest");
  });

  it("is a no-op for the name it already has", async () => {
    const created = await create();

    expect(await renameTo(created.workflowId, "Digest")).toMatchObject({
      name: "Digest",
      changed: false,
    });
  });

  it("still renames when the job file is already gone", async () => {
    const created = await create();
    kit.removeJob(created.job.path);

    expect(await renameTo(created.workflowId, "Weekly digest")).toMatchObject({
      name: "Weekly digest",
      changed: true,
      job: null,
    });
  });

  it("fails for a workflow that does not exist, or one in an unrelated factory", async () => {
    expect(await kit.failureOf(() => renameTo("missing", "x"))).toMatchObject({
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
            name: "Taken over",
          },
          kit.context,
        ),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found" });
    expect(
      (await kit.currentStore().getWorkflow(scope, created.workflowId))?.name,
    ).toBe("Digest");
  });

  it("is declared non-destructive and audited for the whole organization", () => {
    const declared = rename as unknown as {
      audit: {
        target: (args: unknown) => unknown;
        summary: (args: unknown, result: unknown) => string;
      };
      mcpAnnotations: Record<string, boolean>;
    };
    expect(declared.mcpAnnotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(declared.audit.target({ workflowId: "wf-1" })).toEqual({
      type: "factory-workflow",
      id: "wf-1",
      visibility: "org",
    });
    expect(
      declared.audit.summary(
        { workflowId: "wf-1" },
        { id: "wf-1", previousName: "A", name: "B", changed: true },
      ),
    ).toBe('Renamed workflow wf-1 from "A" to "B"');
  });
});
