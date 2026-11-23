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
import {
  canEditProject,
  canManageProject,
  projectAccessLevel,
} from "./project-grant-access.js";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "analytics-shares-"));
vi.stubEnv("DATABASE_URL", `pglite:${path.join(tempDir, "db")}`);
vi.stubEnv("DATABASE_URL_UNPOOLED", "");
vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");

const owner = { ownerEmail: "owner@example.test", orgId: "org-share" };
const viewer = { ownerEmail: "member@example.test", orgId: "org-share" };
const stranger = { ownerEmail: "stranger@example.test", orgId: "org-share" };

beforeAll(async () => {
  await closeDbExec();
  await runAnalyticsMigrations(undefined);
  await ensureAnalyticsDatabase();
  const now = new Date().toISOString();
  await getDb().execute(
    sql`INSERT INTO analytics2_projects
      (id, owner_email, org_id, visibility, title, description, language, working_version_id, created_at, updated_at)
      VALUES ('prj_shared', 'owner@example.test', 'org-share', 'private', 'Shared one', '', 'python', 'prj_shared-v1', ${now}, ${now})`,
  );
});

beforeEach(async () => {
  await getDb().execute(sql`DELETE FROM analytics2_project_shares`);
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

async function grant(
  role: "viewer" | "editor" | "admin",
  principalType: "user" | "group" | "org" = "user",
  principalId = "member@example.test",
) {
  await getDb()
    .insert(schema.projectShares)
    .values({
      id: `shr_${role}_${principalType}`,
      resourceId: "prj_shared",
      principalType,
      principalId,
      role,
      createdBy: "owner@example.test",
      createdAt: new Date().toISOString(),
    });
}

describe("project read access with sharing", () => {
  // oracle-change: sharing is core; ungranted private projects remain inaccessible.
  it("keeps the owner read working and refuses an ungranted member", async () => {
    await expect(
      getReadableProjectRow(owner, "prj_shared"),
    ).resolves.toMatchObject({ id: "prj_shared" });
    await expect(
      getReadableProjectRow(viewer, "prj_shared"),
    ).resolves.toBeNull();
  });

  it("lets the granted member read, and revoking takes it back", async () => {
    await grant("viewer");
    await expect(
      getReadableProjectRow(viewer, "prj_shared"),
    ).resolves.toMatchObject({
      id: "prj_shared",
    });
    // a member with no grant of their own still cannot read it
    await expect(
      getReadableProjectRow(stranger, "prj_shared"),
    ).resolves.toBeNull();
    await getDb().execute(sql`DELETE FROM analytics2_project_shares`);
    await expect(
      getReadableProjectRow(viewer, "prj_shared"),
    ).resolves.toBeNull();
  });

  it("does not let a grant in another workspace open the project", async () => {
    await grant("editor");
    await expect(
      getReadableProjectRow(
        { ownerEmail: "member@example.test", orgId: "org-other" },
        "prj_shared",
      ),
    ).resolves.toBeNull();
  });

  it("hands the write gate an edit level only for an editor or manager grant", async () => {
    const project = {
      id: "prj_shared",
      ownerEmail: "owner@example.test",
      orgId: "org-share",
    };
    await grant("viewer");
    const viewerLevel = await projectAccessLevel(viewer, project);
    expect(viewerLevel).toBe("read");
    expect(canEditProject(viewerLevel)).toBe(false);
    expect(canManageProject(viewerLevel)).toBe(false);

    await getDb().execute(sql`DELETE FROM analytics2_project_shares`);
    await grant("editor");
    const editorLevel = await projectAccessLevel(viewer, project);
    expect(editorLevel).toBe("edit");
    expect(canEditProject(editorLevel)).toBe(true);
    expect(canManageProject(editorLevel)).toBe(false);

    await getDb().execute(sql`DELETE FROM analytics2_project_shares`);
    await grant("admin");
    const managerLevel = await projectAccessLevel(viewer, project);
    expect(managerLevel).toBe("manage");
    expect(canManageProject(managerLevel)).toBe(true);
  });
});
