import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, expect, it } from "vitest";

import addProjectCell from "../../../actions/add-project-cell.js";
import getProject from "../../../actions/get-project.js";
import saveProjectCell from "../../../actions/save-project-cell.js";
import { getDb } from "../../../server/db/index.js";
import { ensureAnalyticsDatabase } from "../../../server/model/database.js";
import { createProject } from "../../../server/model/projects-store.js";

const dir = mkdtempSync(join(tmpdir(), "funnel-test-"));
const previous = process.env.DATABASE_URL;
const orgId = `funnel-${randomUUID()}`;
const email = "owner@example.test";
const context = {
  caller: "frontend" as const,
  userEmail: email,
  orgId,
  appId: "analytics-2",
};
const actor = <T>(fn: () => T) =>
  runWithRequestContext(
    { userEmail: email, orgId, authUserId: email, isSyntheticTraffic: true },
    fn,
  );
beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(dir, "db")}`;
  await runMigrations(
    ORG_MIGRATIONS.map(({ version, sql, name }) =>
      name === undefined ? { version, sql } : { version, sql, name },
    ),
    {
      table: "funnel_test_org_migrations",
    },
  )(null);
  await ensureAnalyticsDatabase();
  await getDb().insert(organizations).values({
    id: orgId,
    name: "Test",
    createdBy: email,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId,
    email,
    role: "owner",
    joinedAt: Date.now(),
  });
});
afterAll(async () => {
  await closeDbExec();
  if (previous === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous;
  rmSync(dir, { recursive: true, force: true });
});
it("report A2-ASK84-FUNNEL-OUTCOMES persists and reloads outcome bindings through actions", async () => {
  const project = await createProject({
    ownerEmail: email,
    orgId,
    title: "Funnel",
    cells: [],
  });
  const added = await actor(() =>
    addProjectCell.run({ projectId: project.id, kind: "chart" }, context),
  );
  const cell = added.project.cells.find(
    (item) => item.id === added.createdCellId,
  );
  if (!cell || cell.contents.kind !== "chart") throw new Error("Missing chart");
  const contents = cell.contents;
  const funnelOutcomes = {
    completedKey: "done",
    skippedKey: "skip",
    leftKey: "left",
    optionalKey: "optional",
  };
  await actor(() =>
    saveProjectCell.run(
      {
        projectId: project.id,
        cellId: cell.id,
        contents: {
          ...contents,
          chartSpec: {
            ...contents.chartSpec,
            mark: "funnel",
            funnelOutcomes,
          },
        },
      },
      context,
    ),
  );
  const loaded = await actor(() =>
    getProject.run({ projectId: project.id }, context),
  );
  const saved = loaded.project.cells.find((item) => item.id === cell.id);
  expect(saved?.contents).toMatchObject({ chartSpec: { funnelOutcomes } });
});
