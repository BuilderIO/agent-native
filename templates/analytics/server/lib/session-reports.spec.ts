import { createRequire } from "node:module";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  resolveAccess: vi.fn(),
  assertAccess: vi.fn(),
  verifyToken: vi.fn(),
  getSummary: vi.fn(),
  openableIds: vi.fn(),
  getErrorIssue: vi.fn(),
  createGrant: vi.fn(),
  buildSessionContext: vi.fn(),
  isOrgMember: vi.fn(),
}));

vi.mock("../db/index.js", async () => ({
  getDb: mocks.getDb,
  schema: await vi.importActual("../db/schema.js"),
}));
vi.mock("@agent-native/core/sharing", () => ({
  accessFilter: vi.fn(),
  assertAccess: mocks.assertAccess,
  resolveAccess: mocks.resolveAccess,
}));
vi.mock("@agent-native/core/org", () => ({ isOrgMember: mocks.isOrgMember }));
vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  recordChange: vi.fn(),
  verifyScopedAgentAccessToken: mocks.verifyToken,
}));
vi.mock("./session-replay.js", () => ({
  getSessionReplaySummary: mocks.getSummary,
  openableSessionRecordingIds: mocks.openableIds,
}));
vi.mock("./error-capture.js", () => ({ getErrorIssue: mocks.getErrorIssue }));
vi.mock("./session-replay-agent-context.js", async () => ({
  replayBuild: (
    await vi.importActual<typeof import("./session-replay-agent-context.js")>(
      "./session-replay-agent-context.js",
    )
  ).replayBuild,
  createSessionReplayAgentGrant: mocks.createGrant,
  buildSessionReplayAgentContext: mocks.buildSessionContext,
}));
vi.mock("./sessions-triage-lab.js", () => ({
  assertSessionsTriageLabEnabled: vi.fn(),
}));

import {
  buildSessionReportAgentContext,
  createSessionReport,
  deleteSessionReport,
  getSessionReport,
  listSessionReports,
  updateSessionReport,
} from "./session-reports";

const COMMIT = "a".repeat(40);
const maker = { userEmail: "maker@example.test", orgId: "org-1" };
const peer = { userEmail: "peer@example.test", orgId: "org-1" };
const input = {
  recordingId: "rec-1",
  title: "Deck stayed empty after the upload failed",
  summary: "The upload returned 503, then the run failed.",
  keyMoments: [{ atMs: 82_000, label: "Upload failed" }],
  reproSteps: ["Pick a model with no key", "Upload a file"],
};

function notFound(): Error {
  return Object.assign(new Error("Session recording not found"), {
    statusCode: 404,
  });
}

describe("session reports", () => {
  type Client = Awaited<ReturnType<typeof PGlite.create>>;
  let client: Client;

  beforeEach(async () => {
    client = await PGlite.create();
    await client.exec(`
      CREATE TABLE session_reports (
        id TEXT PRIMARY KEY, recording_id TEXT NOT NULL, title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '', key_moments TEXT NOT NULL DEFAULT '[]',
        repro_steps TEXT NOT NULL DEFAULT '[]', error_issue_id TEXT, build TEXT,
        from_ms INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        owner_email TEXT NOT NULL, org_id TEXT, visibility TEXT NOT NULL DEFAULT 'private'
      );
      CREATE TABLE session_report_shares (
        id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, principal_type TEXT NOT NULL,
        principal_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer',
        created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT '',
        notified_at TEXT
      );
      CREATE TABLE openable_recordings (id TEXT PRIMARY KEY);
    `);
    mocks.getDb.mockReturnValue(drizzle(client));
    mocks.getSummary.mockResolvedValue({
      id: "rec-1",
      orgId: "org-1",
      visibility: "org",
      metadata: { commit_sha: COMMIT },
    });
    mocks.openableIds.mockReturnValue(
      sql`(SELECT id FROM openable_recordings)`,
    );
    mocks.isOrgMember.mockResolvedValue(true);
    mocks.resolveAccess.mockImplementation(async (_type, id) => {
      const { rows } = await client.query(
        "SELECT * FROM session_reports WHERE id = $1",
        [id],
      );
      const row = rows[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      return {
        role: "owner",
        resource: {
          id: row.id,
          recordingId: row.recording_id,
          title: row.title,
          summary: row.summary,
          keyMoments: row.key_moments,
          reproSteps: row.repro_steps,
          errorIssueId: row.error_issue_id,
          build: row.build,
          fromMs: row.from_ms,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          ownerEmail: row.owner_email,
          orgId: row.org_id,
          visibility: row.visibility,
        },
      };
    });
    mocks.assertAccess.mockImplementation(async (type, id) => {
      const access = await mocks.resolveAccess(type, id);
      if (!access) throw new Error("Not found");
      return access;
    });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await client.close();
  });

  it("opens a new report to the maker's organization, with the session's commit", async () => {
    const report = await createSessionReport(input, maker);

    expect(report.visibility).toBe("org");
    expect(report.orgId).toBe("org-1");
    expect(report.build).toEqual({ commit: COMMIT });
    await expect(getSessionReport(report.id, maker)).resolves.toMatchObject({
      title: input.title,
      keyMoments: input.keyMoments,
      reproSteps: input.reproSteps,
    });
  });

  it("keeps a report private for someone with no organization", async () => {
    const report = await createSessionReport(input, {
      userEmail: "solo@example.test",
      orgId: null,
    });

    expect(report.visibility).toBe("private");
  });

  it("keeps a report private when its recording is private", async () => {
    mocks.getSummary.mockResolvedValue({
      id: "rec-1",
      orgId: "org-1",
      visibility: "private",
      metadata: {},
    });

    const report = await createSessionReport(input, maker);

    expect(report.visibility).toBe("private");
  });

  it("saves nothing for a recording the maker can't open", async () => {
    mocks.getSummary.mockRejectedValue(notFound());

    await expect(createSessionReport(input, maker)).rejects.toThrow(
      "Session recording not found",
    );
    const { rows } = await client.query("SELECT id FROM session_reports");
    expect(rows).toEqual([]);
  });

  it("refuses an error issue the maker can't read", async () => {
    mocks.getErrorIssue.mockRejectedValue(
      Object.assign(new Error("Error issue not found"), { statusCode: 404 }),
    );

    await expect(
      createSessionReport({ ...input, errorIssueId: "erriss_x" }, maker),
    ).rejects.toThrow("Error issue not found");
  });

  it("fails on a damaged row instead of reading it as an empty report", async () => {
    const report = await createSessionReport(input, maker);
    await client.query(
      "UPDATE session_reports SET key_moments = 'not json' WHERE id = $1",
      [report.id],
    );

    await expect(getSessionReport(report.id, maker)).rejects.toThrow(
      "unreadable key_moments",
    );
  });

  it("hides a report from someone who can't open its recording, but not from its writer", async () => {
    const report = await createSessionReport(input, maker);
    mocks.getSummary.mockRejectedValue(notFound());

    await expect(getSessionReport(report.id, peer)).rejects.toMatchObject({
      message: "Session report not found",
      statusCode: 404,
    });
    await expect(
      updateSessionReport(report.id, { title: "Changed" }, peer),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(getSessionReport(report.id, maker)).resolves.toMatchObject({
      title: input.title,
    });
  });

  it("lists someone else's report only while its recording opens for the reader", async () => {
    const opens = await createSessionReport(input, maker);
    mocks.getSummary.mockResolvedValue({
      id: "rec-2",
      orgId: "org-1",
      visibility: "org",
      metadata: {},
    });
    const closed = await createSessionReport(
      { ...input, recordingId: "rec-2" },
      maker,
    );
    await client.query("INSERT INTO openable_recordings (id) VALUES ('rec-1')");

    const peerList = await listSessionReports({ limit: 10 }, peer);
    const makerList = await listSessionReports({ limit: 10 }, maker);

    expect(peerList.map((report) => report.id)).toEqual([opens.id]);
    expect(makerList.map((report) => report.id).sort()).toEqual(
      [opens.id, closed.id].sort(),
    );
    expect(mocks.openableIds).toHaveBeenCalledWith(peer);
  });

  it("deletes a report and its shares together", async () => {
    const report = await createSessionReport(input, maker);
    await client.query(
      "INSERT INTO session_report_shares (id, resource_id, principal_type, principal_id) VALUES ('s1', $1, 'user', 'peer@example.test')",
      [report.id],
    );
    await client.exec(`
      CREATE FUNCTION refuse_delete() RETURNS trigger LANGUAGE plpgsql
        AS $$ BEGIN RAISE EXCEPTION 'delete refused'; END $$;
      CREATE TRIGGER refuse_report_delete BEFORE DELETE ON session_reports
        FOR EACH ROW EXECUTE FUNCTION refuse_delete();
    `);

    await expect(deleteSessionReport(report.id, maker)).rejects.toThrow();
    const kept = await client.query("SELECT id FROM session_report_shares");
    expect(kept.rows).toHaveLength(1);

    await client.exec("DROP TRIGGER refuse_report_delete ON session_reports");
    await expect(deleteSessionReport(report.id, maker)).resolves.toEqual({
      id: report.id,
      deleted: true,
    });
    const shares = await client.query("SELECT id FROM session_report_shares");
    const reports = await client.query("SELECT id FROM session_reports");
    expect([shares.rows, reports.rows]).toEqual([[], []]);
  });

  describe("agent context", () => {
    it("refuses a link that doesn't verify", async () => {
      const report = await createSessionReport(input, maker);
      mocks.verifyToken.mockReturnValue({ ok: false });

      await expect(
        buildSessionReportAgentContext({ reportId: report.id, token: "t" }),
      ).rejects.toMatchObject({ statusCode: 401 });
    });

    it("ends a link once its maker can no longer open the report", async () => {
      const report = await createSessionReport(input, maker);
      mocks.verifyToken.mockReturnValue({
        ok: true,
        viewerEmail: maker.userEmail,
      });
      mocks.resolveAccess.mockResolvedValue(null);

      await expect(
        buildSessionReportAgentContext({ reportId: report.id, token: "t" }),
      ).rejects.toMatchObject({ statusCode: 401 });
      expect(mocks.resolveAccess).toHaveBeenLastCalledWith(
        "session-report",
        report.id,
        { userEmail: maker.userEmail, orgId: "org-1" },
      );
    });

    it("ends a link once its maker leaves the report's organization", async () => {
      const report = await createSessionReport(input, maker);
      mocks.verifyToken.mockReturnValue({
        ok: true,
        viewerEmail: maker.userEmail,
      });
      mocks.isOrgMember.mockResolvedValue(false);

      await expect(
        buildSessionReportAgentContext({ reportId: report.id, token: "t" }),
      ).rejects.toMatchObject({ statusCode: 401 });
      expect(mocks.isOrgMember).toHaveBeenCalledWith("org-1", maker.userEmail);
      expect(mocks.resolveAccess).not.toHaveBeenCalled();
      expect(mocks.createGrant).not.toHaveBeenCalled();
    });

    it("ends a link whose maker can't open the report's recording", async () => {
      const report = await createSessionReport(input, maker);
      mocks.verifyToken.mockReturnValue({
        ok: true,
        viewerEmail: peer.userEmail,
      });
      mocks.getSummary.mockRejectedValue(notFound());

      await expect(
        buildSessionReportAgentContext({ reportId: report.id, token: "t" }),
      ).rejects.toMatchObject({ statusCode: 401 });
      expect(mocks.getSummary).toHaveBeenLastCalledWith("rec-1", peer);
      expect(mocks.createGrant).not.toHaveBeenCalled();
    });

    it("gives the session's context through a fresh session link", async () => {
      const report = await createSessionReport(input, maker);
      mocks.verifyToken.mockReturnValue({
        ok: true,
        viewerEmail: maker.userEmail,
      });
      mocks.createGrant.mockResolvedValue({ grant: { token: "fresh" } });
      mocks.buildSessionContext.mockResolvedValue({ keyMoments: {} });

      const context = await buildSessionReportAgentContext({
        reportId: report.id,
        token: "t",
      });

      expect(mocks.createGrant).toHaveBeenCalledWith({
        recordingId: "rec-1",
        scope: maker,
      });
      expect(mocks.buildSessionContext).toHaveBeenCalledWith(
        expect.objectContaining({ recordingId: "rec-1", token: "fresh" }),
      );
      expect(context.report.title).toBe(input.title);
      expect(context.session).toEqual({ keyMoments: {} });
      expect(context).not.toHaveProperty("labStateError");
    });

    it("says when the maker's Lab state couldn't be read", async () => {
      const report = await createSessionReport(input, maker);
      mocks.verifyToken.mockReturnValue({
        ok: true,
        viewerEmail: maker.userEmail,
      });
      mocks.createGrant.mockResolvedValue({
        grant: { token: "fresh" },
        labStateError: "Couldn't read the Sessions triage Lab state",
      });
      mocks.buildSessionContext.mockResolvedValue({ recording: {} });

      const context = await buildSessionReportAgentContext({
        reportId: report.id,
        token: "t",
      });

      expect(context).toMatchObject({
        session: { recording: {} },
        labStateError: "Couldn't read the Sessions triage Lab state",
      });
    });

    it("says the session is gone rather than handing back an empty one", async () => {
      const report = await createSessionReport(input, maker);
      mocks.verifyToken.mockReturnValue({
        ok: true,
        viewerEmail: maker.userEmail,
      });
      mocks.createGrant.mockRejectedValue(notFound());

      const context = await buildSessionReportAgentContext({
        reportId: report.id,
        token: "t",
      });

      expect(context).toMatchObject({
        session: null,
        sessionUnavailable: expect.stringMatching(/no longer stored/),
        report: { summary: input.summary },
      });
    });
  });
});
