import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-resolve-links-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "links-owner@example.com";
const OUTSIDER = "links-outsider@example.com";
const NOTION_PAGE_ID = "0123456789abcdef0123456789abcdef";
const NOTION_PAGE_DASHED = "01234567-89ab-cdef-0123-456789abcdef";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let resolveContentLinks: typeof import("./resolve-content-links.js").default;

const asUser = <T>(userEmail: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  resolveContentLinks = (await import("./resolve-content-links.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);

  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values([
      {
        id: "links-internal",
        ownerEmail: OWNER,
        title: "Internal target",
        icon: "📄",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "links-notion",
        ownerEmail: OWNER,
        title: "Notion-linked target",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "links-private",
        ownerEmail: OUTSIDER,
        title: "Someone else's page",
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "links-trashed",
        ownerEmail: OWNER,
        title: "Trashed target",
        trashedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "links-local-source",
        ownerEmail: OWNER,
        title: "Local guide",
        sourceMode: "local-files",
        sourceKind: "file",
        sourcePath: "docs/guide.md",
        sourceRootPath: "repo",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "links-database-source",
        ownerEmail: OWNER,
        title: "Same path, not a local source",
        sourcePath: "docs/other.md",
        createdAt: now,
        updatedAt: now,
      },
    ]);
  await getDb().insert(schema.documentSyncLinks).values({
    documentId: "links-notion",
    ownerEmail: OWNER,
    remotePageId: NOTION_PAGE_ID,
  });
});

afterAll(async () => {
  await closeDbExec();
  rmSync(TEST_DB_PATH, { recursive: true, force: true });
});

describe("resolve-content-links", () => {
  it("resolves Content document ids and Notion page ids in one batch", async () => {
    const result = await asUser(OWNER, () =>
      resolveContentLinks.run({
        ids: [
          "links-internal",
          NOTION_PAGE_DASHED,
          NOTION_PAGE_ID.toUpperCase(),
          "links-notion",
        ],
        sourcePaths: [],
      }),
    );
    expect(result.links).toEqual(
      expect.arrayContaining([
        {
          id: "links-internal",
          documentId: "links-internal",
          title: "Internal target",
          icon: "📄",
        },
        {
          id: NOTION_PAGE_DASHED,
          documentId: "links-notion",
          title: "Notion-linked target",
          icon: null,
        },
        {
          id: NOTION_PAGE_ID.toUpperCase(),
          documentId: "links-notion",
          title: "Notion-linked target",
          icon: null,
        },
        {
          id: "links-notion",
          documentId: "links-notion",
          title: "Notion-linked target",
          icon: null,
        },
      ]),
    );
    expect(result.links).toHaveLength(4);
  });

  it("omits targets the caller cannot read", async () => {
    const owner = await asUser(OWNER, () =>
      resolveContentLinks.run({
        ids: ["links-private", "links-trashed", "links-missing"],
        sourcePaths: [],
      }),
    );
    expect(owner.links).toEqual([]);

    const outsider = await asUser(OUTSIDER, () =>
      resolveContentLinks.run({
        ids: ["links-internal", NOTION_PAGE_ID],
        sourcePaths: ["docs/guide.md"],
      }),
    );
    expect(outsider).toEqual({ links: [], sources: [] });
  });

  it("matches source paths only for documents whose own source is local", async () => {
    const result = await asUser(OWNER, () =>
      resolveContentLinks.run({
        ids: [],
        sourcePaths: ["/docs/guide.md", "docs/other.md"],
      }),
    );
    expect(result.sources).toEqual([
      {
        sourcePath: "docs/guide.md",
        documentId: "links-local-source",
        title: "Local guide",
        icon: null,
      },
    ]);
  });
});
