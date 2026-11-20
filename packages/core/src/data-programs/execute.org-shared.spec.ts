import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CredentialUse } from "../credentials/use-ledger.js";
import { DATA_PROGRAM_SENTINEL } from "./contract.js";
import type { DataProgramRow, DataProgramRunRow } from "./store.js";

const PROGRAM_ID = "dp_shared";
const OWNER = "owner@example.com";
const VIEWER = "viewer@example.com";
const ORG = "org_1";

function makeProgram(overrides: Partial<DataProgramRow> = {}): DataProgramRow {
  return {
    id: PROGRAM_ID,
    appId: "analytics",
    name: "repo-health",
    title: "Repo health",
    description: "",
    code: "emit([{a:1}])",
    paramsSchema: null,
    defaultParams: null,
    outputColumns: null,
    refreshMode: "ttl",
    refreshTtlMs: 300_000,
    background: false,
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
    id: "dpr_1",
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
    triggeredBy: "panel_view",
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
  recordDataProgramRun: vi.fn(),
  updateDataProgramRun: vi.fn(),
  MAX_PROGRAM_ROWS: 10_000,
  MAX_PROGRAM_RESULT_BYTES: 4 * 1024 * 1024,
  SHARED_RUN_NOT_SHAREABLE: "not_shareable",
  SHARED_RUN_FAILED: "shared_run_failed",
}));

const accessMocks = vi.hoisted(() => ({ resolveAccess: vi.fn() }));
const credentialMocks = vi.hoisted(() => ({
  resolveCredentialDetailed: vi.fn(),
}));

vi.mock("./store.js", () => storeMocks);
vi.mock("../sharing/access.js", () => accessMocks);
vi.mock("../credentials/index.js", () => credentialMocks);

interface SandboxCall {
  timeoutMs?: number;
  context?: { credentialScope?: "org" };
  credentialLedger?: {
    readsOnly: boolean;
    orgCredentialsOnly: boolean;
    bridgeTools: ReadonlySet<string> | null;
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

async function loadExecute() {
  return import("./execute.js");
}

beforeEach(() => {
  vi.resetModules();
  for (const mock of [
    storeMocks.getDataProgram,
    storeMocks.getLatestSuccessfulRun,
    storeMocks.getLatestFinishedRunOutcome,
    storeMocks.getLatestRun,
    storeMocks.getLatestSharedRunRefusal,
    storeMocks.getActiveRun,
    storeMocks.recordDataProgramRun,
    storeMocks.updateDataProgramRun,
    accessMocks.resolveAccess,
    credentialMocks.resolveCredentialDetailed,
  ]) {
    mock.mockReset();
  }
  storeMocks.getDataProgram.mockResolvedValue(makeProgram());
  accessMocks.resolveAccess.mockResolvedValue({ role: "viewer" });
  storeMocks.getLatestSuccessfulRun.mockResolvedValue(null);
  storeMocks.getLatestFinishedRunOutcome.mockResolvedValue(null);
  storeMocks.getLatestRun.mockResolvedValue(null);
  storeMocks.getLatestSharedRunRefusal.mockResolvedValue(null);
  storeMocks.getActiveRun.mockResolvedValue(null);
  storeMocks.recordDataProgramRun
    .mockResolvedValueOnce(makeRun({ id: "dpr_first", status: "running" }))
    .mockResolvedValueOnce(makeRun({ id: "dpr_second", status: "running" }));
  storeMocks.updateDataProgramRun.mockResolvedValue(undefined);
  credentialMocks.resolveCredentialDetailed.mockResolvedValue({
    value: "org-secret",
    scope: "org",
    scopeId: ORG,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("../coding-tools/run-code.js");
  vi.doUnmock("../coding-tools/sandbox/index.js");
});

describe("org-shared data program runs", () => {
  it("serves a fresh shared run to a viewer whose own credentials resolve the same way", async () => {
    const execute = await loadExecute();
    const sharedHash = execute.hashOrgSharedDataProgramParams(undefined, ORG);
    storeMocks.getLatestSuccessfulRun.mockImplementation(
      async (_id: string, hash: string) =>
        hash === sharedHash
          ? makeRun({
              id: "dpr_shared",
              rowsJson: JSON.stringify([{ shared: true }]),
              credentialUsesJson: JSON.stringify([orgToken]),
            })
          : null,
    );
    const sandbox = mockSandbox(() => sandboxOutput([{ fresh: true }]));
    const { runDataProgram } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
    });

    expect(result).toMatchObject({
      ok: true,
      cacheHit: true,
      runId: "dpr_shared",
      rows: [{ shared: true }],
    });
    expect(sandbox).not.toHaveBeenCalled();
    expect(credentialMocks.resolveCredentialDetailed).toHaveBeenCalledWith(
      "GITHUB_TOKEN",
      { userEmail: VIEWER, orgId: ORG },
    );
  });

  it("never serves the shared run to a viewer whose own run would use their personal key", async () => {
    const execute = await loadExecute();
    const sharedHash = execute.hashOrgSharedDataProgramParams(undefined, ORG);
    const sharedRun = makeRun({
      id: "dpr_shared",
      rowsJson: JSON.stringify([{ shared: true }]),
      credentialUsesJson: JSON.stringify([orgToken]),
    });
    storeMocks.getLatestSuccessfulRun.mockImplementation(
      async (_id: string, hash: string) =>
        hash === sharedHash ? sharedRun : null,
    );
    storeMocks.getLatestRun.mockResolvedValue(sharedRun);
    credentialMocks.resolveCredentialDetailed.mockResolvedValue({
      value: "personal",
      scope: "user",
      scopeId: VIEWER,
    });
    const sandbox = mockSandbox(() => sandboxOutput([{ own: true }]));
    const { runDataProgram, hashDataProgramParams } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
    });

    expect(result).toMatchObject({ ok: true, rows: [{ own: true }] });
    expect(sandbox).toHaveBeenCalledTimes(1);
    expect(sandbox.mock.calls[0]?.[0].context?.credentialScope).toBeUndefined();
    expect(storeMocks.recordDataProgramRun).toHaveBeenCalledWith(
      expect.objectContaining({
        paramsHash: hashDataProgramParams(undefined, VIEWER, ORG),
      }),
    );
  });

  it("never gives a viewer who can't open the program its shared rows", async () => {
    accessMocks.resolveAccess.mockResolvedValue(null);
    storeMocks.getLatestSuccessfulRun.mockResolvedValue(
      makeRun({ credentialUsesJson: JSON.stringify([orgToken]) }),
    );
    const sandbox = mockSandbox(() => sandboxOutput([{ fresh: true }]));
    const { runDataProgram } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "access_denied" },
    });
    expect(storeMocks.getLatestSuccessfulRun).not.toHaveBeenCalled();
    expect(sandbox).not.toHaveBeenCalled();
  });

  it("runs org-only on a miss and shares the run when it read only org credentials", async () => {
    const sandbox = mockSandbox((options) => {
      options.credentialLedger?.record(orgToken);
      return sandboxOutput([{ n: 1 }], ["provider-api-request"]);
    });
    const { runDataProgram, hashOrgSharedDataProgramParams } =
      await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
    });

    expect(result).toMatchObject({ ok: true, rows: [{ n: 1 }] });
    expect(sandbox).toHaveBeenCalledTimes(1);
    expect(sandbox.mock.calls[0]?.[0].context?.credentialScope).toBe("org");
    expect(storeMocks.recordDataProgramRun).toHaveBeenCalledWith(
      expect.objectContaining({
        paramsHash: hashOrgSharedDataProgramParams(undefined, ORG),
      }),
    );
    expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
      "dpr_first",
      expect.objectContaining({
        status: "succeeded",
        credentialUsesJson: JSON.stringify([orgToken]),
      }),
    );
  });

  it("never shares a run that read a person's own key, and gives the viewer their own run", async () => {
    const sandbox = mockSandbox((options) => {
      if (options.context?.credentialScope === "org") {
        options.credentialLedger?.record({
          ...orgToken,
          scope: "user",
          scopeId: VIEWER,
        });
        return sandboxOutput([{ leaked: true }], ["provider-api-request"]);
      }
      return sandboxOutput([{ own: true }], ["provider-api-request"]);
    });
    const { runDataProgram } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
    });

    expect(result).toMatchObject({ ok: true, rows: [{ own: true }] });
    expect(sandbox).toHaveBeenCalledTimes(2);
    expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
      "dpr_first",
      expect.objectContaining({
        status: "failed",
        errorCode: "not_shareable",
      }),
    );
    for (const [, update] of storeMocks.updateDataProgramRun.mock.calls) {
      expect(JSON.stringify(update)).not.toContain("leaked");
    }
  });

  it("keeps a program that calls an app action per viewer", async () => {
    const sandbox = mockSandbox(() =>
      sandboxOutput([{ panel: 1 }], ["extension-data-get"]),
    );
    const { runDataProgram } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
    });

    expect(result).toMatchObject({ ok: true, rows: [{ panel: 1 }] });
    expect(sandbox).toHaveBeenCalledTimes(2);
    expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
      "dpr_first",
      expect.objectContaining({ errorCode: "not_shareable" }),
    );
    expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
      "dpr_second",
      expect.objectContaining({ status: "succeeded" }),
    );
  });

  it("doesn't try an org-only run again soon after one wasn't shareable", async () => {
    storeMocks.getLatestSharedRunRefusal.mockResolvedValue({
      status: "failed",
      errorCode: "not_shareable",
      errorMessage: null,
      startedAt: Date.now() - 2_000,
      finishedAt: Date.now() - 1_000,
    });
    const sandbox = mockSandbox(() => sandboxOutput([{ own: true }]));
    const { runDataProgram } = await loadExecute();

    await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
    });

    expect(sandbox).toHaveBeenCalledTimes(1);
    expect(sandbox.mock.calls[0]?.[0].context?.credentialScope).toBeUndefined();
  });

  it("reads refusals back to the program's last save", async () => {
    const savedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    storeMocks.getDataProgram.mockResolvedValue(
      makeProgram({ updatedAt: savedAt.toISOString() }),
    );
    mockSandbox(() => sandboxOutput([{ own: true }]));
    const { runDataProgram } = await loadExecute();

    await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
    });

    expect(storeMocks.getLatestSharedRunRefusal).toHaveBeenCalledWith(
      PROGRAM_ID,
      savedAt.getTime(),
    );
  });

  it("stops trying an org-only run until the program is saved once a refusal took over half the time limit", async () => {
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const refusal = {
      status: "failed",
      errorCode: "not_shareable",
      errorMessage: null,
      startedAt: twoDaysAgo,
      finishedAt: twoDaysAgo + 6_000,
      durationMs: 6_000,
    };
    storeMocks.getLatestSharedRunRefusal.mockResolvedValue(refusal);
    const sandbox = mockSandbox(() => sandboxOutput([{ n: 1 }]));
    const { runDataProgram } = await loadExecute();
    const run = () =>
      runDataProgram({
        programId: PROGRAM_ID,
        ctx: { userEmail: VIEWER, orgId: ORG },
        triggeredBy: "panel_view",
        timeoutMs: 10_000,
      });

    await run();
    expect(sandbox).toHaveBeenCalledTimes(1);
    expect(sandbox.mock.calls[0]?.[0].context?.credentialScope).toBeUndefined();

    storeMocks.getLatestSharedRunRefusal.mockResolvedValue({
      ...refusal,
      finishedAt: twoDaysAgo + 4_000,
      durationMs: 4_000,
    });
    await run();
    expect(sandbox).toHaveBeenCalledTimes(2);
    expect(sandbox.mock.calls[1]?.[0].context?.credentialScope).toBe("org");
  });

  it("gives the viewer's own run only the time the org-only attempt left", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const sandbox = mockSandbox((options) => {
      if (options.context?.credentialScope === "org") {
        vi.setSystemTime(Date.now() + 4_000);
        return { ...sandboxOutput([]), stdout: "", exitCode: 1 };
      }
      return sandboxOutput([{ own: true }]);
    });
    const { runDataProgram } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
      timeoutMs: 10_000,
    });

    expect(result).toMatchObject({ ok: true, rows: [{ own: true }] });
    expect(sandbox).toHaveBeenCalledTimes(2);
    expect(sandbox.mock.calls[0]?.[0].timeoutMs).toBe(9_000);
    expect(sandbox.mock.calls[1]?.[0].timeoutMs).toBe(6_000);
  });

  it("times out instead of starting the viewer's own run when the org-only attempt used nearly all the time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const sandbox = mockSandbox((options) => {
      if (options.context?.credentialScope === "org") {
        vi.setSystemTime(Date.now() + 9_500);
        return { ...sandboxOutput([]), stdout: "", exitCode: 1 };
      }
      return sandboxOutput([{ own: true }]);
    });
    const { runDataProgram } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
      timeoutMs: 10_000,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "timeout" } });
    expect(sandbox).toHaveBeenCalledTimes(1);
    expect(storeMocks.recordDataProgramRun).toHaveBeenCalledTimes(1);
  });

  it("doesn't start a second org-only run while one may still be running for another caller", async () => {
    storeMocks.getLatestRun.mockResolvedValue(
      makeRun({ status: "running", startedAt: Date.now() - 30_000 }),
    );
    const sandbox = mockSandbox(() => sandboxOutput([{ own: true }]));
    const { runDataProgram } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
    });

    expect(result).toMatchObject({ ok: true, rows: [{ own: true }] });
    expect(sandbox).toHaveBeenCalledTimes(1);
    expect(sandbox.mock.calls[0]?.[0].context?.credentialScope).toBeUndefined();
  });

  it("runs the org-only attempt read-only and never shares a program that tried to write, even when it then failed", async () => {
    const sandbox = mockSandbox((options) => {
      if (options.context?.credentialScope === "org") {
        options.credentialLedger?.record({
          kind: "provider-effect",
          provider: "stripe",
        });
        return { ...sandboxOutput([]), stdout: "", exitCode: 1 };
      }
      return sandboxOutput([{ own: true }], ["provider-api-request"]);
    });
    const { runDataProgram } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
    });

    expect(result).toMatchObject({ ok: true, rows: [{ own: true }] });
    expect(sandbox).toHaveBeenCalledTimes(2);
    expect(sandbox.mock.calls[0]?.[0].credentialLedger?.readsOnly).toBe(true);
    expect(
      sandbox.mock.calls[0]?.[0].credentialLedger?.orgCredentialsOnly,
    ).toBe(true);
    expect(sandbox.mock.calls[1]?.[0].credentialLedger).toBeUndefined();
    expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
      "dpr_first",
      expect.objectContaining({ status: "failed", errorCode: "not_shareable" }),
    );
  });

  it("lets the org-only attempt call only provider API requests, and never shares one that tried another tool, even when it then failed", async () => {
    const sandbox = mockSandbox((options) =>
      options.context?.credentialScope === "org"
        ? { ...sandboxOutput([], ["web-request"]), stdout: "", exitCode: 1 }
        : sandboxOutput([{ own: true }], ["web-request"]),
    );
    const { runDataProgram } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
    });

    expect(result).toMatchObject({ ok: true, rows: [{ own: true }] });
    expect(sandbox).toHaveBeenCalledTimes(2);
    expect([
      ...(sandbox.mock.calls[0]?.[0].credentialLedger?.bridgeTools ?? []),
    ]).toEqual(["provider-api-request"]);
    expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
      "dpr_first",
      expect.objectContaining({ status: "failed", errorCode: "not_shareable" }),
    );
  });

  it("falls back to the viewer's own run when the org-only run fails", async () => {
    const sandbox = mockSandbox((options) =>
      options.context?.credentialScope === "org"
        ? { ...sandboxOutput([]), stdout: "", exitCode: 1 }
        : sandboxOutput([{ own: true }]),
    );
    const { runDataProgram } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
    });

    expect(result).toMatchObject({ ok: true, rows: [{ own: true }] });
    expect(sandbox).toHaveBeenCalledTimes(2);
    expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
      "dpr_first",
      expect.objectContaining({ errorCode: "shared_run_failed" }),
    );
  });

  it("refreshes an expired org run for a viewer whose credentials are all the org's, even after the org set a key it found unset", async () => {
    const expired = makeRun({
      id: "dpr_expired",
      startedAt: Date.now() - 600_000,
      finishedAt: Date.now() - 600_000,
      credentialUsesJson: JSON.stringify([
        { kind: "stored", key: "GITHUB_TOKEN", scope: null, scopeId: null },
      ]),
    });
    storeMocks.getLatestSuccessfulRun.mockResolvedValue(expired);
    storeMocks.getLatestRun.mockResolvedValue(expired);
    const sandbox = mockSandbox(() =>
      sandboxOutput([{ fresh: true }], ["provider-api-request"]),
    );
    const { runDataProgram } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
    });

    expect(result).toMatchObject({ ok: true, rows: [{ fresh: true }] });
    expect(sandbox).toHaveBeenCalledTimes(1);
    expect(sandbox.mock.calls[0]?.[0].context?.credentialScope).toBe("org");
  });

  it("leaves an expired org run for a viewer with their own key, who gets their own run", async () => {
    const expired = makeRun({
      id: "dpr_expired",
      startedAt: Date.now() - 600_000,
      finishedAt: Date.now() - 600_000,
      credentialUsesJson: JSON.stringify([orgToken]),
    });
    storeMocks.getLatestSuccessfulRun.mockResolvedValue(expired);
    storeMocks.getLatestRun.mockResolvedValue(expired);
    credentialMocks.resolveCredentialDetailed.mockResolvedValue({
      value: "personal",
      scope: "user",
      scopeId: VIEWER,
    });
    const sandbox = mockSandbox(() => sandboxOutput([{ own: true }]));
    const { runDataProgram } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
    });

    expect(result).toMatchObject({ ok: true, rows: [{ own: true }] });
    expect(sandbox).toHaveBeenCalledTimes(1);
    expect(sandbox.mock.calls[0]?.[0].context?.credentialScope).toBeUndefined();
  });

  it("refreshes a fresh org run when a viewer it serves forces a refresh", async () => {
    const fresh = makeRun({
      id: "dpr_fresh",
      credentialUsesJson: JSON.stringify([orgToken]),
    });
    storeMocks.getLatestSuccessfulRun.mockResolvedValue(fresh);
    storeMocks.getLatestRun.mockResolvedValue(fresh);
    const sandbox = mockSandbox((options) => {
      options.credentialLedger?.record(orgToken);
      return sandboxOutput([{ refreshed: true }], ["provider-api-request"]);
    });
    const { runDataProgram } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
      forceRefresh: true,
    });

    expect(result).toMatchObject({ ok: true, rows: [{ refreshed: true }] });
    expect(sandbox).toHaveBeenCalledTimes(1);
    expect(sandbox.mock.calls[0]?.[0].context?.credentialScope).toBe("org");
  });

  it("doesn't start or record an org-only run when checking the viewer left too little time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const expired = makeRun({
      id: "dpr_expired",
      startedAt: Date.now() - 600_000,
      finishedAt: Date.now() - 600_000,
      credentialUsesJson: JSON.stringify([orgToken]),
    });
    storeMocks.getLatestSuccessfulRun.mockResolvedValue(expired);
    storeMocks.getLatestRun.mockResolvedValue(expired);
    credentialMocks.resolveCredentialDetailed.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 8_500);
      return { value: "org-secret", scope: "org", scopeId: ORG };
    });
    const sandbox = mockSandbox(() => sandboxOutput([{ own: true }]));
    const { runDataProgram } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
      timeoutMs: 10_000,
    });

    expect(result).toMatchObject({ ok: true, rows: [{ own: true }] });
    expect(sandbox).toHaveBeenCalledTimes(1);
    expect(sandbox.mock.calls[0]?.[0].context?.credentialScope).toBeUndefined();
    expect(sandbox.mock.calls[0]?.[0].timeoutMs).toBe(1_500);
    expect(storeMocks.recordDataProgramRun).toHaveBeenCalledTimes(1);
  });

  it("closes an org-only run without starting it when recording it left too little time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    storeMocks.recordDataProgramRun
      .mockReset()
      .mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 8_500);
        return makeRun({ id: "dpr_first", status: "running" });
      })
      .mockResolvedValueOnce(makeRun({ id: "dpr_second", status: "running" }));
    const sandbox = mockSandbox(() => sandboxOutput([{ own: true }]));
    const { runDataProgram } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
      timeoutMs: 10_000,
    });

    expect(result).toMatchObject({ ok: true, rows: [{ own: true }] });
    expect(storeMocks.updateDataProgramRun).toHaveBeenCalledWith(
      "dpr_first",
      expect.objectContaining({ status: "timed_out", errorCode: "timeout" }),
    );
    expect(sandbox).toHaveBeenCalledTimes(1);
    expect(sandbox.mock.calls[0]?.[0].context?.credentialScope).toBeUndefined();
    expect(sandbox.mock.calls[0]?.[0].timeoutMs).toBe(1_500);
  });

  it("stops checking a viewer's credentials for the shared cache when the time limit runs out", async () => {
    const execute = await loadExecute();
    const sharedHash = execute.hashOrgSharedDataProgramParams(undefined, ORG);
    storeMocks.getLatestSuccessfulRun.mockImplementation(
      async (_id: string, hash: string) =>
        hash === sharedHash
          ? makeRun({ credentialUsesJson: JSON.stringify([orgToken]) })
          : null,
    );
    credentialMocks.resolveCredentialDetailed.mockReturnValue(
      new Promise(() => {}),
    );
    const sandbox = mockSandbox(() => sandboxOutput([{ own: true }]));
    const { runDataProgram } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
      timeoutMs: 30,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "timeout" } });
    expect(sandbox).not.toHaveBeenCalled();
  });

  it("gives up checking a viewer for the shared cache after a quarter of the time limit and runs their own program", async () => {
    const execute = await loadExecute();
    const sharedHash = execute.hashOrgSharedDataProgramParams(undefined, ORG);
    const shared = makeRun({ credentialUsesJson: JSON.stringify([orgToken]) });
    storeMocks.getLatestSuccessfulRun.mockImplementation(
      async (_id: string, hash: string) =>
        hash === sharedHash ? shared : null,
    );
    storeMocks.getLatestRun.mockResolvedValue(shared);
    credentialMocks.resolveCredentialDetailed.mockReturnValue(
      new Promise(() => {}),
    );
    const sandbox = mockSandbox(() => sandboxOutput([{ own: true }]));
    const { runDataProgram } = await loadExecute();

    const result = await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
      timeoutMs: 2_000,
    });

    expect(result).toMatchObject({ ok: true, rows: [{ own: true }] });
    expect(sandbox).toHaveBeenCalledTimes(1);
    expect(sandbox.mock.calls[0]?.[0].context?.credentialScope).toBeUndefined();
    expect(sandbox.mock.calls[0]?.[0].timeoutMs).toBeGreaterThanOrEqual(1_000);
    expect(sandbox.mock.calls[0]?.[0].timeoutMs).toBeLessThanOrEqual(1_500);
  });

  it("keeps a per-viewer cache outside an org and for background programs", async () => {
    const sandbox = mockSandbox(() => sandboxOutput([{ own: true }]));
    const { runDataProgram } = await loadExecute();

    await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER },
      triggeredBy: "panel_view",
    });
    expect(sandbox).toHaveBeenCalledTimes(1);
    expect(storeMocks.getLatestSharedRunRefusal).not.toHaveBeenCalled();

    storeMocks.getDataProgram.mockResolvedValue(
      makeProgram({ background: true }),
    );
    vi.doMock("../coding-tools/sandbox/index.js", () => ({
      enqueueSandboxExecution: vi
        .fn()
        .mockResolvedValue({ execution: { id: "exec_1" } }),
      getSandboxExecutionForOwner: vi.fn(),
    }));
    await runDataProgram({
      programId: PROGRAM_ID,
      ctx: { userEmail: VIEWER, orgId: ORG },
      triggeredBy: "panel_view",
    });
    expect(storeMocks.getLatestSharedRunRefusal).not.toHaveBeenCalled();
    expect(credentialMocks.resolveCredentialDetailed).not.toHaveBeenCalled();
  });
});
