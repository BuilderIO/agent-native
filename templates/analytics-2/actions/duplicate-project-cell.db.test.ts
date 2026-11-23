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
import duplicateProjectCell from "./duplicate-project-cell.js";

const round = mkdtempSync(join(tmpdir(), "duplicate-cell-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "dup-cell@example.test";
const orgId = `qa-dup-cell-${randomUUID()}`;
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
      userName: "QA duplicate cell",
      isSyntheticTraffic: true,
    },
    call,
  );
}

const markdown = (text: string) => ({
  kind: "markdown" as const,
  markdown: text,
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
});

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_dup_cell_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA duplicate cell",
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
    owned.startsWith(temporary + "/duplicate-cell-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

describe("duplicate-project-cell", () => {
  it("keeps the Dataframes source and allocates distinct result names for SQL copies", async () => {
    const project = await createProject({
      ownerEmail: owner,
      orgId,
      title: "SQL copy",
      cells: ["dataframe_3", "DATAFRAME_4"].map((resultVariable) => ({
        kind: "sql",
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
        source: "select * from base",
        dataConnectionId: null,
        connectionMode: "dataframes",
        databaseSchema: null,
        resultVariable,
        outputResult: true,
      })),
    });
    const original = project.cells.at(0);
    if (!original) throw new Error("SQL cell missing");
    const duplicate = () =>
      asActor(() =>
        duplicateProjectCell.run(
          { projectId: project.id, cellId: original.id },
          context,
        ),
      );
    const result = await duplicate();
    expect(result.project.cells[0]?.contents).toMatchObject({
      resultVariable: "dataframe_3",
    });
    expect(result.project.cells[1]?.contents).toMatchObject({
      dataConnectionId: null,
      connectionMode: "dataframes",
      source: "select * from base",
      resultVariable: "dataframe_5",
    });
    const repeated = await duplicate();
    expect(repeated.project.cells[1]?.contents).toMatchObject({
      resultVariable: "dataframe_6",
    });
  });
  it("places an independent copy directly after its source cell", async () => {
    const scope = { ownerEmail: owner, orgId };
    const project = await createProject({
      ...scope,
      title: "QA duplicate cell",
      cells: [markdown("one"), markdown("two"), markdown("three")],
    });
    const second = project.cells[1];
    if (second == null) throw new Error("fixture cell missing");

    const result = await asActor(() =>
      duplicateProjectCell.run(
        { projectId: project.id, cellId: second.id },
        context,
      ),
    );

    const texts = result.project.cells.map((cell) =>
      cell.contents.kind === "markdown"
        ? (cell.contents as { markdown: string }).markdown
        : "",
    );
    expect(texts).toEqual(["one", "two", "two", "three"]);
    const sourceIndex = result.project.cells.findIndex(
      (cell) => cell.id === second.id,
    );
    const copy = result.project.cells[sourceIndex + 1];
    expect(copy?.id).not.toBe(second.id);
    expect(copy?.id).not.toBe("");
    const ids = result.project.cells.map((cell) => cell.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
