import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildTitleSearchIndex,
  rankTitlesByQuery,
} from "../shared/search-title-ranking.js";

// This test shows that for title-tier fixtures, the order the shared
// `rankTitlesByQuery` module (the command search picker's instant lane)
// produces equals the order `search-documents` (the server lane) produces,
// for the tiers both lanes implement: exact, contiguous-prefix, title
// word-prefix, and other title substring coverage. The picker's fuzzy tier is
// browser-only and has no server counterpart to compare against.

const TEST_DB_PATH = join(
  tmpdir(),
  `content-search-title-ranking-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "title-ranking-owner@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let listDocuments: typeof import("./list-documents.js").default;
let searchDocuments: typeof import("./search-documents.js").default;

const asUser = <T>(userEmail: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  listDocuments = (await import("./list-documents.js")).default;
  searchDocuments = (await import("./search-documents.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60_000);

afterAll(async () => {
  await closeDbExec();
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

// Each scenario gets its own parent so fixtures from one `it` block (and the
// `search-documents`/`list-documents` scoping under that parent) can never
// pick up a same-titled document seeded by another scenario.
async function seedTitles(scenario: string, titles: string[]) {
  const now = new Date();
  const parentId = `title-rank-parent-${scenario}`;
  await getDb()
    .insert(schema.documents)
    .values({
      id: parentId,
      ownerEmail: OWNER,
      orgId: null,
      parentId: null,
      title: `Title ranking parent (${scenario})`,
      content: "",
      position: 0,
      visibility: "private",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  const rows = titles.map((title, index) => ({
    id: `title-rank-${scenario}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    ownerEmail: OWNER,
    orgId: null,
    parentId,
    title,
    content: "",
    position: index,
    visibility: "private" as const,
    createdAt: now.toISOString(),
    // Distinct, decreasing updatedAt so a tie in ranking order would be a
    // visible bug rather than an accident of insertion order.
    updatedAt: new Date(now.getTime() - index * 1000).toISOString(),
  }));
  await getDb().insert(schema.documents).values(rows);
  return parentId;
}

async function compareOrders(query: string, parentId: string) {
  const [serverResult, browserCandidates] = await asUser(OWNER, () =>
    Promise.all([
      searchDocuments.run({
        query,
        searchFields: "title",
        parentId,
        limit: 20,
        offset: 0,
      }),
      listDocuments.run({ parentId, limit: 200, offset: 0 }),
    ]),
  );
  const serverOrder = serverResult.documents.map((doc) => doc.id);
  const ranked = rankTitlesByQuery(
    buildTitleSearchIndex(browserCandidates.documents),
    query,
  );
  const browserOrder = ranked
    .map((result) => result.candidate.id)
    .filter((id) => serverOrder.includes(id));
  return { serverOrder, browserOrder };
}

describe("shared title ranking matches search-documents' title tiers", () => {
  it("orders exact, prefix, word-prefix, and substring matches identically for a single term", async () => {
    const parentId = await seedTitles("single", [
      "Road",
      "Roadmap",
      "Stellar Road",
      "Crossroad",
    ]);

    const { serverOrder, browserOrder } = await compareOrders("road", parentId);

    expect(serverOrder).toEqual(browserOrder);
    expect(
      serverOrder.map((id) => id.replace("title-rank-single-", "")),
    ).toEqual(["road", "roadmap", "stellar-road", "crossroad"]);
  });

  it("orders exact, prefix, word-prefix, and substring matches identically for a multi-term AND query", async () => {
    const parentId = await seedTitles("multi", [
      "Stellar Road",
      "Stellar Roadside",
      "Notes on Stellar Road",
      "Superstellar broadcast",
    ]);

    const { serverOrder, browserOrder } = await compareOrders(
      "stellar road",
      parentId,
    );

    expect(serverOrder).toEqual(browserOrder);
    expect(
      serverOrder.map((id) =>
        id.replace("title-rank-multi-", "").replace(/-/g, " "),
      ),
    ).toEqual([
      "stellar road",
      "stellar roadside",
      "notes on stellar road",
      "superstellar broadcast",
    ]);
  });
});
