import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import { and, eq } from "@agent-native/core/db/schema";
import {
  ORG_MIGRATIONS,
  appMemberRoles,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "../server/db/index.js";
import { projects, statuses } from "../server/db/schema.js";
import { ensureAnalyticsDatabase } from "../server/model/database.js";
import { createProject } from "../server/model/projects-store.js";
import { createStatus, listStatuses } from "../server/model/statuses-store.js";
import deleteDataStatus from "./delete-data-status.js";

const round = mkdtempSync(join(tmpdir(), "delete-data-status-"));
const previousDatabase = process.env.DATABASE_URL;
const owner = "status-remove-owner@example.test";
const member = "status-remove-member@example.test";
const orgA = `qa-delete-status-a-${randomUUID()}`;

const context = (email = owner) => ({
  caller: "frontend" as const,
  userEmail: email,
  orgId: orgA,
  appId: "analytics-2",
});

function asActor<T>(email: string, call: () => T) {
  return runWithRequestContext(
    {
      userEmail: email,
      orgId: orgA,
      authUserId: email,
      userName: "QA status account",
      isSyntheticTraffic: true,
    },
    call,
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_delete_status_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await getDb()
    .insert(organizations)
    .values([
      {
        id: orgA,
        name: "QA delete status workspace",
        createdBy: owner,
        createdAt: Date.now(),
      },
    ]);
  await getDb()
    .insert(orgMembers)
    .values([
      {
        id: randomUUID(),
        orgId: orgA,
        email: owner,
        role: "owner",
        joinedAt: Date.now(),
      },
      {
        id: randomUUID(),
        orgId: orgA,
        email: member,
        role: "member",
        joinedAt: Date.now(),
      },
    ]);
  await getDb()
    .insert(appMemberRoles)
    .values([
      {
        id: randomUUID(),
        orgId: orgA,
        email: owner,
        appId: "analytics-2",
        role: "owner",
        updatedBy: owner,
        updatedAt: Date.now(),
      },
    ]);
});

beforeEach(async () => {
  await getDb().delete(projects).where(eq(projects.orgId, orgA));
  await getDb().delete(statuses).where(eq(statuses.orgId, orgA));
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
    owned.startsWith(temporary + "/delete-data-status-")
  )
    rmSync(owned, { recursive: true, force: true });
  else throw new Error("Refused cleanup outside this test round");
});

describe("delete data status", () => {
  it("removes the status and clears it from projects that carried it", async () => {
    const status = await createStatus({
      ownerEmail: owner,
      orgId: orgA,
      name: "QA in review",
      color: "#3f6fb5",
    });
    const project = await createProject({
      ownerEmail: owner,
      orgId: orgA,
      title: "QA project",
    });
    // createProject starts without a status, so assign one the way the project
    // update path does, then prove the removal clears it again.
    await getDb()
      .update(projects)
      .set({ statusId: status.id })
      .where(eq(projects.id, project.id));

    const removed = await asActor(owner, () =>
      deleteDataStatus.run({ id: status.id }, context()),
    );
    expect(removed).toEqual({ removedId: status.id });

    const remaining = await listStatuses({ ownerEmail: owner, orgId: orgA });
    expect(remaining.map((entry) => entry.name)).toEqual([]);

    const [row] = await getDb()
      .select({ statusId: projects.statusId })
      .from(projects)
      .where(and(eq(projects.id, project.id), eq(projects.orgId, orgA)));
    // A removed status must not leave a dangling id on a project.
    expect(row?.statusId).toBeNull();
  });

  it("refuses a member who is not a workspace administrator", async () => {
    const status = await createStatus({
      ownerEmail: owner,
      orgId: orgA,
      name: "QA admin only",
      color: "#6b7280",
    });
    await expect(
      asActor(member, () =>
        deleteDataStatus.run({ id: status.id }, context(member)),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    const remaining = await listStatuses({ ownerEmail: owner, orgId: orgA });
    expect(remaining).toHaveLength(1);
  });
});
