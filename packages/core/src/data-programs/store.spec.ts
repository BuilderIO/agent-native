import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

interface FrameworkClient {
  execute(arg: string | { sql: string; args: any[] }): Promise<{
    rows: any[];
    rowsAffected: number;
  }>;
}

let pglite: Awaited<ReturnType<typeof createTestPglite>>;
let drizzleDb: ReturnType<typeof drizzle>;
let sharedClient: FrameworkClient;

function makeClient(
  db: Awaited<ReturnType<typeof createTestPglite>>,
): FrameworkClient {
  return {
    async execute(arg) {
      const sql = typeof arg === "string" ? arg : arg.sql;
      const args = typeof arg === "string" ? [] : (arg.args ?? []);
      const stmt = await db.prepare(sql);
      if (/^\s*select/i.test(sql)) {
        const rows = (await stmt.all(...args)) as any[];
        return { rows, rowsAffected: 0 };
      }
      const result = await stmt.run(...args);
      return { rows: [], rowsAffected: Number(result.changes ?? 0) };
    },
  };
}

vi.mock("../db/client.js", () => ({
  getEnclosingTransactionDbExec: () => undefined,
  getDbExec: () => sharedClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("../db/create-get-db.js", () => ({
  createGetDb: () => () => drizzleDb,
}));

vi.mock("../sharing/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../sharing/registry.js")>(
    "../sharing/registry.js",
  );
  return actual;
});

beforeEach(async () => {
  pglite = await createTestPglite();
  drizzleDb = drizzle(pglite.db);
  sharedClient = makeClient(pglite);
});

afterEach(async () => {
  vi.resetModules();
  await pglite.close();
});

async function loadStore() {
  return import("./store.js");
}

describe("data-programs/store", () => {
  describe("ensureDataProgramTables", () => {
    it("creates data_programs, data_program_shares, and data_program_runs", async () => {
      const { ensureDataProgramTables } = await loadStore();
      await ensureDataProgramTables();

      const tables = (await pglite
        .prepare(
          `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public'`,
        )
        .all()) as Array<{ name: string }>;
      const names = tables.map((t) => t.name);
      expect(names).toContain("data_programs");
      expect(names).toContain("data_program_shares");
      expect(names).toContain("data_program_runs");

      const runColumns = (await pglite
        .prepare(
          `SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'data_program_runs'`,
        )
        .all()) as Array<{ name: string }>;
      expect(runColumns.map((c) => c.name)).toContain("truncated");
    });

    it("adds notified_at to a data_program_shares table created before it existed", async () => {
      await pglite.exec(`CREATE TABLE data_program_shares (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        principal_type TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT now()
      )`);
      const { ensureDataProgramTables } = await loadStore();
      const { dataProgramShares } = await import("./schema.js");
      await ensureDataProgramTables();

      const shareColumns = (await pglite
        .prepare(
          `SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'data_program_shares'`,
        )
        .all()) as Array<{ name: string }>;
      expect(shareColumns.map((c) => c.name)).toContain("notified_at");

      await expect(
        drizzleDb.insert(dataProgramShares).values({
          id: "share-legacy",
          resourceId: "dp_legacy",
          principalType: "user",
          principalId: "viewer@example.com",
          role: "editor",
          createdBy: "owner@example.com",
        }),
      ).resolves.toBeDefined();
    });

    it("adds scheduled_refresh to a data_programs table created before it existed", async () => {
      await pglite.exec(`CREATE TABLE data_programs (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        code TEXT NOT NULL,
        params_schema TEXT,
        default_params TEXT,
        output_columns TEXT,
        refresh_mode TEXT NOT NULL DEFAULT 'ttl',
        refresh_ttl_ms INTEGER NOT NULL DEFAULT 300000,
        background INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT now(),
        updated_at TEXT NOT NULL DEFAULT now(),
        archived_at TEXT,
        owner_email TEXT NOT NULL DEFAULT 'local@localhost',
        org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      )`);
      await pglite.exec(
        `INSERT INTO data_programs (id, app_id, name, title, code, owner_email, org_id)
         VALUES ('dp_legacy', 'test-app', 'legacy', 'Legacy', 'emit([])', 'owner@example.com', 'org_1')`,
      );
      const { ensureDataProgramTables, getDataProgram } = await loadStore();
      await ensureDataProgramTables();

      const legacy = await getDataProgram("dp_legacy", "test-app", {
        userEmail: "owner@example.com",
        orgId: "org_1",
      });
      expect(legacy?.scheduledRefresh).toBe(false);
    });

    it("memoizes the init promise (second call is a no-op re-await)", async () => {
      const { ensureDataProgramTables } = await loadStore();
      await ensureDataProgramTables();
      await expect(ensureDataProgramTables()).resolves.toBeUndefined();
    });
  });

  describe("registerDataProgramsShareable", () => {
    it("registers with allowPublic: false and requireOrgMemberForUserShares: true", async () => {
      const { registerDataProgramsShareable } = await loadStore();
      const { getShareableResource } = await import("../sharing/registry.js");
      registerDataProgramsShareable();
      const reg = getShareableResource("data_program");
      expect(reg).toBeDefined();
      expect(reg?.allowPublic).toBe(false);
      expect(reg?.requireOrgMemberForUserShares).toBe(true);
    });
  });

  describe("CRUD", () => {
    const appId = "test-app";
    const owner = "owner@example.com";

    it("creates a new program and reads it back by id", async () => {
      const { ensureDataProgramTables, upsertDataProgram, getDataProgram } =
        await loadStore();
      await ensureDataProgramTables();

      const created = await upsertDataProgram({
        appId,
        name: "risk-cohort",
        title: "Risk Cohort",
        code: "emit([])",
        ownerEmail: owner,
      });
      expect(created.id).toMatch(/^dp_/);
      expect(created.refreshMode).toBe("ttl");
      expect(created.refreshTtlMs).toBe(300_000);

      const fetched = await getDataProgram(created.id, appId, {
        userEmail: owner,
      });
      expect(fetched?.name).toBe("risk-cohort");
      expect(fetched?.title).toBe("Risk Cohort");
      expect(fetched?.appId).toBe(appId);
    });

    it("upserts by (appId, name, ownerEmail) slug when no id is given", async () => {
      const {
        ensureDataProgramTables,
        upsertDataProgram,
        getDataProgramByName,
      } = await loadStore();
      await ensureDataProgramTables();

      const first = await upsertDataProgram({
        appId,
        name: "cohort",
        title: "V1",
        code: "emit([])",
        ownerEmail: owner,
      });
      const second = await upsertDataProgram({
        appId,
        name: "cohort",
        title: "V2",
        code: "emit([{a:1}])",
        ownerEmail: owner,
      });

      expect(second.id).toBe(first.id);
      const byName = await getDataProgramByName(appId, "cohort", owner);
      expect(byName?.title).toBe("V2");
      expect(byName?.code).toBe("emit([{a:1}])");
    });

    it("keeps a scheduled refresh through a save that leaves it out, and lists the app's live scheduled programs", async () => {
      const {
        ensureDataProgramTables,
        upsertDataProgram,
        archiveDataProgram,
        listScheduledDataPrograms,
      } = await loadStore();
      await ensureDataProgramTables();
      const org = {
        ownerEmail: owner,
        orgId: "org_1",
        refreshTtlMs: 3_600_000,
      };

      const scheduled = await upsertDataProgram({
        appId,
        name: "hourly",
        title: "Hourly",
        code: "emit([])",
        scheduledRefresh: true,
        ...org,
      });
      expect(scheduled.scheduledRefresh).toBe(true);
      const resaved = await upsertDataProgram({
        appId,
        name: "hourly",
        title: "Hourly v2",
        code: "emit([{a:1}])",
        ...org,
      });
      expect(resaved.scheduledRefresh).toBe(true);

      await upsertDataProgram({
        appId,
        name: "plain",
        title: "Plain",
        code: "emit([])",
        ...org,
      });
      const archived = await upsertDataProgram({
        appId,
        name: "archived",
        title: "Archived",
        code: "emit([])",
        scheduledRefresh: true,
        ...org,
      });
      await archiveDataProgram(archived.id, appId, {
        userEmail: owner,
        orgId: "org_1",
      });
      await upsertDataProgram({
        appId: "other-app",
        name: "elsewhere",
        title: "Elsewhere",
        code: "emit([])",
        scheduledRefresh: true,
        ...org,
      });

      const listed = await listScheduledDataPrograms(appId);
      expect(listed.map((p) => p.id)).toEqual([scheduled.id]);
      await expect(
        listScheduledDataPrograms(appId, scheduled.id),
      ).resolves.toEqual([expect.objectContaining({ title: "Hourly v2" })]);
      await expect(
        listScheduledDataPrograms(appId, archived.id),
      ).resolves.toEqual([]);

      const off = await upsertDataProgram({
        appId,
        name: "hourly",
        title: "Hourly v2",
        code: "emit([{a:1}])",
        scheduledRefresh: false,
        ...org,
      });
      expect(off.scheduledRefresh).toBe(false);
      await expect(listScheduledDataPrograms(appId)).resolves.toEqual([]);
    });

    it("refuses a scheduled refresh it couldn't share with an org", async () => {
      const { ensureDataProgramTables, upsertDataProgram } = await loadStore();
      await ensureDataProgramTables();
      const base = {
        appId,
        title: "Scheduled",
        code: "emit([])",
        ownerEmail: owner,
        refreshTtlMs: 3_600_000,
        scheduledRefresh: true,
      };

      await expect(
        upsertDataProgram({ ...base, name: "no-org" }),
      ).rejects.toThrow(/needs an organization/);
      await expect(
        upsertDataProgram({
          ...base,
          name: "every-five-minutes",
          orgId: "org_1",
          refreshTtlMs: 5 * 60_000,
        }),
      ).rejects.toThrow(/at least 15 minutes/);
      await expect(
        upsertDataProgram({
          ...base,
          name: "manual",
          orgId: "org_1",
          refreshMode: "manual",
        }),
      ).rejects.toThrow(/refreshMode "ttl"/);
      await expect(
        upsertDataProgram({
          ...base,
          name: "background",
          orgId: "org_1",
          background: true,
        }),
      ).rejects.toThrow(/Background programs/);

      const existing = await upsertDataProgram({
        ...base,
        name: "later-manual",
        orgId: "org_1",
      });
      await expect(
        upsertDataProgram({
          appId,
          name: "later-manual",
          title: "Scheduled",
          code: "emit([])",
          ownerEmail: owner,
          orgId: "org_1",
          refreshMode: "manual",
        }),
      ).rejects.toThrow(/refreshMode "ttl"/);
      expect(existing.scheduledRefresh).toBe(true);

      const collector = {
        appId,
        name: "collector",
        title: "Collector",
        code: "emit([])",
        ownerEmail: owner,
        orgId: "org_1",
        refreshTtlMs: 3_600_000,
      };
      await upsertDataProgram({ ...collector, background: true });
      await expect(
        upsertDataProgram({ ...collector, scheduledRefresh: true }),
      ).rejects.toThrow(/background: false/);
      const foreground = await upsertDataProgram({
        ...collector,
        background: false,
        scheduledRefresh: true,
      });
      expect(foreground).toMatchObject({
        background: false,
        scheduledRefresh: true,
      });
    });

    it("keeps updatedAt when a save changes nothing", async () => {
      const { ensureDataProgramTables, upsertDataProgram } = await loadStore();
      await ensureDataProgramTables();
      const input = {
        appId,
        name: "seeded",
        title: "Seeded",
        code: "emit([])",
        ownerEmail: owner,
        background: true,
      };
      const first = await upsertDataProgram(input);
      await new Promise((resolve) => setTimeout(resolve, 5));

      const same = await upsertDataProgram(input);
      expect(same.updatedAt).toBe(first.updatedAt);

      const edited = await upsertDataProgram({
        ...input,
        code: "emit([{a:1}])",
      });
      expect(edited.updatedAt).not.toBe(first.updatedAt);
    });

    it("floors refreshTtlMs at MIN_REFRESH_TTL_MS", async () => {
      const { ensureDataProgramTables, upsertDataProgram, MIN_REFRESH_TTL_MS } =
        await loadStore();
      await ensureDataProgramTables();
      const row = await upsertDataProgram({
        appId,
        name: "fast",
        title: "Fast",
        code: "emit([])",
        ownerEmail: owner,
        refreshTtlMs: 1,
      });
      expect(row.refreshTtlMs).toBe(MIN_REFRESH_TTL_MS);
    });

    it("scopes listDataPrograms by appId and the sharing access filter", async () => {
      const { ensureDataProgramTables, upsertDataProgram, listDataPrograms } =
        await loadStore();
      await ensureDataProgramTables();

      await upsertDataProgram({
        appId,
        name: "mine",
        title: "Mine",
        code: "emit([])",
        ownerEmail: owner,
      });
      await upsertDataProgram({
        appId,
        name: "theirs",
        title: "Theirs",
        code: "emit([])",
        ownerEmail: "someone-else@example.com",
      });
      await upsertDataProgram({
        appId: "other-app",
        name: "mine",
        title: "Other app",
        code: "emit([])",
        ownerEmail: owner,
      });

      const mine = await listDataPrograms(appId, { userEmail: owner });
      expect(mine.map((p) => p.name)).toEqual(["mine"]);
    });

    it("does not read or archive another owner's program", async () => {
      const {
        ensureDataProgramTables,
        upsertDataProgram,
        getDataProgram,
        archiveDataProgram,
      } = await loadStore();
      await ensureDataProgramTables();
      const row = await upsertDataProgram({
        appId,
        name: "private-program",
        title: "Private program",
        code: "emit([])",
        ownerEmail: owner,
      });

      await expect(
        getDataProgram(row.id, appId, { userEmail: "other@example.com" }),
      ).resolves.toBeNull();
      await expect(
        archiveDataProgram(row.id, appId, {
          userEmail: "other@example.com",
        }),
      ).resolves.toBe(false);
      await expect(
        getDataProgram(row.id, appId, { userEmail: owner }),
      ).resolves.toMatchObject({ archivedAt: null });
    });

    it("excludes archived programs from listDataPrograms by default", async () => {
      const {
        ensureDataProgramTables,
        upsertDataProgram,
        listDataPrograms,
        archiveDataProgram,
      } = await loadStore();
      await ensureDataProgramTables();

      const row = await upsertDataProgram({
        appId,
        name: "temp",
        title: "Temp",
        code: "emit([])",
        ownerEmail: owner,
      });
      await archiveDataProgram(row.id, appId, { userEmail: owner });

      const active = await listDataPrograms(appId, { userEmail: owner });
      expect(active).toEqual([]);

      const withArchived = await listDataPrograms(
        appId,
        { userEmail: owner },
        { includeArchived: true },
      );
      expect(withArchived).toHaveLength(1);
      expect(withArchived[0].archivedAt).not.toBeNull();
    });

    it("archiveDataProgram soft-deletes (row remains readable by id)", async () => {
      const {
        ensureDataProgramTables,
        upsertDataProgram,
        archiveDataProgram,
        getDataProgram,
      } = await loadStore();
      await ensureDataProgramTables();

      const row = await upsertDataProgram({
        appId,
        name: "soft-delete-me",
        title: "Soft delete me",
        code: "emit([])",
        ownerEmail: owner,
      });
      const archived = await archiveDataProgram(row.id, appId, {
        userEmail: owner,
      });
      expect(archived).toBe(true);

      const still = await getDataProgram(row.id, appId, { userEmail: owner });
      expect(still).not.toBeNull();
      expect(still?.archivedAt).not.toBeNull();
    });

    it("archiveDataProgram returns false for an unknown id", async () => {
      const { ensureDataProgramTables, archiveDataProgram } = await loadStore();
      await ensureDataProgramTables();
      expect(
        await archiveDataProgram("dp_does_not_exist", appId, {
          userEmail: owner,
        }),
      ).toBe(false);
    });

    it("archiveDataProgram scopes deletes by appId when provided", async () => {
      const {
        ensureDataProgramTables,
        upsertDataProgram,
        archiveDataProgram,
        getDataProgram,
      } = await loadStore();
      await ensureDataProgramTables();

      const row = await upsertDataProgram({
        appId,
        name: "app-scoped-delete",
        title: "App-scoped delete",
        code: "emit([])",
        ownerEmail: owner,
      });

      await expect(
        archiveDataProgram(row.id, "other-app", { userEmail: owner }),
      ).resolves.toBe(false);
      await expect(
        getDataProgram(row.id, appId, { userEmail: owner }),
      ).resolves.toMatchObject({
        archivedAt: null,
      });

      await expect(
        archiveDataProgram(row.id, appId, { userEmail: owner }),
      ).resolves.toBe(true);
      await expect(
        getDataProgram(row.id, appId, { userEmail: owner }),
      ).resolves.toMatchObject({
        appId,
        archivedAt: expect.any(String),
      });
    });

    it("enforces MAX_ACTIVE_PROGRAMS_PER_APP on create (not on update)", async () => {
      const { ensureDataProgramTables, upsertDataProgram } = await loadStore();
      await ensureDataProgramTables();

      const row = await upsertDataProgram({
        appId,
        name: "only-one",
        title: "Only one",
        code: "emit([])",
        ownerEmail: owner,
      });
      await expect(
        upsertDataProgram({
          id: row.id,
          appId,
          name: "only-one",
          title: "Only one v2",
          code: "emit([])",
          ownerEmail: owner,
        }),
      ).resolves.toMatchObject({ title: "Only one v2" });
    });
  });

  describe("run cache", () => {
    const programId = "dp_test123";

    it("records a run and reads it back as the latest run", async () => {
      const { ensureDataProgramTables, recordDataProgramRun, getLatestRun } =
        await loadStore();
      await ensureDataProgramTables();

      await recordDataProgramRun({
        programId,
        paramsHash: "hash1",
        paramsJson: "{}",
        status: "succeeded",
        rowsJson: JSON.stringify([{ a: 1 }]),
        schemaJson: JSON.stringify([{ name: "a", type: "number" }]),
        truncated: true,
        rowCount: 1,
        byteSize: 20,
        triggeredBy: "agent",
        finishedAt: Date.now(),
      });

      const latest = await getLatestRun(programId, "hash1");
      expect(latest?.status).toBe("succeeded");
      expect(latest?.rowCount).toBe(1);
      expect(latest?.truncated).toBe(true);
    });

    it("lets only the first onlyIfActive update finish a queued run", async () => {
      const {
        ensureDataProgramTables,
        recordDataProgramRun,
        updateDataProgramRun,
        getLatestRun,
      } = await loadStore();
      await ensureDataProgramTables();
      const run = await recordDataProgramRun({
        programId,
        paramsHash: "race",
        paramsJson: "{}",
        status: "queued",
        executionId: "exec_1",
        triggeredBy: "panel_view",
      });

      const first = await updateDataProgramRun(run.id, {
        status: "succeeded",
        rowsJson: JSON.stringify([{ a: 1 }]),
        onlyIfActive: true,
      });
      const second = await updateDataProgramRun(run.id, {
        status: "failed",
        errorCode: "emit_missing",
        onlyIfActive: true,
      });

      expect(first).toBe(true);
      expect(second).toBe(false);
      const latest = await getLatestRun(programId, "race");
      expect(latest?.status).toBe("succeeded");
      expect(latest?.errorCode).toBeNull();
    });

    it("getLatestSuccessfulRun ignores failed runs", async () => {
      const {
        ensureDataProgramTables,
        recordDataProgramRun,
        getLatestSuccessfulRun,
      } = await loadStore();
      await ensureDataProgramTables();

      await recordDataProgramRun({
        programId,
        paramsHash: "hash2",
        paramsJson: "{}",
        status: "failed",
        errorCode: "sandbox_error",
        errorMessage: "boom",
        triggeredBy: "agent",
        finishedAt: Date.now(),
      });

      expect(await getLatestSuccessfulRun(programId, "hash2")).toBeNull();

      await recordDataProgramRun({
        programId,
        paramsHash: "hash2",
        paramsJson: "{}",
        status: "succeeded",
        rowsJson: JSON.stringify([{ a: 1 }]),
        rowCount: 1,
        triggeredBy: "agent",
        finishedAt: Date.now() + 1,
      });

      const success = await getLatestSuccessfulRun(programId, "hash2");
      expect(success?.status).toBe("succeeded");
    });

    it("prunes to keep only the N most recent runs per (programId, paramsHash)", async () => {
      const { ensureDataProgramTables, recordDataProgramRun } =
        await loadStore();
      await ensureDataProgramTables();

      for (let i = 0; i < 8; i += 1) {
        await recordDataProgramRun({
          programId,
          paramsHash: "prune-hash",
          paramsJson: "{}",
          status: "succeeded",
          rowsJson: JSON.stringify([{ i }]),
          rowCount: 1,
          triggeredBy: "agent",
          startedAt: 1000 + i,
          finishedAt: 1000 + i,
          keep: 5,
        });
      }

      const { rows } = await sharedClient.execute({
        sql: `SELECT COUNT(*) as total FROM data_program_runs WHERE program_id = ? AND params_hash = ?`,
        args: [programId, "prune-hash"],
      });
      expect(Number((rows[0] as any).total)).toBe(5);
    });

    it("updateDataProgramRun finalizes a running row and re-prunes", async () => {
      const {
        ensureDataProgramTables,
        recordDataProgramRun,
        updateDataProgramRun,
        getLatestRun,
      } = await loadStore();
      await ensureDataProgramTables();

      const running = await recordDataProgramRun({
        programId,
        paramsHash: "update-hash",
        paramsJson: "{}",
        status: "running",
        triggeredBy: "agent",
      });

      await updateDataProgramRun(running.id, {
        status: "succeeded",
        rowsJson: JSON.stringify([{ ok: true }]),
        truncated: true,
        rowCount: 1,
        finishedAt: Date.now(),
      });

      const latest = await getLatestRun(programId, "update-hash");
      expect(latest?.status).toBe("succeeded");
      expect(latest?.rowCount).toBe(1);
      expect(latest?.truncated).toBe(true);
    });

    it("getLatestFinishedRunOutcome reads the newest finished run without its rows", async () => {
      const {
        ensureDataProgramTables,
        recordDataProgramRun,
        getLatestFinishedRunOutcome,
      } = await loadStore();
      await ensureDataProgramTables();
      const now = Date.now();

      await recordDataProgramRun({
        programId,
        paramsHash: "outcome-hash",
        paramsJson: "{}",
        status: "succeeded",
        rowsJson: JSON.stringify([{ a: 1 }]),
        rowCount: 1,
        triggeredBy: "agent",
        startedAt: now - 3_000,
        finishedAt: now - 2_900,
      });
      await recordDataProgramRun({
        programId,
        paramsHash: "outcome-hash",
        paramsJson: "{}",
        status: "failed",
        errorCode: "program_error",
        errorMessage: "boom",
        triggeredBy: "agent",
        startedAt: now - 2_000,
        finishedAt: now - 1_900,
      });
      await recordDataProgramRun({
        programId,
        paramsHash: "outcome-hash",
        paramsJson: "{}",
        status: "queued",
        triggeredBy: "agent",
        startedAt: now - 1_000,
      });

      expect(
        await getLatestFinishedRunOutcome(programId, "outcome-hash"),
      ).toEqual({
        status: "failed",
        errorCode: "program_error",
        errorMessage: "boom",
        startedAt: now - 2_000,
        finishedAt: now - 1_900,
      });
      expect(
        await getLatestFinishedRunOutcome(programId, "no-runs-hash"),
      ).toBeNull();
    });

    it("getLatestSharedRunRefusal skips the schedule's own failures", async () => {
      const {
        ensureDataProgramTables,
        recordDataProgramRun,
        getLatestSharedRunRefusal,
      } = await loadStore();
      await ensureDataProgramTables();
      const now = Date.now();

      await recordDataProgramRun({
        programId,
        paramsHash: "refusal-hash",
        paramsJson: "{}",
        status: "failed",
        errorCode: "shared_run_failed",
        triggeredBy: "panel_view",
        startedAt: now - 3_000,
        finishedAt: now - 2_900,
      });
      for (const [errorCode, startedAt] of [
        ["schedule_timed_out", now - 2_000],
        ["schedule_owner_unverified", now - 1_000],
      ] as const) {
        await recordDataProgramRun({
          programId,
          paramsHash: "refusal-hash",
          paramsJson: "{}",
          status: "failed",
          errorCode,
          triggeredBy: "schedule",
          startedAt,
          finishedAt: startedAt + 100,
        });
      }

      expect(
        await getLatestSharedRunRefusal(programId, now - 10_000),
      ).toMatchObject({
        errorCode: "shared_run_failed",
        startedAt: now - 3_000,
      });
    });

    it("getActiveRun finds queued/running rows but not succeeded/failed ones", async () => {
      const { ensureDataProgramTables, recordDataProgramRun, getActiveRun } =
        await loadStore();
      await ensureDataProgramTables();

      await recordDataProgramRun({
        programId,
        paramsHash: "active-hash",
        paramsJson: "{}",
        status: "running",
        triggeredBy: "agent",
      });

      const active = await getActiveRun(programId, "active-hash");
      expect(active?.status).toBe("running");

      await recordDataProgramRun({
        programId,
        paramsHash: "inactive-hash",
        paramsJson: "{}",
        status: "succeeded",
        rowsJson: "[]",
        triggeredBy: "agent",
        finishedAt: Date.now(),
      });
      expect(await getActiveRun(programId, "inactive-hash")).toBeNull();
    });
  });
});
