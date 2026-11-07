import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertSessionReportSharingChange } from "./session-report-sharing";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const report = { orgId: "org-1", recordingId: "rec-1" };
const toOrg = { kind: "visibility", visibility: "org" } as const;
const grant = { kind: "grant" } as const;

describe("session report sharing", () => {
  type Client = Awaited<ReturnType<typeof PGlite.create>>;
  let client: Client;
  let db: Parameters<typeof assertSessionReportSharingChange>[0];

  beforeEach(async () => {
    client = await PGlite.create();
    await client.exec(
      "CREATE TABLE session_recordings (id TEXT PRIMARY KEY, org_id TEXT, visibility TEXT NOT NULL)",
    );
    db = drizzle(client) as unknown as typeof db;
  });

  afterEach(async () => {
    await client.close();
  });

  async function recording(orgId: string | null, visibility: string) {
    await client.query(
      "INSERT INTO session_recordings (id, org_id, visibility) VALUES ('rec-1', $1, $2)",
      [orgId, visibility],
    );
  }

  it("shares a report whose recording the whole organization can open", async () => {
    await recording("org-1", "org");

    await expect(
      assertSessionReportSharingChange(db, report, grant),
    ).resolves.toBeUndefined();
    await expect(
      assertSessionReportSharingChange(db, report, toOrg),
    ).resolves.toBeUndefined();
  });

  it("refuses to share a report on a private recording", async () => {
    await recording("org-1", "private");

    await expect(
      assertSessionReportSharingChange(db, report, grant),
    ).rejects.toThrow("open to the whole organization");
    await expect(
      assertSessionReportSharingChange(db, report, toOrg),
    ).rejects.toThrow("open to the whole organization");
  });

  it("refuses to share a report on another organization's recording", async () => {
    await recording("org-2", "org");

    await expect(
      assertSessionReportSharingChange(db, report, grant),
    ).rejects.toThrow("open to the whole organization");
  });

  it("refuses to share a report whose recording is gone", async () => {
    await expect(
      assertSessionReportSharingChange(db, report, grant),
    ).rejects.toThrow("open to the whole organization");
  });

  it("always lets a report go private", async () => {
    await expect(
      assertSessionReportSharingChange(db, report, {
        kind: "visibility",
        visibility: "private",
      }),
    ).resolves.toBeUndefined();
  });
});
