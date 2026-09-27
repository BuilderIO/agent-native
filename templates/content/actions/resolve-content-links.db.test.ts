import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec, getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-resolve-links-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "links-owner@example.com";
const TEAMMATE = "links-teammate@example.com";
const OUTSIDER = "links-outsider@example.com";
const STRANGER = "links-stranger@example.com";
const ORG_ID = "links-org";
const NOTION_PAGE_ID = "0123456789abcdef0123456789abcdef";
const NOTION_PAGE_DASHED = "01234567-89ab-cdef-0123-456789abcdef";
const SHARED_NOTION_PAGE_ID = "abcdefabcdefabcdefabcdefabcdefab";
const STRANGER_NOTION_PAGE_ID = "feedfacefeedfacefeedfacefeedface";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let resolveContentLinks: typeof import("./resolve-content-links.js").default;

const asUser = <T>(userEmail: string, run: () => Promise<T>) =>
  runWithRequestContext({ userEmail }, run);

const resolveAs = (
  userEmail: string,
  args: { ids?: string[]; sourcePaths?: string[]; fromDocumentId?: string },
) =>
  asUser(userEmail, () =>
    resolveContentLinks.run({ ids: [], sourcePaths: [], ...args }),
  );

function page(
  id: string,
  ownerEmail: string,
  fields: Partial<{
    title: string;
    icon: string;
    orgId: string;
    visibility: "private" | "org" | "public";
    position: number;
    trashedAt: string;
    sourcePath: string;
    sourceRootPath: string;
    localSource: boolean;
  }> = {},
) {
  const { localSource, ...rest } = fields;
  return {
    id,
    ownerEmail,
    title: fields.title ?? id,
    position: 0,
    visibility: "private" as const,
    ...rest,
    ...(localSource ? { sourceMode: "local-files", sourceKind: "file" } : {}),
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  resolveContentLinks = (await import("./resolve-content-links.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
  await getDbExec().execute({
    sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
    args: [ORG_ID, "Links org", OWNER, Date.now()],
  });
  for (const [id, email] of [
    ["links-member-owner", OWNER],
    ["links-member-teammate", TEAMMATE],
  ]) {
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
      args: [id, ORG_ID, email, "member", Date.now()],
    });
  }

  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values([
      page("links-internal", OWNER, {
        title: "Internal target",
        icon: "📄",
      }),
      page("links-notion", OWNER, { title: "Notion-linked target" }),
      page("links-private", OUTSIDER, { title: "Someone else's page" }),
      page("links-trashed", OWNER, { trashedAt: now }),
      page("links-org-page", TEAMMATE, {
        title: "Team page",
        orgId: ORG_ID,
        visibility: "org",
      }),
      page("links-local-source", OWNER, {
        title: "Local guide",
        localSource: true,
        sourcePath: "docs/guide.md",
        sourceRootPath: "repo",
      }),
      page("links-not-local", OWNER, { sourcePath: "docs/other.md" }),
      page("links-own-readme", OWNER, {
        title: "Own readme",
        position: 50,
        localSource: true,
        sourcePath: "README.md",
        sourceRootPath: "repo",
      }),
      page("links-team-readme", TEAMMATE, {
        title: "Team readme",
        orgId: ORG_ID,
        visibility: "org",
        position: 0,
        localSource: true,
        sourcePath: "README.md",
        sourceRootPath: "team-repo",
      }),
      page("links-team-host", TEAMMATE, {
        orgId: ORG_ID,
        visibility: "org",
        localSource: true,
        sourcePath: "docs/host.md",
        sourceRootPath: "team-repo",
      }),
      page("links-stranger-readme", STRANGER, {
        title: "Stranger readme",
        visibility: "public",
        position: -10,
        localSource: true,
        sourcePath: "README.md",
        sourceRootPath: "repo",
      }),
      page("links-stranger-only", STRANGER, {
        visibility: "public",
        localSource: true,
        sourcePath: "docs/stranger-only.md",
        sourceRootPath: "repo",
      }),
      page("links-stranger-public", STRANGER, {
        title: "Stranger public page",
        visibility: "public",
      }),
      page("links-own-notion", OWNER, { title: "Own copy", position: 99 }),
      page("links-team-notion", TEAMMATE, {
        title: "Team copy",
        orgId: ORG_ID,
        visibility: "org",
        position: 0,
      }),
      page("links-deleted-collection", OWNER),
      page("links-deleted-row", OWNER, {
        title: "Row of a deleted collection",
      }),
    ]);
  await getDb()
    .insert(schema.documentSyncLinks)
    .values([
      {
        documentId: "links-notion",
        ownerEmail: OWNER,
        remotePageId: NOTION_PAGE_ID,
      },
      {
        documentId: "links-stranger-public",
        ownerEmail: STRANGER,
        remotePageId: STRANGER_NOTION_PAGE_ID,
      },
      {
        documentId: "links-team-notion",
        ownerEmail: TEAMMATE,
        remotePageId: SHARED_NOTION_PAGE_ID,
      },
      {
        documentId: "links-own-notion",
        ownerEmail: OWNER,
        remotePageId: SHARED_NOTION_PAGE_ID,
      },
    ]);
  await getDb().insert(schema.contentDatabases).values({
    id: "links-deleted-database",
    ownerEmail: OWNER,
    documentId: "links-deleted-collection",
    deletedAt: now,
  });
  await getDb().insert(schema.contentDatabaseItems).values({
    id: "links-deleted-item",
    ownerEmail: OWNER,
    databaseId: "links-deleted-database",
    documentId: "links-deleted-row",
  });
});

afterAll(async () => {
  await closeDbExec();
  rmSync(TEST_DB_PATH, { recursive: true, force: true });
});

describe("resolve-content-links", () => {
  it("resolves Content document ids and Notion page ids in one batch", async () => {
    const result = await resolveAs(OWNER, {
      ids: [
        "links-internal",
        NOTION_PAGE_DASHED,
        NOTION_PAGE_ID.toUpperCase(),
        "links-notion",
      ],
    });
    const internal = {
      documentId: "links-internal",
      title: "Internal target",
      icon: "📄",
    };
    const notion = {
      documentId: "links-notion",
      title: "Notion-linked target",
      icon: null,
    };
    expect(result.links).toHaveLength(4);
    expect(result.links).toEqual(
      expect.arrayContaining([
        { id: "links-internal", ...internal },
        { id: NOTION_PAGE_DASHED, ...notion },
        { id: NOTION_PAGE_ID.toUpperCase(), ...notion },
        { id: "links-notion", ...notion },
      ]),
    );
  });

  it("omits targets the caller cannot list", async () => {
    const owner = await resolveAs(OWNER, {
      ids: ["links-private", "links-trashed", "links-missing"],
    });
    expect(owner.links).toEqual([]);

    const outsider = await resolveAs(OUTSIDER, {
      ids: ["links-internal", NOTION_PAGE_ID, "links-org-page"],
      sourcePaths: ["docs/guide.md"],
    });
    expect(outsider).toEqual({ links: [], sources: [] });
  });

  it("does not resolve a stranger's public document by id, Notion id, or path", async () => {
    const result = await resolveAs(OWNER, {
      ids: ["links-stranger-public", STRANGER_NOTION_PAGE_ID],
      sourcePaths: ["docs/stranger-only.md"],
    });
    expect(result).toEqual({ links: [], sources: [] });
  });

  it("resolves documents granted through the caller's organization", async () => {
    const result = await resolveAs(OWNER, { ids: ["links-org-page"] });
    expect(result.links).toEqual([
      {
        id: "links-org-page",
        documentId: "links-org-page",
        title: "Team page",
        icon: null,
      },
    ]);
  });

  it("does not resolve rows of a deleted collection", async () => {
    const result = await resolveAs(OWNER, { ids: ["links-deleted-row"] });
    expect(result.links).toEqual([]);
  });

  it("matches source paths only for documents whose own source is local", async () => {
    const result = await resolveAs(OWNER, {
      sourcePaths: ["/docs/guide.md", "docs/other.md"],
    });
    expect(result.sources).toEqual([
      {
        sourcePath: "docs/guide.md",
        documentId: "links-local-source",
        title: "Local guide",
        icon: null,
      },
    ]);
  });

  it("prefers the referencing document's root, then the caller's own, over a public stranger", async () => {
    const withoutOrigin = await Promise.all([
      resolveAs(OWNER, { sourcePaths: ["README.md"] }),
      resolveAs(OWNER, { sourcePaths: ["README.md"] }),
    ]);
    for (const result of withoutOrigin) {
      expect(result.sources.map((source) => source.documentId)).toEqual([
        "links-own-readme",
      ]);
    }

    const fromTeamRoot = await resolveAs(OWNER, {
      sourcePaths: ["README.md"],
      fromDocumentId: "links-team-host",
    });
    expect(fromTeamRoot.sources.map((source) => source.documentId)).toEqual([
      "links-team-readme",
    ]);

    const fromUnreadableOrigin = await resolveAs(OWNER, {
      sourcePaths: ["README.md"],
      fromDocumentId: "links-private",
    });
    expect(
      fromUnreadableOrigin.sources.map((source) => source.documentId),
    ).toEqual(["links-own-readme"]);
  });

  it("resolves a Notion page linked from several readable documents to the caller's own", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await resolveAs(OWNER, {
        ids: [SHARED_NOTION_PAGE_ID],
      });
      expect(result.links).toEqual([
        {
          id: SHARED_NOTION_PAGE_ID,
          documentId: "links-own-notion",
          title: "Own copy",
          icon: null,
        },
      ]);
    }
    const teammate = await resolveAs(TEAMMATE, {
      ids: [SHARED_NOTION_PAGE_ID],
    });
    expect(teammate.links.map((link) => link.documentId)).toEqual([
      "links-team-notion",
    ]);
  });

  it("rejects malformed ids instead of guessing", () => {
    expect(() =>
      resolveContentLinks.schema.parse({ ids: [" padded "] }),
    ).toThrow();
    expect(() =>
      resolveContentLinks.schema.parse({ ids: ["x".repeat(257)] }),
    ).toThrow();
  });
});
