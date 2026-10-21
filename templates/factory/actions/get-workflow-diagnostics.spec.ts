import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const holder = vi.hoisted(() => ({
  world: undefined as undefined | { db: unknown; store: unknown },
  health: undefined as undefined | Record<string, unknown>,
  jobs: { available: true, driver: "netlify-scheduled-function" } as Record<
    string,
    unknown
  >,
  connectionsFail: undefined as undefined | Error,
  jobHealthFail: undefined as undefined | Error,
  jobLastError: null as string | null,
  connectionDetail: undefined as string | undefined,
}));

vi.mock("@agent-native/core/action", async () => {
  const mod = await import("../server/workflow-host/testing/action-module.js");
  return mod.actionModule;
});
vi.mock("@agent-native/core/jobs", () => ({
  getAutomationSchedulerHealth: async ({ orgId }: { orgId: string | null }) =>
    orgId === null ? null : (holder.health ?? null),
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAppConfig: () => ({
    observability: { release: undefined, buildId: "build-4f2a9c" },
  }),
  resolveDeployEnvironment: () => "beta",
  resolveDeployPlatform: () => "netlify",
  isServerlessRuntime: () => true,
  scheduledTriggerAvailability: () => holder.jobs,
}));
vi.mock("../server/db/index.js", () => ({
  getDb: () => holder.world?.db,
}));
vi.mock("../server/workflow-host/factory-store.js", () => ({
  getWorkflowStore: () => holder.world?.store,
}));
vi.mock("../server/workflow-host/factory-read-models.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/read-actions-kit.js");
  return kit.readModelsModule;
});
vi.mock("../server/lib/require-workspace-member.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/read-actions-kit.js");
  return kit.memberModule;
});
vi.mock("../server/lib/factory-definitions.js", async () => {
  const kit =
    await import("../server/workflow-host/testing/read-actions-kit.js");
  return kit.factoryDefinitionsModule;
});
vi.mock("../server/lib/factory-automation-resources.js", () => ({
  findFactoryAutomationDefinition: async () => null,
}));
vi.mock("../server/lib/factory-workflow-job.js", () => ({
  planWorkflowJob: () => ({ plan: undefined }),
  summarizeWorkflowJob: () => {
    if (holder.jobHealthFail) throw holder.jobHealthFail;
    return {
      exists: true,
      enabled: false,
      schedule: "*/15 * * * *",
      timezone: null,
      runner: "workflow",
      lastStatus: "error",
      lastRun: "2026-10-19T11:45:00.000Z",
      nextRun: "2026-10-19T12:00:00.000Z",
      lastError: holder.jobLastError,
      lastErrorCode: "provider_error",
      consecutiveFailures: 2,
      pausedReason: null,
      pausedAt: null,
      drift: ["enabled"],
    };
  },
}));
vi.mock("../server/lib/factory-workflow-connections.js", () => ({
  readProviderConnections: async (providers: string[]) => {
    if (holder.connectionsFail) throw holder.connectionsFail;
    return providers.map((provider) => ({
      provider,
      status: provider === "slack" ? "connected" : "not connected",
      connectWith: "vault",
      ...(holder.connectionDetail === undefined
        ? {}
        : { detail: holder.connectionDetail }),
    }));
  },
}));

import { DIAGNOSTICS_MAX_BYTES } from "../server/tripwire/diagnostics.js";
import {
  createDrizzleTripwireStore,
  type TripwireRow,
} from "../server/tripwire/store.js";
import * as kit from "../server/workflow-host/testing/read-actions-kit.js";
import {
  OTHER_ORG,
  SCOPE,
  addItemState,
  addReceipt,
  addRun,
  addWorkflow,
  closeClient,
  createWorld,
  readGraph,
  type World,
} from "../server/workflow-host/testing/read-models-kit.js";
import { receiptKey } from "../server/workflow/contract.js";
import action from "./get-workflow-diagnostics.js";

const run = kit.runOf(action);

afterAll(closeClient);

// Assembled at run time so no secret scanner reads this file as a leak.
const fake = (...parts: string[]) => parts.join("");
const SLACK = fake("xox", "b-", "1111111111-", "0123456789abcdefghijklmnop");
const GITHUB = fake("gh", "p_", "A".repeat(36));
const EMAIL = "ana.customer@example.test";
const HEX = "0123456789abcdef0123456789abcdef";
const BASE64 = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MEFCQ0RFRg";
const SECRETS = [SLACK, GITHUB, EMAIL, HEX, BASE64];
const ORG_TWO_MARKER = "ORG2-ONLY-MARKER";

const NOW = "2026-10-19T12:00:00.000Z";
const at = (minutesAgo: number) =>
  new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString();

let world: World;
let store: ReturnType<typeof createDrizzleTripwireStore>;
let counter = 0;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  world = await createWorld(at(180));
  kit.bind(world);
  await world.client.exec("TRUNCATE factory_tripwires");
  holder.world = world;
  holder.health = {
    lastCheckedAt: Date.parse(NOW) - 45_000,
    lastDispatchedAt: Date.parse(NOW) - 120_000,
    lastError: null,
    runtime: "netlify",
  };
  holder.jobs = { available: true, driver: "netlify-scheduled-function" };
  holder.connectionsFail = undefined;
  holder.jobHealthFail = undefined;
  holder.jobLastError = null;
  holder.connectionDetail = undefined;
  store = createDrizzleTripwireStore({ getDatabase: () => world.db as never });
  counter = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

async function seedTripwire(overrides: Partial<TripwireRow> = {}) {
  counter += 1;
  await store.insert({
    id: `tw-${String(counter).padStart(5, "0")}`,
    orgId: SCOPE.orgId,
    factoryId: SCOPE.factoryId,
    workflowId: null,
    runId: null,
    nodeId: null,
    area: "provider",
    code: "provider_status_unexpected",
    severity: "warn",
    detailsJson: JSON.stringify({ status: 502 }),
    createdAt: at(counter),
    ...overrides,
  });
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value, null, 2)).length;
}

async function seedWorkflow() {
  const workflow = await addWorkflow(world);
  const wf = workflow.id;
  // Twelve runs: the bundle shows the newest ten.
  for (let index = 0; index < 12; index += 1) {
    const failed = index === 11;
    await addRun(world, {
      workflowId: wf,
      tickKey: `tick-${index}`,
      startedAt: at(120 - index * 5),
      finishedAt: at(120 - index * 5 - 1),
      status: failed ? "failed" : "succeeded",
      counts: { taken: index },
      ...(index === 10
        ? { triggerKind: "manual", startedBy: kit.USER_EMAIL }
        : index === 9
          ? { triggerKind: "manual", startedBy: "owner@example.test" }
          : {}),
      ...(failed
        ? {
            error: {
              code: "provider_error",
              message: `Bearer ${BASE64} rejected for ${EMAIL}`,
            },
            steps: [
              {
                nodeId: "assess",
                status: "failed",
                ports: {},
                error: {
                  code: "provider_error",
                  message: `Slack said ${SLACK} and ${GITHUB} ${HEX}`,
                },
              },
            ],
          }
        : {}),
    });
  }
  return workflow;
}

describe("get-workflow-diagnostics", () => {
  it("is a read-only GET with a bounded window", () => {
    const definition = action as unknown as {
      http: { method: string };
      readOnly: boolean;
    };
    expect(definition.http.method).toBe("GET");
    expect(definition.readOnly).toBe(true);
    const schema = kit.schemaOf(action);
    expect(schema.safeParse({ factoryId: "factory-1" }).data).toMatchObject({
      sinceHours: 24,
    });
    expect(
      schema.safeParse({ factoryId: "factory-1", sinceHours: 169 }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ factoryId: "factory-1", sinceHours: 0 }).success,
    ).toBe(false);
  });

  it("returns one bundle with every section for a workflow", async () => {
    const workflow = await seedWorkflow();
    const wf = workflow.id;
    world.at(at(60));
    await addItemState(world, {
      workflowId: wf,
      itemId: "overdue-item",
      parkAt: {
        nodeId: "hold",
        wake: { wait: "reply", dueAt: at(30), nextCheckAt: at(35) },
      },
    });
    await addItemState(world, {
      workflowId: wf,
      itemId: "future-item",
      parkAt: { nodeId: "hold", wake: { wait: "reply", dueAt: at(-60) } },
    });
    await addReceipt(world, SCOPE, wf, {
      key: receiptKey({
        workflowId: wf,
        itemId: "overdue-item",
        nodeId: "tell",
        attempt: 0,
      }),
      status: "started",
      summary: "slack.postMessage at tell",
      at: at(60),
    });
    await seedTripwire({
      workflowId: "some-other-workflow",
      area: "merge",
      code: "merge_blocked",
    });
    await seedTripwire({
      workflowId: null,
      area: "credential",
      code: "credential_source_used",
      detailsJson: JSON.stringify({ provider: "slack", source: "vault" }),
    });

    const bundle = await run({ factoryId: "factory-1", workflowId: wf });

    expect(Object.keys(bundle).sort()).toEqual(
      [
        "build",
        "connections",
        "environment",
        "focusRun",
        "generatedAt",
        "receiptsNeedingCheck",
        "request",
        "runs",
        "schema",
        "scheduler",
        "scope",
        "tripwires",
        "truncated",
        "unavailable",
        "waiting",
        "workflow",
        "workflows",
      ].sort(),
    );
    expect(bundle.schema).toBe(1);
    expect(bundle.scope).toEqual({ orgId: "org-1", factoryId: "factory-1" });
    expect(bundle.request).toMatchObject({
      workflowId: wf,
      runId: null,
      sinceHours: 24,
    });
    expect(bundle.build).toEqual({
      app: "factory",
      release: "unknown",
      buildId: "build-4f2a9c",
    });
    expect(bundle.environment).toEqual({
      deployEnvironment: "beta",
      deployPlatform: "netlify",
      serverless: true,
      recurringJobs: { available: true, driver: "netlify-scheduled-function" },
    });
    expect(bundle.scheduler).toMatchObject({
      status: "healthy",
      lastCheckedAgeSeconds: 45,
      lastDispatchedAgeSeconds: 120,
    });

    expect(bundle.workflow).toMatchObject({
      id: wf,
      version: 1,
      enabled: false,
      needsCleanDryRun: true,
      hasWait: true,
      waitKinds: ["reply"],
      hasLoop: false,
      job: { exists: true, drift: ["enabled"], consecutiveFailures: 2 },
    });
    expect(bundle.workflow.operationIds).toContain("slack.postMessage");
    expect(bundle.workflow.nodeKinds).toMatchObject({
      trigger: 1,
      wait: 1,
      end: 2,
    });
    expect(bundle.workflows).toBeNull();
    expect(bundle.focusRun).toBeNull();

    expect(bundle.runs).toHaveLength(10);
    expect(bundle.runs[0]).toMatchObject({
      status: "failed",
      failedStepsTotal: 1,
      failedSteps: [
        { nodeId: "assess", status: "failed", code: "provider_error" },
      ],
      error: { code: "provider_error" },
    });
    const started = bundle.runs.map(
      (entry: { startedBy: string }) => entry.startedBy,
    );
    expect(started).toContain("you");
    expect(started).toContain("teammate");
    expect(started).toContain("schedule");
    expect(JSON.stringify(bundle.runs)).not.toContain("teammate@example.test");

    expect(bundle.waiting).toMatchObject({
      parked: 2,
      overdue: 1,
      byWorkflow: [
        { workflowId: wf, parked: 2, overdue: 1, overdueAfterMinutes: 30 },
      ],
    });
    expect(bundle.receiptsNeedingCheck).toMatchObject({
      count: 1,
      items: [{ workflowId: wf, nodeId: "tell", attempt: 0, ageMinutes: 60 }],
    });

    // This workflow's events and the factory-wide ones; not another workflow's.
    expect(JSON.stringify(bundle.tripwires)).not.toContain("merge_blocked");

    expect(bundle.connections).toEqual(
      expect.arrayContaining([
        { provider: "slack", status: "connected", source: "vault" },
      ]),
    );
    for (const entry of bundle.connections) {
      if (entry.status === "not connected") expect(entry.source).toBe("none");
    }
    expect(bundle.truncated).toEqual([]);
    expect(bundle.unavailable).toEqual([]);
    expect(bytes(bundle)).toBeLessThanOrEqual(DIAGNOSTICS_MAX_BYTES);
  });

  it("lists the factory's workflows when none is named", async () => {
    await seedWorkflow();
    const bundle = await run({ factoryId: "factory-1" });
    expect(bundle.request.workflowId).toBeNull();
    expect(bundle.workflow).toBeNull();
    expect(bundle.workflows).toHaveLength(1);
    expect(bundle.runs).toHaveLength(10);
    expect(bundle.connections.length).toBeGreaterThan(0);
  });

  it("calls a waiting item overdue by its own workflow's `wait_overdue` threshold, not a flat ten minutes", async () => {
    const slow = await addWorkflow(world);
    const graph = readGraph();
    const fast = await addWorkflow(world, {
      name: "Every five minutes",
      graph: {
        ...graph,
        settings: { ...graph.settings, checkCadenceMinutes: 5 },
      },
    });
    world.at(at(60));
    const park = (workflowId: string, itemId: string, lateMinutes: number) =>
      addItemState(world, {
        workflowId,
        itemId,
        parkAt: {
          nodeId: "hold",
          wake: { wait: "reply", dueAt: at(lateMinutes) },
        },
      });
    // Fifteen-minute cadence: a wake one cadence late is healthy, three is not.
    await park(slow.id, "one-cadence-late", 15);
    await park(slow.id, "three-cadences-late", 45);
    // Five-minute cadence: twenty minutes late is four cadences.
    await park(fast.id, "four-cadences-late", 20);

    const bundle = await run({ factoryId: "factory-1" });

    expect(bundle.waiting).toMatchObject({
      parked: 3,
      overdue: 2,
      oldestOverdueAt: at(45),
    });
    expect(bundle.waiting.byWorkflow).toEqual(
      expect.arrayContaining([
        {
          workflowId: slow.id,
          parked: 2,
          overdue: 1,
          overdueAfterMinutes: 30,
          oldestOverdueAt: at(45),
        },
        {
          workflowId: fast.id,
          parked: 1,
          overdue: 1,
          overdueAfterMinutes: 10,
          oldestOverdueAt: at(20),
        },
      ]),
    );
  });

  it("includes a run asked for by id, with its steps", async () => {
    const workflow = await seedWorkflow();
    const [latest] = (
      await run({ factoryId: "factory-1", workflowId: workflow.id })
    ).runs;
    const bundle = await run({
      factoryId: "factory-1",
      workflowId: workflow.id,
      runId: latest.id,
    });
    expect(bundle.focusRun.run.id).toBe(latest.id);
    expect(bundle.focusRun.steps).toEqual([
      expect.objectContaining({ nodeId: "assess", status: "failed" }),
    ]);
  });

  it("never carries a credential, an email or a long secret, wherever it was seeded", async () => {
    holder.jobLastError = `Slack answered ${SLACK} for ${EMAIL}`;
    holder.connectionDetail = `Bearer ${BASE64} was refused`;
    holder.health = {
      ...holder.health,
      lastError: `sweep failed with ${GITHUB} ${HEX}`,
    };
    const workflow = await addWorkflow(world, {
      name: `Digest ${SLACK} ${EMAIL}`,
    });
    await addRun(world, {
      workflowId: workflow.id,
      tickKey: "t-1",
      startedAt: at(30),
      status: "failed",
      error: { code: "provider_error", message: `${BASE64} ${HEX} ${EMAIL}` },
      steps: [
        {
          nodeId: "assess",
          status: "failed",
          ports: {},
          error: { code: "provider_error", message: `${SLACK} ${GITHUB}` },
        },
      ],
    });
    world.at(at(60));
    await addReceipt(world, SCOPE, workflow.id, {
      key: receiptKey({
        workflowId: workflow.id,
        itemId: `item-${EMAIL}`,
        nodeId: "tell",
        attempt: 0,
      }),
      status: "started",
      summary: `posted ${SLACK} to ${EMAIL}`,
      at: at(60),
    });
    // Rows written by something other than the recorder: the read scrubs too.
    await seedTripwire({
      workflowId: workflow.id,
      detailsJson: JSON.stringify({
        note: `Bearer ${BASE64} and ${EMAIL}`,
        blob: HEX,
        nested: { token: GITHUB, list: [SLACK, EMAIL] },
        [SLACK]: "key is a token",
      }),
    });

    const bundle = await run({
      factoryId: "factory-1",
      workflowId: workflow.id,
    });
    const text = JSON.stringify(bundle);
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
    expect(text).toContain("[redacted]");
  });

  it("holds the bundle to 30 KB and lists what it cut", async () => {
    const workflow = await seedWorkflow();
    const wide = JSON.stringify(
      Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [
          `field${index}`,
          "a plain sentence about what happened at this boundary. ".repeat(3),
        ]),
      ),
    );
    for (let index = 0; index < 120; index += 1) {
      await seedTripwire({
        workflowId: workflow.id,
        code: [
          "provider_slow",
          "provider_shape_unexpected",
          "provider_status_unexpected",
        ][index % 3] as string,
        detailsJson: wide,
      });
    }
    const bundle = await run({
      factoryId: "factory-1",
      workflowId: workflow.id,
    });
    expect(bytes(bundle)).toBeLessThanOrEqual(DIAGNOSTICS_MAX_BYTES);
    expect(bundle.truncated.length).toBeGreaterThan(0);
    expect(bundle.truncated[0]).toMatchObject({
      section: "tripwires.recent",
      of: 50,
    });
    expect(bundle.truncated[0].kept).toBeLessThan(50);
    // What matters most is still there.
    expect(bundle.runs.length).toBeGreaterThan(0);
    expect(bundle.build).not.toBeNull();
  });

  it("is scoped to the caller's org and factory", async () => {
    const mine = await seedWorkflow();
    const theirs = await addWorkflow(world, {
      scope: OTHER_ORG,
      name: ORG_TWO_MARKER,
    });
    await addRun(world, {
      scope: OTHER_ORG,
      workflowId: theirs.id,
      tickKey: "t-1",
      startedAt: at(20),
      status: "failed",
      error: { code: "provider_error", message: ORG_TWO_MARKER },
    });
    await seedTripwire({
      orgId: OTHER_ORG.orgId,
      workflowId: theirs.id,
      code: "provider_slow",
      detailsJson: JSON.stringify({ note: ORG_TWO_MARKER }),
    });
    await seedTripwire({
      factoryId: "factory-2",
      code: "provider_slow",
      detailsJson: JSON.stringify({ note: ORG_TWO_MARKER }),
    });
    await seedTripwire({
      workflowId: mine.id,
      detailsJson: JSON.stringify({ note: "mine" }),
    });

    const inOrgOne = await run({ factoryId: "factory-1" });
    expect(JSON.stringify(inOrgOne)).not.toContain(ORG_TWO_MARKER);
    expect(inOrgOne.tripwires.total).toBe(1);

    kit.callAsOrg("org-2");
    const inOrgTwo = await run({ factoryId: "factory-1" });
    expect(JSON.stringify(inOrgTwo)).toContain(ORG_TWO_MARKER);
    expect(inOrgTwo.scope.orgId).toBe("org-2");
    expect(inOrgTwo.tripwires.total).toBe(1);
    expect(JSON.stringify(inOrgTwo)).not.toContain(mine.id);

    // Org 2 cannot name org 1's workflow or run.
    const missingWorkflow = await kit.failureOf(() =>
      run({ factoryId: "factory-1", workflowId: mine.id }),
    );
    expect(missingWorkflow.errorCode).toBe("workflow_not_found");
    expect(missingWorkflow.statusCode).toBe(404);
  });

  it("answers a workflow or run that is not there with a typed 404", async () => {
    await seedWorkflow();
    const noWorkflow = await kit.failureOf(() =>
      run({ factoryId: "factory-1", workflowId: "nope" }),
    );
    expect(noWorkflow).toMatchObject({
      errorCode: "workflow_not_found",
      statusCode: 404,
    });
    const noRun = await kit.failureOf(() =>
      run({ factoryId: "factory-1", runId: "nope" }),
    );
    expect(noRun).toMatchObject({
      errorCode: "workflow_run_not_found",
      statusCode: 404,
    });
    const noFactory = await kit.failureOf(() => run({ factoryId: "missing" }));
    expect(noFactory).toMatchObject({ errorCode: "factory_not_found" });
  });

  it("reports a section it cannot read as unavailable, never as an empty one", async () => {
    const workflow = await seedWorkflow();
    holder.connectionsFail = new Error(`vault said no to ${SLACK}`);
    holder.jobHealthFail = new Error("job file is gone");
    const bundle = await run({
      factoryId: "factory-1",
      workflowId: workflow.id,
    });
    expect(bundle.connections).toBeNull();
    expect(bundle.workflow.job).toMatchObject({
      unreadable: true,
      errorMessage: "job file is gone",
    });
    expect(bundle.unavailable).toEqual([
      expect.objectContaining({ section: "connections" }),
    ]);
    expect(JSON.stringify(bundle.unavailable)).not.toContain(SLACK);
    // The rest of the bundle is still there.
    expect(bundle.runs).toHaveLength(10);
    expect(bundle.tripwires).not.toBeNull();
  });

  it("says a scheduler with no heartbeat has no data, and a stale one is stale", async () => {
    holder.health = undefined;
    const none = await run({ factoryId: "factory-1" });
    expect(none.scheduler).toMatchObject({
      status: "no-data",
      lastCheckedAgeSeconds: null,
    });
    holder.health = {
      lastCheckedAt: Date.parse(NOW) - 600_000,
      lastDispatchedAt: null,
      lastError: null,
      runtime: "node",
    };
    const stale = await run({ factoryId: "factory-1" });
    expect(stale.scheduler).toMatchObject({
      status: "stale",
      lastCheckedAgeSeconds: 600,
      lastDispatchedAgeSeconds: null,
    });
  });

  it("says why recurring jobs are off", async () => {
    holder.jobs = { available: false, reason: "local-development" };
    const bundle = await run({ factoryId: "factory-1" });
    expect(bundle.environment.recurringJobs).toEqual({
      available: false,
      reason: "local-development",
    });
    holder.jobs = {
      available: false,
      reason: "missing-trigger-secret",
      driver: "vercel-cron",
      secret: "CRON_SECRET",
    };
    const missing = await run({ factoryId: "factory-1" });
    expect(missing.environment.recurringJobs).toEqual({
      available: false,
      reason: "missing-trigger-secret",
      missingSecret: "CRON_SECRET",
    });
  });
});
