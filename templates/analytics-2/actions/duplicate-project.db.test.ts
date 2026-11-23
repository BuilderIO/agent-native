import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb } from "../server/db/index.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import {
  createProject,
  getProjectDocument,
} from "../server/model/projects-store.js";
import { defaultPivotConfig } from "../shared/pivot-config.js";
import { defaultTableConfig } from "../shared/table-visualization-config.js";
import duplicateProject from "./duplicate-project.js";

const round = mkdtempSync(join(tmpdir(), "duplicate-project-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "duplicate-owner@example.test";
const orgId = `qa-duplicate-${randomUUID()}`;
const context = {
  caller: "frontend" as const,
  userEmail: owner,
  orgId,
  appId: "analytics-2",
};

function asActor<T>(call: () => T) {
  return runWithRequestContext(
    {
      userEmail: owner,
      orgId,
      authUserId: owner,
      userName: "QA duplicate",
      isSyntheticTraffic: true,
    },
    call,
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_duplicate_project_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA duplicate",
    createdBy: owner,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email: owner,
    role: "owner",
    joinedAt: Date.now(),
  });
  await getDb().insert(appMemberRoles).values({
    id: randomUUID(),
    orgId,
    email: owner,
    appId: "analytics-2",
    role: "owner",
    updatedBy: owner,
    updatedAt: Date.now(),
  });
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round),
    temporary = resolve(tmpdir());
  if (
    owned !== temporary &&
    owned !== resolve(process.cwd()) &&
    owned.startsWith(temporary + "/duplicate-project-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

describe("duplicate-project", () => {
  it("creates an independent copy with its own cells and keeps the source", async () => {
    const scope = { ownerEmail: owner, orgId };
    const queryId = randomUUID();
    const binding = { cellId: queryId, exportId: "result" };
    const defaults = {
      label: null,
      hidden: false,
      gridX: null,
      gridY: null,
      gridWidth: null,
      gridHeight: null,
    };
    const source = await createProject({
      ...scope,
      title: "QA source project",
      description: "Kept with the copy",
      cells: [
        {
          ...defaults,
          kind: "markdown",
          markdown: "# Numbers",
        },
        {
          ...defaults,
          id: queryId,
          kind: "sql",
          source: "select 1",
          dataConnectionId: null,
          databaseSchema: null,
          resultVariable: "dataframe",
          outputResult: true,
          label: "Query",
        },
        {
          ...defaults,
          kind: "pivot",
          dataframe: null,
          rows: [],
          columns: [],
          values: [],
          pivotConfig: {
            ...defaultPivotConfig,
            source: binding,
            rows: ["region"],
          },
        },
        {
          ...defaults,
          kind: "display-table",
          dataframe: null,
          columns: [],
          tableConfig: {
            ...defaultTableConfig,
            source: binding,
            sort: { fieldId: "amount", direction: "asc" },
          },
        },
      ],
    });

    const result = await asActor(() =>
      duplicateProject.run({ projectId: source.id }, context),
    );

    expect(result.project.id).not.toBe(source.id);
    expect(result.project.title).toBe("QA source project (copy)");
    expect(result.project.description).toBe("Kept with the copy");
    expect(result.project.cells).toHaveLength(4);
    expect(result.project.cells[0]?.contents).toMatchObject({
      kind: "markdown",
      markdown: "# Numbers",
    });
    const sourceIds = source.cells.map((cell) => cell.id);
    expect(
      result.project.cells.some((cell) => sourceIds.includes(cell.id)),
    ).toBe(false);

    const copied = await getProjectDocument(scope, result.project.id);
    const copiedQueryId = copied?.cells.find(
      ({ contents }) => contents.kind === "sql",
    )?.id;
    expect(copiedQueryId).toEqual(expect.any(String));
    const copiedBinding = { ...binding, cellId: copiedQueryId };
    expect(copied?.cells.map(({ contents }) => contents)).toEqual([
      expect.objectContaining({ kind: "markdown" }),
      expect.objectContaining({ kind: "sql" }),
      expect.objectContaining({
        kind: "pivot",
        pivotConfig: expect.objectContaining({
          source: copiedBinding,
          rows: ["region"],
        }),
      }),
      expect.objectContaining({
        kind: "display-table",
        tableConfig: expect.objectContaining({
          source: copiedBinding,
          sort: { fieldId: "amount", direction: "asc" },
        }),
      }),
    ]);
    const reread = await getProjectDocument(scope, source.id);
    expect(reread?.title).toBe("QA source project");
    expect(reread?.cells).toHaveLength(4);
  });
});
