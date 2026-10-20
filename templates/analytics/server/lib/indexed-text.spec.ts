import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_APP_LENGTH,
  MAX_EVENT_NAME_LENGTH,
  MAX_PATH_LENGTH,
  MAX_USER_KEY_LENGTH,
  boundedIdentity,
  boundedText,
  indexedRowId,
} from "./indexed-text.js";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

// The widest caller-text indexes from plugins/db.ts.
const INDEXES = `
  CREATE TABLE analytics_events (
    org_id TEXT,
    owner_email TEXT NOT NULL,
    event_name TEXT NOT NULL,
    event_date TEXT NOT NULL,
    path TEXT,
    user_key TEXT,
    template TEXT
  );
  CREATE INDEX analytics_events_org_path_event_idx
    ON analytics_events (org_id, path, event_name);
  CREATE INDEX analytics_events_org_date_user_idx
    ON analytics_events (org_id, event_date, user_key);
  CREATE INDEX analytics_events_owner_event_name_date_idx
    ON analytics_events (owner_email, event_name, event_date)
    WHERE org_id IS NULL;
  CREATE TABLE analytics_event_daily_rollups (
    id TEXT PRIMARY KEY,
    tenant_key TEXT NOT NULL,
    event_date TEXT NOT NULL,
    event_name TEXT NOT NULL,
    app TEXT NOT NULL,
    template TEXT NOT NULL
  );
  CREATE UNIQUE INDEX analytics_event_daily_rollups_key_idx
    ON analytics_event_daily_rollups
    (tenant_key, event_date, event_name, app, template);
  CREATE TABLE analytics_user_days (
    id TEXT PRIMARY KEY,
    tenant_key TEXT NOT NULL,
    event_date TEXT NOT NULL,
    user_key TEXT NOT NULL
  );
  CREATE UNIQUE INDEX analytics_user_days_key_idx
    ON analytics_user_days (tenant_key, event_date, user_key);
`;

// Three UTF-8 bytes per code unit, the most any bounded value can take, and
// varied so Postgres cannot compress the index entry under its limit.
let seed = 1;
const WIDEST = Array.from({ length: 4096 }, () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return String.fromCharCode(0x4e00 + (seed % 20_000));
}).join("");
const ORG_ID = "org_".padEnd(64, "x");
const OWNER = `${"o".repeat(64)}@${"d".repeat(185)}.com`;

describe("boundedText", () => {
  it("trims, cuts, and never ends on half of a surrogate pair", () => {
    expect(boundedText("  pageview  ", 200)).toBe("pageview");
    expect(boundedText(`${"a".repeat(199)}\u{1F600}`, 200)).toBe(
      "a".repeat(199),
    );
    expect(boundedText(null, 200)).toBe("");
  });
});

describe("boundedIdentity", () => {
  it("keeps distinct long values distinct and short values unchanged", () => {
    const shared = "u".repeat(300);
    const first = boundedIdentity(`${shared}-first`, 256);
    const second = boundedIdentity(`${shared}-second`, 256);
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(256);
    expect(boundedIdentity(`${shared}-first`, 256)).toBe(first);
    expect(boundedIdentity("  user-1  ", 256)).toBe("user-1");
  });
});

describe("indexedRowId", () => {
  it("keeps short ids readable and hashes long ones", () => {
    expect(indexedRowId("aud", ["user:a@b.co", "2026-10-02", "u 1"])).toBe(
      "aud_user%3Aa%40b.co|2026-10-02|u%201",
    );
    const long = indexedRowId("aedr", [WIDEST.slice(0, 200)]);
    expect(long).toMatch(/^aedr_h_[0-9a-f]{64}$/);
  });
});

describe("indexed text limits on Postgres", () => {
  let client: PGliteClient;

  beforeEach(async () => {
    client = await PGlite.create("memory://");
    await client.exec(INDEXES);
  });

  afterEach(async () => {
    await client.close();
  });

  async function insert(text: {
    eventName: string;
    app: string;
    path: string;
    userKey: string;
  }) {
    for (const orgId of [ORG_ID, null]) {
      await client.query(
        `INSERT INTO analytics_events
           (org_id, owner_email, event_name, event_date, path, user_key, template)
         VALUES ($1, $2, $3, '2026-10-02', $4, $5, $6)`,
        [orgId, OWNER, text.eventName, text.path, text.userKey, text.app],
      );
    }
    const tenantKey = `user:${OWNER}`;
    await client.query(
      `INSERT INTO analytics_event_daily_rollups
         (id, tenant_key, event_date, event_name, app, template)
       VALUES ($1, $2, '2026-10-02', $3, $4, $4)`,
      [
        indexedRowId("aedr", [
          tenantKey,
          "2026-10-02",
          text.eventName,
          text.app,
          text.app,
        ]),
        tenantKey,
        text.eventName,
        text.app,
      ],
    );
    await client.query(
      `INSERT INTO analytics_user_days (id, tenant_key, event_date, user_key)
       VALUES ($1, $2, '2026-10-02', $3)`,
      [
        indexedRowId("aud", [tenantKey, "2026-10-02", text.userKey]),
        tenantKey,
        text.userKey,
      ],
    );
  }

  it("fits the widest bounded values in every index", async () => {
    await expect(
      insert({
        eventName: boundedText(WIDEST, MAX_EVENT_NAME_LENGTH),
        app: boundedText(WIDEST, MAX_APP_LENGTH),
        path: boundedText(WIDEST, MAX_PATH_LENGTH),
        userKey: boundedIdentity(WIDEST, MAX_USER_KEY_LENGTH),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects characters ingest strips from every string", async () => {
    await expect(
      insert({ eventName: "a\u0000b", app: "clips", path: "/", userKey: "u" }),
    ).rejects.toThrow(/0x00/);
    for (const [note, error] of [
      ["a\u0000b", /unsupported Unicode escape/],
      ["x\uD83D", /invalid input syntax for type json/],
    ] as const) {
      await expect(
        client.query("SELECT $1::jsonb ->> 'note' AS note", [
          JSON.stringify({ note }),
        ]),
      ).rejects.toThrow(error);
    }
  });

  it("rejects an unbounded value, which is why ingest bounds them", async () => {
    await expect(
      insert({ eventName: "pageview", app: WIDEST, path: "/", userKey: "u" }),
    ).rejects.toThrow(/index row/);
  });
});
