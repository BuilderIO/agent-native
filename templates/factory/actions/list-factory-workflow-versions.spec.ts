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
import listVersions from "./list-factory-workflow-versions.js";
import save from "./save-factory-workflow.js";

const runSave = kit.runOf(save);
const run = kit.runOf(listVersions);

async function threeVersions() {
  const created = await runSave(
    { factoryId: kit.FACTORY_ID, name: "Digest", graph: kit.simpleGraph() },
    kit.context,
  );
  for (const expectedVersion of [1, 2]) {
    await runSave(
      {
        factoryId: kit.FACTORY_ID,
        workflowId: created.workflowId,
        expectedVersion,
        summary: `Edit ${expectedVersion}`,
        graph: kit.simpleGraph({ schedule: { every: "30m" } }),
      },
      expectedVersion === 1 ? kit.agentContext : kit.context,
    );
  }
  return created;
}

beforeEach(() => {
  kit.reset();
});

describe("list-factory-workflow-versions", () => {
  it("lists versions newest first, without graphs, and marks the current one", async () => {
    const created = await threeVersions();

    const result = await run(
      { factoryId: kit.FACTORY_ID, workflowId: created.workflowId, limit: 50 },
      kit.context,
    );

    expect(result.currentVersion).toBe(3);
    expect(
      result.versions.map(
        (version: { version: number; source: string; current: boolean }) => [
          version.version,
          version.source,
          version.current,
        ],
      ),
    ).toEqual([
      [3, "save", true],
      [2, "agent", false],
      [1, "save", false],
    ]);
    expect(result.versions[0]).toMatchObject({
      summary: "Edit 2",
      createdBy: kit.USER_EMAIL,
    });
    expect(result.versions[0]).not.toHaveProperty("graph");
    expect(result.hasMore).toBe(false);
  });

  it("says when the list was cut", async () => {
    const created = await threeVersions();

    const result = await run(
      { factoryId: kit.FACTORY_ID, workflowId: created.workflowId, limit: 2 },
      kit.context,
    );

    expect(result.versions).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it("fails for a workflow that does not exist", async () => {
    expect(
      await kit.failureOf(() =>
        run(
          { factoryId: kit.FACTORY_ID, workflowId: "missing", limit: 50 },
          kit.context,
        ),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found", statusCode: 404 });
  });
});
