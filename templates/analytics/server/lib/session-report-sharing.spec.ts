import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", async () => ({
  ...(await vi.importActual<typeof import("../db/index.js")>("../db/index.js")),
  getDb: getDbMock,
}));

import { runWithRequestContext } from "@agent-native/core/server";

import { assertSessionReportSharingChange } from "./session-report-sharing";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const report = { orgId: "org-1", recordingId: "rec-1" };
const toOrg = { kind: "visibility", visibility: "org" } as const;
const grant = { kind: "grant" } as const;
const refusal = "open to the whole organization";

describe("session report sharing", () => {
  type Client = Awaited<ReturnType<typeof PGlite.create>>;
  let client: Client;

  beforeEach(async () => {
    client = await PGlite.create();
    await client.exec(`
      CREATE TABLE session_recordings (
        id TEXT PRIMARY KEY, org_id TEXT, visibility TEXT NOT NULL,
        user_id TEXT, user_key TEXT, anonymous_id TEXT,
        chunk_count INTEGER NOT NULL DEFAULT 0, event_count INTEGER NOT NULL DEFAULT 0
      );
    `);
    getDbMock.mockReturnValue(drizzle(client));
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await client.close();
  });

  async function recording(row: {
    orgId?: string | null;
    visibility?: string;
    userId?: string | null;
    chunkCount?: number;
  }) {
    await client.query(
      "INSERT INTO session_recordings (id, org_id, visibility, user_id, chunk_count, event_count) VALUES ('rec-1', $1, $2, $3, $4, 5)",
      [
        row.orgId === undefined ? "org-1" : row.orgId,
        row.visibility ?? "org",
        row.userId === undefined ? "person@example.test" : row.userId,
        row.chunkCount ?? 1,
      ],
    );
  }

  it("shares a report whose recording the whole organization can open", async () => {
    await recording({});

    await expect(
      assertSessionReportSharingChange(report, grant),
    ).resolves.toBeUndefined();
    await expect(
      assertSessionReportSharingChange(report, toOrg),
    ).resolves.toBeUndefined();
  });

  it("refuses to share a report on a private recording", async () => {
    await recording({ visibility: "private" });

    await expect(
      assertSessionReportSharingChange(report, grant),
    ).rejects.toThrow(refusal);
    await expect(
      assertSessionReportSharingChange(report, toOrg),
    ).rejects.toThrow(refusal);
  });

  it("refuses to share a report on another organization's recording", async () => {
    await recording({ orgId: "org-2" });

    await expect(
      assertSessionReportSharingChange(report, grant),
    ).rejects.toThrow(refusal);
  });

  it("refuses to share a report on a recording Sessions wouldn't open", async () => {
    await recording({ chunkCount: 0 });

    await expect(
      assertSessionReportSharingChange(report, grant),
    ).rejects.toThrow(refusal);
  });

  it("refuses to share a report whose recording is gone", async () => {
    await expect(
      assertSessionReportSharingChange(report, grant),
    ).rejects.toThrow(refusal);
  });

  it("opens a report with no organization to the caller's, by that organization's recording", async () => {
    await recording({});
    const unattached = { orgId: null, recordingId: "rec-1" };

    await runWithRequestContext(
      { userEmail: "maker@example.test", orgId: "org-1" },
      async () => {
        await expect(
          assertSessionReportSharingChange(unattached, toOrg),
        ).resolves.toBeUndefined();
        await expect(
          assertSessionReportSharingChange(unattached, grant),
        ).rejects.toThrow(refusal);
      },
    );
    await runWithRequestContext(
      { userEmail: "maker@example.test", orgId: "org-2" },
      async () => {
        await expect(
          assertSessionReportSharingChange(unattached, toOrg),
        ).rejects.toThrow(refusal);
      },
    );
  });

  it("always lets a report go private", async () => {
    await expect(
      assertSessionReportSharingChange(report, {
        kind: "visibility",
        visibility: "private",
      }),
    ).resolves.toBeUndefined();
  });
});
