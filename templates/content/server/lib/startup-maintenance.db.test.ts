import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

vi.mock("@agent-native/core/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agent-native/core/db")>();
  return {
    ...actual,
    ensureAdditiveColumns: vi.fn(actual.ensureAdditiveColumns),
  };
});

vi.mock("../../actions/_property-utils.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../actions/_property-utils.js")>();
  return {
    ...actual,
    repairUnseededBlocksFields: vi.fn(actual.repairUnseededBlocksFields),
  };
});

vi.mock("../../actions/_files-system-properties.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../actions/_files-system-properties.js")
    >();
  return {
    ...actual,
    repairFilesSystemPropertyDefinitions: vi.fn(
      actual.repairFilesSystemPropertyDefinitions,
    ),
  };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `startup-maintenance-test-${process.pid}-${Date.now()}.pglite`,
);

type Schema = typeof import("../db/schema.js");
let getDb: () => any;
let schema: Schema;
let blocksRepair: Mock;
let filesRepair: Mock;
let additiveColumns: Mock;

function resetMaintenanceMemo() {
  (
    globalThis as { __contentStartupMaintenance?: unknown }
  ).__contentStartupMaintenance = undefined;
}

const OWNER = "owner@example.com";

async function insertDatabaseRow(args: {
  blocksSeeded: number;
  systemRole?: string;
  filesSystemPropertiesSeeded?: number;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = `db_maint_${Math.random().toString(36).slice(2, 10)}`;
  const documentId = `doc_${id}`;
  await db.insert(schema.documents).values({
    id: documentId,
    ownerEmail: OWNER,
    title: "Untitled",
    content: "body text",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id,
    ownerEmail: OWNER,
    documentId,
    title: "Maintenance DB",
    blocksSeeded: args.blocksSeeded,
    systemRole: args.systemRole ?? null,
    filesSystemPropertiesSeeded: args.filesSystemPropertiesSeeded ?? 0,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  blocksRepair = (await import("../../actions/_property-utils.js"))
    .repairUnseededBlocksFields as Mock;
  filesRepair = (await import("../../actions/_files-system-properties.js"))
    .repairFilesSystemPropertyDefinitions as Mock;
  additiveColumns = (await import("@agent-native/core/db"))
    .ensureAdditiveColumns as Mock;
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as any);
  const { scheduleStartupMaintenance } =
    await import("./startup-maintenance.js");
  await scheduleStartupMaintenance();
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("scheduleStartupMaintenance — lazy post-boot maintenance", () => {
  it("runs both repairs when triggered after boot", async () => {
    resetMaintenanceMemo();
    const db = getDb();
    const legacyDatabaseId = await insertDatabaseRow({ blocksSeeded: 0 });
    const filesDatabaseId = await insertDatabaseRow({
      blocksSeeded: 1,
      systemRole: "files",
      filesSystemPropertiesSeeded: 0,
    });

    const { scheduleStartupMaintenance } =
      await import("./startup-maintenance.js");
    await scheduleStartupMaintenance();

    const [legacy] = await db
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, legacyDatabaseId));
    expect(legacy.blocksSeeded).toBe(1);
    const [primaryDefinition] = await db
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(
        and(
          eq(schema.documentPropertyDefinitions.databaseId, legacyDatabaseId),
          eq(schema.documentPropertyDefinitions.type, "blocks"),
        ),
      );
    expect(primaryDefinition).toBeTruthy();
    expect(legacy.primaryBlocksPropertyId).toBe(primaryDefinition!.id);

    const [files] = await db
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, filesDatabaseId));
    expect(files.filesSystemPropertiesSeeded).toBe(2);

    expect(blocksRepair).toHaveBeenCalled();
    expect(filesRepair).toHaveBeenCalled();
  });

  it("runs at most once per isolate — concurrent triggers join one run", async () => {
    resetMaintenanceMemo();
    blocksRepair.mockClear();
    filesRepair.mockClear();

    const { scheduleStartupMaintenance } =
      await import("./startup-maintenance.js");
    await Promise.all([
      scheduleStartupMaintenance(),
      scheduleStartupMaintenance(),
    ]);

    expect(blocksRepair).toHaveBeenCalledTimes(1);
    expect(filesRepair).toHaveBeenCalledTimes(1);
  });

  it("logs a failed repair loudly and resolves only after the retry completes", async () => {
    resetMaintenanceMemo();
    blocksRepair.mockClear();
    blocksRepair.mockRejectedValueOnce(new Error("repair exploded"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const { scheduleStartupMaintenance } =
        await import("./startup-maintenance.js");
      await scheduleStartupMaintenance();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'startup maintenance "blocks-repair" failed (attempt 1/5)',
        ),
      );
      expect(blocksRepair).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
      blocksRepair.mockReset();
    }
  }, 30_000);

  it("adds back a schema column a migration missed before the repairs read it", async () => {
    resetMaintenanceMemo();
    const filesDatabaseId = await insertDatabaseRow({
      blocksSeeded: 1,
      systemRole: "files",
      filesSystemPropertiesSeeded: 0,
    });
    await getDbExec().execute(
      "ALTER TABLE content_databases DROP COLUMN files_system_properties_seeded",
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const { scheduleStartupMaintenance } =
        await import("./startup-maintenance.js");
      await scheduleStartupMaintenance();

      const [files] = await getDb()
        .select()
        .from(schema.contentDatabases)
        .where(eq(schema.contentDatabases.id, filesDatabaseId));
      expect(files.filesSystemPropertiesSeeded).toBe(2);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("logs and retries the additive-column check when it reports errors", async () => {
    resetMaintenanceMemo();
    blocksRepair.mockClear();
    additiveColumns.mockClear();
    additiveColumns.mockResolvedValueOnce({
      mode: "checked",
      applied: [],
      skipped: [],
      errors: [{ column: "documents.title", error: "permission denied" }],
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const { scheduleStartupMaintenance } =
        await import("./startup-maintenance.js");
      await scheduleStartupMaintenance();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'startup maintenance "additive-columns" failed (attempt 1/5): ensureAdditiveColumns reported 1 error(s): documents.title: permission denied',
        ),
      );
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(additiveColumns).toHaveBeenCalledTimes(2);
      expect(blocksRepair).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("starts each repair only after the step before it, and that step's retry, have finished", async () => {
    resetMaintenanceMemo();
    additiveColumns.mockClear();
    blocksRepair.mockClear();
    filesRepair.mockClear();
    const retry = Promise.withResolvers<void>();
    const blocks = Promise.withResolvers<void>();
    additiveColumns
      .mockRejectedValueOnce(new Error("lock timeout"))
      .mockImplementationOnce(async () => {
        await retry.promise;
        return { mode: "checked", applied: [], skipped: [], errors: [] };
      });
    blocksRepair.mockImplementationOnce(() => blocks.promise);
    filesRepair.mockResolvedValueOnce(undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout"] });

    try {
      const { scheduleStartupMaintenance } =
        await import("./startup-maintenance.js");
      const maintenance = scheduleStartupMaintenance();
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledOnce());

      expect(additiveColumns).toHaveBeenCalledOnce();
      expect(blocksRepair).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2_000);
      await vi.waitFor(() => expect(additiveColumns).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(0);
      expect(blocksRepair).not.toHaveBeenCalled();

      retry.resolve();
      await vi.waitFor(() => expect(blocksRepair).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(0);
      expect(filesRepair).not.toHaveBeenCalled();

      blocks.resolve();
      await maintenance;
      expect(filesRepair).toHaveBeenCalledOnce();
    } finally {
      retry.resolve();
      blocks.resolve();
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
      errorSpy.mockRestore();
      additiveColumns.mockReset();
      blocksRepair.mockReset();
      filesRepair.mockReset();
    }
  });

  it("holds the process open for the post-boot run but not for a retry wait", async () => {
    resetMaintenanceMemo();
    blocksRepair.mockClear();
    blocksRepair
      .mockRejectedValueOnce(new Error("repair exploded"))
      .mockResolvedValueOnce(undefined);
    additiveColumns.mockResolvedValueOnce({
      mode: "checked",
      applied: [],
      skipped: [],
      errors: [],
    });
    filesRepair.mockResolvedValueOnce(undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const timers = vi.spyOn(globalThis, "setTimeout");

    try {
      const { scheduleStartupMaintenance } =
        await import("./startup-maintenance.js");
      const maintenance = scheduleStartupMaintenance();
      const trigger = timers.mock.results[0]?.value as
        | NodeJS.Timeout
        | undefined;
      expect(trigger?.hasRef()).toBe(true);

      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledOnce());
      const retryIndex = timers.mock.calls.findIndex(
        ([, delay]) => delay === 2_000,
      );
      const retry = timers.mock.results[retryIndex]?.value as
        | NodeJS.Timeout
        | undefined;
      expect(retry?.hasRef()).toBe(false);

      await vi.advanceTimersByTimeAsync(2_000);
      await maintenance;
      expect(blocksRepair).toHaveBeenCalledTimes(2);
    } finally {
      timers.mockRestore();
      await vi.runOnlyPendingTimersAsync();
      vi.useRealTimers();
      errorSpy.mockRestore();
      additiveColumns.mockReset();
      blocksRepair.mockReset();
      filesRepair.mockReset();
    }
  });
});
