import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, getDbExec, sql } from "@agent-native/core/db";
import {
  readAppSecret,
  writeAppSecret,
  deleteAppSecret,
} from "@agent-native/core/secrets";
import { runWithRequestContext } from "@agent-native/core/server";
import { getSettingsEmitter, putSetting } from "@agent-native/core/settings";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const fixture = vi.hoisted(() => ({
  orgId: "query-reservation-workspace",
  userEmail: "query-owner@example.test",
  projectId: "query-fixture-project",
  executeRequest: vi.fn(),
}));

vi.mock("../../actions/_semantic-helpers.js", () => ({
  requireSemanticOrg: async () => fixture.orgId,
}));
vi.mock("./org-bigquery-credentials.js", () => ({
  requireOrganizationBigQueryProjectId: async () => fixture.projectId,
  withOrganizationBigQueryRequestContext: async (
    _context: unknown,
    run: () => unknown,
  ) => run(),
}));
vi.mock("./provider-api.js", () => ({
  getAnalytics2OrganizationQueryProviderApiRuntime: () => ({
    requestCapabilities: { singleAttemptUnsafeRequests: true },
    executeRequest: fixture.executeRequest,
  }),
}));

import action from "../../actions/run-organization-warehouse-query.js";
import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../../shared/bigquery-source-contract.js";
import type { OrganizationWarehouseQueryInput } from "../../shared/organization-warehouse-query-contract.js";

const directory = mkdtempSync(
  join(tmpdir(), "organization-query-reservation-"),
);
const request = <T>(run: () => T) =>
  runWithRequestContext(
    {
      orgId: fixture.orgId,
      userEmail: fixture.userEmail,
    },
    run,
  );

function response(rows: string[], nextPage?: string, totalRows = "2") {
  return {
    response: {
      ok: true,
      truncated: false,
      json: {
        jobComplete: true,
        jobReference: {
          projectId: "query-fixture-project",
          jobId: "fixture-job",
          location: "US",
        },
        schema: { fields: [{ name: "entry", type: "STRING" }] },
        totalRows,
        rows: rows.map((value) => ({ f: [{ v: value }] })),
        ...(nextPage ? { pageToken: nextPage } : {}),
      },
    },
  };
}

async function storedRows() {
  const result = await getDbExec().execute(
    sql`SELECT key, value FROM public.settings ORDER BY key`,
  );
  return result.rows.map((row) => ({
    key: String(row.key),
    value: JSON.parse(String(row.value)) as Record<string, unknown>,
  }));
}

async function startQuery() {
  fixture.executeRequest.mockResolvedValueOnce(
    response(["first"], "provider-page-two"),
  );
  const result = await request(() =>
    action.run(
      {
        operation: "start",
        connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
        sql: "SELECT entry FROM fixture_table",
        maxRows: 1,
      },
      { caller: "frontend" },
    ),
  );
  expect(result.queryId).toEqual(expect.any(String));
  if (result.queryId === null)
    throw new Error("Start returned no continuation");
  return { ...result, queryId: result.queryId };
}

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", `pglite:${join(directory, "database")}`);
  vi.stubEnv(
    "WORKSPACE_SECRETS_ENCRYPTION_KEY",
    "local reservation fixture encryption material",
  );
  vi.stubEnv(
    "SECRETS_ENCRYPTION_KEY",
    "local legacy reservation fixture encryption material",
  );
});

beforeEach(async () => {
  fixture.orgId = "query-reservation-workspace";
  fixture.userEmail = "query-owner@example.test";
  fixture.projectId = "query-fixture-project";
  fixture.executeRequest.mockReset();
  await getDbExec().execute(sql`CREATE TABLE IF NOT EXISTS public.settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT NOT NULL
  )`);
  await getDbExec().execute(sql`DELETE FROM public.settings`);
  await readAppSecret({
    key: "fixture-vault-initialization",
    scope: "org",
    scopeId: fixture.orgId,
  });
  await getDbExec().execute(sql`DELETE FROM app_secrets`);
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  const safeDirectory = resolve(directory);
  if (
    !safeDirectory.startsWith(
      `${resolve(tmpdir())}/organization-query-reservation-`,
    )
  ) {
    throw new Error("Unsafe local fixture cleanup path");
  }
  rmSync(safeDirectory, { recursive: true });
});

import recover from "../../actions/recover-organization-warehouse-query.js";
import { recoverOrganizationWarehouseQueryInputSchema } from "../../shared/organization-warehouse-query-contract.js";
const recoverInput = {
  connectionId: ORGANIZATION_BIGQUERY_SOURCE_ID,
  sql: "SELECT entry FROM fixture_table",
} as const;
const recovery = () =>
  request(() => recover.run(recoverInput, { caller: "frontend" }));
const pendingResponse = () => ({
  response: {
    ok: true,
    status: 200,
    truncated: false,
    json: {
      jobComplete: false,
      jobReference: {
        projectId: "query-fixture-project",
        jobId: "fixture-job",
        location: "US",
      },
    },
  },
});
async function pending() {
  fixture.executeRequest.mockResolvedValueOnce(pendingResponse());
  return request(() =>
    action.run(
      { operation: "start", ...recoverInput, maxRows: 1 },
      { caller: "frontend" },
    ),
  );
}
async function alterState(patch: Record<string, unknown>) {
  const [saved] = await storedRows();
  if (!saved) throw new Error("Missing controlled state");
  await getDbExec().execute(
    sql`UPDATE public.settings SET value = ${sql.value(JSON.stringify({ ...saved.value, ...patch }))} WHERE key = ${sql.value(saved.key)}`,
  );
}
describe("pending organization query recovery", () => {
  it("recovers exact pending output after reopening storage without provider calls or state changes", async () => {
    const first = await pending();
    const before = await storedRows();
    const settingsBefore = await getDbExec().execute(
      sql`SELECT * FROM public.settings ORDER BY key`,
    );
    const vaultBefore = await getDbExec().execute(
      sql`SELECT * FROM app_secrets ORDER BY id`,
    );
    await closeDbExec();
    expect(await recovery()).toEqual(first);
    expect(await storedRows()).toEqual(before);
    expect(
      (
        await getDbExec().execute(
          sql`SELECT * FROM public.settings ORDER BY key`,
        )
      ).rows,
    ).toEqual(settingsBefore.rows);
    expect(
      (await getDbExec().execute(sql`SELECT * FROM app_secrets ORDER BY id`))
        .rows,
    ).toEqual(vaultBefore.rows);
    expect(fixture.executeRequest).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await storedRows())).not.toContain(first.queryId);
    expect(JSON.stringify(await storedRows())).not.toContain("fixture-job");
  });
  it("retains the poll token after transient GET failure and recovery, rotating only on successful poll", async () => {
    const first = await pending();
    fixture.executeRequest.mockRejectedValueOnce(
      new Error("controlled GET unavailable"),
    );
    await expect(
      request(() =>
        action.run(
          { operation: "poll", queryId: first.queryId! },
          { caller: "frontend" },
        ),
      ),
    ).rejects.toBeTruthy();
    await closeDbExec();
    expect((await recovery()).queryId).toBe(first.queryId);
    fixture.executeRequest.mockResolvedValueOnce(pendingResponse());
    const second = await request(() =>
      action.run(
        { operation: "poll", queryId: first.queryId! },
        { caller: "frontend" },
      ),
    );
    expect(second.queryId).not.toBe(first.queryId);
    expect((await recovery()).queryId).toBe(second.queryId);
    expect(
      fixture.executeRequest.mock.calls.map(([arg]) => arg.method),
    ).toEqual(["POST", "GET", "GET"]);
  });
  it.each(["actor", "org", "project"])("rejects changed %s", async (which) => {
    await pending();
    if (which === "actor") fixture.userEmail = "other-member@example.test";
    if (which === "org") fixture.orgId = "other-workspace";
    if (which === "project") fixture.projectId = "other-project";
    await expect(recovery()).rejects.toMatchObject({
      errorCode:
        which === "project"
          ? "organization_query_continuation_forbidden"
          : "organization_query_continuation_invalid",
    });
    expect(fixture.executeRequest).toHaveBeenCalledTimes(1);
  });
  it.each([
    "reserved",
    "uncertain",
    "paging",
    "complete",
    "failed",
    "budget_exhausted",
  ])("refuses %s instead of submitting SQL", async (state) => {
    await pending();
    await alterState({ state });
    await expect(recovery()).rejects.toMatchObject({
      errorCode: "organization_query_operation_invalid",
    });
    expect(fixture.executeRequest).toHaveBeenCalledTimes(1);
  });
  it("refuses an occupied reservation and does not extend expiry", async () => {
    await pending();
    await alterState({ reservation: "controlled-reservation" });
    await expect(recovery()).rejects.toMatchObject({
      errorCode: "organization_query_operation_invalid",
    });
    await alterState({ reservation: null, expiresAt: 1 });
    await expect(recovery()).rejects.toMatchObject({
      errorCode: "organization_query_continuation_stale",
    });
    expect((await storedRows())[0]?.value.expiresAt).toBe(1);
    expect(fixture.executeRequest).toHaveBeenCalledTimes(1);
  });
  it.each(["missing", "malformed", "missing-token", "rotated", "foreign"])(
    "refuses %s vault material",
    async (kind) => {
      const first = await pending();
      const [saved] = await storedRows();
      if (!saved) throw new Error("Missing state");
      const ref = {
        key: saved.key,
        scope: "org" as const,
        scopeId: fixture.orgId,
      };
      const existing = await readAppSecret(ref);
      if (!existing) throw new Error("Missing vault");
      const value = JSON.parse(existing.value);
      if (kind === "missing") await deleteAppSecret(ref);
      else if (kind === "malformed")
        await writeAppSecret({ ...ref, value: "unreadable" });
      else {
        if (kind === "missing-token") delete value.pendingQueryId;
        if (kind === "rotated")
          value.pendingQueryId = `${first.queryId!.split(".")[0]}.${randomUUID()}`;
        if (kind === "foreign") value.actor = "other-member@example.test";
        await writeAppSecret({ ...ref, value: JSON.stringify(value) });
      }
      await expect(recovery()).rejects.toMatchObject({
        errorCode:
          kind === "missing"
            ? "organization_query_continuation_invalid"
            : kind === "malformed"
              ? "organization_query_continuation_unreadable"
              : kind === "foreign"
                ? "organization_query_continuation_forbidden"
                : "organization_query_continuation_stale",
      });
      expect(fixture.executeRequest).toHaveBeenCalledTimes(1);
    },
  );
  it("does not recover different SQL or accept extra input fields", async () => {
    await pending();
    await expect(
      request(() =>
        recover.run(
          { ...recoverInput, sql: "SELECT other FROM fixture_table" },
          { caller: "frontend" },
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "organization_query_continuation_invalid",
    });
    expect(
      recoverOrganizationWarehouseQueryInputSchema.safeParse({
        ...recoverInput,
        queryId: "invented",
      }).success,
    ).toBe(false);
    expect(fixture.executeRequest).toHaveBeenCalledTimes(1);
  });
  it("refuses recovery during an actual in-flight poll, then recovers only its new token", async () => {
    const first = await pending();
    let resolvePoll!: (value: ReturnType<typeof pendingResponse>) => void;
    let dispatched!: () => void;
    const started = new Promise<void>((resolve) => {
      dispatched = resolve;
    });
    fixture.executeRequest.mockImplementationOnce(() => {
      dispatched();
      return new Promise((resolve) => {
        resolvePoll = resolve;
      });
    });
    const poll = request(() =>
      action.run(
        { operation: "poll", queryId: first.queryId! },
        { caller: "frontend" },
      ),
    );
    await started;
    try {
      await expect(recovery()).rejects.toMatchObject({
        errorCode: "organization_query_operation_invalid",
      });
    } finally {
      resolvePoll(pendingResponse());
    }
    const second = await poll;
    expect(second.queryId).not.toBe(first.queryId);
    expect((await recovery()).queryId).toBe(second.queryId);
    await expect(
      request(() =>
        action.run(
          { operation: "poll", queryId: first.queryId! },
          { caller: "frontend" },
        ),
      ),
    ).rejects.toMatchObject({
      errorCode: "organization_query_continuation_stale",
    });
    expect(fixture.executeRequest).toHaveBeenCalledTimes(2);
  });
});
