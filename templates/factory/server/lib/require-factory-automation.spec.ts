import { beforeEach, describe, expect, it, vi } from "vitest";

const findFactoryAutomationDefinitionMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());
const workflowStoreHolder = vi.hoisted(() => ({
  store: undefined as unknown,
}));

vi.mock("./factory-automation-resources.js", () => ({
  findFactoryAutomationDefinition: findFactoryAutomationDefinitionMock,
  factoryIdFromAutomationName: (name: string) => {
    const nested = name.match(/^factories\/([^/]+)\//);
    if (nested?.[1]) return nested[1];
    if (/^factory-[^/]+$/.test(name)) return "product-feedback";
    return null;
  },
}));

vi.mock("../db/index.js", () => ({
  getDb: getDbMock,
}));

vi.mock("../workflow-host/factory-store.js", () => ({
  getWorkflowStore: () => workflowStoreHolder.store,
}));

import { sanitizeDetails } from "../tripwire/redact.js";
import { createCapturingTripwireSink } from "../tripwire/testing.js";
import { STORY_GRAPHS, buildGraph } from "../workflow/story-graphs.fixture.js";
import { createInMemoryWorkflowStore } from "../workflow/testing/in-memory-store.js";
import { requireFactoryAutomation } from "./require-factory-automation.js";
import { createRunObserver, withRunObserver } from "./workflow-run-observer.js";

const teammateEmail = "teammate@example.com";
const factoryId = "enzo-test-factory-3";

function nestedJob(leafName: string, createdBy = teammateEmail) {
  const name = `factories/${factoryId}/${leafName}`;
  return {
    name,
    resource: {
      id: `resource-${leafName}`,
      path: `jobs/${name}.md`,
      content: "---\ndomain: factory\n---\n",
    },
    meta: {
      domain: "factory",
      orgId: "org-1",
      runAs: "creator" as const,
      createdBy,
    },
  };
}

function governedContext(leafName: string) {
  const definition = nestedJob(leafName);
  return {
    caller: "automation" as const,
    automation: {
      triggerId: definition.resource.id,
      triggerName: definition.name,
    },
  };
}

function factoryLookupDb(found: boolean) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(found ? [{ id: factoryId }] : []),
        })),
      })),
    })),
  };
}

describe("requireFactoryAutomation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WORKSPACE_OWNER_EMAIL = "deploy-owner@example.com";
    findFactoryAutomationDefinitionMock.mockResolvedValue(
      nestedJob("factory-slack-feedback"),
    );
    getDbMock.mockReturnValue(factoryLookupDb(true));
  });

  it("accepts a blank Slack job by source frontmatter", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      name: `factories/${factoryId}/factory-slack-custom`,
      body: "",
      resource: {
        id: "resource-factory-slack-custom",
        path: `jobs/factories/${factoryId}/factory-slack-custom.md`,
        content: "---\ndomain: factory\nsource: slack\n---\n",
      },
      meta: {
        domain: "factory",
        orgId: "org-1",
        runAs: "creator" as const,
        createdBy: teammateEmail,
      },
    });
    await expect(
      requireFactoryAutomation(
        {
          caller: "automation",
          automation: {
            triggerId: "resource-factory-slack-custom",
            triggerName: `factories/${factoryId}/factory-slack-custom`,
          },
        },
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        factoryId,
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts a nested Factory Slack job created by a teammate", async () => {
    await expect(
      requireFactoryAutomation(
        governedContext("factory-slack-feedback"),
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        factoryId,
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts nested GitHub issue and governance jobs for githubPolling", async () => {
    for (const leafName of [
      "factory-github-issues",
      "factory-pr-governance",
      "factory-pr-governance-2",
    ] as const) {
      findFactoryAutomationDefinitionMock.mockResolvedValue(
        nestedJob(leafName),
      );
      await expect(
        requireFactoryAutomation(
          governedContext(leafName),
          { userEmail: teammateEmail, orgId: "org-1" },
          "githubPolling",
          factoryId,
        ),
      ).resolves.toBeUndefined();
    }
  });

  it("rejects in-app chat and other tool callers", async () => {
    await expect(
      requireFactoryAutomation(
        {
          caller: "tool",
          automation: governedContext("factory-slack-feedback").automation,
        },
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        factoryId,
      ),
    ).rejects.toThrow("This action is only available to Factory automations.");
  });

  it("rejects a nested name that is not a Factory source automation", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue(
      nestedJob("not-a-factory-job"),
    );
    await expect(
      requireFactoryAutomation(
        {
          caller: "automation",
          automation: {
            triggerId: "resource-not-a-factory-job",
            triggerName: `factories/${factoryId}/not-a-factory-job`,
          },
        },
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        factoryId,
      ),
    ).rejects.toThrow(
      `factories/${factoryId}/not-a-factory-job is not allowed to call this action (sourcePolling).`,
    );
  });

  it("no longer admits the retired PR babysit name by name alone", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue(
      nestedJob("factory-pr-babysit"),
    );

    for (const role of ["sourcePolling", "githubPolling"] as const) {
      await expect(
        requireFactoryAutomation(
          governedContext("factory-pr-babysit"),
          { userEmail: teammateEmail, orgId: "org-1" },
          role,
          factoryId,
        ),
      ).rejects.toThrow(
        `factories/${factoryId}/factory-pr-babysit is not allowed to call this action (${role}).`,
      );
    }
  });

  it("still admits a job with that name when its config says GitHub, like any custom job", async () => {
    const babysit = nestedJob("factory-pr-babysit");
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      ...babysit,
      resource: {
        ...babysit.resource,
        content: "---\ndomain: factory\nrepository: acme/repo\n---\n",
      },
    });

    await expect(
      requireFactoryAutomation(
        governedContext("factory-pr-babysit"),
        { userEmail: teammateEmail, orgId: "org-1" },
        "githubPolling",
        factoryId,
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects Slack feedback from GitHub polling", async () => {
    await expect(
      requireFactoryAutomation(
        governedContext("factory-slack-feedback"),
        { userEmail: teammateEmail, orgId: "org-1" },
        "githubPolling",
        factoryId,
      ),
    ).rejects.toThrow(
      `factories/${factoryId}/factory-slack-feedback is not allowed to call this action (githubPolling).`,
    );
  });

  it("rejects a governed job with no createdBy", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue(
      nestedJob("factory-slack-feedback", ""),
    );

    await expect(
      requireFactoryAutomation(
        governedContext("factory-slack-feedback"),
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        factoryId,
      ),
    ).rejects.toThrow(
      `factories/${factoryId}/factory-slack-feedback is not a governed Factory automation (sourcePolling).`,
    );
  });

  it("rejects a governed job for a different factory", async () => {
    await expect(
      requireFactoryAutomation(
        governedContext("factory-slack-feedback"),
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        "other-factory",
      ),
    ).rejects.toThrow(
      `factories/${factoryId}/factory-slack-feedback is not the governed Factory automation for this factory (sourcePolling).`,
    );
  });

  it("rejects a governed job after the Factory has been deleted", async () => {
    getDbMock.mockReturnValue(factoryLookupDb(false));

    await expect(
      requireFactoryAutomation(
        governedContext("factory-slack-feedback"),
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        factoryId,
      ),
    ).rejects.toThrow("Factory not found.");
  });

  it("accepts a factory-folder job that lost domain and triggerType", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      name: `factories/${factoryId}/factory-slack-feedback`,
      body: "Observe Slack.",
      resource: {
        id: "resource-slim",
        path: `jobs/factories/${factoryId}/factory-slack-feedback.md`,
        content: "---\nenabled: true\ncreatedBy: teammate@example.com\n---\n",
      },
      meta: {
        createdBy: teammateEmail,
      },
    });

    await expect(
      requireFactoryAutomation(
        {
          caller: "automation",
          automation: {
            triggerId: "resource-slim",
            triggerName: `factories/${factoryId}/factory-slack-feedback`,
          },
        },
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        factoryId,
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts a custom-named factory-folder job", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      name: `factories/${factoryId}/my-slack-watch`,
      body: "Observe Slack.",
      resource: {
        id: "resource-custom",
        path: `jobs/factories/${factoryId}/my-slack-watch.md`,
        content:
          "---\nenabled: true\ncreatedBy: teammate@example.com\nsource: slack\n---\n",
      },
      meta: {
        createdBy: teammateEmail,
      },
    });

    await expect(
      requireFactoryAutomation(
        {
          caller: "automation",
          automation: {
            triggerId: "resource-custom",
            triggerName: `factories/${factoryId}/my-slack-watch`,
          },
        },
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        factoryId,
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts the virtual default Factory when no definition row exists", async () => {
    getDbMock.mockReturnValue(factoryLookupDb(false));
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      name: "factory-slack-feedback",
      body: "",
      resource: {
        id: "resource-default",
        path: "jobs/factory-slack-feedback.md",
        content: "---\ndomain: factory\n---\n",
      },
      meta: {
        domain: "factory",
        orgId: "org-1",
        runAs: "creator",
        createdBy: teammateEmail,
      },
    });

    await expect(
      requireFactoryAutomation(
        {
          caller: "automation",
          automation: {
            triggerId: "resource-default",
            triggerName: "factory-slack-feedback",
          },
        },
        { userEmail: teammateEmail, orgId: "org-1" },
        "sourcePolling",
        "product-feedback",
      ),
    ).resolves.toBeUndefined();
  });
});

describe("requireFactoryAutomation for a workflow job", () => {
  const identity = { userEmail: teammateEmail, orgId: "org-1" };
  const automationId = "resource-workflow";

  function workflowJob(
    leafName: string,
    frontmatter = "domain: factory\nrunner: workflow",
  ) {
    const name = `factories/${factoryId}/${leafName}`;
    return {
      name,
      body: "Run the workflow.",
      resource: {
        id: automationId,
        path: `jobs/${name}.md`,
        content: `---\n${frontmatter}\n---\n`,
      },
      meta: {
        domain: "factory",
        orgId: "org-1",
        runAs: "creator" as const,
        createdBy: teammateEmail,
      },
    };
  }

  function workflowContext(leafName: string, actionName?: string) {
    return {
      caller: "automation" as const,
      actionName,
      automation: {
        triggerId: automationId,
        triggerName: `factories/${factoryId}/${leafName}`,
      },
    };
  }

  async function saveGraph(graph: Parameters<typeof buildGraph>[0] | unknown) {
    const store = createInMemoryWorkflowStore();
    workflowStoreHolder.store = store;
    await store.createWorkflow(
      { orgId: "org-1", factoryId },
      {
        name: "Workflow",
        ownerEmail: teammateEmail,
        automationId,
        graph: graph as never,
      },
    );
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    getDbMock.mockReturnValue(factoryLookupDb(true));
    findFactoryAutomationDefinitionMock.mockResolvedValue(
      workflowJob("my-merge-flow"),
    );
    await saveGraph(STORY_GRAPHS["builder-to-merge"]);
  });

  it("allows an action the saved graph names", async () => {
    await expect(
      requireFactoryAutomation(
        workflowContext("my-merge-flow", "merge-factory-pull-request"),
        identity,
        "workflow",
        factoryId,
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses an action no node of the saved graph names", async () => {
    await expect(
      requireFactoryAutomation(
        workflowContext("my-merge-flow", "create-hubspot-task"),
        identity,
        "workflow",
        factoryId,
      ),
    ).rejects.toMatchObject({
      errorCode: "workflow_action_not_allowed",
      statusCode: 403,
    });
  });

  it("refuses a call that carries no action name", async () => {
    await expect(
      requireFactoryAutomation(
        workflowContext("my-merge-flow"),
        identity,
        "workflow",
        factoryId,
      ),
    ).rejects.toMatchObject({ errorCode: "workflow_action_not_allowed" });
  });

  it("throws when the saved graph cannot be read, and does not refuse as if it were empty", async () => {
    workflowStoreHolder.store = {
      getWorkflowByAutomation: async () =>
        ({ id: "wf", graph: { nodes: null } }) as never,
    };

    await expect(
      requireFactoryAutomation(
        workflowContext("my-merge-flow", "merge-factory-pull-request"),
        identity,
        "workflow",
        factoryId,
      ),
    ).rejects.toMatchObject({ errorCode: "workflow_graph_unreadable" });
  });

  it("throws when the job says workflow but nothing is saved for it", async () => {
    workflowStoreHolder.store = createInMemoryWorkflowStore();

    await expect(
      requireFactoryAutomation(
        workflowContext("my-merge-flow", "merge-factory-pull-request"),
        identity,
        "workflow",
        factoryId,
      ),
    ).rejects.toMatchObject({ errorCode: "workflow_not_found" });
  });

  it("does not let a legacy-looking name or source open an action the graph does not name", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue(
      workflowJob(
        "factory-slack-feedback",
        "domain: factory\nrunner: workflow\nsource: slack",
      ),
    );

    for (const [role, actionName] of [
      ["governance", "govern-factory-pull-request"],
      ["sourcePolling", "poll-slack-channel"],
      ["workflow", "merge-factory-pull-request"],
    ] as const) {
      const outcome = requireFactoryAutomation(
        workflowContext("factory-slack-feedback", actionName),
        identity,
        role,
        factoryId,
      );
      if (actionName === "merge-factory-pull-request") {
        await expect(outcome).resolves.toBeUndefined();
      } else {
        await expect(outcome).rejects.toMatchObject({
          errorCode: "workflow_action_not_allowed",
        });
      }
    }
  });

  it("opens a poller only through an inbox source the graph has", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue(
      workflowJob("factory-slack-feedback"),
    );
    await saveGraph(STORY_GRAPHS["bug-report-to-builder"]);

    await expect(
      requireFactoryAutomation(
        workflowContext("factory-slack-feedback", "poll-slack-channel"),
        identity,
        "sourcePolling",
        factoryId,
      ),
    ).resolves.toBeUndefined();
  });

  it("checks the operation for the wrapper action", async () => {
    await saveGraph(
      buildGraph({
        nodes: [
          ["every5", "trigger", { schedule: { every: "5m" } }],
          [
            "file",
            "lookup",
            {
              operation: "github.readFile",
              args: {
                repo: { mode: "fixed", value: "acme/app" },
                path: { mode: "fixed", value: "README.md" },
              },
            },
          ],
          ["done", "end", { outcome: "done" }],
        ],
        edges: [["every5", "out", "done"]],
      }),
    );
    const context = workflowContext("my-merge-flow", "run-workflow-operation");

    await expect(
      requireFactoryAutomation(context, identity, "workflow", factoryId, {
        operationId: "github.readFile",
      }),
    ).resolves.toBeUndefined();
    await expect(
      requireFactoryAutomation(context, identity, "workflow", factoryId, {
        operationId: "github.searchCode",
      }),
    ).rejects.toMatchObject({ errorCode: "workflow_action_not_allowed" });
  });

  it("treats the job as a workflow when either parser sees the runner", async () => {
    const job = workflowJob("my-merge-flow", "domain: factory");
    findFactoryAutomationDefinitionMock.mockResolvedValue({
      ...job,
      meta: { ...job.meta, runner: "workflow" },
    });

    await expect(
      requireFactoryAutomation(
        workflowContext("my-merge-flow", "create-hubspot-task"),
        identity,
        "workflow",
        factoryId,
      ),
    ).rejects.toMatchObject({ errorCode: "workflow_action_not_allowed" });
  });

  it("still applies the identity and factory checks to a workflow job", async () => {
    await expect(
      requireFactoryAutomation(
        workflowContext("my-merge-flow", "merge-factory-pull-request"),
        identity,
        "workflow",
        "other-factory",
      ),
    ).rejects.toThrow(
      "is not the governed Factory automation for this factory",
    );
  });

  it("leaves a legacy job as it was, and keeps the workflow-only role away from it", async () => {
    findFactoryAutomationDefinitionMock.mockResolvedValue(
      nestedJob("factory-slack-feedback"),
    );

    await expect(
      requireFactoryAutomation(
        governedContext("factory-slack-feedback"),
        identity,
        "sourcePolling",
        factoryId,
      ),
    ).resolves.toBeUndefined();
    await expect(
      requireFactoryAutomation(
        {
          ...governedContext("factory-slack-feedback"),
          actionName: "post-slack-message",
        },
        identity,
        "workflow",
        factoryId,
      ),
    ).rejects.toThrow(
      `factories/${factoryId}/factory-slack-feedback is not allowed to call this action (workflow).`,
    );
  });
});

describe("operation_gate_denied tripwire", () => {
  const SECRET = "xoxb-FAKE-0000-aaaaaaaaaaaa";
  const identity = { userEmail: teammateEmail, orgId: "org-1" };
  // The check reports to the run's sink when a run is open. Without a run the
  // default sink writes through the database, so the baseline run drops its events.
  const dropped = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    getDbMock.mockReturnValue(factoryLookupDb(true));
  });

  async function rejectionOf(run: () => Promise<unknown>): Promise<Error> {
    try {
      await run();
    } catch (error) {
      if (error instanceof Error) return error;
      throw error;
    }
    throw new Error("Expected the call to reject.");
  }

  it("records a governed job whose definition does not match, and throws as it does without a sink", async () => {
    const leaf = `factory-slack-feedback ${SECRET}`;
    findFactoryAutomationDefinitionMock.mockResolvedValue(nestedJob(leaf, ""));
    const { sink, events } = createCapturingTripwireSink();

    const thrown = await rejectionOf(() =>
      withRunObserver(createRunObserver(sink), () =>
        requireFactoryAutomation(
          governedContext(leaf),
          identity,
          "sourcePolling",
          factoryId,
        ),
      ),
    );

    const stored = sanitizeDetails(events[0].details);
    expect(
      JSON.stringify({ ...events[0], details: stored.fields }),
    ).not.toContain(SECRET);

    // The job's name reaches the caller's error, and never the event.
    expect(thrown.message).toContain(SECRET);
    const unobserved = await rejectionOf(() =>
      withRunObserver(createRunObserver(dropped), () =>
        requireFactoryAutomation(
          governedContext(leaf),
          identity,
          "sourcePolling",
          factoryId,
        ),
      ),
    );
    expect(thrown.message).toBe(unobserved.message);
  });

  it("records a governed job called for another factory, and throws as it does without a sink", async () => {
    const leaf = `factory-slack-feedback ${SECRET}`;
    findFactoryAutomationDefinitionMock.mockResolvedValue(nestedJob(leaf));
    const { sink, events } = createCapturingTripwireSink();

    const thrown = await rejectionOf(() =>
      withRunObserver(createRunObserver(sink), () =>
        requireFactoryAutomation(
          governedContext(leaf),
          identity,
          "sourcePolling",
          "other-factory",
        ),
      ),
    );

    expect(
      JSON.stringify({
        ...events[0],
        details: sanitizeDetails(events[0].details).fields,
      }),
    ).not.toContain(SECRET);

    expect(thrown.message).toContain(SECRET);
    expect(thrown.message).toContain(
      "is not the governed Factory automation for this factory",
    );
    const unobserved = await rejectionOf(() =>
      withRunObserver(createRunObserver(dropped), () =>
        requireFactoryAutomation(
          governedContext(leaf),
          identity,
          "sourcePolling",
          "other-factory",
        ),
      ),
    );
    expect(thrown.message).toBe(unobserved.message);
  });
});
