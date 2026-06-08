import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../../server/request-context.js";
import { registerShareableResource } from "../../sharing/registry.js";
import { ForbiddenError } from "../../sharing/access.js";
import { extensions, extensionShares } from "../schema.js";
import {
  EXTENSION_SLOTS_CREATE_SQL,
  EXTENSION_SLOTS_BY_SLOT_INDEX_SQL,
  EXTENSION_SLOTS_BY_EXTENSION_INDEX_SQL,
  EXTENSION_SLOTS_UNIQUE_INDEX_SQL,
  EXTENSION_SLOT_INSTALLS_CREATE_SQL,
  EXTENSION_SLOT_INSTALLS_BY_USER_SLOT_INDEX_SQL,
  EXTENSION_SLOT_INSTALLS_UNIQUE_INDEX_SQL,
} from "./schema.js";

// One real in-memory sqlite DB shared between the slot store's drizzle handle
// (createGetDb is mocked to return it) and the raw getDbExec client used by
// ensureSlotTables for DDL, plus the registered "extension" shareable resource
// so access scoping is exercised for real (not mocked away).
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      sqlite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = sqlite.prepare(input.sql);
    if (/^\s*select/i.test(input.sql)) {
      const rows = stmt.all(...((input.args ?? []) as unknown[]));
      return { rows, rowsAffected: 0 };
    }
    const info = stmt.run(...((input.args ?? []) as unknown[]));
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../../db/client.js", () => ({
  getDbExec: () => rawClient,
  isPostgres: () => false,
  getDialect: () => "sqlite",
  intType: () => "INTEGER",
}));

vi.mock("../../db/create-get-db.js", () => ({
  createGetDb: () => () => db,
}));

const {
  addExtensionSlotTarget,
  removeExtensionSlotTarget,
  listSlotsForExtension,
  listExtensionsForSlot,
  installExtensionSlot,
  uninstallExtensionSlot,
  listSlotInstallsForUser,
  cascadeDeleteExtensionSlots,
} = await import("./store.js");

const OWNER = "owner@example.com";
const VIEWER = "viewer@example.com";
const OUTSIDER = "outsider@example.com";
const ORG = "org-1";

async function insertExtension(values: {
  id: string;
  name?: string;
  ownerEmail?: string;
  orgId?: string | null;
  visibility?: "private" | "org" | "public";
}) {
  await db.insert(extensions).values({
    id: values.id,
    name: values.name ?? values.id,
    description: `${values.id} description`,
    content: "<div></div>",
    icon: null,
    ownerEmail: values.ownerEmail ?? OWNER,
    orgId: values.orgId === undefined ? ORG : values.orgId,
    visibility: values.visibility ?? "private",
  });
}

function shareToUser(resourceId: string, email: string, role = "viewer") {
  return db.insert(extensionShares).values({
    id: `${resourceId}:${email}:${role}`,
    resourceId,
    principalType: "user",
    principalId: email,
    role,
    createdBy: OWNER,
    createdAt: "2026-04-30T00:00:00.000Z",
  });
}

beforeEach(() => {
  sqlite = new Database(":memory:");
  // Mirror the real extensions/extension_shares tables so accessFilter and
  // resolveAccess run against genuine rows.
  sqlite.exec(`
    CREATE TABLE tools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      icon TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      hidden_at TEXT,
      hidden_by TEXT,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
    CREATE TABLE tool_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  sqlite.exec(EXTENSION_SLOTS_CREATE_SQL);
  sqlite.exec(EXTENSION_SLOTS_BY_SLOT_INDEX_SQL);
  sqlite.exec(EXTENSION_SLOTS_BY_EXTENSION_INDEX_SQL);
  sqlite.exec(EXTENSION_SLOTS_UNIQUE_INDEX_SQL);
  sqlite.exec(EXTENSION_SLOT_INSTALLS_CREATE_SQL);
  sqlite.exec(EXTENSION_SLOT_INSTALLS_BY_USER_SLOT_INDEX_SQL);
  sqlite.exec(EXTENSION_SLOT_INSTALLS_UNIQUE_INDEX_SQL);
  db = drizzle(sqlite);

  registerShareableResource({
    type: "extension",
    resourceTable: extensions,
    sharesTable: extensionShares,
    displayName: "Extension",
    titleColumn: "name",
    allowPublic: false,
    requireOrgMemberForUserShares: true,
    getDb: () => db,
  });
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("extension slots: slot-target declarations", () => {
  it("requires editor access on the extension to declare a slot target", async () => {
    await insertExtension({ id: "ext-1" });
    // Viewer-only share — not enough to declare a slot target.
    await shareToUser("ext-1", VIEWER, "viewer");

    await runWithRequestContext({ userEmail: VIEWER, orgId: ORG }, async () => {
      await expect(
        addExtensionSlotTarget("ext-1", "mail.sidebar"),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    // No declaration row should have been written.
    await runWithRequestContext({ userEmail: OWNER, orgId: ORG }, async () => {
      await expect(listSlotsForExtension("ext-1")).resolves.toEqual([]);
    });
  });

  it("lets the owner declare a slot target and is idempotent on the unique index", async () => {
    await insertExtension({ id: "ext-1" });

    await runWithRequestContext({ userEmail: OWNER, orgId: ORG }, async () => {
      const first = await addExtensionSlotTarget(
        "ext-1",
        "mail.sidebar",
        '{"variant":"compact"}',
      );
      expect(first).toMatchObject({
        extensionId: "ext-1",
        slotId: "mail.sidebar",
        config: '{"variant":"compact"}',
      });

      // Re-declaring the same (extension, slot) pair returns the existing row
      // instead of throwing on the unique index.
      const again = await addExtensionSlotTarget("ext-1", "mail.sidebar");
      expect(again.id).toBe(first.id);

      const rows = await listSlotsForExtension("ext-1");
      expect(rows).toHaveLength(1);
    });
  });

  it("requires viewer access to list an extension's slot targets", async () => {
    await insertExtension({ id: "ext-1" });
    await runWithRequestContext({ userEmail: OWNER, orgId: ORG }, () =>
      addExtensionSlotTarget("ext-1", "mail.sidebar"),
    );

    await runWithRequestContext(
      { userEmail: OUTSIDER, orgId: ORG },
      async () => {
        await expect(listSlotsForExtension("ext-1")).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      },
    );
  });

  it("removes a slot target only with editor access", async () => {
    await insertExtension({ id: "ext-1" });
    await runWithRequestContext({ userEmail: OWNER, orgId: ORG }, () =>
      addExtensionSlotTarget("ext-1", "mail.sidebar"),
    );

    await runWithRequestContext(
      { userEmail: OUTSIDER, orgId: ORG },
      async () => {
        await expect(
          removeExtensionSlotTarget("ext-1", "mail.sidebar"),
        ).rejects.toBeInstanceOf(ForbiddenError);
      },
    );

    await runWithRequestContext({ userEmail: OWNER, orgId: ORG }, async () => {
      await expect(
        removeExtensionSlotTarget("ext-1", "mail.sidebar"),
      ).resolves.toBe(true);
      await expect(listSlotsForExtension("ext-1")).resolves.toEqual([]);
    });
  });
});

describe("extension slots: listExtensionsForSlot scoping", () => {
  it("only returns slot declarations for extensions the caller can access", async () => {
    await insertExtension({ id: "mine", name: "Mine", ownerEmail: OWNER });
    await insertExtension({
      id: "theirs",
      name: "Theirs",
      ownerEmail: OUTSIDER,
      visibility: "private",
    });
    await insertExtension({
      id: "shared",
      name: "Shared",
      ownerEmail: OUTSIDER,
    });
    await shareToUser("shared", OWNER, "viewer");

    // Declare all three in the same slot (declaration auth is checked when
    // adding; insert directly to bypass and focus on the read-side scoping).
    for (const id of ["mine", "theirs", "shared"]) {
      sqlite
        .prepare(
          `INSERT INTO tool_slots (id, tool_id, slot_id, config, created_at)
           VALUES (?, ?, 'calendar.panel', NULL, '2026-04-30T00:00:00.000Z')`,
        )
        .run(`decl-${id}`, id);
    }

    await runWithRequestContext({ userEmail: OWNER, orgId: ORG }, async () => {
      const visible = await listExtensionsForSlot("calendar.panel");
      expect(visible.map((e) => e.extensionId).sort()).toEqual([
        "mine",
        "shared",
      ]);
      // "theirs" (private, not shared) must never leak.
      expect(visible.some((e) => e.extensionId === "theirs")).toBe(false);
    });
  });

  it("returns an empty list when the caller can see no extensions", async () => {
    await insertExtension({ id: "theirs", ownerEmail: OUTSIDER });
    sqlite
      .prepare(
        `INSERT INTO tool_slots (id, tool_id, slot_id, config, created_at)
         VALUES ('d1', 'theirs', 'calendar.panel', NULL, '2026-04-30T00:00:00.000Z')`,
      )
      .run();

    await runWithRequestContext(
      { userEmail: OUTSIDER + ".nope", orgId: "org-x" },
      async () => {
        await expect(listExtensionsForSlot("calendar.panel")).resolves.toEqual(
          [],
        );
      },
    );
  });
});

describe("extension slots: install / uninstall", () => {
  it("requires viewer access on the extension to install it into a slot", async () => {
    await insertExtension({ id: "ext-1", ownerEmail: OUTSIDER });

    await runWithRequestContext({ userEmail: VIEWER, orgId: ORG }, async () => {
      await expect(
        installExtensionSlot("ext-1", "mail.sidebar"),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  it("installs an accessible extension and auto-assigns increasing positions per slot", async () => {
    await insertExtension({ id: "ext-a", ownerEmail: OWNER });
    await insertExtension({ id: "ext-b", ownerEmail: OWNER });

    await runWithRequestContext({ userEmail: OWNER, orgId: ORG }, async () => {
      const a = await installExtensionSlot("ext-a", "mail.sidebar");
      const b = await installExtensionSlot("ext-b", "mail.sidebar");
      expect(a.position).toBe(0);
      expect(b.position).toBe(1);
      expect(a.ownerEmail).toBe(OWNER);
      expect(a.orgId).toBe(ORG);

      // A different slot starts its own position sequence at 0.
      const otherSlot = await installExtensionSlot("ext-a", "calendar.panel");
      expect(otherSlot.position).toBe(0);
    });
  });

  it("honors an explicit position and is idempotent on re-install", async () => {
    await insertExtension({ id: "ext-a", ownerEmail: OWNER });

    await runWithRequestContext({ userEmail: OWNER, orgId: ORG }, async () => {
      const first = await installExtensionSlot("ext-a", "mail.sidebar", {
        position: 7,
        config: '{"x":1}',
      });
      expect(first.position).toBe(7);

      // Re-installing returns the existing row (does not create a duplicate or
      // bump position).
      const again = await installExtensionSlot("ext-a", "mail.sidebar", {
        position: 99,
      });
      expect(again.id).toBe(first.id);
      expect(again.position).toBe(7);

      const installs = await listSlotInstallsForUser("mail.sidebar");
      expect(installs).toHaveLength(1);
    });
  });

  it("scopes installs per user — one user's install is invisible to another", async () => {
    await insertExtension({
      id: "ext-a",
      ownerEmail: OWNER,
      visibility: "org",
    });

    await runWithRequestContext({ userEmail: OWNER, orgId: ORG }, () =>
      installExtensionSlot("ext-a", "mail.sidebar"),
    );

    // VIEWER can see ext-a (org visibility) but has installed nothing.
    await runWithRequestContext({ userEmail: VIEWER, orgId: ORG }, async () => {
      await expect(listSlotInstallsForUser("mail.sidebar")).resolves.toEqual(
        [],
      );
      // VIEWER installs for themselves.
      await installExtensionSlot("ext-a", "mail.sidebar");
      const mine = await listSlotInstallsForUser("mail.sidebar");
      expect(mine).toHaveLength(1);
      expect(mine[0].extensionId).toBe("ext-a");
    });

    // OWNER still sees only their own single install.
    await runWithRequestContext({ userEmail: OWNER, orgId: ORG }, async () => {
      await expect(
        listSlotInstallsForUser("mail.sidebar"),
      ).resolves.toHaveLength(1);
    });
  });

  it("uninstall only removes the calling user's install row", async () => {
    await insertExtension({
      id: "ext-a",
      ownerEmail: OWNER,
      visibility: "org",
    });

    await runWithRequestContext({ userEmail: OWNER, orgId: ORG }, () =>
      installExtensionSlot("ext-a", "mail.sidebar"),
    );
    await runWithRequestContext({ userEmail: VIEWER, orgId: ORG }, () =>
      installExtensionSlot("ext-a", "mail.sidebar"),
    );

    // VIEWER uninstalls — OWNER's install must remain.
    await runWithRequestContext({ userEmail: VIEWER, orgId: ORG }, async () => {
      await expect(
        uninstallExtensionSlot("ext-a", "mail.sidebar"),
      ).resolves.toBe(true);
      await expect(listSlotInstallsForUser("mail.sidebar")).resolves.toEqual(
        [],
      );
    });
    await runWithRequestContext({ userEmail: OWNER, orgId: ORG }, async () => {
      await expect(
        listSlotInstallsForUser("mail.sidebar"),
      ).resolves.toHaveLength(1);
    });
  });

  it("rejects install/uninstall with no authenticated user", async () => {
    await insertExtension({ id: "ext-a", ownerEmail: OWNER });

    await runWithRequestContext({ userEmail: undefined }, async () => {
      // install runs the access check first; with no user it has no access.
      await expect(
        installExtensionSlot("ext-a", "mail.sidebar"),
      ).rejects.toBeInstanceOf(ForbiddenError);
      // uninstall has no access check — it falls straight to requireUserEmail().
      await expect(
        uninstallExtensionSlot("ext-a", "mail.sidebar"),
      ).rejects.toThrow(/authenticated user/i);
    });
  });
});

describe("extension slots: listSlotInstallsForUser", () => {
  it("sorts by position and lazily skips installs the user lost access to", async () => {
    await insertExtension({ id: "ext-a", ownerEmail: OWNER });
    await insertExtension({ id: "ext-b", ownerEmail: OWNER });
    // ext-gone: owned by an outsider, never shared — represents an extension
    // the user installed earlier but has since lost access to.
    await insertExtension({ id: "ext-gone", ownerEmail: OUTSIDER });

    await runWithRequestContext({ userEmail: OWNER, orgId: ORG }, async () => {
      await installExtensionSlot("ext-b", "mail.sidebar", { position: 5 });
      await installExtensionSlot("ext-a", "mail.sidebar", { position: 1 });
    });

    // Directly insert an install row for ext-gone owned by OWNER (simulating a
    // stale install), so listSlotInstallsForUser must filter it out because
    // accessFilter no longer admits ext-gone.
    sqlite
      .prepare(
        `INSERT INTO tool_slot_installs
          (id, tool_id, slot_id, owner_email, org_id, position, config, created_at, updated_at)
         VALUES ('stale', 'ext-gone', 'mail.sidebar', ?, ?, 2, NULL, '2026-04-30T00:00:00.000Z', '2026-04-30T00:00:00.000Z')`,
      )
      .run(OWNER, ORG);

    await runWithRequestContext({ userEmail: OWNER, orgId: ORG }, async () => {
      const installs = await listSlotInstallsForUser("mail.sidebar");
      // ext-gone is silently dropped; the rest are sorted by position asc.
      expect(installs.map((i) => i.extensionId)).toEqual(["ext-a", "ext-b"]);
      expect(installs[0]).toMatchObject({ name: "ext-a", position: 1 });
      // Joined extension metadata is present.
      expect(installs[0].description).toBe("ext-a description");
    });
  });
});

describe("extension slots: cascadeDeleteExtensionSlots", () => {
  it("removes every declaration and install row referencing the extension", async () => {
    await insertExtension({ id: "ext-a", ownerEmail: OWNER });

    await runWithRequestContext({ userEmail: OWNER, orgId: ORG }, async () => {
      await addExtensionSlotTarget("ext-a", "mail.sidebar");
      await addExtensionSlotTarget("ext-a", "calendar.panel");
      await installExtensionSlot("ext-a", "mail.sidebar");
    });

    await cascadeDeleteExtensionSlots("ext-a");

    const slotRows = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM tool_slots WHERE tool_id = 'ext-a'`)
      .get() as { c: number };
    const installRows = sqlite
      .prepare(
        `SELECT COUNT(*) AS c FROM tool_slot_installs WHERE tool_id = 'ext-a'`,
      )
      .get() as { c: number };
    expect(slotRows.c).toBe(0);
    expect(installRows.c).toBe(0);
  });
});
