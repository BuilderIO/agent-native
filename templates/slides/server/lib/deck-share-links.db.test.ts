import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec, sql } from "@agent-native/core/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `deck-share-links-${process.pid}-${Date.now()}.pglite`,
);

let findLiveDeckShareLink: typeof import("./deck-share-links.js").findLiveDeckShareLink;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  findLiveDeckShareLink = (await import("./deck-share-links.js"))
    .findLiveDeckShareLink;
  await getDbExec().execute(`CREATE TABLE decks (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, data TEXT NOT NULL,
    owner_email TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'private'
  )`);
  await getDbExec().execute(`CREATE TABLE deck_share_links (
    token TEXT PRIMARY KEY, deck_id TEXT, title TEXT NOT NULL,
    slides TEXT NOT NULL, aspect_ratio TEXT, design_system_data TEXT,
    created_at TEXT NOT NULL
  )`);
}, 120000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("findLiveDeckShareLink", () => {
  it("serves a snapshot only while its deck exists and is public", async () => {
    const createdAt = new Date().toISOString();
    const exec = getDbExec();
    await exec.execute(sql`INSERT INTO decks (id, title, data, owner_email, visibility)
      VALUES ('deck-public', 'Deck', '{}', 'owner@example.test', 'public'),
             ('deck-private', 'Deck', '{}', 'owner@example.test', 'private')`);
    await exec.execute(sql`INSERT INTO deck_share_links (token, deck_id, title, slides, created_at)
      VALUES ('tok-public', 'deck-public', 'Deck', '[]', ${sql.value(createdAt)}),
             ('tok-private', 'deck-private', 'Deck', '[]', ${sql.value(createdAt)}),
             ('tok-deleted', 'deck-gone', 'Deck', '[]', ${sql.value(createdAt)}),
             ('tok-legacy', NULL, 'Deck', '[]', ${sql.value(createdAt)})`);

    expect(await findLiveDeckShareLink("tok-public")).toMatchObject({
      token: "tok-public",
    });
    expect(await findLiveDeckShareLink("tok-private")).toBeNull();
    expect(await findLiveDeckShareLink("tok-deleted")).toBeNull();
    expect(await findLiveDeckShareLink("tok-legacy")).toBeNull();
  });
});
