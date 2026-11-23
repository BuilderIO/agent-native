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
import { cellOutputs } from "../server/db/schema.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { createProject } from "../server/model/projects-store.js";
import { writeCellOutput } from "../server/model/runs-store.js";
import clearProjectOutputs from "./clear-project-outputs.js";
import getProject from "./get-project.js";

const round = mkdtempSync(join(tmpdir(), "clear-project-outputs-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "clear-owner@example.test";
const orgId = `qa-clear-${randomUUID()}`;
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
      userName: "QA clear outputs",
      isSyntheticTraffic: true,
    },
    call,
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_clear_outputs_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "QA clear outputs",
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
    owned.startsWith(temporary + "/clear-project-outputs-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

describe("clear-project-outputs", () => {
  it("removes the saved outputs while keeping the cells and their sources", async () => {
    const scope = { ownerEmail: owner, orgId };
    const project = await createProject({
      ...scope,
      title: "QA clear outputs",
      cells: [
        {
          kind: "markdown",
          markdown: "hello",
          label: null,
          hidden: false,
          gridX: null,
          gridY: null,
          gridWidth: null,
          gridHeight: null,
        },
      ],
    });
    const cellId = project.cells[0]!.id;
    await writeCellOutput({
      ...scope,
      projectId: project.id,
      cellId,
      runId: null,
      status: "complete",
      output: { type: "text", text: "result" },
    });
    expect(await getDb().select().from(cellOutputs)).toHaveLength(1);

    const cleared = await asActor(() =>
      clearProjectOutputs.run({ projectId: project.id }, context),
    );
    expect(cleared.project.cells.map((cell) => cell.id)).toEqual([cellId]);
    expect(await getDb().select().from(cellOutputs)).toEqual([]);

    const read = await asActor(() =>
      getProject.run({ projectId: project.id }, context),
    );
    expect(read.outputs[cellId]).toBeUndefined();
    expect(read.project.cells[0]?.contents).toMatchObject({
      kind: "markdown",
      markdown: "hello",
    });
  });
});
