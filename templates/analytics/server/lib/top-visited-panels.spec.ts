import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

import { interpolateDashboardPanelSql } from "../../app/pages/adhoc/sql-dashboard/interpolate";
import { buildPanel } from "./first-party-metric-catalog";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

async function seedEvents(client: PGliteClient) {
  await client.query(`
    CREATE TABLE analytics_events (
      id text PRIMARY KEY,
      event_name text NOT NULL,
      event_date text NOT NULL,
      timestamp text,
      user_id text,
      user_key text,
      anonymous_id text,
      session_id text,
      app text,
      template text,
      hostname text,
      url text,
      path text,
      properties jsonb NOT NULL DEFAULT '{}'
    )
  `);
  const today = (
    (await client.query("SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d")) as {
      rows: Array<{ d: string }>;
    }
  ).rows[0]!.d;
  const rows: Array<[string, string, string, string, string, string?]> = [
    // [id, event, hostname, url, path, recording_id]
    [
      "old-1",
      "pageview",
      "clips.example.test",
      "https://clips.example.test/share/abc",
      "/share/abc",
    ],
    [
      "new-1",
      "pageview",
      "clips.example.test",
      "https://clips.example.test/share/:shareId",
      "/share/:shareId",
    ],
    [
      "new-2",
      "pageview",
      "clips.example.test",
      "https://clips.example.test/share/:shareId",
      "/share/:shareId",
    ],
    [
      "old-2",
      "share_view",
      "clips.example.test",
      "https://clips.example.test/share/abc",
      "/share/abc",
      "rec-1",
    ],
    [
      "new-3",
      "share_view",
      "clips.example.test",
      "https://clips.example.test/share/:shareId",
      "/share/:shareId",
      "rec-1",
    ],
    [
      "new-4",
      "share_view",
      "clips.example.test",
      "https://clips.example.test/share/:shareId",
      "/share/:shareId",
      "rec-2",
    ],
  ];
  for (const [id, event, hostname, url, path, recordingId] of rows) {
    await client.query(
      "INSERT INTO analytics_events (id, event_name, event_date, timestamp, user_key, hostname, url, path, properties) VALUES ($1, $2, $3, $3, $1, $4, $5, $6, $7)",
      [
        id,
        event,
        today,
        hostname,
        url,
        path,
        JSON.stringify(recordingId ? { recording_id: recordingId } : {}),
      ],
    );
  }
}

async function runPanel(client: PGliteClient, key: string) {
  const panel = buildPanel(key)!;
  const sql = interpolateDashboardPanelSql(
    panel.sql,
    {
      timeRange: "all",
      timeRangeStart: "",
      timeRangeEnd: "",
      emailFilter: "",
      appFilter: "",
    },
    panel,
  );
  return ((await client.query(sql)) as { rows: Array<Record<string, unknown>> })
    .rows;
}

describe("top visited panels with stored raw paths and new route templates", () => {
  let client: PGliteClient;

  afterEach(async () => {
    await client?.close();
  });

  it("links a raw path and shows a route template without a link", async () => {
    client = await PGlite.create("memory://");
    await seedEvents(client);

    const rows = await runPanel(client, "top-visited-urls");

    expect(rows.map((row) => [row.url, Number(row.views), row.href])).toEqual([
      ["https://clips.example.test/share/:shareId", 2, ""],
      [
        "https://clips.example.test/share/abc",
        1,
        "https://clips.example.test/share/abc",
      ],
    ]);
  });

  it("groups clip views by recording and keeps a raw link when one exists", async () => {
    client = await PGlite.create("memory://");
    await seedEvents(client);

    const rows = await runPanel(client, "top-visited-clips");

    expect(rows.map((row) => [row.clip, Number(row.views), row.href])).toEqual([
      [
        "https://clips.example.test/share/abc",
        2,
        "https://clips.example.test/share/abc",
      ],
      ["rec-2", 1, ""],
    ]);
  });
});
