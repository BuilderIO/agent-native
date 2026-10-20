import { parseJobResource } from "@agent-native/core/jobs/frontmatter";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readProviderConnectionsMock = vi.hoisted(() => vi.fn());
const recordTripwireMock = vi.hoisted(() => vi.fn());

vi.mock("../server/lib/factory-workflow-connections.js", () => ({
  readProviderConnections: readProviderConnectionsMock,
}));
vi.mock("../server/tripwire/index.js", async (importActual) => ({
  ...(await importActual<typeof import("../server/tripwire/index.js")>()),
  recordTripwire: recordTripwireMock,
}));
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
import { STORY_GRAPHS } from "../server/workflow/story-graphs.fixture.js";
import save from "./save-factory-workflow.js";
import setEnabled from "./set-factory-workflow-enabled.js";

const runSave = kit.runOf(save);
const run = kit.runOf(setEnabled);
const scope = { orgId: kit.ORG_ID, factoryId: kit.FACTORY_ID };

const toggle = (workflowId: string, enabled: boolean) =>
  run({ factoryId: kit.FACTORY_ID, workflowId, enabled }, kit.context);

async function create(graph = kit.simpleGraph()) {
  return runSave(
    { factoryId: kit.FACTORY_ID, name: "Digest", graph },
    kit.context,
  );
}

const jobMeta = (path: string) =>
  parseJobResource(kit.readJob(path) as string).meta;

const stored = (workflowId: string) =>
  kit.currentStore().getWorkflow(scope, workflowId);

beforeEach(() => {
  kit.reset();
  readProviderConnectionsMock.mockReset();
  recordTripwireMock.mockReset();
});

function reportStatus(status: Record<string, string>) {
  readProviderConnectionsMock.mockImplementation(async (providers: string[]) =>
    providers.map((provider) => ({
      provider,
      status: status[provider] ?? "connected",
      connectWith: "workspace-connection",
      ...(status[provider] === "unknown" ? { detail: "vault down" } : {}),
    })),
  );
}

describe("set-factory-workflow-enabled: connections", () => {
  async function createDigest() {
    const created = await create(STORY_GRAPHS["morning-digest"]);
    await kit
      .currentStore()
      .recordCleanDryRun(scope, { workflowId: created.workflowId, version: 1 });
    return created;
  }

  it("refuses with connection_required, listing the providers and their nodes, and changes nothing", async () => {
    reportStatus({ slack: "not connected" });
    const created = await createDigest();
    const jobBefore = kit.readJob(created.job.path);

    const failure = await kit.failureOf(() => toggle(created.workflowId, true));

    expect(failure).toMatchObject({
      errorCode: "connection_required",
      statusCode: 412,
      details: { providers: ["slack"] },
    });
    expect(failure.message).toContain("slack is used by post");
    expect(failure.message).toContain("request-workflow-connection");
    expect((await stored(created.workflowId))?.enabled).toBe(false);
    expect(kit.readJob(created.job.path)).toBe(jobBefore);
  });

  it("an agent's refused turn-on", async () => {
    reportStatus({ slack: "not connected" });
    const created = await createDigest();
    const input = {
      factoryId: kit.FACTORY_ID,
      workflowId: created.workflowId,
      enabled: true,
    };

    const failure = await kit.failureOf(() => run(input, kit.agentContext));

    expect(failure.errorCode).toBe("connection_required");
  });

  it("turns on with a warning when a connection could not be checked", async () => {
    reportStatus({ github: "unknown" });
    const created = await createDigest();

    const result = await toggle(created.workflowId, true);

    expect(result.enabled).toBe(true);
    expect(result.warnings).toEqual([
      expect.stringContaining("github could not be checked (vault down)"),
    ]);
    expect(result.connections).toHaveLength(2);
  });
});

describe("set-factory-workflow-enabled: turning on", () => {
  it("needs a clean dry run, and changes nothing without one", async () => {
    const created = await create();
    const jobBefore = kit.readJob(created.job.path);

    const failure = await kit.failureOf(() => toggle(created.workflowId, true));

    expect(failure).toMatchObject({
      errorCode: "dry_run_required",
      statusCode: 409,
      details: { currentVersion: 1, lastCleanDryRunVersion: null },
    });
    expect((await stored(created.workflowId))?.enabled).toBe(false);
    expect(kit.readJob(created.job.path)).toBe(jobBefore);
  });

  it("needs the dry run to be of the current version", async () => {
    const created = await create();
    await kit
      .currentStore()
      .recordCleanDryRun(scope, { workflowId: created.workflowId, version: 1 });
    await runSave(
      {
        factoryId: kit.FACTORY_ID,
        workflowId: created.workflowId,
        expectedVersion: 1,
        graph: kit.simpleGraph({ schedule: { every: "30m" } }),
      },
      kit.context,
    );

    const failure = await kit.failureOf(() => toggle(created.workflowId, true));

    expect(failure).toMatchObject({
      errorCode: "dry_run_required",
      details: { currentVersion: 2, lastCleanDryRunVersion: 1 },
    });
    expect((await stored(created.workflowId))?.enabled).toBe(false);
  });

  it("enables the workflow and its job together after a clean dry run", async () => {
    const created = await create();
    await kit
      .currentStore()
      .recordCleanDryRun(scope, { workflowId: created.workflowId, version: 1 });

    const result = await toggle(created.workflowId, true);

    expect(result).toMatchObject({
      workflowId: created.workflowId,
      enabled: true,
      version: 1,
    });
    expect((await stored(created.workflowId))?.enabled).toBe(true);
    const meta = jobMeta(created.job.path);
    expect(meta).toMatchObject({ enabled: true, runner: "workflow" });
    expect(Date.parse(meta.nextRun as string)).toBeGreaterThan(Date.now());
  });

  it("is a no-op the second time", async () => {
    const created = await create();
    await kit
      .currentStore()
      .recordCleanDryRun(scope, { workflowId: created.workflowId, version: 1 });
    await toggle(created.workflowId, true);
    const once = kit.readJob(created.job.path);

    await toggle(created.workflowId, true);

    expect(kit.readJob(created.job.path)).toBe(once);
  });

  it("checks the graph against today's catalog before it starts running", async () => {
    // The store keeps any graph that parses; the catalog is code and can move on.
    const store = kit.currentStore();
    const workflow = await store.createWorkflow(scope, {
      name: "Old",
      graph: kit.graphWithUnknownOperation(),
      ownerEmail: kit.USER_EMAIL,
    });
    await store.recordCleanDryRun(scope, {
      workflowId: workflow.id,
      version: 1,
    });

    const failure = await kit.failureOf(() => toggle(workflow.id, true));

    expect(failure).toMatchObject({ errorCode: "graph_invalid" });
    expect((await stored(workflow.id))?.enabled).toBe(false);
  });

  it("switches the store back off when the job file cannot be switched on", async () => {
    const created = await create();
    await kit
      .currentStore()
      .recordCleanDryRun(scope, { workflowId: created.workflowId, version: 1 });
    kit.onConditionalWrite((content) => `${content}\n`, 10);

    const failure = await kit.failureOf(() => toggle(created.workflowId, true));

    expect(failure).toMatchObject({ errorCode: "workflow_job_conflict" });
    expect((await stored(created.workflowId))?.enabled).toBe(false);
    expect(jobMeta(created.job.path).enabled).toBe(false);
  });

  it("fails for a workflow that does not exist", async () => {
    expect(await kit.failureOf(() => toggle("missing", true))).toMatchObject({
      errorCode: "workflow_not_found",
      statusCode: 404,
    });
  });
});

describe("set-factory-workflow-enabled: turning off", () => {
  async function enabledWorkflow(graph = kit.simpleGraph()) {
    const created = await create(graph);
    await kit
      .currentStore()
      .recordCleanDryRun(scope, { workflowId: created.workflowId, version: 1 });
    await toggle(created.workflowId, true);
    return created;
  }

  it("switches the job and the workflow off", async () => {
    const created = await enabledWorkflow();

    const result = await toggle(created.workflowId, false);

    expect(result).toMatchObject({ enabled: false });
    expect((await stored(created.workflowId))?.enabled).toBe(false);
    expect(jobMeta(created.job.path).enabled).toBe(false);
  });

  it("leaves the clean dry run in place so it can be switched back on", async () => {
    const created = await enabledWorkflow();
    await toggle(created.workflowId, false);

    await toggle(created.workflowId, true);

    expect((await stored(created.workflowId))?.enabled).toBe(true);
  });

  it("works when the job file is already gone", async () => {
    const created = await enabledWorkflow();
    kit.removeJob(created.job.path);

    const result = await toggle(created.workflowId, false);

    expect(result).toMatchObject({ enabled: false, job: null });
    expect((await stored(created.workflowId))?.enabled).toBe(false);
  });

  it("works when the graph no longer describes a schedule", async () => {
    const created = await enabledWorkflow();
    // Saved straight to the store: a daily Trigger with no zone anywhere.
    await kit.currentStore().saveWorkflowGraph(scope, {
      workflowId: created.workflowId,
      expectedVersion: 1,
      graph: kit.simpleGraph({ schedule: { daily: { at: "08:00" } } }),
      source: "save",
      summary: "No zone",
      createdBy: kit.USER_EMAIL,
    });

    await toggle(created.workflowId, false);

    expect(jobMeta(created.job.path).enabled).toBe(false);
    expect((await stored(created.workflowId))?.enabled).toBe(false);
  });

  it("turns the job off before the workflow, so a failed job write never reads as off while firing", async () => {
    const created = await enabledWorkflow();
    kit.onConditionalWrite((content) => `${content}\n`, 10);

    const failure = await kit.failureOf(() =>
      toggle(created.workflowId, false),
    );

    expect(failure).toMatchObject({ errorCode: "workflow_job_conflict" });
    expect((await stored(created.workflowId))?.enabled).toBe(true);
    expect(jobMeta(created.job.path).enabled).toBe(true);
  });
});

describe("set-factory-workflow-enabled: declarations", () => {
  const declared = setEnabled as unknown as {
    audit: {
      target: (args: unknown) => unknown;
      summary: (args: unknown) => string;
    };
    mcpAnnotations: Record<string, boolean>;
  };

  it("audits the workflow for the whole organization and says which way it went", () => {
    expect(declared.audit.target({ workflowId: "wf-1" })).toEqual({
      type: "factory-workflow",
      id: "wf-1",
      visibility: "org",
    });
    expect(declared.audit.summary({ workflowId: "wf-1", enabled: true })).toBe(
      "Enabled workflow wf-1",
    );
    expect(declared.audit.summary({ workflowId: "wf-1", enabled: false })).toBe(
      "Disabled workflow wf-1",
    );
  });

  // Turning a workflow on lets it send and merge, which is why that call asks a
  // person; MCP hosts are told the same, and that a repeat lands in the same place.
  it("is advertised as an outward effect that is safe to repeat", () => {
    expect(declared.mcpAnnotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
  });
});
