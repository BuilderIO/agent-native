import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CredentialUse } from "../credentials/use-ledger.js";
import { DATA_PROGRAM_SENTINEL } from "./contract.js";
import type { DataProgramRow, DataProgramRunRow } from "./store.js";

const PROGRAM_ID = "dp_scheduled";
const OWNER = "owner@example.com";
const ORG = "org_1";
const HOUR_MS = 60 * 60 * 1000;

function makeProgram(overrides: Partial<DataProgramRow> = {}): DataProgramRow {
  return {
    id: PROGRAM_ID,
    appId: "analytics",
    name: "repo-health",
    title: "Repo health",
    description: "",
    code: "emit([{a:1}])",
    paramsSchema: null,
    defaultParams: JSON.stringify({ repo: "agent-native" }),
    outputColumns: null,
    refreshMode: "ttl",
    refreshTtlMs: HOUR_MS,
    background: false,
    scheduledRefresh: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    archivedAt: null,
    ownerEmail: OWNER,
    orgId: ORG,
    visibility: "org",
    ...overrides,
  };
}

function makeRun(
  overrides: Partial<DataProgramRunRow> = {},
): DataProgramRunRow {
  return {
    id: "dpr_latest",
    programId: PROGRAM_ID,
    paramsHash: "hash",
    paramsJson: "{}",
    status: "succeeded",
    rowsJson: JSON.stringify([{ a: 1 }]),
    schemaJson: JSON.stringify([{ name: "a", type: "number" }]),
    truncated: false,
    rowCount: 1,
    byteSize: 20,
    errorCode: null,
    errorMessage: null,
    logsTail: null,
    executionId: null,
    triggeredBy: "schedule",
    startedAt: Date.now(),
    finishedAt: Date.now(),
    durationMs: 5,
    credentialUsesJson: null,
    ...overrides,
  };
}

const orgToken: CredentialUse = {
  kind: "stored",
  key: "GITHUB_TOKEN",
  scope: "org",
  scopeId: ORG,
};

const storeMocks = vi.hoisted(() => ({
  getDataProgram: vi.fn(),
  getLatestSuccessfulRun: vi.fn(),
  getLatestFinishedRunOutcome: vi.fn(),
  getLatestRun: vi.fn(),
  getLatestSharedRunRefusal: vi.fn(),
  getActiveRun: vi.fn(),
  listScheduledDataPrograms: vi.fn(),
  recordDataProgramRun: vi.fn(),
  updateDataProgramRun: vi.fn(),
  MAX_PROGRAM_ROWS: 10_000,
  MAX_PROGRAM_RESULT_BYTES: 4 * 1024 * 1024,
  MIN_SCHEDULED_REFRESH_MS: 15 * 60_000,
  SHARED_RUN_NOT_SHAREABLE: "not_shareable",
  SHARED_RUN_FAILED: "shared_run_failed",
}));

const identityMocks = vi.hoisted(() => ({
  validateAutomationRunIdentity: vi.fn(),
}));

vi.mock("./store.js", () => storeMocks);
vi.mock("../jobs/background-automation-runner.js", () => identityMocks);

interface SandboxCall {
  code: string;
  timeoutMs?: number;
  context?: {
    userEmail?: string;
    orgId?: string | null;
    credentialScope?: "org";
  };
  credentialLedger?: {
    readsOnly: boolean;
    orgCredentialsOnly: boolean;
    record: (use: CredentialUse) => void;
  };
}

function sandboxOutput(
  rows: Record<string, unknown>[],
  bridgeToolsUsed: string[] = [],
) {
  return {
    stdout: DATA_PROGRAM_SENTINEL + JSON.stringify({ rows }),
    stderr: "",
    exitCode: 0,
    timedOut: false,
    bridgeToolsUsed,
  };
}

function mockSandbox(
  impl: (options: SandboxCall) => ReturnType<typeof sandboxOutput>,
) {
  const executeSandboxCode = vi.fn(async (options: SandboxCall) =>
    impl(options),
  );
  vi.doMock("../coding-tools/run-code.js", () => ({ executeSandboxCode }));
  return executeSandboxCode;
}

function readsOrgToken() {
  return mockSandbox((options) => {
    options.credentialLedger?.record(orgToken);
    return sandboxOutput([{ stars: 5 }], ["provider-api-request"]);
  });
}

async function loadExecute() {
  return import("./execute.js");
}

const farDeadline = () => Date.now() + 10 * 60_000;

const finishedAgo = (ms: number, overrides: Partial<DataProgramRunRow> = {}) =>
  makeRun({
    startedAt: Date.now() - ms - 5,
    finishedAt: Date.now() - ms,
    ...overrides,
  });

beforeEach(() => {
  vi.resetModules();
  for (const mock of [
    storeMocks.getActiveRun,
    storeMocks.getLatestFinishedRunOutcome,
    storeMocks.listScheduledDataPrograms,
    storeMocks.recordDataProgramRun,
    storeMocks.updateDataProgramRun,
    identityMocks.validateAutomationRunIdentity,
  ]) {
    mock.mockReset();
  }
  storeMocks.getActiveRun.mockResolvedValue(null);
  storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(null);
  storeMocks.listScheduledDataPrograms.mockResolvedValue([makeProgram()]);
  storeMocks.recordDataProgramRun.mockResolvedValue(
    makeRun({ id: "dpr_new", status: "running" }),
  );
  storeMocks.updateDataProgramRun.mockResolvedValue(undefined);
  identityMocks.validateAutomationRunIdentity.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.doUnmock("../coding-tools/run-code.js");
});

describe("runScheduledDataProgram", () => {
  it("runs as the owner with org credentials only and saves the run the org shares", async () => {
    const sandbox = readsOrgToken();
    const { runScheduledDataProgram, hashOrgSharedDataProgramParams } =
      await loadExecute();

    const outcome = await runScheduledDataProgram(makeProgram(), {
      deadline: farDeadline(),
    });

    expect(outcome).toBe("refreshed");
    expect(identityMocks.validateAutomationRunIdentity).toHaveBeenCalledWith(
      OWNER,
      ORG,
    );
    expect(sandbox).toHaveBeenCalledTimes(1);
    expect(sandbox.mock.calls[0]?.[0].context).toMatchObject({
      userEmail: OWNER,
      orgId: ORG,
      credentialScope: "org",
    });
    expect(sandbox.mock.calls[0]?.[0].credentialLedger).toMatchObject({
      readsOnly: true,
      orgCredentialsOnly: true,
    });
    expect(sandbox.mock.calls[0]?.[0].code).toContain(
      '{"repo":"agent-native"}',
    );
    expect(storeMocks.recordDataProgramRun).toHaveBeenCalledWith(
      expect.objectContaining({
        paramsHash: hashOrgSharedDataProgramParams(
          { repo: "agent-native" },
          ORG,
        ),
        triggeredBy: "schedule",
      }),
    );
    expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
      "dpr_new",
      expect.objectContaining({
        status: "succeeded",
        rowsJson: JSON.stringify([{ stars: 5 }]),
        credentialUsesJson: JSON.stringify([orgToken]),
      }),
    );
  });

  it("keys a program with no default params the way a panel with no params reads it", async () => {
    readsOrgToken();
    const { runScheduledDataProgram, hashOrgSharedDataProgramParams } =
      await loadExecute();

    await runScheduledDataProgram(makeProgram({ defaultParams: null }), {
      deadline: farDeadline(),
    });

    expect(storeMocks.recordDataProgramRun).toHaveBeenCalledWith(
      expect.objectContaining({
        paramsHash: hashOrgSharedDataProgramParams(undefined, ORG),
      }),
    );
  });

  it("never follows a run that isn't shareable with one using someone's own key", async () => {
    const sandbox = mockSandbox((options) => {
      options.credentialLedger?.record({
        ...orgToken,
        scope: "user",
        scopeId: OWNER,
      });
      return sandboxOutput([{ personal: true }], ["provider-api-request"]);
    });
    const { runScheduledDataProgram } = await loadExecute();

    const outcome = await runScheduledDataProgram(makeProgram(), {
      deadline: farDeadline(),
    });

    expect(outcome).toBe("not_shareable");
    expect(sandbox).toHaveBeenCalledTimes(1);
    expect(storeMocks.recordDataProgramRun).toHaveBeenCalledTimes(1);
    expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
      "dpr_new",
      expect.objectContaining({
        status: "failed",
        errorCode: "not_shareable",
      }),
    );
    for (const [, update] of storeMocks.updateDataProgramRun.mock.calls) {
      expect(JSON.stringify(update)).not.toContain("personal");
    }
  });

  it("saves a shareable run that failed as a failed shared run", async () => {
    mockSandbox(() => ({
      stdout: "",
      stderr: "boom",
      exitCode: 1,
      timedOut: false,
      bridgeToolsUsed: [],
    }));
    const { runScheduledDataProgram } = await loadExecute();

    const outcome = await runScheduledDataProgram(makeProgram(), {
      deadline: farDeadline(),
    });

    expect(outcome).toBe("failed");
    expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
      "dpr_new",
      expect.objectContaining({ errorCode: "shared_run_failed" }),
    );
  });

  it("records a run that used up the sweep's time without holding back viewers' shared runs", async () => {
    mockSandbox(() => ({
      stdout: "",
      stderr: "",
      exitCode: 1,
      timedOut: true,
      bridgeToolsUsed: [],
    }));
    const { runScheduledDataProgram, SCHEDULE_TIMED_OUT } = await loadExecute();

    const outcome = await runScheduledDataProgram(makeProgram(), {
      deadline: Date.now() + 85_000,
    });

    expect(outcome).toBe("timed_out");
    expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
      "dpr_new",
      expect.objectContaining({
        status: "timed_out",
        errorCode: SCHEDULE_TIMED_OUT,
      }),
    );
  });

  it("tries a run that used up the sweep's time again only after refreshTtlMs", async () => {
    const sandbox = readsOrgToken();
    const { runScheduledDataProgram, SCHEDULE_TIMED_OUT } = await loadExecute();
    const timedOut = {
      status: "timed_out" as const,
      errorCode: SCHEDULE_TIMED_OUT,
    };

    storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(
      finishedAgo(30 * 60_000, timedOut),
    );
    await expect(
      runScheduledDataProgram(makeProgram(), { deadline: farDeadline() }),
    ).resolves.toBe("timed_out");
    expect(sandbox).not.toHaveBeenCalled();

    storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(
      finishedAgo(HOUR_MS + 60_000, timedOut),
    );
    await expect(
      runScheduledDataProgram(makeProgram(), { deadline: farDeadline() }),
    ).resolves.toBe("refreshed");
  });

  it("refreshes a run three minutes before it would go stale", async () => {
    const sandbox = readsOrgToken();
    const { runScheduledDataProgram } = await loadExecute();

    storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(
      finishedAgo(HOUR_MS - 4 * 60_000),
    );
    await expect(
      runScheduledDataProgram(makeProgram(), { deadline: farDeadline() }),
    ).resolves.toBe("fresh");
    expect(sandbox).not.toHaveBeenCalled();

    storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(
      finishedAgo(HOUR_MS - 2 * 60_000),
    );
    await expect(
      runScheduledDataProgram(makeProgram(), { deadline: farDeadline() }),
    ).resolves.toBe("refreshed");
    expect(sandbox).toHaveBeenCalledTimes(1);
  });

  it("waits on a run still going, but not on one stuck past the time limit", async () => {
    const sandbox = readsOrgToken();
    const { runScheduledDataProgram } = await loadExecute();

    storeMocks.getActiveRun.mockResolvedValue(
      makeRun({
        status: "running",
        startedAt: Date.now() - 30_000,
        finishedAt: null,
      }),
    );
    await expect(
      runScheduledDataProgram(makeProgram(), { deadline: farDeadline() }),
    ).resolves.toBe("running");
    expect(sandbox).not.toHaveBeenCalled();

    storeMocks.getActiveRun.mockResolvedValue(
      makeRun({
        status: "running",
        startedAt: Date.now() - 5 * 60_000,
        finishedAt: null,
      }),
    );
    await expect(
      runScheduledDataProgram(makeProgram(), { deadline: farDeadline() }),
    ).resolves.toBe("refreshed");
    expect(sandbox).toHaveBeenCalledTimes(1);
  });

  it("tries a run that wasn't shareable again only after a day", async () => {
    const sandbox = readsOrgToken();
    const { runScheduledDataProgram } = await loadExecute();
    const refused = { status: "failed" as const, errorCode: "not_shareable" };

    storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(
      finishedAgo(2 * HOUR_MS, refused),
    );
    await expect(
      runScheduledDataProgram(makeProgram(), { deadline: farDeadline() }),
    ).resolves.toBe("not_shareable");
    expect(sandbox).not.toHaveBeenCalled();

    storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(
      finishedAgo(25 * HOUR_MS, refused),
    );
    await expect(
      runScheduledDataProgram(makeProgram(), { deadline: farDeadline() }),
    ).resolves.toBe("refreshed");
  });

  it("tries a failed refresh again after five minutes, before the last good run goes stale", async () => {
    const sandbox = readsOrgToken();
    const { runScheduledDataProgram } = await loadExecute();
    const failed = {
      status: "failed" as const,
      errorCode: "shared_run_failed",
    };

    storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(
      finishedAgo(2 * 60_000, failed),
    );
    await expect(
      runScheduledDataProgram(makeProgram(), { deadline: farDeadline() }),
    ).resolves.toBe("failed");
    expect(sandbox).not.toHaveBeenCalled();

    storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(
      finishedAgo(6 * 60_000, failed),
    );
    await expect(
      runScheduledDataProgram(makeProgram(), { deadline: farDeadline() }),
    ).resolves.toBe("refreshed");
  });

  it("checks an owner who left the org again only after refreshTtlMs", async () => {
    const sandbox = readsOrgToken();
    const { runScheduledDataProgram, SCHEDULE_OWNER_INVALID } =
      await loadExecute();
    storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(
      finishedAgo(10 * 60_000, {
        status: "failed",
        errorCode: SCHEDULE_OWNER_INVALID,
      }),
    );

    await expect(
      runScheduledDataProgram(makeProgram(), { deadline: farDeadline() }),
    ).resolves.toBe("owner_invalid");
    expect(identityMocks.validateAutomationRunIdentity).not.toHaveBeenCalled();
    expect(sandbox).not.toHaveBeenCalled();
  });

  it("doesn't count runs from before the program's last save", async () => {
    const sandbox = readsOrgToken();
    const { runScheduledDataProgram } = await loadExecute();
    storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(
      finishedAgo(59_000, { status: "failed", errorCode: "not_shareable" }),
    );

    const program = makeProgram({
      updatedAt: new Date(Date.now() - 1_000).toISOString(),
    });
    storeMocks.listScheduledDataPrograms.mockResolvedValue([program]);
    const outcome = await runScheduledDataProgram(program, {
      deadline: farDeadline(),
    });

    expect(outcome).toBe("refreshed");
    expect(sandbox).toHaveBeenCalledTimes(1);
  });

  it("records a refusal and runs nothing once the owner has left the org", async () => {
    identityMocks.validateAutomationRunIdentity.mockResolvedValue({
      ok: false,
      code: "owner_missing",
      reason: 'user "owner@example.com" is no longer a member',
    });
    const sandbox = readsOrgToken();
    const { runScheduledDataProgram, SCHEDULE_OWNER_INVALID } =
      await loadExecute();

    const outcome = await runScheduledDataProgram(makeProgram(), {
      deadline: farDeadline(),
    });

    expect(outcome).toBe("owner_invalid");
    expect(sandbox).not.toHaveBeenCalled();
    expect(storeMocks.recordDataProgramRun).toHaveBeenCalledWith(
      expect.objectContaining({ triggeredBy: "schedule" }),
    );
    expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
      "dpr_new",
      expect.objectContaining({
        status: "failed",
        errorCode: SCHEDULE_OWNER_INVALID,
      }),
    );
  });

  it.each([
    ["a database error that may pass", { code: "owner_unverifiable" }],
    ["a database error that isn't transient", { code: "config_invalid" }],
    [
      "a deployment with no built-in user accounts",
      { code: "owner_unverifiable", accountStatus: "untracked" },
    ],
  ])(
    "records a failed run for an owner check that fails: %s",
    async (_label, failure) => {
      identityMocks.validateAutomationRunIdentity.mockResolvedValue({
        ok: false,
        reason: 'could not verify user "owner@example.com"',
        ...failure,
      });
      const sandbox = readsOrgToken();
      const { runScheduledDataProgram, SCHEDULE_OWNER_UNVERIFIED } =
        await loadExecute();

      const outcome = await runScheduledDataProgram(makeProgram(), {
        deadline: farDeadline(),
      });

      expect(outcome).toBe("owner_unverified");
      expect(sandbox).not.toHaveBeenCalled();
      expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
        "dpr_new",
        expect.objectContaining({
          status: "failed",
          errorCode: SCHEDULE_OWNER_UNVERIFIED,
        }),
      );
      for (const [, update] of storeMocks.updateDataProgramRun.mock.calls) {
        expect(JSON.stringify(update)).not.toContain("owner@example.com");
      }
    },
  );

  it("records the run as starting no later than the program's second read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      let readAt = 0;
      storeMocks.listScheduledDataPrograms.mockImplementation(async () => {
        readAt = Date.now();
        vi.setSystemTime(readAt + 1_000);
        return [makeProgram()];
      });
      readsOrgToken();
      const { runScheduledDataProgram } = await loadExecute();

      await expect(
        runScheduledDataProgram(makeProgram(), { deadline: farDeadline() }),
      ).resolves.toBe("refreshed");

      const [recorded] = storeMocks.recordDataProgramRun.mock.calls[0] as [
        { startedAt?: number },
      ];
      expect(recorded.startedAt).toBeLessThanOrEqual(readAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts nothing when reading the program again leaves too little time", async () => {
    const controller = new AbortController();
    storeMocks.listScheduledDataPrograms.mockImplementation(async () => {
      controller.abort();
      return [makeProgram()];
    });
    const sandbox = readsOrgToken();
    const { runScheduledDataProgram } = await loadExecute();

    const outcome = await runScheduledDataProgram(makeProgram(), {
      deadline: farDeadline(),
      signal: controller.signal,
    });

    expect(outcome).toBe("no_time");
    expect(sandbox).not.toHaveBeenCalled();
    expect(storeMocks.recordDataProgramRun).not.toHaveBeenCalled();
  });

  it.each([
    ["saved", [makeProgram({ updatedAt: new Date(60_000).toISOString() })]],
    ["archived or switched off", []],
  ])(
    "leaves a program %s during the owner check to the next pass",
    async (_label, current) => {
      storeMocks.listScheduledDataPrograms.mockResolvedValue(current);
      const sandbox = readsOrgToken();
      const { runScheduledDataProgram } = await loadExecute();

      const outcome = await runScheduledDataProgram(makeProgram(), {
        deadline: farDeadline(),
      });

      expect(outcome).toBe("skipped");
      expect(storeMocks.listScheduledDataPrograms).toHaveBeenCalledWith(
        "analytics",
        PROGRAM_ID,
      );
      expect(sandbox).not.toHaveBeenCalled();
      expect(storeMocks.recordDataProgramRun).not.toHaveBeenCalled();
    },
  );

  it("records no refusal for a program switched off while its owner was found gone", async () => {
    identityMocks.validateAutomationRunIdentity.mockResolvedValue({
      ok: false,
      code: "owner_missing",
      reason: "gone",
    });
    storeMocks.listScheduledDataPrograms.mockResolvedValue([]);
    const sandbox = readsOrgToken();
    const { runScheduledDataProgram } = await loadExecute();

    const outcome = await runScheduledDataProgram(makeProgram(), {
      deadline: farDeadline(),
    });

    expect(outcome).toBe("skipped");
    expect(sandbox).not.toHaveBeenCalled();
    expect(storeMocks.recordDataProgramRun).not.toHaveBeenCalled();
  });

  it.each([
    ["has no scheduled refresh", { scheduledRefresh: false }],
    ["is archived", { archivedAt: new Date().toISOString() }],
    ["runs in the background", { background: true }],
    ["has no organization", { orgId: null }],
    ["is refreshed by hand", { refreshMode: "manual" as const }],
    ["goes stale in under 15 minutes", { refreshTtlMs: 5 * 60_000 }],
  ])("skips a program that %s", async (_label, overrides) => {
    const sandbox = readsOrgToken();
    const { runScheduledDataProgram } = await loadExecute();

    const outcome = await runScheduledDataProgram(makeProgram(overrides), {
      deadline: farDeadline(),
    });

    expect(outcome).toBe("skipped");
    expect(sandbox).not.toHaveBeenCalled();
    expect(storeMocks.getActiveRun).not.toHaveBeenCalled();
  });

  it("starts nothing with less than a panel view's time limit left", async () => {
    const sandbox = readsOrgToken();
    const { runScheduledDataProgram } = await loadExecute();

    const outcome = await runScheduledDataProgram(makeProgram(), {
      deadline: Date.now() + 10_000,
    });

    expect(outcome).toBe("no_time");
    expect(identityMocks.validateAutomationRunIdentity).not.toHaveBeenCalled();
    expect(sandbox).not.toHaveBeenCalled();
    expect(storeMocks.recordDataProgramRun).not.toHaveBeenCalled();
  });

  it("starts and records nothing when the sweep is aborted during the owner check", async () => {
    const controller = new AbortController();
    identityMocks.validateAutomationRunIdentity.mockImplementation(async () => {
      controller.abort();
      return { ok: false, code: "owner_missing", reason: "gone" };
    });
    const sandbox = readsOrgToken();
    const { runScheduledDataProgram } = await loadExecute();

    const outcome = await runScheduledDataProgram(makeProgram(), {
      deadline: farDeadline(),
      signal: controller.signal,
    });

    expect(outcome).toBe("no_time");
    expect(sandbox).not.toHaveBeenCalled();
    expect(storeMocks.recordDataProgramRun).not.toHaveBeenCalled();
  });

  it("gives a run no more than the usual time limit, even early in a sweep", async () => {
    const sandbox = readsOrgToken();
    const { runScheduledDataProgram } = await loadExecute();

    await runScheduledDataProgram(makeProgram(), {
      deadline: Date.now() + HOUR_MS,
    });

    expect(sandbox.mock.calls[0]?.[0].timeoutMs).toBeLessThanOrEqual(120_000);
  });
});

describe("scheduledDataProgramDueAt", () => {
  const now = Date.parse("2026-11-21T12:00:00Z");
  const endedAgo = (ms: number, overrides: Partial<DataProgramRunRow> = {}) =>
    makeRun({ startedAt: now - ms - 5, finishedAt: now - ms, ...overrides });

  it("is due now when it hasn't run since its last save", async () => {
    const { scheduledDataProgramDueAt } = await loadExecute();
    await expect(scheduledDataProgramDueAt(makeProgram(), now)).resolves.toBe(
      now,
    );

    storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(
      endedAgo(10 * 60_000),
    );
    const savedSince = makeProgram({
      updatedAt: new Date(now - 60_000).toISOString(),
    });
    await expect(scheduledDataProgramDueAt(savedSince, now)).resolves.toBe(now);
  });

  it.each([
    ["three minutes before a good run goes stale", {}, HOUR_MS - 3 * 60_000],
    [
      "five minutes after a failed run",
      { status: "failed" as const, errorCode: "shared_run_failed" },
      5 * 60_000,
    ],
    [
      "a day after a run that wasn't shareable",
      { status: "failed" as const, errorCode: "not_shareable" },
      24 * HOUR_MS,
    ],
    [
      "refreshTtlMs after the owner was found gone",
      { status: "failed" as const, errorCode: "schedule_owner_invalid" },
      HOUR_MS,
    ],
    [
      "five minutes after an owner check that failed",
      { status: "failed" as const, errorCode: "schedule_owner_unverified" },
      5 * 60_000,
    ],
    [
      "refreshTtlMs after a run that used up the sweep's time",
      { status: "timed_out" as const, errorCode: "schedule_timed_out" },
      HOUR_MS,
    ],
  ])("is due %s", async (_label, overrides, waitMs) => {
    storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(
      endedAgo(60_000, overrides),
    );
    const { scheduledDataProgramDueAt } = await loadExecute();

    await expect(scheduledDataProgramDueAt(makeProgram(), now)).resolves.toBe(
      now - 60_000 + waitMs,
    );
  });

  it("is due when a run in progress passes the time limit", async () => {
    storeMocks.getActiveRun.mockResolvedValue(
      makeRun({ status: "running", startedAt: now - 30_000, finishedAt: null }),
    );
    const { scheduledDataProgramDueAt } = await loadExecute();

    await expect(scheduledDataProgramDueAt(makeProgram(), now)).resolves.toBe(
      now - 30_000 + 120_000,
    );
  });

  it("is due now once its wait is over", async () => {
    storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(
      endedAgo(6 * 60_000, {
        status: "failed",
        errorCode: "shared_run_failed",
      }),
    );
    const { scheduledDataProgramDueAt } = await loadExecute();

    await expect(scheduledDataProgramDueAt(makeProgram(), now)).resolves.toBe(
      now,
    );
  });

  it("has no due time when it can't have a scheduled refresh", async () => {
    const { scheduledDataProgramDueAt } = await loadExecute();

    await expect(
      scheduledDataProgramDueAt(makeProgram({ scheduledRefresh: false }), now),
    ).resolves.toBeNull();
    expect(storeMocks.getActiveRun).not.toHaveBeenCalled();
  });
});
