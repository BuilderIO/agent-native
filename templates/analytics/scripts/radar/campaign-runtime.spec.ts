import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
  });

  afterEach(() => {
    if (previousSentFile === undefined)
      delete process.env.FIRST_TOUCH_RADAR_SENT_FILE;
    else process.env.FIRST_TOUCH_RADAR_SENT_FILE = previousSentFile;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("fails clearly on BigQuery until secure keyed campaign matching is configured", async () => {
    await expect(runCampaignFollowup("org-1")).rejects.toMatchObject({
      name: "RadarQueryError",
      exitCode: 2,
      message:
        "Campaign follow-up is unavailable for the BigQuery sink until a keyed recipient matching function is configured.",
    });
    expect(mocks.runBigQuery).not.toHaveBeenCalled();
    expect(mocks.runPostgresQuery).not.toHaveBeenCalled();
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
