import { beforeEach, describe, expect, it, vi } from "vitest";

import { safeRadarEventLabel } from "./event-labels.ts";
import {
  loadUploadRejectionRows,
  safeCampaignLabel,
  uploadRejectionCheck,
} from "./watch.ts";

const queryMocks = vi.hoisted(() => ({
  resolveRadarBigQueryEventsTable: vi.fn(),
  runBigQuery: vi.fn(),
  runPostgresQuery: vi.fn(),
}));

vi.mock("./query.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./query.ts")>();
  return {
    ...actual,
    ...queryMocks,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("campaign label output", () => {
  it("preserves the reviewed outage campaign and redacts arbitrary labels", () => {
    expect(safeCampaignLabel("outage_recovery_20261026")).toBe(
      "outage_recovery_20261026",
    );
    expect(safeCampaignLabel("alice@example.com | private note")).toBe("other");
    expect(safeCampaignLabel("newsletter_alice@example.com")).toBe("other");
  });
});

describe("radar event labels", () => {
  it("redacts unreviewed event names before report output", () => {
    expect(safeRadarEventLabel("signup")).toBe("signup");
    expect(safeRadarEventLabel("alice@example.com | private note")).toBe(
      "unreviewed event",
    );
  });
});

describe("upload rejection evidence routing", () => {
  it("reads rejection events from BigQuery when it is the configured sink", async () => {
    queryMocks.resolveRadarBigQueryEventsTable.mockResolvedValue(
      "`project_id.analytics.events_raw_query_range`",
    );
    queryMocks.runBigQuery.mockResolvedValue({
      rows: [
        {
          app: "clips",
          reason: "storage",
          status: "413",
          rejected_recorders: 2,
          unidentified_rejections: 0,
        },
      ],
    });
    queryMocks.runPostgresQuery.mockResolvedValue({
      rows: [{ app: "clips", recorders: 8 }],
    });

    const rows = await loadUploadRejectionRows(
      { sink: "bigquery", table: "analytics.events" },
      "2026-10-25",
      "org-id",
    );

    expect(queryMocks.runBigQuery).toHaveBeenCalledWith(
      expect.stringContaining("session_replay_upload_rejected"),
      expect.objectContaining({ cache: false, fresh: true }),
    );
    expect(queryMocks.runPostgresQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM session_recordings r"),
      ["2026-10-25", "2026-10-25", "org-id"],
      { fresh: true },
    );
    expect(queryMocks.runPostgresQuery.mock.calls[0]?.[0]).not.toContain(
      "session_replay_upload_rejected",
    );
    expect(rows).toEqual([
      {
        app: "clips",
        reason: "storage",
        status: "413",
        rejected_recorders: 2,
        unidentified_rejections: 0,
        recorders: 8,
      },
    ]);
  });

  it("uses the combined Postgres query for Postgres and dual sinks", async () => {
    queryMocks.runPostgresQuery.mockResolvedValue({
      rows: [{ app: "clips", reason: "storage", recorders: 8 }],
    });

    await loadUploadRejectionRows(
      { sink: "dual", table: null },
      "2026-10-25",
      "org-id",
    );

    expect(queryMocks.runBigQuery).not.toHaveBeenCalled();
    expect(queryMocks.runPostgresQuery).toHaveBeenCalledWith(
      expect.stringContaining("session_replay_upload_rejected"),
      ["2026-10-25", "2026-10-25", "org-id"],
    );
  });

  it("reports rejection rows as unavailable when the recorder denominator is missing", () => {
    expect(
      uploadRejectionCheck({
        app: "clips",
        reason: "storage",
        status: "413",
        rejected_recorders: 2,
        unidentified_rejections: 0,
        recorders: null,
      }),
    ).toMatchObject({
      app: "clips",
      status: "unavailable",
      numerator: 2,
      denominator: null,
    });
  });

  it("reports sessionless rejection events as unavailable", () => {
    expect(
      uploadRejectionCheck({
        app: "clips",
        reason: "storage",
        status: "413",
        rejected_recorders: 0,
        unidentified_rejections: 1,
        recorders: 8,
      }),
    ).toMatchObject({ app: "clips", status: "unavailable" });
  });
});
