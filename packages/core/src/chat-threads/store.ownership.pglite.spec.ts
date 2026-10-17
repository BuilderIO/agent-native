import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { storeLedgerResult } from "../db/store-ledger.test-helpers.js";
import { runWithRequestContext } from "../server/request-context.js";

// Real PGlite behind getDbExec so the ownership filter, the ACL, and the
// access-basis projection run their genuine SQL, including LIMIT/OFFSET.
let pglite: Awaited<ReturnType<typeof createTestPglite>>;
const membershipQueries: string[] = [];
const federation = vi.hoisted(() => ({
  enabled: vi.fn(async () => true),
  validate: vi.fn(async () => ({ active: true, role: "member" })),
}));

vi.mock("../feature-flags/store.js", () => ({
  evaluateFeatureFlagStrict: federation.enabled,
}));
vi.mock("../org/federation.js", () => ({
  validateFederatedOrganizationMembershipForCurrentRequest: federation.validate,
}));
vi.mock("../db/create-get-db.js", () => ({
  createGetDb: () => () =>
    drizzle(pglite.db, {
      logger: {
        logQuery(query) {
          if (query.includes('from "org_members"'))
            membershipQueries.push(query);
        },
      },
    }),
}));

vi.mock("../db/client.js", () => ({
  getScopedDbExec: () => undefined,
  getDbExec: () => ({
    execute: async (input: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof input === "string" ? input : input.sql;
      const ledger = storeLedgerResult(sql);
      if (ledger) return ledger;
      if (/FROM information_schema\.columns/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }
      if (typeof input === "string") {
        await pglite.exec(input);
        return { rows: [], rowsAffected: 0 };
      }
      const args = (input.args ?? []) as unknown[];
      if (/^\s*(SELECT|WITH)\b/i.test(sql)) {
        return {
          rows: await pglite.prepare(sql).all(...args),
          rowsAffected: 0,
        };
      }
      const { changes } = await pglite.prepare(sql).run(...args);
      return { rows: [], rowsAffected: changes };
    },
  }),
}));

vi.mock("../db/ddl-guard.js", () => ({
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./emitter.js", () => ({ emitChatThreadChange: vi.fn() }));

const { listThreads, searchThreads, resolveThreadsAccess } =
  await import("./store.js");

const ME = "Me@Example.com";
const ORG = "org-1";

interface SeedThread {
  id: string;
  owner: string;
  updatedAt: number;
  visibility?: "private" | "org";
  orgId?: string | null;
  title?: string;
}

async function seed(thread: SeedThread) {
  await pglite.query(
    `INSERT INTO chat_threads (id, owner_email, title, preview, thread_data, message_count, created_at, updated_at, org_id, visibility)
     VALUES (?, ?, ?, '', '{}', 1, ?, ?, ?, ?)`,
    [
      thread.id,
      thread.owner,
      thread.title ?? "Quarterly plan",
      thread.updatedAt,
      thread.updatedAt,
      thread.orgId ?? null,
      thread.visibility ?? "private",
    ],
  );
}

async function share(
  threadId: string,
  principalType: "user" | "org",
  principalId: string,
  role: "viewer" | "admin" = "viewer",
) {
  await pglite.query(
    `INSERT INTO chat_thread_shares (id, resource_id, principal_type, principal_id, role, created_by)
     VALUES (?, ?, ?, ?, ?, 'seed')`,
    [
      `${threadId}:${principalType}:${principalId}`,
      threadId,
      principalType,
      principalId,
      role,
    ],
  );
}

describe("chat thread ownership lists (real SQL)", () => {
  beforeAll(async () => {
    pglite = await createTestPglite();
    await pglite.exec(`
      CREATE TABLE chat_threads (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        preview TEXT NOT NULL DEFAULT '',
        thread_data TEXT NOT NULL DEFAULT '{}',
        message_count BIGINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        scope_type TEXT, scope_id TEXT, scope_label TEXT,
        pinned_at BIGINT, archived_at BIGINT, share_token_hash TEXT,
        source_platform TEXT, source_app_id TEXT, source_url TEXT,
        org_id TEXT,
        visibility TEXT NOT NULL DEFAULT 'private'
      );
      CREATE TABLE chat_thread_shares (
        id TEXT PRIMARY KEY,
        resource_id TEXT NOT NULL,
        principal_type TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT '',
        notified_at TEXT
      );
      CREATE TABLE organizations (
        id TEXT PRIMARY KEY, identity_authority TEXT, identity_id TEXT
      );
      CREATE TABLE org_members (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
        role TEXT NOT NULL, federation_removal_pending_at BIGINT
      );
    `);

    // Mine: owned private, and owned org-visible (still mine).
    await seed({ id: "mine-private", owner: "me@example.com", updatedAt: 100 });
    await seed({
      id: "mine-org",
      owner: "ME@EXAMPLE.COM",
      updatedAt: 90,
      visibility: "org",
      orgId: ORG,
    });
    // Shared with me by name, with the stored principal in another case.
    await seed({ id: "direct", owner: "ann@example.com", updatedAt: 95 });
    await share("direct", "user", "ME@example.COM", "admin");
    // Organization only.
    await seed({
      id: "org-visible",
      owner: "bob@example.com",
      updatedAt: 85,
      visibility: "org",
      orgId: ORG,
    });
    await seed({ id: "org-grant", owner: "cy@example.com", updatedAt: 80 });
    await share("org-grant", "org", ORG);
    // Both: the direct grant outranks organization visibility.
    await seed({
      id: "direct-and-org",
      owner: "dee@example.com",
      updatedAt: 75,
      visibility: "org",
      orgId: ORG,
    });
    await share("direct-and-org", "user", "me@example.com");
    // Not accessible: other org, other person's grant, no grant.
    await seed({
      id: "other-org",
      owner: "eve@example.com",
      updatedAt: 70,
      visibility: "org",
      orgId: "org-2",
    });
    await seed({
      id: "other-org-grant",
      owner: "eve@example.com",
      updatedAt: 65,
    });
    await share("other-org-grant", "org", "org-2");
    await seed({
      id: "someone-elses",
      owner: "eve@example.com",
      updatedAt: 60,
    });
    await share("someone-elses", "user", "fay@example.com");
    await seed({
      id: "private-other",
      owner: "eve@example.com",
      updatedAt: 55,
    });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    federation.enabled.mockResolvedValue(true);
    federation.validate.mockResolvedValue({ active: true, role: "member" });
    await pglite.exec(`
      DELETE FROM org_members;
      DELETE FROM organizations;
      INSERT INTO organizations (id) VALUES ('org-1'), ('org-2');
      INSERT INTO org_members (id, org_id, email, role)
        VALUES ('me', 'org-1', 'ME@example.COM', 'admin');
    `);
    membershipQueries.length = 0;
  });

  afterAll(async () => {
    await pglite.close();
  });

  const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

  it("mine is ownership alone, so an org-visible chat I own stays mine", async () => {
    const rows = await listThreads(ME, { orgId: ORG, ownership: "mine" });
    expect(ids(rows)).toEqual(["mine-private", "mine-org"]);
    expect(rows.every((row) => row.accessBasis === "owner")).toBe(true);
  });

  it("shared is accessible chats owned by someone else, with direct beating organization", async () => {
    const rows = await listThreads(ME, { orgId: ORG, ownership: "shared" });
    expect(
      rows.map((row) => [row.id, row.accessBasis, row.ownerEmail]),
    ).toEqual([
      ["direct", "direct", "ann@example.com"],
      ["org-visible", "organization", "bob@example.com"],
      ["org-grant", "organization", "cy@example.com"],
      ["direct-and-org", "direct", "dee@example.com"],
    ]);
  });

  it("shared never widens access: cross-org and ungranted chats stay hidden", async () => {
    const all = await listThreads(ME, { orgId: ORG, ownership: "all" });
    expect(ids(all)).not.toContain("other-org");
    expect(ids(all)).not.toContain("other-org-grant");
    expect(ids(all)).not.toContain("someone-elses");
    expect(ids(all)).not.toContain("private-other");
    expect(ids(all)).toHaveLength(6);
  });

  it("checks membership once for an active member's batch", async () => {
    const threads = await resolveThreadsAccess(
      ` ${ME} `,
      ["mine-org", "direct", "org-visible", "org-grant", "other-org"],
      { orgId: ORG },
    );
    expect([...threads.keys()].sort()).toEqual([
      "direct",
      "mine-org",
      "org-grant",
      "org-visible",
    ]);
    expect(membershipQueries).toHaveLength(1);
  });

  it("without an organization, org visibility grants nothing", async () => {
    const rows = await listThreads(ME, { orgId: null, ownership: "shared" });
    expect(ids(rows)).toEqual(["direct", "direct-and-org"]);
  });

  it("pages mine and shared independently: the filter narrows before LIMIT/OFFSET", async () => {
    const paged: string[] = [];
    for (let offset = 0; offset < 6; offset += 1) {
      const page = await listThreads(ME, {
        orgId: ORG,
        ownership: "shared",
        limit: 1,
        offset,
      });
      paged.push(...ids(page));
    }
    expect(paged).toEqual([
      "direct",
      "org-visible",
      "org-grant",
      "direct-and-org",
    ]);

    // A page of 2 from the shared list is never padded with my own chats.
    const first = await listThreads(ME, {
      orgId: ORG,
      ownership: "shared",
      limit: 2,
    });
    expect(ids(first)).toEqual(["direct", "org-visible"]);
  });

  it("search honours ownership and offset before paging", async () => {
    const mine = await searchThreads(ME, "Quarterly", 10, {
      orgId: ORG,
      ownership: "mine",
    });
    expect(ids(mine)).toEqual(["mine-private", "mine-org"]);

    const sharedPage2 = await searchThreads(ME, "Quarterly", 2, {
      orgId: ORG,
      ownership: "shared",
      offset: 2,
    });
    expect(ids(sharedPage2)).toEqual(["org-grant", "direct-and-org"]);
    expect(
      sharedPage2.map(({ ownerEmail, accessBasis }) => ({
        ownerEmail,
        accessBasis,
      })),
    ).toEqual([
      { ownerEmail: "cy@example.com", accessBasis: "organization" },
      { ownerEmail: "dee@example.com", accessBasis: "direct" },
    ]);
  });

  it("rejects an unknown ownership instead of listing everything", async () => {
    await expect(
      listThreads(ME, { ownership: "everyone" as never }),
    ).rejects.toThrow(/Unknown chat thread ownership/);
  });

  it.each(["deleted", "pending"])(
    "excludes organization access for a %s member with stale scope in every store boundary",
    async (state) => {
      if (state === "deleted") await pglite.exec("DELETE FROM org_members");
      else
        await pglite.exec(
          "UPDATE org_members SET federation_removal_pending_at = 1",
        );
      const expected = ["mine-private", "direct", "mine-org", "direct-and-org"];
      expect(ids(await listThreads(ME, { orgId: ORG }))).toEqual(expected);
      expect(
        ids(await searchThreads(ME, "Quarterly", 20, { orgId: ORG })),
      ).toEqual(expected);
      const batch = await resolveThreadsAccess(
        ME,
        [...expected, "org-visible", "org-grant"],
        { orgId: ORG },
      );
      expect([...batch.keys()].sort()).toEqual([...expected].sort());
      expect(membershipQueries).toHaveLength(3);
      expect(federation.validate).not.toHaveBeenCalled();
    },
  );

  it("filters inaccessible rows before paging and does not expose body-only search matches", async () => {
    await pglite.exec("DELETE FROM org_members");
    await pglite.query(
      "UPDATE chat_threads SET thread_data = ? WHERE id = 'org-visible'",
      ['{"content":"synthetic-body-secret"}'],
    );
    try {
      const page = await listThreads(ME, {
        orgId: ORG,
        ownership: "shared",
        offset: 1,
        limit: 2,
      });
      expect(ids(page)).toEqual(["direct-and-org"]);
      expect(
        ids(
          await searchThreads(ME, "Quarterly", 2, {
            orgId: ORG,
            ownership: "shared",
            offset: 1,
          }),
        ),
      ).toEqual(["direct-and-org"]);
      expect(
        await searchThreads(ME, "synthetic-body-secret", 2, { orgId: ORG }),
      ).toEqual([]);
    } finally {
      await pglite.exec("UPDATE chat_threads SET thread_data = '{}'");
    }
  });

  it("keeps explicit personal scope separate from an omitted scope", async () => {
    await runWithRequestContext({ userEmail: ME, orgId: ORG }, async () => {
      expect(
        ids(await listThreads(ME, { orgId: null, ownership: "shared" })),
      ).toEqual(["direct", "direct-and-org"]);
      expect(
        ids(await searchThreads(ME, "Quarterly", 20, { orgId: null })),
      ).toEqual(["mine-private", "direct", "mine-org", "direct-and-org"]);
      expect(ids(await listThreads(ME, { ownership: "shared" }))).toEqual([
        "direct",
        "org-visible",
        "org-grant",
        "direct-and-org",
      ]);
      expect(await resolveThreadsAccess(ME, ["org-visible"])).toEqual(
        new Map(),
      );
    });
  });

  it("does not treat membership in another organization as membership in the requested one", async () => {
    await pglite.exec("UPDATE org_members SET org_id = 'org-2'");
    expect(
      ids(await listThreads(ME, { orgId: ORG, ownership: "shared" })),
    ).toEqual(["direct", "direct-and-org"]);
  });

  it("rejects missing organization metadata and unreadable membership tables", async () => {
    await pglite.exec("DELETE FROM organizations WHERE id = 'org-1'");
    await expect(listThreads(ME, { orgId: ORG })).rejects.toThrow(
      /organization/i,
    );
    await pglite.exec("ALTER TABLE org_members RENAME TO unavailable_members");
    try {
      await expect(
        searchThreads(ME, "Quarterly", 10, { orgId: ORG }),
      ).rejects.toThrow();
    } finally {
      await pglite.exec(
        "ALTER TABLE unavailable_members RENAME TO org_members",
      );
    }
  });

  it("validates linked organizations once and preserves authoritative denial and errors", async () => {
    await pglite.exec(
      "UPDATE organizations SET identity_authority = 'https://identity.example.test', identity_id = 'upstream-org' WHERE id = 'org-1'",
    );
    expect(
      ids(await listThreads(ME, { orgId: ORG, ownership: "shared" })),
    ).toEqual(["direct", "org-visible", "org-grant", "direct-and-org"]);
    expect(federation.validate).toHaveBeenCalledTimes(1);
    federation.validate.mockClear();
    federation.validate.mockResolvedValue({ active: false, role: "member" });
    expect(
      ids(await listThreads(ME, { orgId: ORG, ownership: "shared" })),
    ).toEqual(["direct", "direct-and-org"]);
    expect(federation.validate).toHaveBeenCalledTimes(1);
    federation.validate.mockRejectedValue(new Error("authority unavailable"));
    await expect(
      resolveThreadsAccess(ME, ["org-grant"], { orgId: ORG }),
    ).rejects.toThrow("authority unavailable");
    federation.enabled.mockRejectedValue(new Error("rollout unavailable"));
    await expect(
      searchThreads(ME, "Quarterly", 10, { orgId: ORG }),
    ).rejects.toThrow("rollout unavailable");
  });

  it("allows only proven local service identities without a membership row", async () => {
    const serviceEmail = `svc-recap@service.${ORG}`;
    const context = {
      userEmail: serviceEmail,
      orgId: ORG,
      verifiedServiceIdentity: { userEmail: serviceEmail, orgId: ORG },
    };
    await runWithRequestContext(context, async () => {
      expect(ids(await listThreads(serviceEmail, { orgId: ORG }))).toEqual([
        "mine-org",
        "org-visible",
        "org-grant",
        "direct-and-org",
      ]);
      await pglite.exec(
        "UPDATE organizations SET identity_authority = 'https://identity.example.test', identity_id = 'upstream-org' WHERE id = 'org-1'",
      );
      expect(await listThreads(serviceEmail, { orgId: ORG })).toEqual([]);
    });
    await runWithRequestContext(
      { userEmail: serviceEmail, orgId: ORG },
      async () => {
        await pglite.exec(
          "UPDATE organizations SET identity_authority = NULL, identity_id = NULL",
        );
        expect(await listThreads(serviceEmail, { orgId: ORG })).toEqual([]);
      },
    );
  });
});
