import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_APP_LENGTH,
  MAX_EVENT_NAME_LENGTH,
  MAX_PATH_LENGTH,
  MAX_USER_KEY_LENGTH,
  boundedText,
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
    tenant_key TEXT NOT NULL,
    event_date TEXT NOT NULL,
    event_name TEXT NOT NULL,
    app TEXT NOT NULL,
    template TEXT NOT NULL
  );
  CREATE UNIQUE INDEX analytics_event_daily_rollups_key_idx
    ON analytics_event_daily_rollups
    (tenant_key, event_date, event_name, app, template);
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
    await client.query(
      `INSERT INTO analytics_event_daily_rollups
         (tenant_key, event_date, event_name, app, template)
       VALUES ($1, '2026-10-02', $2, $3, $3)`,
      [`user:${OWNER}`, text.eventName, text.app],
    );
  }

  it("fits the widest bounded values in every index", async () => {
    await expect(
      insert({
        eventName: boundedText(WIDEST, MAX_EVENT_NAME_LENGTH),
        app: boundedText(WIDEST, MAX_APP_LENGTH),
        path: boundedText(WIDEST, MAX_PATH_LENGTH),
        userKey: boundedText(WIDEST, MAX_USER_KEY_LENGTH),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects an unbounded value, which is why ingest bounds them", async () => {
    await expect(
      insert({ eventName: "pageview", app: WIDEST, path: "/", userKey: "u" }),
    ).rejects.toThrow(/index row/);
  });
});
