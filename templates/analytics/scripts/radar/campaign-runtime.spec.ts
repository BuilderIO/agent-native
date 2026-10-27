import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runPostgresQuery: vi.fn() }));

vi.mock("./query.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./query.ts")>();
  return { ...actual, runPostgresQuery: mocks.runPostgresQuery };
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
  });

  afterEach(() => {
    if (previousSentFile === undefined)
      delete process.env.FIRST_TOUCH_RADAR_SENT_FILE;
    else process.env.FIRST_TOUCH_RADAR_SENT_FILE = previousSentFile;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("uses the PostgreSQL event mirror and returns counts without recipient emails", async () => {
    const result = await runCampaignFollowup("org-1");

    const [sql, params, options] = mocks.runPostgresQuery.mock.calls[0] as [
      string,
      unknown[],
      { fresh: boolean; cache: boolean },
    ];
    expect(sql).toContain("jsonb_to_recordset($1::jsonb)");
    expect(params[0]).toBeTypeOf("string");
    expect(JSON.parse(String(params[0]))).toEqual([
      {
        email: "recipient@example.test",
        sent_at: "2026-10-26T12:00:00.000Z",
        app: "clips",
      },
    ]);
    expect(options).toEqual({ fresh: true, cache: false });
    expect(result.sentRecipients).toBe(1);
    expect(JSON.stringify(result)).not.toContain("recipient@example.test");
  });
});
