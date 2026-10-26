import {
  parseJobResource,
  recoveredFactoryOwnerOrgId,
} from "@agent-native/core/jobs/frontmatter";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/resources", async () => {
  const kit = await import("../workflow-host/testing/workflow-actions-kit.js");
  return kit.resourcesModule;
});
vi.mock("@agent-native/core/jobs", async (importActual) => {
  const kit = await import("../workflow-host/testing/workflow-actions-kit.js");
  return kit.jobsModule(await importActual<Record<string, unknown>>());
});

import * as kit from "../workflow-host/testing/workflow-actions-kit.js";
import { buildGraph, STORY_GRAPHS } from "../workflow/story-graphs.fixture.js";
import {
  findFactoryAutomationDefinition,
  listFactoryAutomationDefinitions,
} from "./factory-automation-resources.js";
import { readAutomationFactoryId } from "./factory-scope.js";
import {
  WorkflowJobError,
  createWorkflowJob,
  disableWorkflowJob,
  planWorkflowJob,
  removeWorkflowJob,
  summarizeWorkflowJob,
  syncWorkflowJob,
  type WorkflowJobPlan,
} from "./factory-workflow-job.js";

const NEW_YORK = "America/New_York";

function graphWith(
  sources: Record<string, unknown>[] = [],
  options: {
    schedule?: Record<string, unknown>;
    timezone?: string;
    wait?: boolean;
    settings?: Record<string, unknown>;
  } = {},
) {
  const { schedule = { every: "15m" }, timezone, wait = false } = options;
  const names = sources.map((_, index) => `poll${index + 1}`);
  const hasWait = wait;
  return buildGraph({
    settings: options.settings,
    nodes: [
      ["start", "trigger", { schedule, ...(timezone ? { timezone } : {}) }],
      ...sources.map(
        (settings, index) =>
          [names[index] as string, "source", settings] as [
            string,
            "source",
            Record<string, unknown>,
          ],
      ),
      ...(hasWait
        ? ([
            [
              "pause",
              "wait",
              { wait: "time", duration: { amount: 1, unit: "hours" } },
            ],
          ] as [string, "wait", Record<string, unknown>][])
        : []),
      ["finish", "end", { outcome: "done" }],
    ],
    edges: [
      // One chain: the trigger feeds the first source and each node the next.
      ...["start", ...names, ...(hasWait ? ["pause"] : []), "finish"].flatMap(
        (from, index, all) =>
          index === all.length - 1
            ? []
            : [
                [
                  from,
                  from === "pause" ? "done" : "out",
                  all[index + 1] as string,
                ] as [string, string, string],
              ],
      ),
    ],
  });
}

const slackPoll = (extra: Record<string, unknown> = {}) => ({
  source: "inbox-poll",
  poller: "slack",
  takeLimit: 5,
  ...extra,
});

function planOf(graph: ReturnType<typeof graphWith>): WorkflowJobPlan {
  const { plan, issues } = planWorkflowJob(graph);
  expect(issues).toEqual([]);
  if (!plan) throw new Error("expected a plan");
  return plan;
}

beforeEach(() => {
  kit.reset();
});

describe("planWorkflowJob", () => {
  it.each(Object.entries(STORY_GRAPHS))(
    "plans the %s story with no issues",
    (_key, graph) => {
      const { plan, issues } = planWorkflowJob(graph);
      expect(issues).toEqual([]);
      expect(plan?.schedule.cron).toMatch(/^\S+ \S+ \S+ \S+ \S+$/);
    },
  );

  it("takes the schedule from the graph", () => {
    const plan = planOf(
      graphWith([], {
        schedule: { weekdays: { at: "08:00" } },
        timezone: NEW_YORK,
      }),
    );
    expect(plan.schedule).toEqual({
      cron: "0 8 * * 1-5",
      timezone: NEW_YORK,
      hasWait: false,
      triggerKind: "weekdays",
    });
    expect(plan.config).toMatchObject({ slackChannelId: undefined });
  });

  it("maps a Slack inbox poll to the keys the pollers read", () => {
    const plan = planOf(
      graphWith([
        slackPoll({
          takeLimit: 4,
          filter: { scopes: ["C0FEEDBACK"], authors: ["u0abc123"] },
        }),
      ]),
    );
    expect(plan.config).toEqual({
      slackChannelId: "C0FEEDBACK",
      repository: undefined,
      sentryOrgSlug: undefined,
      sentryProjectSlug: undefined,
      authorMode: "include",
      authorIds: "U0ABC123",
      workLimit: "4",
    });
  });

  it("maps GitHub and Sentry polls, normalizing the repository", () => {
    const plan = planOf(
      graphWith([
        {
          source: "inbox-poll",
          poller: "github",
          takeLimit: 3,
          filter: {
            scopes: ["https://github.com/Example-Org/example-repo"],
            excludeAuthors: ["12345"],
          },
        },
        {
          source: "inbox-poll",
          poller: "sentry",
          takeLimit: 7,
          filter: { scopes: ["acme/web"] },
        },
      ]),
    );
    expect(plan.config).toMatchObject({
      repository: "Example-Org/example-repo",
      sentryOrgSlug: "acme",
      sentryProjectSlug: "web",
      authorMode: "exclude",
      authorIds: "12345",
      workLimit: "7",
    });
  });

  it.each([
    [
      "more than one scope",
      slackPoll({ filter: { scopes: ["C1", "C2"] } }),
      "source_scope_unsupported",
    ],
    [
      "a Slack channel given as a name instead of an ID",
      slackPoll({ filter: { scopes: ["#eng"] } }),
      "source_scope_unsupported",
    ],
    [
      "authors and excluded authors together",
      slackPoll({ filter: { authors: ["U1AAA"], excludeAuthors: ["U2BBB"] } }),
      "source_filter_invalid",
    ],
    [
      "a Slack author given as a name",
      slackPoll({ filter: { authors: ["bob"] } }),
      "source_filter_invalid",
    ],
    [
      "a repository that is not owner/name",
      {
        source: "inbox-poll",
        poller: "github",
        takeLimit: 3,
        filter: { scopes: ["not a repository"] },
      },
      "source_scope_unsupported",
    ],
    [
      "a Sentry project without its organization",
      {
        source: "inbox-poll",
        poller: "sentry",
        takeLimit: 3,
        filter: { scopes: ["web"] },
      },
      "source_scope_unsupported",
    ],
    [
      "an author filter on Sentry",
      {
        source: "inbox-poll",
        poller: "sentry",
        takeLimit: 3,
        filter: { scopes: ["acme/web"], authors: ["someone"] },
      },
      "source_filter_invalid",
    ],
  ])("refuses %s", (_label, source, code) => {
    const { plan, issues } = planWorkflowJob(graphWith([source]));
    expect(plan).toBeNull();
    expect(issues).toEqual([
      expect.objectContaining({ code, nodeId: "poll1" }),
    ]);
  });

  it("refuses two polls of the same kind and two different author filters", () => {
    expect(
      planWorkflowJob(graphWith([slackPoll(), slackPoll()])).issues,
    ).toEqual([
      expect.objectContaining({
        code: "source_poller_duplicate",
        nodeId: "poll2",
      }),
    ]);
    expect(
      planWorkflowJob(
        graphWith([
          slackPoll({ filter: { authors: ["U1AAA"] } }),
          {
            source: "inbox-poll",
            poller: "github",
            takeLimit: 2,
            filter: { excludeAuthors: ["12345"] },
          },
        ]),
      ).issues,
    ).toEqual([
      expect.objectContaining({
        code: "source_filter_conflict",
        nodeId: "poll2",
      }),
    ]);
  });

  it("reports schedule problems as issues instead of guessing", () => {
    expect(
      planWorkflowJob(graphWith([], { schedule: { daily: { at: "08:00" } } })),
    ).toEqual({
      plan: null,
      issues: [
        expect.objectContaining({
          code: "schedule_timezone_required",
          nodeId: "start",
        }),
      ],
    });
    expect(
      planWorkflowJob(
        graphWith([], { wait: true, settings: { checkCadenceMinutes: 45 } }),
      ).issues,
    ).toEqual([
      expect.objectContaining({ code: "schedule_cadence_unsupported" }),
    ]);
  });

  it("leaves a missing or doubled Trigger to the graph validator", () => {
    const none = buildGraph({ nodes: [], edges: [] });
    expect(planWorkflowJob(none)).toEqual({ plan: null, issues: [] });
  });
});

describe("createWorkflowJob", () => {
  const create = (factoryId = kit.FACTORY_ID, name = "Bug report to Builder") =>
    createWorkflowJob({
      orgId: kit.ORG_ID,
      factoryId,
      ownerEmail: kit.USER_EMAIL,
      name,
      plan: planOf(
        graphWith([slackPoll({ filter: { scopes: ["C0FEEDBACK"] } })], {
          wait: true,
        }),
      ),
    });

  it("writes a disabled job a runner owns, with the identity fields the job layer expects", async () => {
    const { id, path } = await create();

    expect(path).toMatch(
      /^jobs\/factories\/support-triage\/workflow-bug-report-to-builder-[0-9a-f]{8}\.md$/,
    );
    const content = kit.readJob(path) as string;
    const { meta, body } = parseJobResource(content);
    expect(meta).toMatchObject({
      schedule: "*/15 * * * *",
      enabled: false,
      triggerType: "schedule",
      domain: "factory",
      appId: "factory",
      orgId: kit.ORG_ID,
      createdBy: kit.USER_EMAIL,
      runAs: "creator",
      runner: "workflow",
    });
    expect(body.trim().length).toBeGreaterThan(0);
    expect(readAutomationFactoryId(meta, content, path)).toBe(kit.FACTORY_ID);
    expect(content).toContain("displayName: Bug report to Builder");
    expect(content).toContain("slackChannelId: C0FEEDBACK");
    expect(meta.nextRun).toBeUndefined();
    expect(id).toMatch(/^resource-/);
  });

  it("is found by the job layer, which only lists files a Factory owns", async () => {
    const { id, path } = await create();
    const definition = await findFactoryAutomationDefinition(
      kit.ORG_ID,
      kit.FACTORY_ID,
      id,
    );
    expect(definition?.resource.path).toBe(path);
    expect(definition?.name).toMatch(
      /^factories\/support-triage\/workflow-bug-report-to-builder-/,
    );
    expect(
      recoveredFactoryOwnerOrgId(
        definition!.meta,
        path,
        definition!.resource.owner,
      ),
    ).toBe(kit.ORG_ID);
  });

  it("puts a workflow in the default Factory under the factory folder too", async () => {
    const { path } = await create("product-feedback");
    expect(path).toMatch(/^jobs\/factories\/product-feedback\/workflow-/);
    expect(
      await listFactoryAutomationDefinitions(kit.ORG_ID, "product-feedback"),
    ).toHaveLength(1);
  });

  it("gives two workflows with one name two files", async () => {
    const first = await create();
    const second = await create();
    expect(second.path).not.toBe(first.path);
  });
});

describe("syncWorkflowJob", () => {
  async function setUp(planned = graphWith([], { wait: true })) {
    const created = await createWorkflowJob({
      orgId: kit.ORG_ID,
      factoryId: kit.FACTORY_ID,
      ownerEmail: kit.USER_EMAIL,
      name: "Digest",
      plan: planOf(planned),
    });
    return {
      ...created,
      sync: (
        graph = planned,
        enabled = false,
        name = "Digest",
      ): ReturnType<typeof syncWorkflowJob> =>
        syncWorkflowJob({
          orgId: kit.ORG_ID,
          factoryId: kit.FACTORY_ID,
          automationId: created.id,
          name,
          plan: planOf(graph),
          enabled,
        }),
    };
  }

  const metaOf = (path: string) =>
    parseJobResource(kit.readJob(path) as string).meta;

  it("says nothing changed when the file already matches", async () => {
    const job = await setUp();
    expect(await job.sync()).toMatchObject({ changed: false });
  });

  it("writes the new schedule, switch, runner and zone", async () => {
    const job = await setUp();
    const result = await job.sync(
      graphWith([], {
        schedule: { weekdays: { at: "08:00" } },
        timezone: NEW_YORK,
      }),
      true,
    );
    expect(result.changed).toBe(true);
    const meta = metaOf(job.path);
    expect(meta).toMatchObject({
      schedule: "0 8 * * 1-5",
      timezone: NEW_YORK,
      enabled: true,
      runner: "workflow",
    });
    expect(Date.parse(meta.nextRun as string)).toBeGreaterThan(Date.now());
  });

  it("keeps the next run alone when nothing about the schedule moved", async () => {
    const job = await setUp();
    await job.sync(undefined, true);
    const nextRun = metaOf(job.path).nextRun;
    expect(nextRun).toBeDefined();
    await job.sync(undefined, true, "Digest renamed");
    expect(metaOf(job.path).nextRun).toBe(nextRun);
  });

  it("lifts a pause when it switches the job on", async () => {
    const job = await setUp();
    const paused = (kit.readJob(job.path) as string).replace(
      "enabled: false",
      "enabled: false\npausedReason: repeated_failure\npausedAt: 2026-10-01T00:00:00.000Z\nlastErrorCode: provider_error\nconsecutiveFailures: 3",
    );
    kit.seedJob(job.path, paused);
    await job.sync(undefined, true);
    const meta = metaOf(job.path);
    expect(meta.enabled).toBe(true);
    expect(meta.pausedReason).toBeUndefined();
    expect(meta.pausedAt).toBeUndefined();
    expect(meta.lastErrorCode).toBeUndefined();
    expect(meta.consecutiveFailures).toBeUndefined();
  });

  it("does not overwrite run state the scheduler writes while it is saving", async () => {
    const job = await setUp();
    kit.onConditionalWrite(
      (content) =>
        content.replace(
          "enabled: false",
          "enabled: false\nlastRun: 2026-10-18T09:00:00.000Z\nlastStatus: success",
        ),
      1,
    );
    const result = await job.sync(
      graphWith([], { schedule: { every: "30m" } }),
      true,
    );
    expect(result.changed).toBe(true);
    expect(metaOf(job.path)).toMatchObject({
      schedule: "*/30 * * * *",
      enabled: true,
      lastRun: "2026-10-18T09:00:00.000Z",
      lastStatus: "success",
    });
  });

  it("gives up with job_conflict when the file never stops changing", async () => {
    const job = await setUp();
    let n = 0;
    kit.onConditionalWrite((content) => `${content}\n<!-- ${(n += 1)} -->`, 10);
    await expect(
      job.sync(graphWith([], { schedule: { every: "30m" } }), true),
    ).rejects.toMatchObject({ code: "job_conflict" });
  });

  it("clears the poller settings of a Source taken off the canvas", async () => {
    const job = await setUp();
    await job.sync(
      graphWith([
        slackPoll({ filter: { scopes: ["C0A"], authors: ["U1AAA"] } }),
      ]),
    );
    expect(kit.readJob(job.path)).toContain("slackChannelId: C0A");
    await job.sync(graphWith([]));
    const content = kit.readJob(job.path) as string;
    expect(content).not.toContain("slackChannelId");
    expect(content).not.toContain("authorIds");
    expect(content).not.toContain("workLimit");
  });

  it("fails loudly when the file is gone, and when it targets a host", async () => {
    const job = await setUp();
    const host = (kit.readJob(job.path) as string).replace(
      "runner:",
      'executionHostId: "host-1"\nrunner:',
    );
    kit.seedJob(job.path, host);
    await expect(job.sync()).rejects.toMatchObject({ code: "job_invalid" });

    await removeWorkflowJob({
      orgId: kit.ORG_ID,
      factoryId: kit.FACTORY_ID,
      automationId: job.id,
    });
    await expect(job.sync()).rejects.toBeInstanceOf(WorkflowJobError);
    await expect(job.sync()).rejects.toMatchObject({ code: "job_missing" });
  });
});

describe("disableWorkflowJob and removeWorkflowJob", () => {
  it("switches only the enable flag, whatever the graph says", async () => {
    const created = await createWorkflowJob({
      orgId: kit.ORG_ID,
      factoryId: kit.FACTORY_ID,
      ownerEmail: kit.USER_EMAIL,
      name: "Digest",
      plan: planOf(graphWith([])),
    });
    await syncWorkflowJob({
      orgId: kit.ORG_ID,
      factoryId: kit.FACTORY_ID,
      automationId: created.id,
      name: "Digest",
      plan: planOf(graphWith([])),
      enabled: true,
    });
    const before = kit.readJob(created.path) as string;

    await disableWorkflowJob({
      orgId: kit.ORG_ID,
      factoryId: kit.FACTORY_ID,
      automationId: created.id,
    });

    expect(kit.readJob(created.path)).toBe(
      before.replace("enabled: true", "enabled: false"),
    );
  });

  it("deletes the file and its run history once", async () => {
    const created = await createWorkflowJob({
      orgId: kit.ORG_ID,
      factoryId: kit.FACTORY_ID,
      ownerEmail: kit.USER_EMAIL,
      name: "Digest",
      plan: planOf(graphWith([])),
    });
    const input = {
      orgId: kit.ORG_ID,
      factoryId: kit.FACTORY_ID,
      automationId: created.id,
    };
    expect(await removeWorkflowJob(input)).toBe(true);
    expect(kit.readJob(created.path)).toBeUndefined();
    expect(kit.removedHistories).toEqual([
      {
        owner: kit.orgOwner(),
        automation: created.path.replace(/^jobs\//, "").replace(/\.md$/, ""),
      },
    ]);
    expect(await removeWorkflowJob(input)).toBe(false);
  });
});

describe("summarizeWorkflowJob", () => {
  const definition = async () => {
    const created = await createWorkflowJob({
      orgId: kit.ORG_ID,
      factoryId: kit.FACTORY_ID,
      ownerEmail: kit.USER_EMAIL,
      name: "Digest",
      plan: planOf(graphWith([])),
    });
    return findFactoryAutomationDefinition(
      kit.ORG_ID,
      kit.FACTORY_ID,
      created.id,
    );
  };

  it("reports a job that is gone as missing, not as healthy", () => {
    expect(summarizeWorkflowJob(null, { enabled: true })).toMatchObject({
      exists: false,
      drift: ["missing"],
    });
  });

  it("reports nothing wrong for a job that matches", async () => {
    const plan = planOf(graphWith([]));
    expect(
      summarizeWorkflowJob(await definition(), {
        enabled: false,
        schedule: plan.schedule,
      }),
    ).toMatchObject({
      exists: true,
      enabled: false,
      runner: "workflow",
      schedule: "*/15 * * * *",
      consecutiveFailures: 0,
      drift: [],
    });
  });

  it("names what disagrees with the saved workflow", async () => {
    const plan = planOf(
      graphWith([], {
        schedule: { daily: { at: "07:00" } },
        timezone: NEW_YORK,
      }),
    );
    const health = summarizeWorkflowJob(await definition(), {
      enabled: true,
      schedule: plan.schedule,
    });
    expect(health.drift).toEqual(["enabled", "schedule", "timezone"]);
  });
});
