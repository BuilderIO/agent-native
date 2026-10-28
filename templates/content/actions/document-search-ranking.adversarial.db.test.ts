import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-search-ranking-adversarial-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "search-ranking-adversarial@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let searchDocuments: typeof import("./search-documents.js").default;

const searchIds = async (query: string) => {
  const result = await runWithRequestContext({ userEmail: OWNER }, () =>
    searchDocuments.run({
      query,
      searchFields: "title",
      limit: 20,
      offset: 0,
    }),
  );
  return result.documents.map((document) => document.id);
};

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  searchDocuments = (await import("./search-documents.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);

  await getDb()
    .insert(schema.documents)
    .values([
      {
        id: "qa-01-word-intent",
        ownerEmail: OWNER,
        title: "Task planning priorities",
        visibility: "private",
        updatedAt: "2000-01-01T00:00:00.000Z",
      },
      {
        id: "qa-01-embedded-substrings",
        ownerEmail: OWNER,
        title: "Multitasking deprioritized notes",
        visibility: "private",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "qa-02-exact-positive",
        ownerEmail: OWNER,
        title: "Atlas Roadmap",
        visibility: "private",
        updatedAt: "2000-01-02T00:00:00.000Z",
      },
      {
        id: "qa-02-positive-prefix",
        ownerEmail: OWNER,
        title: "Atlas Roadmap Archive",
        visibility: "private",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "qa-02-excluded",
        ownerEmail: OWNER,
        title: "Atlas Roadmap Draft",
        visibility: "private",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
      {
        id: "qa-03-unicode-word-intent",
        ownerEmail: OWNER,
        title: "Café—Launch   Plan",
        visibility: "private",
        updatedAt: "2000-01-03T00:00:00.000Z",
      },
      {
        id: "qa-03-unicode-embedded",
        ownerEmail: OWNER,
        title: "Decafé—Launch Planning Notes",
        visibility: "private",
        updatedAt: "2026-01-04T00:00:00.000Z",
      },
      {
        id: "qa-or-older-amber",
        ownerEmail: OWNER,
        title: "Amber",
        visibility: "private",
        updatedAt: "2000-01-05T00:00:00.000Z",
      },
      {
        id: "qa-or-newer-violet",
        ownerEmail: OWNER,
        title: "Violet",
        visibility: "private",
        updatedAt: "2026-01-05T00:00:00.000Z",
      },
      {
        id: "qa-title-only-older-description",
        ownerEmail: OWNER,
        title: "Amber violet notes",
        description: "amber violet",
        visibility: "private",
        updatedAt: "2000-01-06T00:00:00.000Z",
      },
      {
        id: "qa-title-only-newer",
        ownerEmail: OWNER,
        title: "Amber violet archive",
        content: "amber violet",
        visibility: "private",
        updatedAt: "2026-01-06T00:00:00.000Z",
      },
      {
        id: "qa-intitle-newer",
        ownerEmail: OWNER,
        title: "Copper launch newer",
        content: "launch",
        visibility: "private",
        updatedAt: "2026-01-07T00:00:00.000Z",
      },
      {
        id: "qa-intitle-older-description",
        ownerEmail: OWNER,
        title: "Copper launch older",
        description: "copper",
        content: "launch",
        visibility: "private",
        updatedAt: "2000-01-07T00:00:00.000Z",
      },
    ]);
}, 60_000);

afterAll(async () => {
  await closeDbExec();
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("adversarial document search ranking", () => {
  it("QA-01 ranks title word intent above newer embedded substrings", async () => {
    expect(await searchIds("task prio")).toEqual([
      "qa-01-word-intent",
      "qa-01-embedded-substrings",
    ]);
  });

  it("QA-02 keeps exclusion filtering neutral to positive title ranking", async () => {
    expect(await searchIds("atlas roadmap -draft")).toEqual([
      "qa-02-exact-positive",
      "qa-02-positive-prefix",
    ]);
  });

  it("QA-03 does not let duplicate OR alternatives erase word-intent ranking for eligible Unicode, punctuation, and spacing", async () => {
    expect(await searchIds('"Café—Launch" OR "Café—Launch" plan')).toEqual([
      "qa-03-unicode-word-intent",
      "qa-03-unicode-embedded",
    ]);
  });

  it("gives OR alternatives symmetric title tiers", async () => {
    expect(
      (await searchIds("amber OR violet")).filter((id) =>
        id.startsWith("qa-or-"),
      ),
    ).toEqual(["qa-or-newer-violet", "qa-or-older-amber"]);
    expect(
      (await searchIds("violet OR amber")).filter((id) =>
        id.startsWith("qa-or-"),
      ),
    ).toEqual(["qa-or-newer-violet", "qa-or-older-amber"]);
  });

  it("keeps excluded fields neutral in title-only search", async () => {
    expect(await searchIds("amber violet")).toEqual([
      "qa-title-only-newer",
      "qa-title-only-older-description",
    ]);
  });

  it("keeps intitle terms neutral in description ranking", async () => {
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      searchDocuments.run({
        query: "intitle:copper launch",
        limit: 20,
        offset: 0,
      }),
    );
    expect(result.documents.map((document) => document.id)).toEqual([
      "qa-intitle-newer",
      "qa-intitle-older-description",
    ]);
  });
});
