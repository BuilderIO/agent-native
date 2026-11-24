import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isActionExposedToExternalAgents } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-read-link-summary-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "summary-owner@example.com";
const OTHER = "summary-other@example.com";
const TIMESTAMP = "2026-01-01T00:00:00.000Z";

type Schema = typeof import("../server/db/schema.js");
let getDb: typeof import("../server/db/index.js").getDb;
let schema: Schema;
let action: typeof import("./read-link-summary.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  action = (await import("./read-link-summary.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
  await addDocument({ id: "launch-page", title: "Launch brief" });
  await addDocument({ id: "blank-page", title: "" });
  await addDocument({ id: "hidden-page", hideFromSearch: true });
  await addDocument({ id: "trashed-page", trashed: true });
  await addDocument({ id: "private-page", ownerEmail: OTHER });
  await addDocument({ id: "database-page", title: "Launch tracker" });
  await addDocument({ id: "deleted-database-page" });
  await addDocument({ id: "deleted-database-row" });
  await getDb()
    .insert(schema.contentDatabases)
    .values([
      { id: "tracker", ownerEmail: OWNER, documentId: "database-page" },
      {
        id: "deleted-tracker",
        ownerEmail: OWNER,
        documentId: "deleted-database-page",
        deletedAt: TIMESTAMP,
      },
    ]);
  await getDb().insert(schema.contentDatabaseItems).values({
    id: "deleted-tracker-row",
    ownerEmail: OWNER,
    databaseId: "deleted-tracker",
    documentId: "deleted-database-row",
  });
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function addDocument(args: {
  id: string;
  title?: string;
  ownerEmail?: string;
  orgId?: string;
  trashed?: boolean;
  hideFromSearch?: boolean;
}) {
  await getDb()
    .insert(schema.documents)
    .values({
      id: args.id,
      parentId: null,
      ownerEmail: args.ownerEmail ?? OWNER,
      orgId: args.orgId ?? null,
      title: args.title ?? args.id,
      description: "",
      content: `body of ${args.id}`,
      visibility: args.orgId ? "org" : "private",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      ...(args.trashed ? { trashedAt: TIMESTAMP } : {}),
      ...(args.hideFromSearch ? { hideFromSearch: 1 } : {}),
    });
}

function link(id: string) {
  return `https://content.example.com/page/${id}`;
}

async function summarize(ids: string[], userEmail: string | undefined = OWNER) {
  const { summaries } = await runWithRequestContext({ userEmail }, () =>
    action.run({ links: ids.map(link) }),
  );
  return summaries;
}

function titled(id: string, title: string) {
  return {
    status: "available",
    app: "content",
    kind: "page",
    title,
    url: link(id),
  };
}

const UNAVAILABLE = { status: "unavailable" };

describe("Content read-link-summary", () => {
  it("answers with the title of each page the caller can open, in order", async () => {
    await expect(
      summarize(["launch-page", "database-page", "blank-page", "hidden-page"]),
    ).resolves.toEqual([
      titled("launch-page", "Launch brief"),
      titled("database-page", "Launch tracker"),
      titled("blank-page", "Untitled"),
      titled("hidden-page", "hidden-page"),
    ]);
  });

  it.each([
    "private-page",
    "missing-page",
    "trashed-page",
    "deleted-database-page",
    "deleted-database-row",
  ])("answers %s the same way, with no title", async (id) => {
    await expect(summarize([id])).resolves.toEqual([UNAVAILABLE]);
  });

  it("answers another reader by their own access", async () => {
    await expect(
      summarize(["launch-page", "private-page"], OTHER),
    ).resolves.toEqual([UNAVAILABLE, titled("private-page", "private-page")]);
  });

  it("gives a signed-out caller no private title", async () => {
    const { summaries } = await runWithRequestContext({}, () =>
      action.run({ links: [link("launch-page")] }),
    );
    expect(summaries).toEqual([UNAVAILABLE]);
  });

  it("answers for a page in an organization that isn't the active one", async () => {
    await getDbExec().execute({
      sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
      args: ["side-org", "Side org", OTHER, 0],
    });
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
      args: ["side-member", "side-org", OWNER, "member", 0],
    });
    await addDocument({
      id: "side-org-page",
      title: "Side brief",
      ownerEmail: OTHER,
      orgId: "side-org",
    });
    await expect(summarize(["side-org-page"])).resolves.toEqual([
      titled("side-org-page", "Side brief"),
    ]);
    await expect(
      summarize(["side-org-page"], "stranger@example.com"),
    ).resolves.toEqual([UNAVAILABLE]);
  });

  it("answers for a page shared with an organization that isn't the active one", async () => {
    await getDbExec().execute({
      sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
      args: ["shared-org", "Shared org", OTHER, 0],
    });
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
      args: ["shared-member", "shared-org", OWNER, "member", 0],
    });
    await addDocument({ id: "org-shared-page", ownerEmail: OTHER });
    await getDb().insert(schema.documentShares).values({
      id: "org-share",
      resourceId: "org-shared-page",
      principalType: "org",
      principalId: "shared-org",
      role: "viewer",
      createdBy: OTHER,
    });
    await expect(summarize(["org-shared-page"])).resolves.toEqual([
      titled("org-shared-page", "org-shared-page"),
    ]);
    await expect(
      summarize(["org-shared-page"], "stranger@example.com"),
    ).resolves.toEqual([UNAVAILABLE]);
  });

  it("names no page for a link to anything else", async () => {
    const { summaries } = await runWithRequestContext(
      { userEmail: OWNER },
      () =>
        action.run({
          links: [
            "https://content.example.com/p/launch-page",
            "https://content.example.com/page/launch-page/edit",
            "https://content.example.com/_agent-native/open?documentId=launch-page",
            "https://content.example.com/page/launch-page?token=fake",
          ],
        }),
    );
    expect(summaries).toEqual([
      UNAVAILABLE,
      UNAVAILABLE,
      UNAVAILABLE,
      UNAVAILABLE,
    ]);
  });

  it("is exposed to peer apps as an authenticated read, not to Content's own agent", () => {
    expect(action.readOnly).toBe(true);
    expect(action.agentTool).toBe(false);
    expect(isActionExposedToExternalAgents(action)).toBe(true);
    expect(action.publicAgent).toEqual({
      expose: true,
      readOnly: true,
      requiresAuth: true,
    });
  });
});
