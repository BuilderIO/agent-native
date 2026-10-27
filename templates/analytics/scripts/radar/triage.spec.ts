import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveRadarOrganizationId: vi.fn(),
  resolveRadarFirstPartyBackend: vi.fn(),
  resolveRadarBigQueryEventsTable: vi.fn(),
  runBigQuery: vi.fn(),
  runPostgresQuery: vi.fn(),
}));

vi.mock("./query.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./query.ts")>();
  return { ...actual, ...mocks };
});

import { runTriage } from "./triage.ts";

describe("BigQuery triage metadata parameters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveRadarOrganizationId.mockResolvedValue("org-1");
    mocks.resolveRadarFirstPartyBackend.mockResolvedValue({
      sink: "bigquery",
      table: null,
    });
    mocks.resolveRadarBigQueryEventsTable.mockResolvedValue(
      "`project.analytics.events`",
    );
    mocks.runBigQuery.mockResolvedValue({
      rows: [
        {
          session_id: "session-1",
          app: "clips",
          signup_at: "2026-10-26T12:00:00.000Z",
          prompted: true,
          recording_started: false,
          output_ready: false,
          onboarding_abandoned: false,
        },
      ],
      bytesProcessed: 10,
      cacheHit: false,
    });
    mocks.runPostgresQuery.mockResolvedValue({
      rows: [
        { session_id: "session-1", trouble_labels: "", friction_signals: 0 },
      ],
      bytesProcessed: null,
      cacheHit: false,
    });
  });

  it("passes non-empty selected session rows as a PostgreSQL JSONB value", async () => {
    await runTriage({ date: "2026-10-26" });

    const [sql, params] = mocks.runPostgresQuery.mock.calls[0] as [
      string,
      unknown[],
    ];
    expect(sql).toContain("jsonb_to_recordset($1::jsonb)");
    expect(params[0]).toMatchObject({
      __radarJsonbParameter: true,
      value: [
        {
          session_id: "session-1",
          app: "clips",
          signup_at: "2026-10-26T12:00:00.000Z",
        },
      ],
    });
    expect(params[1]).toBe("org-1");
    expect(params[2]).toBe("2026-10-27T00:00:00.000Z");
  });
});
