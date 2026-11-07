import { createRequire } from "node:module";

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
  getErrorIssue: vi.fn(),
  createGrant: vi.fn(),
  buildSessionContext: vi.fn(),
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
vi.mock("@agent-native/core/server", () => ({
  getRequestOrgId: vi.fn(),
  getRequestUserEmail: vi.fn(),
  recordChange: vi.fn(),
  verifyScopedAgentAccessToken: mocks.verifyToken,
}));
vi.mock("./session-replay.js", () => ({
  getSessionReplaySummary: mocks.getSummary,
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
  getSessionReport,
} from "./session-reports";

const COMMIT = "a".repeat(40);
const maker = { userEmail: "maker@example.test", orgId: "org-1" };
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
    `);
    mocks.getDb.mockReturnValue(drizzle(client));
    mocks.getSummary.mockResolvedValue({
      id: "rec-1",
      metadata: { commit_sha: COMMIT },
    });
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
