import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

const pglite = await createTestPglite();

afterAll(async () => {
  await pglite.close();
});

type ExecuteInput = string | { sql: string; args?: unknown[] };

const rawClient = {
  execute: vi.fn(async (input: ExecuteInput) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [] as unknown[], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [] as unknown[], rowsAffected: info.changes };
  }),
};

vi.mock(import("../db/client.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getDbExec: () => rawClient };
});

interface StoredResource {
  id: string;
  owner: string;
  path: string;
  content: string;
  updatedAt: string;
}

const resourceStore = vi.hoisted(() => ({
  rows: new Map<string, StoredResource>(),
  version: 0,
}));

vi.mock("../resources/store.js", () => {
  const key = (owner: string, path: string) => `${owner}:${path}`;
  const copy = (row: StoredResource | undefined) => (row ? { ...row } : null);
  return {
    organizationIdFromResourceOwner: (owner: string) =>
      owner.startsWith("__organization__:")
        ? decodeURIComponent(owner.slice("__organization__:".length))
        : null,
    organizationResourceOwner: (orgId: string) =>
      `__organization__:${encodeURIComponent(orgId)}`,
    resourceListAllOwners: async () =>
      [...resourceStore.rows.values()].map((row) => ({ ...row })),
    resourceGetByPath: async (owner: string, path: string) =>
      copy(resourceStore.rows.get(key(owner, path))),
    resourcePut: async (owner: string, path: string, content: string) => {
      const existing = resourceStore.rows.get(key(owner, path));
      const row = {
        id: existing?.id ?? `resource-${++resourceStore.version}`,
        owner,
        path,
        content,
        updatedAt: `v${++resourceStore.version}`,
      };
      resourceStore.rows.set(key(owner, path), row);
      return { ...row };
    },
    resourcePutIfCurrent: async (input: {
      owner: string;
      path: string;
      content: string;
      expectedId: string;
      expectedContent: string;
    }) => {
      const existing = resourceStore.rows.get(key(input.owner, input.path));
      if (
        !existing ||
        existing.id !== input.expectedId ||
        existing.content !== input.expectedContent
      ) {
        return null;
      }
      const row = {
        ...existing,
        content: input.content,
        updatedAt: `v${++resourceStore.version}`,
      };
      resourceStore.rows.set(key(input.owner, input.path), row);
      return { ...row };
    },
  };
});

vi.mock("../resources/emitter.js", () => ({
  getResourcesEmitter: () => ({ on: vi.fn() }),
}));

const createThreadMock = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ id: "thread-1" })),
);

vi.mock("../chat-threads/store.js", () => ({
  createThread: createThreadMock,
  getThread: vi.fn(async () => ({
    id: "thread-1",
    title: "Job",
    preview: "",
    threadData: "{}",
    messageCount: 0,
  })),
  updateThreadData: vi.fn(async () => {}),
  withThreadDataLock: async (_threadId: string, fn: () => Promise<unknown>) =>
    fn(),
}));

const runAgentLoopMock = vi.hoisted(() => vi.fn());

vi.mock("../agent/run-loop-with-resume.js", () => ({
  runAgentLoopDirectWithSoftTimeout: runAgentLoopMock,
}));

vi.mock("../agent/production-agent.js", () => ({
  actionsToEngineTools: () => [],
  filterInitialEngineTools: (tools: unknown[]) => tools,
  getOwnerActiveApiKey: vi.fn(async () => "test-api-key"),
  resolveOwnerEngineApiKey: vi.fn(async () => ({
    apiKey: undefined,
    apiKeyEnvVar: undefined,
  })),
  runAgentLoop: vi.fn(),
}));

const engineUsableMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock("../agent/engine/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agent/engine/index.js")>()),
  isResolvedEngineUsableForRequest: engineUsableMock,
}));

const insertRunSpy = vi.hoisted(() => vi.fn());

vi.mock("../agent/run-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent/run-store.js")>();
  insertRunSpy.mockImplementation(actual.insertRun);
  return { ...actual, insertRun: insertRunSpy };
});

const deployEnvironmentMock = vi.hoisted(() => vi.fn(() => "local"));

vi.mock("../server/deploy-environment.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/deploy-environment.js")>()),
  resolveDeployEnvironment: deployEnvironmentMock,
}));

const sendFailureEmailMock = vi.hoisted(() =>
  vi.fn(async () => ({ status: "sent", provider: "resend" })),
);

vi.mock("../server/automation-failure-notifications.js", () => ({
  createAutomationFailureUnsubscribeToken: vi.fn(() => "unsubscribe-token"),
  sendAutomationFailureNotification: sendFailureEmailMock,
}));

const trackMock = vi.hoisted(() => vi.fn());

vi.mock("../tracking/registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tracking/registry.js")>()),
  track: trackMock,
}));

vi.mock("../secrets/crypto.js", () => ({
  decryptSecretValue: (value: string) => value.replace(/^sealed:/, ""),
  encryptSecretValue: (value: string) => `sealed:${value}`,
}));

vi.mock("../usage/store.js", () => ({ recordUsage: vi.fn() }));

vi.mock("../file-upload/actions/upload-image.js", () => ({
  runUploadReceiptCleanupOnce: vi.fn(),
}));

vi.mock("./scheduler-health.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./scheduler-health.js")>()),
  acquireAutomationSchedulerLease: vi.fn(async () => "test-lease"),
  releaseAutomationSchedulerLease: vi.fn(async () => undefined),
  renewAutomationSchedulerLease: vi.fn(async () => undefined),
  recordAutomationSchedulerHealth: vi.fn(async () => undefined),
}));

const { processRecurringJobs } = await import("./scheduler.js");
const { registerErrorCaptureProvider } =
  await import("../server/capture-error.js");
const { automationHash } = await import("./automation-events.js");
const { resetFailureCountersForTests } =
  await import("../tracking/failure-counters.js");
const { parseJobResource } = await import("./frontmatter.js");
const { resetStaleWorkReapThrottle, STALE_AUTOMATION_RUN_AFTER_MS } =
  await import("./stale-reaper.js");
const { EngineError } = await import("../agent/engine/types.js");

const START = Date.parse("2026-10-01T00:00:00.000Z");
const MINUTE = 60_000;
const ORG_OWNER = "__organization__:acme";

const deps = {
  getActions: () => ({}),
  getSystemPrompt: async () => "system",
  engine: {
    name: "test",
    defaultModel: "test-model",
    supportedModels: ["test-model"],
  } as any,
  model: "test-model",
  appId: "calendar",
};

const okUsage = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  model: "test-model",
};

function putJob(
  owner: string,
  name: string,
  frontmatter: string[],
  body = "Send the booking reminder emails.",
): StoredResource {
  const row: StoredResource = {
    id: `resource-${name}`,
    owner,
    path: `jobs/${name}.md`,
    content: ["---", ...frontmatter, "---", "", body].join("\n"),
    updatedAt: "v0",
  };
  resourceStore.rows.set(`${owner}:${row.path}`, row);
  return row;
}

function putOrgReminderJob(name = "booking-reminder-emails") {
  return putJob(ORG_OWNER, name, [
    'schedule: "*/15 * * * *"',
    "enabled: true",
    "createdBy: alice@agent-native.test",
    'orgId: "acme"',
    'appId: "calendar"',
    "runAs: shared",
    `nextRun: "${new Date(START - MINUTE).toISOString()}"`,
  ]);
}

function readJob(owner: string, name: string) {
  const row = resourceStore.rows.get(`${owner}:jobs/${name}.md`);
  if (!row) throw new Error(`job ${name} was deleted`);
  return { ...parseJobResource(row.content).meta, raw: row.content };
}

async function tickAt(ms: number) {
  vi.setSystemTime(ms);
  await processRecurringJobs(deps);
  // A finished run keeps persisting its terminal state after the tick returns;
  // let it land so it cannot overlap the next statement on this one connection.
  await new Promise((resolve) => setTimeout(resolve, 30));
}

async function historyOf(name: string) {
  return (await pglite
    .prepare(
      `SELECT status, error, error_code, failure_alert_state FROM automation_runs WHERE automation = ? ORDER BY started_at ASC`,
    )
    .all(name)) as Array<{
    status: string;
    error: string | null;
    error_code: string | null;
    failure_alert_state: string | null;
  }>;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  resourceStore.rows.clear();
  createThreadMock.mockClear();
  insertRunSpy.mockClear();
  runAgentLoopMock.mockReset().mockResolvedValue(okUsage);
  engineUsableMock.mockReset().mockResolvedValue(true);
  sendFailureEmailMock.mockClear();
  trackMock.mockClear();
  resetFailureCountersForTests();
  deployEnvironmentMock.mockReset().mockReturnValue("local");
  resetStaleWorkReapThrottle();
  await pglite.exec(`
    CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, email TEXT UNIQUE);
    INSERT INTO "user" (id, email) VALUES ('u1', 'alice@agent-native.test'), ('u2', 'qa-bot@local.test')
      ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS org_members (
      org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL,
      federation_removal_pending_at BIGINT
    );
    DELETE FROM org_members;
    INSERT INTO org_members (org_id, email, role) VALUES ('acme', 'alice@agent-native.test', 'member');
  `);
  await rawClient.execute(`DELETE FROM automation_runs`).catch(() => undefined);
});

describe("scheduled automations that cannot run", () => {
  it("records the real cause on the first failure and creates no thread or run", async () => {
    engineUsableMock.mockResolvedValue(false);
    putOrgReminderJob();

    await tickAt(START);

    const job = readJob(ORG_OWNER, "booking-reminder-emails");
    expect(job).toMatchObject({
      enabled: true,
      lastStatus: "error",
      lastErrorCode: "missing_credentials",
      consecutiveFailures: 1,
    });
    expect(job.lastError).toContain("No LLM provider is connected");
    expect(job.lastError).toContain("organization");
    expect(job.lastError).not.toContain("ended with status");
    expect(createThreadMock).not.toHaveBeenCalled();
    expect(insertRunSpy).not.toHaveBeenCalled();
    expect(runAgentLoopMock).not.toHaveBeenCalled();
    expect(await historyOf("booking-reminder-emails")).toEqual([
      expect.objectContaining({
        status: "error",
        error_code: "missing_credentials",
        // The first failure of a streak that will pause stays quiet.
        failure_alert_state: null,
      }),
    ]);
    expect(sendFailureEmailMock).not.toHaveBeenCalled();
  });

  it("pauses on the third identical failure, alerts once, stops running, and resumes when fixed", async () => {
    engineUsableMock.mockResolvedValue(false);
    putOrgReminderJob();

    await tickAt(START);
    await tickAt(START + 15 * MINUTE);
    expect(sendFailureEmailMock).not.toHaveBeenCalled();
    expect(readJob(ORG_OWNER, "booking-reminder-emails")).toMatchObject({
      enabled: true,
      consecutiveFailures: 2,
    });

    await tickAt(START + 30 * MINUTE);

    const paused = readJob(ORG_OWNER, "booking-reminder-emails");
    expect(paused).toMatchObject({
      enabled: false,
      lastStatus: "paused",
      pausedReason: "missing_credentials",
      lastErrorCode: "missing_credentials",
      consecutiveFailures: 3,
      pausedAt: new Date(START + 30 * MINUTE).toISOString(),
    });
    expect(paused.lastError).toContain("Paused after 3 consecutive");
    expect(paused.lastError).toContain("No LLM provider is connected");

    // The owner is told exactly once, by the run that paused it, and the
    // organization job's creator is the recipient (the org has no inbox).
    expect(sendFailureEmailMock).toHaveBeenCalledTimes(1);
    expect(sendFailureEmailMock.mock.calls[0]![0]).toMatchObject({
      email: "alice@agent-native.test",
      automation: "booking-reminder-emails",
      errorCode: "missing_credentials",
      error: expect.stringContaining("Paused after 3 consecutive"),
    });
    expect(await historyOf("booking-reminder-emails")).toHaveLength(3);

    // Fourth tick: due by the clock, but paused, so it does not run.
    await tickAt(START + 45 * MINUTE);
    expect(await historyOf("booking-reminder-emails")).toHaveLength(3);
    expect(sendFailureEmailMock).toHaveBeenCalledTimes(1);
    expect(readJob(ORG_OWNER, "booking-reminder-emails")).toMatchObject({
      enabled: false,
      pausedReason: "missing_credentials",
    });
    expect(createThreadMock).not.toHaveBeenCalled();

    // The credential gets connected: the job resumes by itself, then runs.
    engineUsableMock.mockResolvedValue(true);
    await tickAt(START + 60 * MINUTE);
    const resumed = readJob(ORG_OWNER, "booking-reminder-emails");
    expect(resumed.enabled).toBe(true);
    expect(resumed.pausedReason).toBeUndefined();
    expect(resumed.consecutiveFailures).toBeUndefined();
    expect(resumed.lastErrorCode).toBeUndefined();
    expect(resumed.raw).not.toContain("pausedReason");
    expect(await historyOf("booking-reminder-emails")).toHaveLength(3);

    await tickAt(START + 75 * MINUTE);
    expect(readJob(ORG_OWNER, "booking-reminder-emails")).toMatchObject({
      enabled: true,
      lastStatus: "success",
    });
    expect(
      (await historyOf("booking-reminder-emails")).map((run) => run.status),
    ).toEqual(["error", "error", "error", "success"]);
    expect(createThreadMock).toHaveBeenCalledTimes(1);
  });

  it("does not resume a paused job while its credential is still missing", async () => {
    engineUsableMock.mockResolvedValue(false);
    putOrgReminderJob();
    for (const minute of [0, 15, 30]) await tickAt(START + minute * MINUTE);
    const checksBefore = engineUsableMock.mock.calls.length;

    await tickAt(START + 45 * MINUTE);
    // Rechecked, still unusable: stays paused; not rechecked again inside 15 minutes.
    expect(engineUsableMock.mock.calls.length).toBe(checksBefore + 1);
    await tickAt(START + 50 * MINUTE);
    expect(engineUsableMock.mock.calls.length).toBe(checksBefore + 1);
    expect(readJob(ORG_OWNER, "booking-reminder-emails").enabled).toBe(false);
  });

  it("lets the owner resume a paused job by enabling it, with a fresh failure streak", async () => {
    engineUsableMock.mockResolvedValue(false);
    putOrgReminderJob();
    for (const minute of [0, 15, 30]) await tickAt(START + minute * MINUTE);
    const row = resourceStore.rows.get(
      `${ORG_OWNER}:jobs/booking-reminder-emails.md`,
    )!;
    // What the Automations toggle leaves behind: enabled flipped, pause fields stale.
    row.content = row.content.replace("enabled: false", "enabled: true");

    await tickAt(START + 31 * MINUTE);

    const job = readJob(ORG_OWNER, "booking-reminder-emails");
    expect(job.enabled).toBe(true);
    expect(job.pausedReason).toBeUndefined();
    expect(job.consecutiveFailures).toBeUndefined();

    // Still not fixed: the next failure starts a new streak at one, not at four.
    await tickAt(START + 46 * MINUTE);
    expect(readJob(ORG_OWNER, "booking-reminder-emails")).toMatchObject({
      enabled: true,
      consecutiveFailures: 1,
    });
  });

  it("backs off ordinary runtime errors and pauses only after the fifth, emailing once", async () => {
    runAgentLoopMock.mockRejectedValue(
      new EngineError("Gateway returned 502", { errorCode: "http_502" }),
    );
    putJob("alice@agent-native.test", "flaky-digest", [
      'schedule: "*/15 * * * *"',
      "enabled: true",
      "createdBy: alice@agent-native.test",
      'appId: "calendar"',
      `nextRun: "${new Date(START - MINUTE).toISOString()}"`,
    ]);

    const gaps: number[] = [];
    let now = START;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await tickAt(now);
      const job = readJob("alice@agent-native.test", "flaky-digest");
      expect(job.lastErrorCode).toBe("http_502");
      expect(job.lastError).toContain("Gateway returned 502");
      expect(job.consecutiveFailures).toBe(attempt);
      if (attempt < 5) {
        expect(job.enabled).toBe(true);
        const next = Date.parse(job.nextRun!);
        gaps.push((next - now) / MINUTE);
        now = next;
      }
    }

    // Widening interval between attempts: 15, 30, 60, 120 minutes.
    expect(gaps).toEqual([15, 30, 60, 120]);
    expect(readJob("alice@agent-native.test", "flaky-digest")).toMatchObject({
      enabled: false,
      lastStatus: "paused",
      pausedReason: "http_502",
    });
    expect((await historyOf("flaky-digest")).length).toBe(5);
    // One email for the whole streak: the first failure's, then repeats are suppressed.
    expect(sendFailureEmailMock).toHaveBeenCalledTimes(1);
  });

  it("pauses on spent credits, probes on its own, and resumes after the credits reset", async () => {
    runAgentLoopMock.mockRejectedValue(
      new EngineError("Daily Builder credits are used up", {
        errorCode: "credits-limit-daily",
      }),
    );
    putJob("alice@agent-native.test", "credit-digest", [
      'schedule: "*/15 * * * *"',
      "enabled: true",
      "createdBy: alice@agent-native.test",
      'appId: "calendar"',
      `nextRun: "${new Date(START - MINUTE).toISOString()}"`,
    ]);
    let now = START;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await tickAt(now);
      if (attempt < 5) {
        now = Date.parse(
          readJob("alice@agent-native.test", "credit-digest").nextRun!,
        );
      }
    }
    const paused = readJob("alice@agent-native.test", "credit-digest");
    expect(paused).toMatchObject({
      enabled: false,
      pausedReason: "credits-limit-daily",
      consecutiveFailures: 5,
    });
    expect(paused.lastError).toContain("resumes once this clears");
    const pausedAt = Date.parse(paused.pausedAt!);

    // Inside the probe backoff: nothing runs.
    await tickAt(pausedAt + 60 * MINUTE);
    expect(readJob("alice@agent-native.test", "credit-digest").enabled).toBe(
      false,
    );
    expect(await historyOf("credit-digest")).toHaveLength(5);

    // The first probe still hits the spent quota: paused again at once, quietly.
    await tickAt(pausedAt + 4 * 60 * MINUTE);
    const probing = readJob("alice@agent-native.test", "credit-digest");
    expect(probing.enabled).toBe(true);
    await tickAt(Date.parse(probing.nextRun!));
    const repaused = readJob("alice@agent-native.test", "credit-digest");
    expect(repaused).toMatchObject({
      enabled: false,
      pausedReason: "credits-limit-daily",
      consecutiveFailures: 6,
    });
    expect(await historyOf("credit-digest")).toHaveLength(6);

    // The daily credits reset: the next probe runs and the streak is gone.
    runAgentLoopMock.mockReset().mockResolvedValue(okUsage);
    await tickAt(Date.parse(repaused.pausedAt!) + 6 * 60 * MINUTE);
    const resumed = readJob("alice@agent-native.test", "credit-digest");
    expect(resumed.enabled).toBe(true);
    await tickAt(Date.parse(resumed.nextRun!));
    const healthy = readJob("alice@agent-native.test", "credit-digest");
    expect(healthy).toMatchObject({ enabled: true, lastStatus: "success" });
    expect(healthy.consecutiveFailures).toBeUndefined();
    expect(healthy.pausedReason).toBeUndefined();
    expect(
      (await historyOf("credit-digest")).map((run) => run.status).at(-1),
    ).toBe("success");
    expect(sendFailureEmailMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a job paused for a rejected key paused when the rejection marker expires, with no second email", async () => {
    runAgentLoopMock.mockRejectedValue(
      new EngineError("Invalid API key", { errorCode: "invalid_api_key" }),
    );
    putJob("alice@agent-native.test", "rejected-key-digest", [
      'schedule: "*/15 * * * *"',
      "enabled: true",
      "createdBy: alice@agent-native.test",
      'appId: "calendar"',
      `nextRun: "${new Date(START - MINUTE).toISOString()}"`,
    ]);
    for (const minute of [0, 15, 30]) await tickAt(START + minute * MINUTE);
    expect(
      readJob("alice@agent-native.test", "rejected-key-digest"),
    ).toMatchObject({ enabled: false, pausedReason: "invalid_api_key" });
    expect(sendFailureEmailMock).toHaveBeenCalledTimes(1);

    // The engine check passes again once the 15-minute rejection marker
    // expires, but the key never changed: no resume, no runs, no new email.
    for (let minute = 45; minute <= 4 * 60; minute += 15) {
      await tickAt(START + minute * MINUTE);
    }
    expect(
      readJob("alice@agent-native.test", "rejected-key-digest"),
    ).toMatchObject({ enabled: false, pausedReason: "invalid_api_key" });
    expect(await historyOf("rejected-key-digest")).toHaveLength(3);
    expect(sendFailureEmailMock).toHaveBeenCalledTimes(1);
  });

  it("settles a paused job's interrupted 'Run now' and keeps it paused", async () => {
    putJob("alice@agent-native.test", "paused-run-now", [
      'schedule: "0 * * * *"',
      "enabled: false",
      "createdBy: alice@agent-native.test",
      'appId: "calendar"',
      "lastStatus: running",
      `lastRun: "${new Date(START - 20 * MINUTE).toISOString()}"`,
      'lastErrorCode: "missing_tools"',
      "consecutiveFailures: 3",
      'pausedReason: "missing_tools"',
      `pausedAt: "${new Date(START - 60 * MINUTE).toISOString()}"`,
    ]);

    await tickAt(START);

    const job = readJob("alice@agent-native.test", "paused-run-now");
    expect(job.lastStatus).toBe("error");
    expect(job.lastError).toContain("Worker stopped");
    expect(job).toMatchObject({
      enabled: false,
      pausedReason: "missing_tools",
    });
    expect(runAgentLoopMock).not.toHaveBeenCalled();
  });

  it("sends an org job's pause alert to an org owner when its creator has left", async () => {
    engineUsableMock.mockResolvedValue(false);
    await pglite.exec(`
      DELETE FROM org_members;
      INSERT INTO org_members (org_id, email, role) VALUES ('acme', 'bob@agent-native.test', 'owner');
    `);
    putOrgReminderJob();

    for (const minute of [0, 15, 30]) await tickAt(START + minute * MINUTE);

    expect(sendFailureEmailMock).toHaveBeenCalledTimes(1);
    expect(sendFailureEmailMock.mock.calls[0]![0]).toMatchObject({
      email: "bob@agent-native.test",
    });
  });
});

describe("owners that cannot run automations", () => {
  it("disables a job whose owner no longer exists, once, without running it", async () => {
    putJob("ghost@agent-native.test", "qa-nightly-sync-error", [
      'schedule: "0 * * * *"',
      "enabled: true",
      "createdBy: ghost@agent-native.test",
      'appId: "calendar"',
      `nextRun: "${new Date(START - MINUTE).toISOString()}"`,
    ]);

    await tickAt(START);

    const job = readJob("ghost@agent-native.test", "qa-nightly-sync-error");
    expect(job).toMatchObject({
      enabled: false,
      lastStatus: "paused",
      pausedReason: "owner_missing",
      lastErrorCode: "owner_missing",
    });
    expect(job.lastError).toContain("no longer exists");
    expect(createThreadMock).not.toHaveBeenCalled();
    expect(await historyOf("qa-nightly-sync-error")).toHaveLength(0);

    const written = resourceStore.rows.get(
      "ghost@agent-native.test:jobs/qa-nightly-sync-error.md",
    )!.updatedAt;
    await tickAt(START + 10 * MINUTE);
    expect(
      resourceStore.rows.get(
        "ghost@agent-native.test:jobs/qa-nightly-sync-error.md",
      )!.updatedAt,
    ).toBe(written);
  });

  it("does not disable a job just because the owner lookup failed", async () => {
    putJob("alice@agent-native.test", "digest", [
      'schedule: "0 * * * *"',
      "enabled: true",
      "createdBy: alice@agent-native.test",
      'appId: "calendar"',
      `nextRun: "${new Date(START - MINUTE).toISOString()}"`,
    ]);
    const original = rawClient.execute.getMockImplementation()!;
    rawClient.execute.mockImplementation(async (input: ExecuteInput) => {
      if (typeof input !== "string" && input.sql.includes('FROM "user"')) {
        throw new Error("connection terminated");
      }
      return original(input);
    });
    try {
      await tickAt(START);
    } finally {
      rawClient.execute.mockImplementation(original);
    }

    const job = readJob("alice@agent-native.test", "digest");
    expect(job.enabled).toBe(true);
    expect(job.lastStatus).toBe("skipped");
    expect(job.pausedReason).toBeUndefined();
  });

  it("runs a personal automation whose stored account email differs only in case", async () => {
    await pglite.exec(
      `INSERT INTO "user" (id, email) VALUES ('u-carol', 'Carol@Agent-Native.test') ON CONFLICT DO NOTHING`,
    );
    try {
      putJob("carol@agent-native.test", "carol-digest", [
        'schedule: "0 * * * *"',
        "enabled: true",
        "triggerType: schedule",
        "createdBy: carol@agent-native.test",
        'appId: "calendar"',
        `nextRun: "${new Date(START - MINUTE).toISOString()}"`,
      ]);

      await tickAt(START);

      expect(readJob("carol@agent-native.test", "carol-digest")).toMatchObject({
        enabled: true,
        lastStatus: "success",
      });
    } finally {
      await pglite.exec(`DELETE FROM "user" WHERE id = 'u-carol'`);
    }
  });

  it("does not disable automations on a deployment whose accounts are not in the built-in user table", async () => {
    // A custom getSession deployment: the table exists, none of its users do.
    await pglite.exec(`DELETE FROM "user"`);
    putJob("dave@agent-native.test", "dave-digest", [
      'schedule: "0 * * * *"',
      "enabled: true",
      "triggerType: schedule",
      "createdBy: dave@agent-native.test",
      'appId: "calendar"',
      `nextRun: "${new Date(START - MINUTE).toISOString()}"`,
    ]);
    putJob(ORG_OWNER, "org-digest", [
      'schedule: "0 * * * *"',
      "enabled: true",
      "triggerType: schedule",
      "createdBy: alice@agent-native.test",
      'orgId: "acme"',
      'appId: "calendar"',
      "runAs: creator",
      `nextRun: "${new Date(START - MINUTE).toISOString()}"`,
    ]);

    await tickAt(START);

    expect(readJob("dave@agent-native.test", "dave-digest")).toMatchObject({
      enabled: true,
      lastStatus: "success",
    });
    const org = readJob(ORG_OWNER, "org-digest");
    expect(org.enabled).toBe(true);
    expect(org.pausedReason).toBeUndefined();
    expect(org.lastStatus).toBe("skipped");
  });

  it("does not run test-identity jobs in production, and runs them elsewhere", async () => {
    putJob("qa-bot@local.test", "qa-healthy-automation", [
      'schedule: "0 * * * *"',
      "enabled: true",
      "createdBy: qa-bot@local.test",
      'appId: "calendar"',
      `nextRun: "${new Date(START - MINUTE).toISOString()}"`,
    ]);

    deployEnvironmentMock.mockReturnValue("production");
    await tickAt(START);
    expect(readJob("qa-bot@local.test", "qa-healthy-automation")).toMatchObject(
      {
        enabled: false,
        lastStatus: "paused",
        pausedReason: "owner_reserved",
      },
    );
    expect(createThreadMock).not.toHaveBeenCalled();
    expect(runAgentLoopMock).not.toHaveBeenCalled();
    expect(await historyOf("qa-healthy-automation")).toHaveLength(0);

    // The same fixture on a local or beta deployment is untouched.
    putJob("qa-bot@local.test", "qa-beta-automation", [
      'schedule: "0 * * * *"',
      "enabled: true",
      "createdBy: qa-bot@local.test",
      'appId: "calendar"',
      `nextRun: "${new Date(START - MINUTE).toISOString()}"`,
    ]);
    deployEnvironmentMock.mockReturnValue("beta");
    await tickAt(START + MINUTE);
    expect(readJob("qa-bot@local.test", "qa-beta-automation")).toMatchObject({
      enabled: true,
      lastStatus: "success",
    });
  });
});

describe("automation pause and resume events", () => {
  function eventsNamed(name: string) {
    return trackMock.mock.calls
      .filter(([event]) => event === name)
      .map(([, properties]) => properties as Record<string, unknown>);
  }

  it("counts each credential failure, tracks the pause once, and tracks the automatic resume", async () => {
    engineUsableMock.mockResolvedValue(false);
    putOrgReminderJob();

    for (const minute of [0, 15, 30]) await tickAt(START + minute * MINUTE);

    const credentialCounts = eventsNamed("credential_state_counts");
    expect(credentialCounts).toHaveLength(3);
    expect(credentialCounts[0]).toMatchObject({
      credential_state: "missing",
      credential_subject: "provider",
      source: "automation",
      count: 1,
    });

    const paused = eventsNamed("automation_paused");
    expect(paused).toHaveLength(1);
    expect(paused[0]).toMatchObject({
      automation_hash: automationHash("booking-reminder-emails"),
      error_code: "missing_credentials",
      failure_kind: "precondition",
      consecutive_failures: 3,
      surface: "scheduler",
    });
    expect(JSON.stringify(paused[0])).not.toContain("booking-reminder");

    // Paused and rechecked: nothing more is tracked until it recovers.
    await tickAt(START + 45 * MINUTE);
    expect(eventsNamed("automation_paused")).toHaveLength(1);
    expect(eventsNamed("automation_resumed")).toHaveLength(0);

    engineUsableMock.mockResolvedValue(true);
    await tickAt(START + 60 * MINUTE);
    expect(eventsNamed("automation_resumed")).toEqual([
      expect.objectContaining({
        automation_hash: automationHash("booking-reminder-emails"),
        via: "credential_recovered",
      }),
    ]);
  });

  it("names the failed run's own thread and automation on the captured error", async () => {
    runAgentLoopMock.mockRejectedValue(
      new EngineError("Gateway returned 502", { errorCode: "http_502" }),
    );
    putJob("alice@agent-native.test", "flaky-digest", [
      'schedule: "*/15 * * * *"',
      "enabled: true",
      "createdBy: alice@agent-native.test",
      'appId: "calendar"',
      `nextRun: "${new Date(START - MINUTE).toISOString()}"`,
    ]);
    const captured = vi.fn(() => "evt");
    const unregister = registerErrorCaptureProvider(
      "automation-test",
      captured,
    );

    try {
      await tickAt(START);
    } finally {
      unregister();
    }

    // The run manager reports the run it was driving; the runner reports the
    // automation. Both name the same thread, so either report opens the run.
    const contexts = (
      captured.mock.calls as unknown as Array<[unknown, Record<string, any>]>
    ).map(([, context]) => context);
    const fromRunner = contexts.find(
      (context) => context.tags?.area === "background-automation",
    )!;
    expect(fromRunner.extra.failureContext).toMatchObject({
      automationName: "flaky-digest",
      threadId: "thread-1",
      errorCode: "http_502",
      userScope: "personal",
    });
    expect(fromRunner.aiTraceId).toBe(fromRunner.extra.failureContext.runId);
    for (const context of contexts) {
      expect(context.extra.failureContext.threadId).toBe("thread-1");
    }
  });

  it("tracks the pause of a job whose owner is gone as a preflight pause", async () => {
    putJob("ghost@agent-native.test", "qa-nightly-sync-error", [
      'schedule: "0 * * * *"',
      "enabled: true",
      "createdBy: ghost@agent-native.test",
      'appId: "calendar"',
      `nextRun: "${new Date(START - MINUTE).toISOString()}"`,
    ]);

    await tickAt(START);

    expect(eventsNamed("automation_paused")).toEqual([
      expect.objectContaining({
        error_code: "owner_missing",
        surface: "preflight",
        consecutive_failures: 1,
      }),
    ]);
  });
});

describe("stuck work", () => {
  it("is reaped from the scheduler tick, not at startup, even with no jobs", async () => {
    const stuckAt = START - STALE_AUTOMATION_RUN_AFTER_MS - 60 * MINUTE;
    await (await import("./run-history.js")).ensureTable();
    for (const name of ["a", "b", "c"]) {
      await pglite
        .prepare(
          `INSERT INTO automation_runs (id, owner, automation, path, status, started_at) VALUES (?, 'alice@agent-native.test', ?, ?, 'running', ?)`,
        )
        .run(`stuck-${name}`, name, `jobs/${name}.md`, stuckAt);
    }

    await tickAt(START);

    for (const name of ["a", "b", "c"]) {
      const [run] = await historyOf(name);
      expect(run).toMatchObject({
        status: "interrupted",
        error_code: "automation_run_abandoned",
        failure_alert_state: null,
      });
    }
    expect(sendFailureEmailMock).not.toHaveBeenCalled();
  });
});
