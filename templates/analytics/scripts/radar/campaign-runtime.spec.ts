import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveRadarBigQueryEventsTable: vi.fn(),
  resolveRadarCampaignHmacConfig: vi.fn(),
  resolveRadarFirstPartyBackend: vi.fn(),
  runBigQuery: vi.fn(),
  runPostgresQuery: vi.fn(),
}));

vi.mock("./query.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./query.ts")>();
  return { ...actual, ...mocks };
});

import { runCampaignFollowup } from "./campaign.ts";
import { RadarQueryError } from "./query.ts";

describe("campaign follow-up query privacy", () => {
  let directory: string;
  let previousSentFile: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveRadarBigQueryEventsTable.mockResolvedValue(
      "project.analytics.events_raw_query_range",
    );
    mocks.resolveRadarCampaignHmacConfig.mockReturnValue({
      key: "test-hmac-key",
      functionName: "project.private.hmac_email",
    });
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
  });

  afterEach(() => {
    if (previousSentFile === undefined)
      delete process.env.FIRST_TOUCH_RADAR_SENT_FILE;
    else process.env.FIRST_TOUCH_RADAR_SENT_FILE = previousSentFile;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("uses keyed campaign hashes without sending emails or the key to BigQuery", async () => {
    mocks.runBigQuery.mockResolvedValue({
      rows: [
        {
          period: "after_send",
          recipient_app: "clips",
          activity_app: "clips",
          metric: "any_visit",
          recipients: 1,
          recipients_with_activity: 1,
        },
      ],
      bytesProcessed: 10,
      actualBytesProcessed: 10,
      cacheHit: false,
    });

    const result = await runCampaignFollowup("org-1");
    const [sql, options] = mocks.runBigQuery.mock.calls[0] as [
      string,
      {
        fresh: boolean;
        cache: boolean;
        params: Array<{ name: string; value: string }>;
      },
    ];
    const recipientRows = JSON.parse(
      options.params.find((param) => param.name === "recipients_json")?.value ??
        "[]",
    ) as Array<Record<string, string>>;

    expect(sql).toContain("`project.private.hmac_email`");
    expect(sql).not.toContain("recipient@example.test");
    expect(options).toMatchObject({ fresh: true, cache: false });
    expect(options.params.map((param) => param.value).join(" ")).not.toContain(
      "recipient@example.test",
    );
    expect(options.params.map((param) => param.value).join(" ")).not.toContain(
      "test-hmac-key",
    );
    expect(recipientRows).toHaveLength(1);
    expect(recipientRows[0]).toMatchObject({
      email_hash: createHmac("sha256", "test-hmac-key")
        .update("recipient@example.test")
        .digest("hex"),
      sent_at: "2026-10-26T12:00:00.000Z",
      app: "clips",
    });
    expect(mocks.runPostgresQuery).not.toHaveBeenCalled();
    expect(result.rows).toContainEqual(
      expect.objectContaining({
        period: "after_send",
        activity_app: "clips",
        metric: "any_visit",
        recipients_with_activity: 1,
      }),
    );
    expect(JSON.stringify(result)).not.toContain("recipient@example.test");
  });

  it("fails closed when a server-side keyed matcher is not configured", async () => {
    mocks.resolveRadarCampaignHmacConfig.mockImplementation(() => {
      throw new RadarQueryError(
        "Secure BigQuery campaign matching is not configured.",
        1,
      );
    });

    await expect(runCampaignFollowup("org-1")).rejects.toThrow(
      "Secure BigQuery campaign matching is not configured.",
    );
    expect(mocks.runBigQuery).not.toHaveBeenCalled();
  });

  it("runs PostgreSQL campaign matching with uncached recipient parameters", async () => {
    mocks.resolveRadarFirstPartyBackend.mockResolvedValue({
      sink: "postgres",
      table: null,
    });
    mocks.runPostgresQuery.mockResolvedValue({
      rows: [
        {
          period: "after_send",
          recipient_app: "clips",
          activity_app: "clips",
          metric: "any_visit",
          recipients: 1,
          recipients_with_activity: 1,
        },
      ],
      bytesProcessed: null,
      actualBytesProcessed: null,
      cacheHit: false,
    });

    const result = await runCampaignFollowup("org-1");
    const [, params, options] = mocks.runPostgresQuery.mock.calls[0] as [
      string,
      Array<{
        __radarJsonbParameter?: boolean;
        value?: unknown;
      }>,
      { fresh: boolean; cache: boolean },
    ];

    expect(params[0]).toMatchObject({
      __radarJsonbParameter: true,
      value: [
        {
          email: "recipient@example.test",
          sent_at: "2026-10-26T12:00:00.000Z",
          app: "clips",
        },
      ],
    });
    expect(options).toMatchObject({ fresh: true, cache: false });
    expect(mocks.runBigQuery).not.toHaveBeenCalled();
    expect(result.rows).toContainEqual(
      expect.objectContaining({
        period: "after_send",
        activity_app: "clips",
        metric: "any_visit",
        recipients_with_activity: 1,
      }),
    );
  });
});
