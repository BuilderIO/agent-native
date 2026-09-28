import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `list-decks-isolation-${process.pid}-${Date.now()}.pglite`,
);

const ALICE = "alice@org-a.example.com";
const BOB = "bob@org-b.example.com";
const NEWCOMER = "newcomer@org-c.example.com";
const ORG_A = "org-a";
const ORG_B = "org-b";
const ORG_C = "org-c";

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let listDecks: typeof import("./list-decks.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  process.env.APP_URL = "https://slides.agent.test";
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  listDecks = (await import("./list-decks.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL, identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
    role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at INTEGER
  )`);

  await getDb()
    .insert(schema.decks)
    .values([
      {
        id: "deck-a-private",
        title: "Org A private",
        data: JSON.stringify({ slides: [{ id: "s1" }] }),
        ownerEmail: ALICE,
        orgId: ORG_A,
        visibility: "private",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
      {
        id: "deck-b-private",
        title: "Org B private",
        data: JSON.stringify({ slides: [{ id: "s1" }] }),
        ownerEmail: BOB,
        orgId: ORG_B,
        visibility: "private",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      },
      {
        id: "deck-b-org",
        title: "Org B org-visible",
        data: JSON.stringify({ slides: [{ id: "s1" }] }),
        ownerEmail: BOB,
        orgId: ORG_B,
        visibility: "org",
        createdAt: "2026-05-03T00:00:00.000Z",
        updatedAt: "2026-05-03T00:00:00.000Z",
      },
      {
        id: "deck-b-public",
        title: "Org B public-by-link",
        data: JSON.stringify({ slides: [{ id: "s1" }] }),
        ownerEmail: BOB,
        orgId: ORG_B,
        visibility: "public",
        createdAt: "2026-05-04T00:00:00.000Z",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
      {
        id: "deck-b-solo",
        title: "Org B unscoped legacy",
        data: JSON.stringify({ slides: [{ id: "s1" }] }),
        ownerEmail: BOB,
        orgId: null,
        visibility: "private",
        createdAt: "2026-05-05T00:00:00.000Z",
        updatedAt: "2026-05-05T00:00:00.000Z",
      },
    ]);
}, 120000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function idsFor(
  ctx: { userEmail?: string; orgId?: string },
  args: Record<string, unknown> = {},
): Promise<string[]> {
  return runWithRequestContext(ctx, async () => {
    const result: any = await listDecks.run(args as any, {} as any);
    return result.decks.map((deck: any) => deck.id).sort();
  });
}

const BRANCHES: Array<[string, Record<string, unknown>]> = [
  ["default metadata", {}],
  ["light", { light: "true" }],
  ["light + preview", { light: "true", includePreview: "true" }],
  ["includeSlides", { includeSlides: "true" }],
  ["compact", { includeSlides: "false", compact: "true" }],
  ["paged", { limit: 100 }],
  ["updatedSince", { updatedSince: "2020-01-01T00:00:00.000Z" }],
];

describe("list-decks cross-organization isolation", () => {
  it("searches visible titles before applying the page limit", async () => {
    expect(
      await idsFor(
        { userEmail: BOB, orgId: ORG_B },
        { limit: 1, search: "PRIVATE" },
      ),
    ).toEqual(["deck-b-private"]);
    expect(
      await idsFor(
        { userEmail: ALICE, orgId: ORG_A },
        { limit: 1, search: "Org B" },
      ),
    ).toEqual([]);
    expect(
      await idsFor(
        { userEmail: BOB, orgId: ORG_B },
        { limit: 1, search: "%_" },
      ),
    ).toEqual([]);
  });

  it.each(BRANCHES)(
    "never shows another org's decks to a brand-new account (%s)",
    async (_label, args) => {
      expect(await idsFor({ userEmail: NEWCOMER, orgId: ORG_C }, args)).toEqual(
        [],
      );
    },
  );

  it.each(BRANCHES)(
    "scopes the 'All' listing to the caller's own org (%s)",
    async (_label, args) => {
      expect(await idsFor({ userEmail: ALICE, orgId: ORG_A }, args)).toEqual([
        "deck-a-private",
      ]);
    },
  );

  it("does not leak public-by-link decks into another account's listing", async () => {
    const ids = await idsFor({ userEmail: NEWCOMER, orgId: ORG_C });
    expect(ids).not.toContain("deck-b-public");
  });

  it("keeps an unscoped legacy deck with its owner rather than the active org", async () => {
    expect(await idsFor({ userEmail: BOB, orgId: ORG_B })).toEqual([
      "deck-b-org",
      "deck-b-private",
      "deck-b-public",
      "deck-b-solo",
    ]);
    expect(await idsFor({ userEmail: ALICE, orgId: ORG_A })).not.toContain(
      "deck-b-solo",
    );
  });

  it("returns nothing for an unauthenticated caller", async () => {
    expect(await idsFor({})).toEqual([]);
  });

  it("keeps the access filter on the 'Mine' listing", async () => {
    expect(
      await idsFor({ userEmail: NEWCOMER, orgId: ORG_C }, { createdBy: "me" }),
    ).toEqual([]);
    expect(
      await idsFor({ userEmail: ALICE, orgId: ORG_A }, { createdBy: "me" }),
    ).toEqual(["deck-a-private"]);
  });

  it("does not widen the listing when paging through a cursor", async () => {
    await runWithRequestContext(
      { userEmail: NEWCOMER, orgId: ORG_C },
      async () => {
        const first: any = await listDecks.run({ limit: 1 } as any, {} as any);
        expect(first.decks).toEqual([]);
        expect(first.nextCursor).toBeUndefined();
      },
    );
  });

  it("does not fail the light+preview listing when one deck's data isn't valid JSON", async () => {
    await getDb().insert(schema.decks).values({
      id: "deck-a-corrupted",
      title: "Org A corrupted",
      data: "not valid json {{{",
      ownerEmail: ALICE,
      orgId: ORG_A,
      visibility: "private",
      createdAt: "2026-05-06T00:00:00.000Z",
      updatedAt: "2026-05-06T00:00:00.000Z",
    });
    try {
      await runWithRequestContext(
        { userEmail: ALICE, orgId: ORG_A },
        async () => {
          const result: any = await listDecks.run(
            { light: "true", includePreview: "true" } as any,
            {} as any,
          );
          const decks = result.decks as any[];
          expect(decks.map((d) => d.id).sort()).toEqual([
            "deck-a-corrupted",
            "deck-a-private",
          ]);
          const good = decks.find((d) => d.id === "deck-a-private");
          expect(good.previewSlide).toEqual({ id: "s1" });
          const corrupted = decks.find((d) => d.id === "deck-a-corrupted");
          expect(corrupted).not.toHaveProperty("previewSlide");
        },
      );
    } finally {
      await getDb()
        .delete(schema.decks)
        .where(eq(schema.decks.id, "deck-a-corrupted"));
    }
  });
});
