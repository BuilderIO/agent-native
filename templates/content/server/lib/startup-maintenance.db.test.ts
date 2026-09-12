// Behavioral tests for the post-boot maintenance module: the additive-column
// net and the one-time data repairs run lazily from a single memoized,
// per-isolate trigger, log failures loudly, and retry — boot no longer awaits
// any of them. Boots a real PGlite database and runs the actual versioned
// migrations, then drives scheduleStartupMaintenance directly.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

// A unique on-disk PGlite directory in the OS temp dir, removed after the run.
// It is isolated from the process-wide getDbExec singleton other test files share.
const TEST_DB_PATH = join(
  tmpdir(),
  `startup-maintenance-test-${process.pid}-${Date.now()}.pglite`,
);

type Schema = typeof import("../db/schema.js");
let getDb: () => any;
let schema: Schema;
let blocksRepair: Mock;
let filesRepair: Mock;

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
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as any);
  // The plugin scheduled the maintenance fire-and-forget; joining the
  // memoized run here makes the post-boot state deterministic before any
  // fixture rows exist.
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

  it("logs a failed repair loudly and retries it", async () => {
    resetMaintenanceMemo();
    blocksRepair.mockClear();
    blocksRepair.mockRejectedValue(new Error("repair exploded"));
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

      // First retry lands ~2s later; the mock recovers so the run completes.
      blocksRepair.mockImplementation(async () => 0);
      await vi.waitFor(() => expect(blocksRepair).toHaveBeenCalledTimes(2), {
        timeout: 10_000,
        interval: 200,
      });
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
      blocksRepair.mockReset();
    }
  }, 30_000);
});
