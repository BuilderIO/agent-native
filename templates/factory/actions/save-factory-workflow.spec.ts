import { parseJobResource } from "@agent-native/core/jobs/frontmatter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const writeAppStateMock = vi.hoisted(() => vi.fn());
const readProviderConnectionsMock = vi.hoisted(() => vi.fn());
const recordTripwireMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/application-state", () => ({
  writeAppStateForCurrentTab: writeAppStateMock,
}));
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

import { factoryWorkflowUrl } from "../app/lib/factory-tab-params.js";
import * as kit from "../server/workflow-host/testing/workflow-actions-kit.js";
import { WorkflowStoreError } from "../server/workflow/adapter.js";
import { STORY_GRAPHS } from "../server/workflow/story-graphs.fixture.js";
import save from "./save-factory-workflow.js";
import setEnabled from "./set-factory-workflow-enabled.js";

const run = kit.runOf(save);
const enable = kit.runOf(setEnabled);
const scope = { orgId: kit.ORG_ID, factoryId: kit.FACTORY_ID };

const create = (overrides: Record<string, unknown> = {}, ctx = kit.context) =>
  run(
    {
      factoryId: kit.FACTORY_ID,
      name: "Morning digest",
      graph: kit.simpleGraph(),
      ...overrides,
    },
    ctx,
  );

function jobMeta(path: string) {
  return parseJobResource(kit.readJob(path) as string).meta;
}

beforeEach(() => {
  kit.reset();
  writeAppStateMock.mockReset();
  readProviderConnectionsMock.mockReset();
  recordTripwireMock.mockReset();
});

describe("save-factory-workflow: creating", () => {
  it("saves a new workflow disabled, as version 1, with its job file", async () => {
    const result = await create();

    expect(result).toMatchObject({
      version: 1,
      created: true,
      enabled: false,
      lastCleanDryRunVersion: null,
      disabledBySave: false,
    });
    const stored = await kit
      .currentStore()
      .getWorkflow(scope, result.workflowId);
    expect(stored).toMatchObject({
      name: "Morning digest",
      version: 1,
      enabled: false,
      ownerEmail: kit.USER_EMAIL,
      automationId: result.job.automationId,
    });
    const meta = jobMeta(result.job.path);
    expect(meta).toMatchObject({
      runner: "workflow",
      enabled: false,
      schedule: "*/15 * * * *",
      createdBy: kit.USER_EMAIL,
    });
    expect(kit.jobFiles()).toHaveLength(1);
  });

  it("records who made the first version: a person, or the agent", async () => {
    const byPerson = await create({ name: "By hand" });
    const byAgent = await create({ name: "By agent" }, kit.agentContext);

    const store = kit.currentStore();
    const [person] = (
      await store.listWorkflowVersions(scope, byPerson.workflowId)
    ).items;
    const [agent] = (
      await store.listWorkflowVersions(scope, byAgent.workflowId)
    ).items;
    expect(person).toMatchObject({ source: "save", summary: "Created" });
    expect(agent).toMatchObject({ source: "agent", createdBy: kit.USER_EMAIL });
  });

  it("writes the schedule the graph asks for, in its zone", async () => {
    const result = await create({
      graph: kit.simpleGraph({
        schedule: { weekdays: { at: "08:00" } },
        timezone: "America/New_York",
      }),
    });
    expect(jobMeta(result.job.path)).toMatchObject({
      schedule: "0 8 * * 1-5",
      timezone: "America/New_York",
    });
  });

  it("needs a name, and refuses an expectedVersion it cannot use", async () => {
    expect(
      await kit.failureOf(() => create({ name: undefined })),
    ).toMatchObject({ errorCode: "invalid_request" });
    expect(
      await kit.failureOf(() => create({ expectedVersion: 1 })),
    ).toMatchObject({ errorCode: "invalid_request" });
    expect(kit.jobFiles()).toEqual([]);
  });

  it("takes the job file back out when the workflow row cannot be created", async () => {
    vi.spyOn(kit.currentStore(), "createWorkflow").mockRejectedValue(
      new WorkflowStoreError("already_exists", "That workflow exists."),
    );

    const failure = await kit.failureOf(() => create());

    expect(failure).toMatchObject({
      errorCode: "workflow_exists",
      statusCode: 409,
    });
    expect(kit.jobFiles()).toEqual([]);
  });

  it("refuses an unknown factory", async () => {
    expect(
      await kit.failureOf(() => create({ factoryId: "no-such-factory" })),
    ).toMatchObject({ errorCode: "factory_not_found", statusCode: 404 });
  });
});

describe("save-factory-workflow: what the agent is told", () => {
  it("opens the canvas of a workflow the chat agent created, and only then", async () => {
    const byAgent = await create({ name: "By agent" }, kit.agentContext);

    expect(byAgent).toMatchObject({ created: true, navigated: true });
    // The app opens exactly the route its own links build.
    expect(byAgent.canvasPath).toBe(
      factoryWorkflowUrl(kit.FACTORY_ID, { workflowId: byAgent.workflowId }),
    );
    expect(writeAppStateMock).toHaveBeenCalledTimes(1);
    expect(writeAppStateMock).toHaveBeenCalledWith("navigate", {
      view: "factory",
      path: byAgent.canvasPath,
      _writeId: expect.any(String),
    });

    const byPerson = await create({ name: "By hand" });
    await run(
      {
        factoryId: kit.FACTORY_ID,
        workflowId: byAgent.workflowId,
        expectedVersion: 1,
        graph: kit.simpleGraph({ schedule: { every: "30m" } }),
      },
      kit.agentContext,
    );
    expect(byPerson.navigated).toBe(false);
    expect(writeAppStateMock).toHaveBeenCalledTimes(1);

    // The save already landed, so a failed write is reported, not thrown.
    writeAppStateMock.mockRejectedValue(new Error("no app state"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unreachable = await create({ name: "Again" }, kit.agentContext);
    expect(unreachable).toMatchObject({ created: true, navigated: false });
    expect(unreachable.canvasPath).toContain(unreachable.workflowId);
  });

  it("lists each provider the graph needs with its status and the nodes that need it", async () => {
    readProviderConnectionsMock.mockImplementation(
      async (providers: string[]) =>
        providers.map((provider) => ({
          provider,
          status: provider === "slack" ? "not connected" : "connected",
          connectWith: "workspace-connection",
        })),
    );

    const result = await create({ graph: STORY_GRAPHS["morning-digest"] });

    expect(result.connections).toEqual([
      {
        provider: "github",
        status: "connected",
        connectWith: "workspace-connection",
        nodes: ["commits"],
      },
      {
        provider: "slack",
        status: "not connected",
        connectWith: "workspace-connection",
        nodes: ["post"],
      },
    ]);

    // A check that cannot run reports unknown, and the save still lands.
    readProviderConnectionsMock.mockRejectedValue(new Error("vault down"));
    const unchecked = await create({
      name: "Unchecked",
      graph: STORY_GRAPHS["morning-digest"],
    });
    expect(unchecked.version).toBe(1);
    expect(unchecked.connections).toEqual([
      expect.objectContaining({
        provider: "github",
        status: "unknown",
        detail: "vault down",
      }),
      expect.objectContaining({
        provider: "slack",
        status: "unknown",
        detail: "vault down",
      }),
    ]);
  });
});

describe("save-factory-workflow: refusing a graph", () => {
  it("puts the issues in the message, as `code @ where: detail`, up to fifteen, and keeps them all in details", async () => {
    const nodes = Array.from({ length: 20 }, (_, index) => ({
      id: `n${index}`,
      name: `n${index}`,
      kind: "action",
      position: { x: index * 220, y: 0 },
      settings: { operation: "nope.missing", args: {} },
    }));
    const graph = {
      ...kit.simpleGraph(),
      nodes: [...kit.simpleGraph().nodes, ...nodes],
    };

    const failure = await kit.failureOf(() => create({ graph }));

    expect(failure.errorCode).toBe("graph_invalid");
    const lines = failure.message.split("\n");
    expect(lines[0]).toMatch(/has \d+ problems, so nothing was saved/);
    const listed = lines.slice(1, -1);
    expect(listed).toHaveLength(15);
    for (const line of listed) expect(line).toMatch(/^- [a-z_]+ @ node n\d+/);
    expect(lines.at(-1)).toMatch(/^- \d+ more$/);
    expect((failure.details?.issues as unknown[]).length).toBe(
      failure.details?.issueCount,
    );
  });

  it("fails with graph_invalid for an operation the catalog does not have, and saves nothing", async () => {
    const failure = await kit.failureOf(() =>
      create({ graph: kit.graphWithUnknownOperation() }),
    );

    expect(failure).toMatchObject({
      errorCode: "graph_invalid",
      statusCode: 422,
    });
    expect(failure.details?.issues).toEqual([
      expect.objectContaining({
        source: "graph",
        code: "unknown_operation",
        nodeId: "notify",
      }),
    ]);
    expect(failure.message).toContain("- unknown_operation @ node notify");
    expect((await kit.currentStore().listWorkflows(scope)).items).toEqual([]);
    expect(kit.jobFiles()).toEqual([]);
  });

  it("reports every problem at once: structure, the job's schedule, and the catalog", async () => {
    const graph = kit.graphWithUnknownOperation();
    graph.nodes[0] = {
      ...graph.nodes[0],
      settings: { schedule: { daily: { at: "08:00" } } },
    } as (typeof graph.nodes)[number];
    graph.edges = graph.edges.filter((edge) => edge.id !== "e2");

    const failure = await kit.failureOf(() => create({ graph }));

    const codes = (failure.details?.issues as { code: string }[]).map(
      (issue) => issue.code,
    );
    expect(codes).toEqual(
      expect.arrayContaining([
        "unknown_operation",
        "port_leads_nowhere",
        "schedule_timezone_required",
      ]),
    );
    expect(failure.details?.issueCount).toBe(codes.length);
    expect(failure.details?.truncated).toBe(false);
  });

  it("reports a graph that does not parse as schema problems", async () => {
    const failure = await kit.failureOf(() =>
      create({
        graph: {
          nodes: [
            {
              id: "start",
              name: "start",
              kind: "teleport",
              position: { x: 0, y: 0 },
              settings: {},
            },
          ],
          edges: [],
          settings: {},
        },
      }),
    );
    expect(failure.errorCode).toBe("graph_invalid");
    expect(failure.details?.issues).toEqual([
      expect.objectContaining({ source: "schema", path: "nodes.0.kind" }),
    ]);
  });

  it("refuses an uneven check cadence rather than rounding it", async () => {
    const graph = kit.simpleGraph(undefined, { checkCadenceMinutes: 45 });
    graph.nodes.splice(1, 0, {
      id: "pause",
      name: "pause",
      kind: "wait",
      position: { x: 0, y: 0 },
      settings: {
        wait: "time",
        duration: { amount: 1, unit: "hours" },
      },
    } as (typeof graph.nodes)[number]);
    graph.edges = [
      { id: "e1", from: { node: "start", port: "out" }, to: { node: "pause" } },
      {
        id: "e2",
        from: { node: "pause", port: "done" },
        to: { node: "finish" },
      },
    ];

    const failure = await kit.failureOf(() => create({ graph }));

    expect(failure.details?.issues).toEqual([
      expect.objectContaining({
        source: "job",
        code: "schedule_cadence_unsupported",
      }),
    ]);
  });
});

describe("save-factory-workflow: updating", () => {
  it("saves a new version and writes the schedule through to the job file", async () => {
    const created = await create();

    const result = await run(
      {
        factoryId: kit.FACTORY_ID,
        workflowId: created.workflowId,
        expectedVersion: 1,
        summary: "Weekday mornings",
        graph: kit.simpleGraph({
          schedule: { weekdays: { at: "08:00" } },
          timezone: "America/New_York",
        }),
      },
      kit.agentContext,
    );

    expect(result).toMatchObject({
      version: 2,
      created: false,
      enabled: false,
    });
    const meta = jobMeta(created.job.path);
    expect(meta).toMatchObject({
      runner: "workflow",
      schedule: "0 8 * * 1-5",
      timezone: "America/New_York",
      enabled: false,
    });
    const { items } = await kit
      .currentStore()
      .listWorkflowVersions(scope, created.workflowId);
    expect(
      items.map((item) => [item.version, item.source, item.summary]),
    ).toEqual([
      [2, "agent", "Weekday mornings"],
      [1, "save", "Created"],
    ]);
  });

  it("puts `runner: workflow` back if the job file lost it", async () => {
    const created = await create();
    kit.seedJob(
      created.job.path,
      (kit.readJob(created.job.path) as string).replace(/^runner:.*\n/m, ""),
    );
    expect(jobMeta(created.job.path).runner).toBeUndefined();

    await run(
      {
        factoryId: kit.FACTORY_ID,
        workflowId: created.workflowId,
        expectedVersion: 1,
        graph: kit.simpleGraph({ schedule: { every: "30m" } }),
      },
      kit.context,
    );

    expect(jobMeta(created.job.path)).toMatchObject({
      runner: "workflow",
      schedule: "*/30 * * * *",
    });
  });

  it("fails a stale save with version_conflict and the current version, and writes nothing", async () => {
    const created = await create();
    await run(
      {
        factoryId: kit.FACTORY_ID,
        workflowId: created.workflowId,
        expectedVersion: 1,
        graph: kit.simpleGraph({ schedule: { every: "30m" } }),
      },
      kit.context,
    );
    const jobBefore = kit.readJob(created.job.path);

    const failure = await kit.failureOf(() =>
      run(
        {
          factoryId: kit.FACTORY_ID,
          workflowId: created.workflowId,
          expectedVersion: 1,
          graph: kit.simpleGraph({ schedule: { every: "5m" } }),
        },
        kit.context,
      ),
    );

    expect(failure).toMatchObject({
      errorCode: "version_conflict",
      statusCode: 409,
      details: { expectedVersion: 1, currentVersion: 2 },
    });
    expect(
      (await kit.currentStore().getWorkflow(scope, created.workflowId))
        ?.version,
    ).toBe(2);
    expect(kit.readJob(created.job.path)).toBe(jobBefore);
  });

  it("needs the expectedVersion, and will not rename", async () => {
    const created = await create();
    const base = {
      factoryId: kit.FACTORY_ID,
      workflowId: created.workflowId,
      graph: kit.simpleGraph(),
    };
    expect(await kit.failureOf(() => run(base, kit.context))).toMatchObject({
      errorCode: "invalid_request",
    });
    expect(
      await kit.failureOf(() =>
        run({ ...base, expectedVersion: 1, name: "Other name" }, kit.context),
      ),
    ).toMatchObject({ errorCode: "invalid_request" });
  });

  it("fails for a workflow that does not exist", async () => {
    expect(
      await kit.failureOf(() =>
        run(
          {
            factoryId: kit.FACTORY_ID,
            workflowId: "missing",
            expectedVersion: 1,
            graph: kit.simpleGraph(),
          },
          kit.context,
        ),
      ),
    ).toMatchObject({ errorCode: "workflow_not_found", statusCode: 404 });
  });

  async function enabledWorkflow() {
    const created = await create();
    await kit.currentStore().recordCleanDryRun(scope, {
      workflowId: created.workflowId,
      version: 1,
    });
    await enable(
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

  const saveVersion = (workflowId: string, expectedVersion: number) =>
    run(
      {
        factoryId: kit.FACTORY_ID,
        workflowId,
        expectedVersion,
        graph: kit.simpleGraph({ schedule: { every: "30m" } }),
      },
      kit.context,
    );

  it("switches an enabled workflow off with the save, so the new version needs its own dry run", async () => {
    const created = await enabledWorkflow();

    const result = await saveVersion(created.workflowId, 1);

    expect(result).toMatchObject({
      version: 2,
      enabled: false,
      lastCleanDryRunVersion: 1,
      disabledBySave: true,
    });
    expect(
      (await kit.currentStore().getWorkflow(scope, created.workflowId))
        ?.enabled,
    ).toBe(false);
    expect(jobMeta(created.job.path)).toMatchObject({
      enabled: false,
      schedule: "*/30 * * * *",
    });
    expect(
      await kit.failureOf(() =>
        enable(
          {
            factoryId: kit.FACTORY_ID,
            workflowId: created.workflowId,
            enabled: true,
          },
          kit.context,
        ),
      ),
    ).toMatchObject({
      errorCode: "dry_run_required",
      details: { currentVersion: 2, lastCleanDryRunVersion: 1 },
    });
  });

  it("leaves a disabled workflow disabled and says it did not switch anything off", async () => {
    const created = await create();

    const result = await saveVersion(created.workflowId, 1);

    expect(result).toMatchObject({ enabled: false, disabledBySave: false });
    expect(jobMeta(created.job.path).enabled).toBe(false);
  });

  it("keeps the rows switched off when the job file cannot be switched off", async () => {
    const created = await enabledWorkflow();
    kit.onConditionalWrite((content) => `${content}\n`, 10);

    const failure = await kit.failureOf(() =>
      saveVersion(created.workflowId, 1),
    );

    expect(failure).toMatchObject({
      errorCode: "job_sync_failed",
      details: {
        workflowId: created.workflowId,
        savedVersion: 2,
        jobError: "job_conflict",
        disabledBySave: true,
      },
    });
    const stored = await kit
      .currentStore()
      .getWorkflow(scope, created.workflowId);
    expect(stored).toMatchObject({ version: 2, enabled: false });
    expect(jobMeta(created.job.path).schedule).toBe("*/15 * * * *");
  });

  it("says exactly what is stale when the job file cannot follow a saved version", async () => {
    const created = await create();
    kit.onConditionalWrite((content) => `${content}\n`, 10);

    const failure = await kit.failureOf(() =>
      run(
        {
          factoryId: kit.FACTORY_ID,
          workflowId: created.workflowId,
          expectedVersion: 1,
          graph: kit.simpleGraph({ schedule: { every: "30m" } }),
        },
        kit.context,
      ),
    );

    expect(failure).toMatchObject({
      errorCode: "job_sync_failed",
      details: {
        workflowId: created.workflowId,
        savedVersion: 2,
        jobError: "job_conflict",
      },
    });
    expect(
      (await kit.currentStore().getWorkflow(scope, created.workflowId))
        ?.version,
    ).toBe(2);
    expect(jobMeta(created.job.path).schedule).toBe("*/15 * * * *");
  });

  it("does not hide a missing job file behind a successful save", async () => {
    const created = await create();
    kit.removeJob(created.job.path);

    const failure = await kit.failureOf(() =>
      run(
        {
          factoryId: kit.FACTORY_ID,
          workflowId: created.workflowId,
          expectedVersion: 1,
          graph: kit.simpleGraph({ schedule: { every: "30m" } }),
        },
        kit.context,
      ),
    );

    expect(failure).toMatchObject({
      errorCode: "job_sync_failed",
      details: { jobError: "job_missing", savedVersion: 2 },
    });
  });
});

describe("save-factory-workflow: declarations", () => {
  const declared = save as unknown as {
    audit: {
      recordInputs: boolean;
      target: (args: unknown, result: unknown) => unknown;
      summary: (args: unknown, result: unknown) => string;
    };
    mcpAnnotations: Record<string, boolean>;
  };

  it("audits a workflow, visible to the organization, without recording the graph", () => {
    expect(declared.audit.recordInputs).toBe(false);
    expect(
      declared.audit.target(
        {},
        { workflowId: "wf-1", version: 1, created: true },
      ),
    ).toEqual({ type: "factory-workflow", id: "wf-1", visibility: "org" });
    expect(declared.audit.target({ workflowId: "wf-2" }, undefined)).toEqual({
      type: "factory-workflow",
      id: "wf-2",
      visibility: "org",
    });
    expect(
      declared.audit.summary(
        { name: "Digest" },
        { workflowId: "wf-1", version: 1, created: true },
      ),
    ).toBe('Created workflow wf-1 "Digest" as version 1');
  });

  it("is not destructive: a save adds a version and keeps the old ones", () => {
    expect(declared.mcpAnnotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
  });
});

describe("save-factory-workflow: the graph as the agent sends it", () => {
  const declared = save as unknown as {
    schema: z.ZodType;
    agentInputSchema: z.ZodType;
  };
  const request = (graph: unknown) => ({
    factoryId: kit.FACTORY_ID,
    name: "Morning digest",
    graph,
  });

  it("takes JSON text from the agent and the object from the app, and names a parse failure", async () => {
    const advertised = z.toJSONSchema(declared.agentInputSchema, {
      io: "input",
    }) as { properties: Record<string, { type?: string }> };
    expect(advertised.properties.graph.type).toBe("string");

    const fromText = declared.schema.parse(
      request(JSON.stringify(kit.simpleGraph())),
    ) as ReturnType<typeof request>;
    const fromObject = declared.schema.parse(
      request(kit.simpleGraph()),
    ) as ReturnType<typeof request>;
    expect(fromText.graph).toEqual(fromObject.graph);

    const saved = await run(fromText, kit.agentContext);
    const stored = await kit
      .currentStore()
      .getWorkflow(scope, saved.workflowId);
    expect(stored?.graph.nodes.map((node) => node.kind)).toEqual([
      "trigger",
      "end",
    ]);

    const broken = declared.schema.safeParse(request('{"nodes": ['));
    expect(broken.success).toBe(false);
    expect(broken.error?.issues).toEqual([
      expect.objectContaining({
        path: ["graph"],
        message: expect.stringContaining("is not valid JSON text"),
      }),
    ]);
    const wrongShape = declared.schema.safeParse(request("[1, 2]"));
    expect(wrongShape.error?.issues).toEqual([
      expect.objectContaining({ path: ["graph"] }),
    ]);
  });
});

describe("save-factory-workflow: which failures are safe to repeat", () => {
  const { retrySafe } = save as unknown as {
    retrySafe: (input: Record<string, unknown>) => boolean;
  };
  const valid = {
    factoryId: kit.FACTORY_ID,
    name: "Morning digest",
    graph: kit.simpleGraph(),
  };

  it("lets a refusal before any write be repeated, and keeps a failed create after its write began unknown", async () => {
    const emptyNodes = {
      ...valid,
      graph: { nodes: [{}], edges: [], settings: {} },
    };
    expect(
      (await kit.failureOf(() => run(emptyNodes, kit.agentContext))).errorCode,
    ).toBe("graph_invalid");
    expect(kit.jobFiles()).toEqual([]);
    expect(retrySafe(emptyNodes)).toBe(true);

    const nameless = { ...valid, name: undefined };
    expect(
      (await kit.failureOf(() => run(nameless, kit.agentContext))).errorCode,
    ).toBe("invalid_request");
    expect(retrySafe(nameless)).toBe(true);

    // An update names the version it read: a repeat is a version conflict.
    expect(
      retrySafe({ ...valid, workflowId: "wf-1", expectedVersion: 1 }),
    ).toBe(true);

    // The job file was written before the workflow row failed, so repeating
    // this create could save the workflow twice.
    vi.spyOn(kit.currentStore(), "createWorkflow").mockRejectedValue(
      new WorkflowStoreError("already_exists", "That workflow exists."),
    );
    expect(
      (await kit.failureOf(() => run(valid, kit.agentContext))).errorCode,
    ).toBe("workflow_exists");
    expect(retrySafe(valid)).toBe(false);
  });
});

describe("save-factory-workflow: what the tripwires record", () => {
  const emptyNodes = {
    factoryId: kit.FACTORY_ID,
    name: "Morning digest",
    graph: { nodes: [{}, {}], edges: [], settings: {} },
  };

  it("still throws the same error", async () => {
    const failure = await kit.failureOf(() =>
      run(emptyNodes, kit.agentContext),
    );

    expect(failure).toMatchObject({
      errorCode: "graph_invalid",
      statusCode: 422,
    });
  });
});
