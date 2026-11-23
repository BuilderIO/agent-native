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
import { createProject } from "../server/model/projects-store.js";
import { SAMPLE_DATA_SOURCE_ID as BUILTIN_SAMPLE_CONNECTION_ID } from "../shared/sample-data-contract.js";
import getProject from "./get-project.js";
import pasteProjectCell from "./paste-project-cell.js";

const round = mkdtempSync(join(tmpdir(), "paste-cell-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "paste-cell@example.test";
const orgId = `qa-paste-cell-${randomUUID()}`;
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
      userName: "QA paste cell",
      isSyntheticTraffic: true,
    },
    call,
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_paste_cell_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA paste cell",
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
    owned.startsWith(temporary + "/paste-cell-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

const sql = (source: string, resultVariable: string | null) => ({
  kind: "sql" as const,
  label: "Revenue",
  hidden: true,
  gridX: 2,
  gridY: 3,
  gridWidth: 5,
  gridHeight: 4,
  source,
  dataConnectionId: null,
  databaseSchema: null,
  resultVariable,
  outputResult: true,
});

describe("paste-project-cell", () => {
  it("places a copied cell after the named cell with every field kept and a fresh identity", async () => {
    const target = await createProject({
      ownerEmail: owner,
      orgId,
      title: "Paste target",
      cells: [sql("select 1", "orders"), sql("select 2", "other")],
    });
    const first = target.cells.at(0);
    if (!first) throw new Error("cell missing");
    const result = await asActor(() =>
      pasteProjectCell.run(
        {
          projectId: target.id,
          afterCellId: first.id,
          contents: sql("select 9", "orders"),
        },
        context,
      ),
    );
    const cells = result.project.cells;
    expect(cells).toHaveLength(3);
    expect(cells[1]?.id).toBe(result.createdCellId);
    expect(cells[1]?.contents).toMatchObject({
      kind: "sql",
      label: "Revenue",
      hidden: true,
      gridX: 2,
      gridWidth: 5,
      source: "select 9",
    });
    // "orders" already exists in this project, so the pasted result is renamed.
    expect(cells[1]?.contents).not.toMatchObject({ resultVariable: "orders" });
    expect(cells[0]?.id).toBe(first.id);
  });

  it("refuses contents that are not a cell, and an anchor outside the project", async () => {
    const target = await createProject({
      ownerEmail: owner,
      orgId,
      title: "Paste refusal",
      cells: [sql("select 1", "orders")],
    });
    await expect(
      asActor(() =>
        pasteProjectCell.run(
          { projectId: target.id, contents: { kind: "nonsense" } },
          context,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "pasted_cell_invalid" });
    await expect(
      asActor(() =>
        pasteProjectCell.run(
          {
            projectId: target.id,
            afterCellId: "cel_missing",
            contents: sql("select 1", null),
          },
          context,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "cell_not_found" });
  });

  it("refuses a copied SQL cell whose data connection this account cannot use, and adds nothing", async () => {
    const target = await createProject({
      ownerEmail: owner,
      orgId,
      title: "Paste foreign source",
      cells: [sql("select 1", "orders")],
    });
    const before = target.cells.length;
    await expect(
      asActor(() =>
        pasteProjectCell.run(
          {
            projectId: target.id,
            contents: {
              ...sql("select 5", "fresh"),
              dataConnectionId: "conn_foreign_revoked",
            },
          },
          context,
        ),
      ),
    ).rejects.toBeDefined();
    const after = await asActor(() =>
      getProject.run({ projectId: target.id }, context),
    );
    expect(after.project.cells).toHaveLength(before);
    expect(JSON.stringify(after.project.cells)).not.toContain(
      "conn_foreign_revoked",
    );
  });

  it("keeps a permitted non-null source and never carries a saved output or agent proposal", async () => {
    const target = await createProject({
      ownerEmail: owner,
      orgId,
      title: "Paste permitted source",
      cells: [sql("select 1", "orders")],
    });
    const result = await asActor(() =>
      pasteProjectCell.run(
        {
          projectId: target.id,
          contents: {
            ...sql("select 6", "fresh2"),
            dataConnectionId: BUILTIN_SAMPLE_CONNECTION_ID,
            pendingEdit: {
              id: "p1",
              baseSource: "select 6",
              source: "drop table x",
            },
            output: { type: "text", text: "leak" },
          },
        },
        context,
      ),
    );
    const pasted = result.project.cells.find(
      (cell) => cell.id === result.createdCellId,
    );
    expect(pasted?.contents).toMatchObject({
      dataConnectionId: BUILTIN_SAMPLE_CONNECTION_ID,
    });
    expect(JSON.stringify(pasted)).not.toContain("drop table x");
    expect(JSON.stringify(pasted)).not.toContain("leak");
  });
});
