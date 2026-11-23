import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { getDb, schema } from "../db/index.js";
import { runAnalyticsMigrations } from "../db/migrations.js";
import { ensureAnalyticsDatabase } from "./database.js";
import { getReadableProjectRow } from "./project-access.js";
import { canEditProject, projectAccessLevel } from "./project-grant-access.js";
import {
  hasPendingWorkspaceInvite,
  listPendingWorkspaceInvites,
} from "./pending-workspace-invites.js";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "analytics-invite-"));
vi.stubEnv("DATABASE_URL", `pglite:${path.join(tempDir, "db")}`);
vi.stubEnv("DATABASE_URL_UNPOOLED", "");
vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");

const projectOrg = "org-project";
const inviteeScope = { ownerEmail: "Invitee@Example.test", orgId: "org-own" };
const project = {
  id: "prj_invited",
  ownerEmail: "owner@example.test",
  orgId: projectOrg,
};

beforeAll(async () => {
  await closeDbExec();
  await runAnalyticsMigrations(undefined);
  await ensureAnalyticsDatabase();
  const db = getDb();
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL)`,
  );
  await db.execute(sql`CREATE TABLE IF NOT EXISTS org_invitations (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
    invited_by TEXT NOT NULL, created_at BIGINT NOT NULL, status TEXT NOT NULL)`);
  await db.execute(
    sql`INSERT INTO organizations (id, name) VALUES (${projectOrg}, 'Acme')`,
  );
  const now = new Date().toISOString();
  await db.execute(
    sql`INSERT INTO analytics2_projects
      (id, owner_email, org_id, visibility, title, description, language, working_version_id, created_at, updated_at)
      VALUES ('prj_invited', 'owner@example.test', ${projectOrg}, 'private', 'Invited', '', 'python', 'prj_invited-v1', ${now}, ${now})`,
  );
});

beforeEach(async () => {
  await getDb().execute(sql`DELETE FROM analytics2_project_shares`);
  await getDb().execute(sql`DELETE FROM org_invitations`);
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

async function invite(email: string, status = "pending", orgId = projectOrg) {
  await getDb().execute(
    sql`INSERT INTO org_invitations (id, org_id, email, invited_by, created_at, status)
        VALUES (${`inv_${email}_${status}_${orgId}`}, ${orgId}, ${email}, 'owner@example.test', 1, ${status})`,
  );
}

async function share(
  role: "viewer" | "editor",
  principalId = "invitee@example.test",
) {
  await getDb()
    .insert(schema.projectShares)
    .values({
      id: `shr_${role}_${principalId}`,
      resourceId: "prj_invited",
      principalType: "user",
      principalId,
      role,
      createdBy: "owner@example.test",
      createdAt: new Date().toISOString(),
    });
}

describe("pending workspace invites", () => {
  it("lists only the invitee's own pending invitations, case-insensitively", async () => {
    await invite("invitee@example.test");
    await invite("invitee@example.test", "accepted");
    await invite("someone-else@example.test");
    const rows = await listPendingWorkspaceInvites("Invitee@Example.test");
    expect(rows).toEqual([
      {
        id: "inv_invitee@example.test_pending_org-project",
        orgId: projectOrg,
        orgName: "Acme",
        invitedBy: "owner@example.test",
      },
    ]);
    await expect(listPendingWorkspaceInvites("")).resolves.toEqual([]);
    await expect(
      hasPendingWorkspaceInvite("invitee@example.test", "org-other"),
    ).resolves.toBe(false);
  });
});

describe("project access for a pending invitee", () => {
  it("opens a shared project read-only for a viewer grant", async () => {
    await share("viewer");
    await invite("invitee@example.test");
    const row = await getReadableProjectRow(inviteeScope, "prj_invited");
    expect(row).toMatchObject({ id: "prj_invited" });
    const level = await projectAccessLevel(inviteeScope, project);
    expect(level).toBe("read");
    expect(canEditProject(level)).toBe(false);
  });

  it("gives an editor grant edit rights", async () => {
    await share("editor");
    await invite("invitee@example.test");
    const level = await projectAccessLevel(inviteeScope, project);
    expect(canEditProject(level)).toBe(true);
  });

  it("stays closed without a pending invite, with another org's invite, or without a grant", async () => {
    await share("viewer");
    await expect(
      getReadableProjectRow(inviteeScope, "prj_invited"),
    ).resolves.toBeNull();
    await invite("invitee@example.test", "pending", "org-unrelated");
    await expect(
      getReadableProjectRow(inviteeScope, "prj_invited"),
    ).resolves.toBeNull();
    await getDb().execute(sql`DELETE FROM analytics2_project_shares`);
    await invite("invitee@example.test");
    await expect(
      getReadableProjectRow(inviteeScope, "prj_invited"),
    ).resolves.toBeNull();
  });

  it("does not let an invitation for another address open a grant", async () => {
    await share("viewer");
    await invite("other@example.test");
    await expect(
      getReadableProjectRow(inviteeScope, "prj_invited"),
    ).resolves.toBeNull();
  });
});
