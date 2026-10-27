import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveRadarBigQueryEventsTable: vi.fn(),
  resolveRadarFirstPartyBackend: vi.fn(),
  runBigQuery: vi.fn(),
  runPostgresQuery: vi.fn(),
}));

vi.mock("./query.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./query.ts")>();
  return { ...actual, ...mocks };
});

import { runCampaignFollowup } from "./campaign.ts";

describe("campaign follow-up query privacy", () => {
  let directory: string;
  let previousSentFile: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "radar-campaign-test-"));
    const sentFile = path.join(directory, "sent.jsonl");
    fs.writeFileSync(
      sentFile,
      `${JSON.stringify({
        email: "recipient@example.test",
        sent_at: "2026-10-26T12:00:00.000Z",
        app: "clips",
        status: 202,
      })}\n`,
      { mode: 0o600 },
    );
    fs.chmodSync(sentFile, 0o600);
    previousSentFile = process.env.FIRST_TOUCH_RADAR_SENT_FILE;
    process.env.FIRST_TOUCH_RADAR_SENT_FILE = sentFile;
    mocks.resolveRadarFirstPartyBackend.mockResolvedValue({
      sink: "bigquery",
      table: null,
    });
    mocks.resolveRadarBigQueryEventsTable.mockResolvedValue(
      "`project_id.analytics.events_raw_query_range`",
    );
    mocks.runBigQuery.mockResolvedValue({
      rows: [
        {
          period: "after_send",
          recipient_app: "clips",
          activity_app: "clips",
          metric: "campaign_landing",
          recipients_with_activity: "1",
        },
      ],
      bytesProcessed: 10,
      cacheHit: false,
    });
  });

  afterEach(() => {
    if (previousSentFile === undefined)
      delete process.env.FIRST_TOUCH_RADAR_SENT_FILE;
    else process.env.FIRST_TOUCH_RADAR_SENT_FILE = previousSentFile;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("matches BigQuery activity in memory without sending or returning emails", async () => {
    const result = await runCampaignFollowup("org-1");

    const [sql, options] = mocks.runBigQuery.mock.calls[0] as [
      string,
      {
        params: Array<{ name: string; type: string; value: string }>;
        fresh: boolean;
        cache: boolean;
      },
    ];
    expect(sql).toContain("to_hex(sha256(lower(trim(e.identity_email))))");
    const outputSql = sql.slice(
      sql.lastIndexOf("SELECT period, recipient_app"),
    );
    expect(outputSql).not.toContain("identity_email");
    expect(outputSql).not.toMatch(/^SELECT[^\n]*email_hash/im);
    expect(outputSql).toContain(
      "count(DISTINCT email_hash) AS recipients_with_activity",
    );
    expect(options.params).toEqual([
      { name: "start_date", type: "DATE", value: "2026-10-19" },
      {
        name: "end_date",
        type: "DATE",
        value: new Date().toISOString().slice(0, 10),
      },
      { name: "org_id", type: "STRING", value: "org-1" },
      {
        name: "recipients_json",
        type: "STRING",
        value: expect.any(String),
      },
      { name: "observed_at", type: "TIMESTAMP", value: expect.any(String) },
    ]);
    expect(JSON.stringify(options.params)).not.toContain(
      "recipient@example.test",
    );
    const rosterJson = options.params.find(
      (param) => param.name === "recipients_json",
    )?.value;
    expect(typeof rosterJson).toBe("string");
    const roster = JSON.parse(String(rosterJson)) as Array<{
      email_hash: string;
      sent_at: string;
      recipient_app: string;
    }>;
    expect(roster).toHaveLength(1);
    expect(roster[0]).toMatchObject({
      email_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      sent_at: "2026-10-26T12:00:00.000Z",
      recipient_app: "clips",
    });
    expect(rosterJson).not.toContain("recipient@example.test");
    expect(options).toMatchObject({ fresh: true, cache: false });
    expect(mocks.runPostgresQuery).not.toHaveBeenCalled();
    expect(result.sentRecipients).toBe(1);
    expect(result.rows).toContainEqual(
      expect.objectContaining({
        period: "after_send",
        recipient_app: "clips",
        activity_app: "clips",
        metric: "campaign_landing",
        recipients_with_activity: 1,
      }),
    );
    expect(JSON.stringify(result)).not.toContain("recipient@example.test");
  });
});
