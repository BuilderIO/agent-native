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
  }, 30_000);

  it("holds the process open for the post-boot run but not for a retry wait", async () => {
    resetMaintenanceMemo();
    blocksRepair.mockClear();
    blocksRepair.mockRejectedValueOnce(new Error("repair exploded"));
    const liveTimers = () =>
      process.getActiveResourcesInfo().filter((type) => type === "Timeout")
        .length;
    let timersAtFailure = -1;
    let timersWhileRetryWaits = -1;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {
      timersAtFailure = liveTimers();
      queueMicrotask(() => {
        timersWhileRetryWaits = liveTimers();
      });
    });

    try {
      const { scheduleStartupMaintenance } =
        await import("./startup-maintenance.js");
      const timersBefore = liveTimers();
      const maintenance = scheduleStartupMaintenance();
      expect(liveTimers()).toBe(timersBefore + 1);
      await maintenance;

      expect(blocksRepair).toHaveBeenCalledTimes(2);
      expect(timersAtFailure).toBeGreaterThanOrEqual(0);
      expect(timersWhileRetryWaits).toBe(timersAtFailure);
    } finally {
      errorSpy.mockRestore();
      blocksRepair.mockReset();
    }
  }, 30_000);
});
