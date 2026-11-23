import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { ORG_MIGRATIONS } from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  read: vi.fn(),
  readTab: vi.fn(),
}));
vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/application-state")
  >()),
  readAppState: state.read,
  readAppStateForCurrentTab: state.readTab,
}));

import viewScreen from "../../actions/view-screen.js";
import type { CellDraft } from "../../app/lib/model/contracts.js";
import { getDb } from "../db/index.js";
import { ensureAnalyticsDatabase } from "../model/database.js";
import { createProject, updateProject } from "../model/projects-store.js";
import {
  RECENT_QUERY_SOURCE_PREVIEW_LIMIT,
  RECENT_QUERY_SQL_CELL_LIMIT,
} from "./recent-query-project.js";

const SQL_DRAFT_BASE = {
  hidden: false,
  gridX: 0,
  gridY: 0,
  gridWidth: 6,
  gridHeight: 2,
  kind: "sql" as const,
  dataConnectionId: null,
  databaseSchema: null,
  resultVariable: "data",
  outputResult: true,
};

function sqlCellDraft(source: string, label: string | null = null): CellDraft {
  return {
    ...SQL_DRAFT_BASE,
    label,
    source,
  };
}

let directory: string | undefined;

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "analytics-recent-query-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(directory, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  await runMigrations(
    ORG_MIGRATIONS.map((entry) =>
      entry.name === undefined
        ? { version: entry.version, sql: entry.sql }
        : { version: entry.version, name: entry.name, sql: entry.sql },
    ),
    { table: "test_org_migrations" },
  )(undefined);
  await ensureAnalyticsDatabase();
  await getDb().execute(
    sql`INSERT INTO organizations (id,name,created_by,created_at) VALUES ('org-1','Workspace','owner@example.test',1), ('org-2','Other Org','owner@example.test',1)`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES
      ('m1','org-1','owner@example.test','owner',1),
      ('m2','org-1','member@example.test','member',1),
      ('m3','org-1','empty@example.test','member',1),
      ('m4','org-1','bounded@example.test','member',1),
      ('m5','org-2','owner@example.test','owner',1)`,
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  state.readTab.mockResolvedValue(null);
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
});

const asActor = <T>(
  userEmail: string,
  orgId: string,
  fn: () => T | Promise<T>,
) => runWithRequestContext({ userEmail, orgId }, fn);

it("report K-ANA-4-1: view-screen on /home/data includes the newest editable SQL notebook over newer empty, archived, trashed, unlisted, or other-workspace projects", async () => {
  const olderSql = await asActor("owner@example.test", "org-1", () =>
    createProject({
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      title: "Earlier SQL",
      at: "2026-11-20T10:00:00.000Z",
      cells: [sqlCellDraft("SELECT 1", "Earlier")],
    }),
  );
  expect(olderSql.id).toBeTruthy();

  const ordersNotebook = await asActor("owner@example.test", "org-1", () =>
    createProject({
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      title: "Orders by month — demo",
      at: "2026-11-20T11:00:00.000Z",
      cells: [
        sqlCellDraft("SELECT * FROM orders LIMIT 100", "Orders"),
        {
          kind: "text",
          label: "Notes",
          text: "Summary",
          hidden: false,
          gridX: 0,
          gridY: 2,
          gridWidth: 6,
          gridHeight: 1,
        },
      ],
    }),
  );
  const expectedCell = ordersNotebook.cells.find(
    (cell) => cell.contents.kind === "sql",
  );
  if (!expectedCell) throw new Error("Missing SQL cell fixture");

  // Newer empty project (exact K-ANA-4-1 workspace clutter like "Untitled project (45)")
  await asActor("owner@example.test", "org-1", () =>
    createProject({
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      title: "Untitled project (45)",
      at: "2026-11-20T12:00:00.000Z",
    }),
  );

  // Newer unlisted Ask backing notebook
  await asActor("owner@example.test", "org-1", () =>
    createProject({
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      title: "Ask private notebook",
      at: "2026-11-20T12:05:00.000Z",
      listed: false,
      cells: [sqlCellDraft("SELECT * FROM private_ask")],
    }),
  );

  // Newer archived SQL project
  const archived = await asActor("owner@example.test", "org-1", () =>
    createProject({
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      title: "Archived SQL",
      at: "2026-11-20T12:10:00.000Z",
      cells: [sqlCellDraft("SELECT * FROM archived_orders")],
    }),
  );
  await asActor("owner@example.test", "org-1", () =>
    updateProject({
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      projectId: archived.id,
      archived: true,
    }),
  );

  // Newer trashed SQL project
  const trashed = await asActor("owner@example.test", "org-1", () =>
    createProject({
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      title: "Trashed SQL",
      at: "2026-11-20T12:15:00.000Z",
      cells: [sqlCellDraft("SELECT * FROM trashed_orders")],
    }),
  );
  await asActor("owner@example.test", "org-1", () =>
    updateProject({
      ownerEmail: "owner@example.test",
      orgId: "org-1",
      projectId: trashed.id,
      trashed: true,
    }),
  );

  // Newer SQL project owned by another member in org-1
  await asActor("member@example.test", "org-1", () =>
    createProject({
      ownerEmail: "member@example.test",
      orgId: "org-1",
      title: "Member SQL",
      at: "2026-11-20T12:20:00.000Z",
      cells: [sqlCellDraft("SELECT * FROM member_orders")],
    }),
  );

  // Newer SQL project in another org
  await asActor("owner@example.test", "org-2", () =>
    createProject({
      ownerEmail: "owner@example.test",
      orgId: "org-2",
      title: "Other Org SQL",
      at: "2026-11-20T12:25:00.000Z",
      cells: [sqlCellDraft("SELECT * FROM org2_orders")],
    }),
  );

  state.read.mockResolvedValue({
    view: "home/data/all/data-connection/builtin-sample-data",
    path: "/analytics-2/home/data/all/data-connection/builtin-sample-data",
    resourceKind: "data-connection",
    resourceId: "builtin-sample-data",
  });

  const screen = await asActor("owner@example.test", "org-1", () =>
    viewScreen.run({}, { caller: "webmcp" }),
  );
  expect(screen).toMatchObject({
    navigation: {
      view: "home/data/all/data-connection/builtin-sample-data",
      resourceKind: "data-connection",
      resourceId: "builtin-sample-data",
    },
    recentQueryProject: {
      id: ordersNotebook.id,
      title: "Orders by month — demo",
      updatedAt: ordersNotebook.updatedAt,
      sqlCells: [
        {
          id: expectedCell.id,
          label: "Orders",
          sourcePreview: "SELECT * FROM orders LIMIT 100",
        },
      ],
    },
  });

  // Member in org-1 sees only their own SQL notebook, never owner's
  const memberScreen = await asActor("member@example.test", "org-1", () =>
    viewScreen.run({}, { caller: "webmcp" }),
  );
  expect(memberScreen).toMatchObject({
    recentQueryProject: {
      title: "Member SQL",
    },
  });

  // Project view omits recentQueryProject so open-project screen payload stays unchanged
  state.read.mockResolvedValue({
    view: `project/${ordersNotebook.id}/latest`,
    resourceKind: "project",
    resourceId: ordersNotebook.id,
  });
  const projectScreen = await asActor("owner@example.test", "org-1", () =>
    viewScreen.run({}, { caller: "webmcp" }),
  );
  expect(projectScreen).not.toHaveProperty("recentQueryProject");

  // Published app view omits recentQueryProject
  state.read.mockResolvedValue({
    view: `app/${ordersNotebook.id}/latest`,
    resourceKind: "project",
    resourceId: ordersNotebook.id,
  });
  const appScreen = await asActor("owner@example.test", "org-1", () =>
    viewScreen.run({}, { caller: "webmcp" }),
  );
  expect(appScreen).not.toHaveProperty("recentQueryProject");
});

it("report K-ANA-4-1: view-screen omits recentQueryProject when the member has no SQL notebook", async () => {
  await asActor("empty@example.test", "org-1", () =>
    createProject({
      ownerEmail: "empty@example.test",
      orgId: "org-1",
      title: "Empty notebook",
      at: "2026-11-20T12:00:00.000Z",
    }),
  );

  state.read.mockResolvedValue({
    view: "home/data/all/data-connection/builtin-sample-data",
    path: "/analytics-2/home/data/all/data-connection/builtin-sample-data",
    resourceKind: "data-connection",
    resourceId: "builtin-sample-data",
  });

  const screen = await asActor("empty@example.test", "org-1", () =>
    viewScreen.run({}, { caller: "webmcp" }),
  );
  expect(screen).toEqual({
    navigation: {
      view: "home/data/all/data-connection/builtin-sample-data",
      path: "/analytics-2/home/data/all/data-connection/builtin-sample-data",
      resourceKind: "data-connection",
      resourceId: "builtin-sample-data",
    },
  });
});

it("report K-ANA-4-1: bounds recentQueryProject SQL cell count and code-point preview length", async () => {
  const longEmojiSql = `SELECT '${"😀".repeat(RECENT_QUERY_SOURCE_PREVIEW_LIMIT + 20)}'`;
  await asActor("bounded@example.test", "org-1", () =>
    createProject({
      ownerEmail: "bounded@example.test",
      orgId: "org-1",
      title: "Many queries",
      at: "2026-11-20T13:00:00.000Z",
      cells: Array.from({ length: RECENT_QUERY_SQL_CELL_LIMIT + 3 }, (_, i) =>
        sqlCellDraft(i === 0 ? longEmojiSql : `SELECT ${i}`, `Cell ${i}`),
      ),
    }),
  );

  state.read.mockResolvedValue({
    view: "home",
    path: "/analytics-2/home",
  });

  const screen = await asActor("bounded@example.test", "org-1", () =>
    viewScreen.run({}, { caller: "webmcp" }),
  );
  expect(screen).toMatchObject({
    recentQueryProject: {
      title: "Many queries",
    },
  });
  if (typeof screen === "string" || !screen.recentQueryProject) {
    throw new Error("Expected recentQueryProject");
  }
  expect(screen.recentQueryProject.sqlCells).toHaveLength(
    RECENT_QUERY_SQL_CELL_LIMIT,
  );
  expect(screen.recentQueryProject.sqlCells[0]?.label).toBe("Cell 0");
  const preview = screen.recentQueryProject.sqlCells[0]?.sourcePreview ?? "";
  expect(Array.from(preview)).toHaveLength(RECENT_QUERY_SOURCE_PREVIEW_LIMIT);
  expect(Buffer.from(preview, "utf8").toString("utf8")).toBe(preview);
});
