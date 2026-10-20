import { parseJobResource } from "@agent-native/core/jobs/frontmatter";
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
import restore from "./restore-factory-workflow-version.js";
import save from "./save-factory-workflow.js";
import setEnabled from "./set-factory-workflow-enabled.js";

const runSave = kit.runOf(save);
const runEnable = kit.runOf(setEnabled);
const run = kit.runOf(restore);
const scope = { orgId: kit.ORG_ID, factoryId: kit.FACTORY_ID };

const bring = (workflowId: string, version: number, expectedVersion: number) =>
  run(
    { factoryId: kit.FACTORY_ID, workflowId, version, expectedVersion },
    kit.context,
  );

const jobMeta = (path: string) =>
  parseJobResource(kit.readJob(path) as string).meta;

/** Version 1 every 15 minutes, version 2 every 30 minutes. */
async function twoVersions() {
  const created = await runSave(
    {
      factoryId: kit.FACTORY_ID,
      name: "Digest",
      graph: kit.simpleGraph(),
    },
    kit.context,
  );
  await runSave(
    {
      factoryId: kit.FACTORY_ID,
      workflowId: created.workflowId,
      expectedVersion: 1,
      graph: kit.simpleGraph({ schedule: { every: "30m" } }),
    },
    kit.context,
  );
  return created;
}

beforeEach(() => {
  kit.reset();
});

describe("restore-factory-workflow-version", () => {
  it("saves the old graph as a new version and leaves history alone", async () => {
    const created = await twoVersions();
    const store = kit.currentStore();
    const original = (await store.getWorkflowVersion(
      scope,
      created.workflowId,
      1,
    ))!.graph;

    const result = await bring(created.workflowId, 1, 2);

    expect(result).toMatchObject({
      version: 3,
      restoredFrom: 1,
      enabled: false,
      disabledBySave: false,
    });
    const current = await store.getWorkflow(scope, created.workflowId);
    expect(current?.version).toBe(3);
    expect(current?.graph).toEqual(original);
    const { items } = await store.listWorkflowVersions(
      scope,
      created.workflowId,
    );
    expect(
      items.map((item) => [item.version, item.source, item.summary]),
    ).toEqual([
      [3, "restore", "Restored version 1"],
      [2, "save", "Saved"],
      [1, "save", "Created"],
    ]);
    expect(
      (await store.getWorkflowVersion(scope, created.workflowId, 2))!.graph
        .nodes[0],
    ).toMatchObject({ settings: { schedule: { every: "30m" } } });
  });

  it("writes the restored schedule through to the job file", async () => {
    const created = await twoVersions();
    expect(jobMeta(created.job.path).schedule).toBe("*/30 * * * *");

    await bring(created.workflowId, 1, 2);

    expect(jobMeta(created.job.path)).toMatchObject({
      schedule: "*/15 * * * *",
      runner: "workflow",
    });
  });

  async function enabledAtVersionTwo() {
    const created = await twoVersions();
    await kit.currentStore().recordCleanDryRun(scope, {
      workflowId: created.workflowId,
      version: 2,
    });
    await runEnable(
      {
        factoryId: kit.FACTORY_ID,
        workflowId: created.workflowId,
        enabled: true,
      },
      kit.context,
    );
    expect(jobMeta(created.job.path).enabled).toBe(true);
    return created;
  }

  it("switches an enabled workflow off with the restore, so the restored version needs its own dry run", async () => {
    const created = await enabledAtVersionTwo();

    const result = await bring(created.workflowId, 1, 2);

    expect(result).toMatchObject({
      version: 3,
      enabled: false,
      lastCleanDryRunVersion: 2,
      disabledBySave: true,
    });
    expect(
      (await kit.currentStore().getWorkflow(scope, created.workflowId))
        ?.enabled,
    ).toBe(false);
    expect(jobMeta(created.job.path)).toMatchObject({
      enabled: false,
      schedule: "*/15 * * * *",
    });
    expect(
      await kit.failureOf(() =>
        runEnable(
          {
            factoryId: kit.FACTORY_ID,
            workflowId: created.workflowId,
            enabled: true,
          },
          kit.context,
        ),
      ),
    ).toMatchObject({ errorCode: "dry_run_required" });
  });

  it("keeps the rows switched off when the job file cannot be switched off", async () => {
    const created = await enabledAtVersionTwo();
    kit.onConditionalWrite((content) => `${content}\n`, 10);

    const failure = await kit.failureOf(() => bring(created.workflowId, 1, 2));

    expect(failure).toMatchObject({
      errorCode: "job_sync_failed",
      details: { savedVersion: 3, disabledBySave: true },
    });
    expect(
      await kit.currentStore().getWorkflow(scope, created.workflowId),
    ).toMatchObject({ version: 3, enabled: false });
  });

  it("fails a stale restore with version_conflict and writes nothing", async () => {
    const created = await twoVersions();

    const failure = await kit.failureOf(() => bring(created.workflowId, 1, 1));

    expect(failure).toMatchObject({
      errorCode: "version_conflict",
      details: { expectedVersion: 1, currentVersion: 2 },
    });
    expect(
      (await kit.currentStore().getWorkflow(scope, created.workflowId))
        ?.version,
    ).toBe(2);
    expect(jobMeta(created.job.path).schedule).toBe("*/30 * * * *");
  });

  it("refuses to restore the version it already is, or one that does not exist", async () => {
    const created = await twoVersions();
    expect(
      await kit.failureOf(() => bring(created.workflowId, 2, 2)),
    ).toMatchObject({ errorCode: "version_already_current" });
    expect(
      await kit.failureOf(() => bring(created.workflowId, 9, 2)),
    ).toMatchObject({
      errorCode: "workflow_version_not_found",
      statusCode: 404,
    });
    expect(await kit.failureOf(() => bring("missing", 1, 1))).toMatchObject({
      errorCode: "workflow_not_found",
    });
  });

  it("refuses an old graph today's catalog no longer accepts, and saves nothing", async () => {
    const created = await twoVersions();
    const store = kit.currentStore();
    // Version 3 names an operation the catalog does not have; version 4 is fine.
    await store.saveWorkflowGraph(scope, {
      workflowId: created.workflowId,
      expectedVersion: 2,
      graph: kit.graphWithUnknownOperation(),
      source: "save",
      summary: "Old catalog",
      createdBy: kit.USER_EMAIL,
    });
    await store.saveWorkflowGraph(scope, {
      workflowId: created.workflowId,
      expectedVersion: 3,
      graph: kit.simpleGraph(),
      source: "save",
      summary: "Fixed",
      createdBy: kit.USER_EMAIL,
    });

    const failure = await kit.failureOf(() => bring(created.workflowId, 3, 4));

    expect(failure.errorCode).toBe("graph_invalid");
    expect(failure.details?.issues).toEqual([
      expect.objectContaining({ code: "unknown_operation" }),
    ]);
    expect((await store.getWorkflow(scope, created.workflowId))?.version).toBe(
      4,
    );
  });
});

describe("restore-factory-workflow-version: declarations", () => {
  const declared = restore as unknown as {
    audit: {
      recordInputs: boolean;
      summary: (args: unknown, result: unknown) => string;
    };
    mcpAnnotations: Record<string, boolean>;
  };

  it("is not destructive and does not record the graph in the audit row", () => {
    expect(declared.mcpAnnotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(declared.audit.recordInputs).toBe(false);
    expect(
      declared.audit.summary(
        { workflowId: "wf-1", version: 1 },
        { version: 3 },
      ),
    ).toBe("Restored workflow wf-1 version 1 as version 3");
  });
});
