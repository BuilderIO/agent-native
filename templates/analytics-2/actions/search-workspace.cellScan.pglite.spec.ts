import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { ORG_MIGRATIONS } from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server/request-context";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { getDb, schema } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { seedLegacyPublishedProject } from "../server/model/legacy-published-fixture.test-support.js";
import { createProject } from "../server/model/projects-store.js";
import * as projectsStore from "../server/model/projects-store.js";
import { runAnalytics2Migrations } from "../server/plugins/db.js";
import searchWorkspace from "./search-workspace.js";

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    listThreads: async () => [],
    getThread: async () => null,
  };
});

vi.mock("../server/model/projects-store.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/model/projects-store.js")>();
  return {
    ...actual,
    getReadableProjectDocument: vi.fn(actual.getReadableProjectDocument),
  };
});

const ORG = "org-scan";
const ME = "me@example.test";
const FILLER = 24;

let tempDir: string | undefined;

const sqlCell = (id: string, source: string) => ({
  id,
  kind: "sql" as const,
  source,
  dataConnectionId: null,
  databaseSchema: null,
  resultVariable: id,
  outputResult: true,
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
});

const markdownCell = (id: string, markdown: string) => ({
  id,
  kind: "markdown" as const,
  markdown,
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
});

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "analytics-scan-"));
  vi.stubEnv("DATABASE_URL", `pglite:${path.join(tempDir, "db")}`);
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");
  await closeDbExec();
  await runMigrations(ORG_MIGRATIONS, { table: "test_org_migrations" })(
    undefined,
  );
  await runAnalytics2Migrations(undefined);
  await ensureAnalyticsDatabase();
  await getDb().execute(
    sql`INSERT INTO organizations (id,name,created_by,created_at) VALUES (${ORG},'Scan fixture',${ME},1)`,
  );
  for (const [id, email] of [
    ["member-me", ME],
    ["member-them", "them@example.test"],
  ] as const) {
    await getDb().execute(
      sql`INSERT INTO org_members (id,org_id,email,role,joined_at) VALUES (${id},${ORG},${email},'member',1)`,
    );
  }
  for (let index = 0; index < FILLER; index += 1) {
    await createProject({
      ownerEmail: ME,
      orgId: ORG,
      projectId: `filler-${index}`,
      title: `Filler notebook ${index}`,
      cells: [sqlCell(`filler-cell-${index}`, `select ${index} as n`)],
    });
  }
  await createProject({
    ownerEmail: ME,
    orgId: ORG,
    projectId: "accented",
    title: "Quarterly plan",
    cells: [markdownCell("accented-md", "# Révenue forecast\nfor next year")],
  });
  await createProject({
    ownerEmail: ME,
    orgId: ORG,
    projectId: "quoted",
    title: "Quoted notes",
    cells: [sqlCell("quoted-sql", `select 'say "hello" now' as greeting`)],
  });
  await createProject({
    ownerEmail: "them@example.test",
    orgId: ORG,
    projectId: "shared-published",
    title: "Shared dashboard",
    cells: [sqlCell("shared-sql", "select 1 as zebra_stripes")],
  });
  await getDb()
    .update(schema.projects)
    .set({ visibility: "org" })
    .where(eq(schema.projects.id, "shared-published"));
  await seedLegacyPublishedProject(
    { orgId: ORG, ownerEmail: "them@example.test" },
    "shared-published",
  );
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

beforeEach(() => {
  vi.mocked(projectsStore.getReadableProjectDocument).mockClear();
});

const search = (text: string) =>
  runWithRequestContext({ orgId: ORG, userEmail: ME }, () =>
    searchWorkspace.run(searchWorkspace.schema.parse({ text }), {} as never),
  ) as Promise<{
    results: Array<{
      kind: string;
      id: string;
      cellMatches?: Array<{ cellId: string; snippet: string }>;
    }>;
  }>;

const projectIds = (results: Array<{ kind: string; id: string }>) =>
  results.filter((row) => row.kind === "project").map((row) => row.id);

it("K-ANA-5-1 hydrates only the projects whose cell text can match", async () => {
  const { results } = await search("revenue");
  expect(projectIds(results)).toEqual(["accented"]);
  expect(results[0]?.cellMatches?.map((cell) => cell.cellId)).toEqual([
    "accented-md",
  ]);
  expect(
    vi.mocked(projectsStore.getReadableProjectDocument).mock.calls.length,
  ).toBeLessThanOrEqual(3);
});

it("K-ANA-5-1 still matches stored text with quotes and accents", async () => {
  expect(projectIds((await search('"hello"')).results)).toEqual(["quoted"]);
  expect(projectIds((await search("révenue")).results)).toEqual(["accented"]);
});

it("K-ANA-5-1 still reads a published project's cells the way a viewer does", async () => {
  const { results } = await search("zebra");
  expect(projectIds(results)).toEqual(["shared-published"]);
});
