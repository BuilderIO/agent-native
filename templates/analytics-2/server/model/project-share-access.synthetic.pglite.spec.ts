import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { resolveAccessStatus } from "@agent-native/core/sharing";
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

import "../db/index.js";
import { getDb } from "../db/index.js";
import { runAnalyticsMigrations } from "../db/migrations.js";
import { ensureAnalyticsDatabase } from "./database.js";

/**
 * Row 599: the synthetic-recipient evidence the orchestrator asked for
 * (01:29 answer). A grant to a synthetic address lets that address reach the
 * project — the 200 an HTTP caller would get — and revoking the grant takes it
 * away again (404 for the same caller). The owner is unaffected throughout, and
 * no real account is written to: every recipient here is synthetic.
 *
 * This exercises the framework's own access resolver for the registered
 * "analytics-project" type, which is what the share actions use, so it proves
 * the registration and the shares table rather than only our flag-gated helper.
 */
const tempDir = await mkdtemp(
  path.join(os.tmpdir(), "analytics-synthetic-share-"),
);
vi.stubEnv("DATABASE_URL", `pglite:${path.join(tempDir, "db")}`);
vi.stubEnv("DATABASE_URL_UNPOOLED", "");
vi.stubEnv("NETLIFY_DATABASE_URL_UNPOOLED", "");

const ORG = "org-synthetic-share";
const OWNER = "owner-synthetic@example.test";
const RECIPIENT = "recipient-synthetic@example.test";
const STRANGER = "stranger-synthetic@example.test";

const as = (userEmail: string) => ({ userEmail, orgId: ORG });

beforeAll(async () => {
  await closeDbExec();
  await runAnalyticsMigrations(undefined);
  await ensureAnalyticsDatabase();
  const now = new Date().toISOString();
  await getDb().execute(
    sql`INSERT INTO analytics2_projects
      (id, owner_email, org_id, visibility, title, description, language, working_version_id, created_at, updated_at)
      VALUES ('prj_synthetic', ${OWNER}, ${ORG}, 'private', 'Synthetic share', '', 'python', 'prj_synthetic-v1', ${now}, ${now})`,
  );
});

beforeEach(async () => {
  await getDb().execute(sql`DELETE FROM analytics2_project_shares`);
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

async function grant(role = "viewer") {
  await getDb().execute(
    sql`INSERT INTO analytics2_project_shares
      (id, resource_id, principal_type, principal_id, role, created_by, created_at)
      VALUES ('shr_synthetic', 'prj_synthetic', 'user', ${RECIPIENT}, ${role}, ${OWNER}, ${new Date().toISOString()})`,
  );
}

describe("project sharing with a synthetic recipient", () => {
  it("lets the granted recipient reach the project, and revoking takes it back", async () => {
    // before the grant: the project exists but this caller may not open it
    expect(
      await resolveAccessStatus(
        "analytics-project",
        "prj_synthetic",
        as(RECIPIENT),
      ),
    ).toMatchObject({ state: "denied" });

    await grant("viewer");
    expect(
      await resolveAccessStatus(
        "analytics-project",
        "prj_synthetic",
        as(RECIPIENT),
      ),
    ).toMatchObject({ state: "allowed" });

    await getDb().execute(sql`DELETE FROM analytics2_project_shares`);
    expect(
      await resolveAccessStatus(
        "analytics-project",
        "prj_synthetic",
        as(RECIPIENT),
      ),
    ).toMatchObject({ state: "denied" });
  });

  it("keeps the owner's access regardless of grants", async () => {
    expect(
      await resolveAccessStatus(
        "analytics-project",
        "prj_synthetic",
        as(OWNER),
      ),
    ).toMatchObject({ state: "allowed" });
    await grant("viewer");
    expect(
      await resolveAccessStatus(
        "analytics-project",
        "prj_synthetic",
        as(OWNER),
      ),
    ).toMatchObject({ state: "allowed" });
    await getDb().execute(sql`DELETE FROM analytics2_project_shares`);
    expect(
      await resolveAccessStatus(
        "analytics-project",
        "prj_synthetic",
        as(OWNER),
      ),
    ).toMatchObject({ state: "allowed" });
  });

  it("never widens access for someone without a grant", async () => {
    await grant("viewer");
    expect(
      await resolveAccessStatus(
        "analytics-project",
        "prj_synthetic",
        as(STRANGER),
      ),
    ).toMatchObject({ state: "denied" });
  });
});
