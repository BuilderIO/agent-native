import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

type Pglite = Awaited<ReturnType<typeof createTestPglite>>;

function createPgliteExec(
  pglite: Pglite,
  reportPartialMarker = false,
  shouldFailLocalCleanup?: () => boolean,
) {
  const execute = async (
    client: Pick<Pglite, "prepare">,
    input: string | { sql: string; args?: unknown[] },
  ) => {
    const sql = typeof input === "string" ? input : input.sql;
    const args = typeof input === "string" ? [] : (input.args ?? []);
    if (sql.trimStart().toUpperCase().startsWith("SELECT")) {
      return {
        rows: await client.prepare(sql).all(...(args as any[])),
        rowsAffected: 0,
      };
    }
    if (
      sql.includes("DELETE FROM org_members") &&
      sql.includes("federation_removal_pending_at IS NOT NULL") &&
      shouldFailLocalCleanup?.()
    ) {
      throw new Error("simulated local cleanup failure");
    }
    const result = await client.prepare(sql).run(...(args as any[]));
    return {
      rows: [],
      rowsAffected:
        reportPartialMarker && sql.includes("SET federation_removal_pending_at")
          ? 1
          : result.changes,
    };
  };

  return {
    execute: (input: string | { sql: string; args?: unknown[] }) =>
      execute(pglite, input),
    transaction: async <T>(
      fn: (tx: { execute: typeof execute }) => Promise<T>,
    ) => {
      await pglite.exec("BEGIN");
      try {
        const value = await fn({ execute: (input) => execute(pglite, input) });
        await pglite.exec("COMMIT");
        return value;
      } catch (error) {
        await pglite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

async function seedMembers(pglite: Pglite) {
  await pglite.exec(`
    CREATE TABLE org_members (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at BIGINT NOT NULL,
      federation_removal_pending_at BIGINT
    );
  `);
}

async function loadHandlers(
  pglite: Pglite,
  options: {
    actorRole: "owner" | "admin";
    reportPartialMarker?: boolean;
    failLocalCleanupOnce?: boolean;
    revoke?: () => Promise<boolean>;
    updateRole?: () => Promise<boolean>;
  },
) {
  const revoke = vi.fn(options.revoke ?? (async () => true));
  const updateRole = vi.fn(options.updateRole ?? (async () => true));
  let failLocalCleanup = options.failLocalCleanupOnce ?? false;
  vi.doMock("h3", () => ({
    createError: ({
      statusCode,
      message,
    }: {
      statusCode: number;
      message: string;
    }) => Object.assign(new Error(message), { statusCode }),
    defineEventHandler: (handler: unknown) => handler,
    getRequestURL: (event: { _url: string }) => new URL(event._url),
    getRouterParam: () => undefined,
  }));
  vi.doMock("../db/client.js", () => ({
    getDbExec: () =>
      createPgliteExec(pglite, options.reportPartialMarker, () => {
        if (!failLocalCleanup) return false;
        failLocalCleanup = false;
        return true;
      }),
  }));
  vi.doMock("./context.js", () => ({
    createOrganization: vi.fn(),
    getOrgContext: vi.fn(async () => ({
      email: `${options.actorRole}@example.test`,
      orgId: "org-1",
      orgName: "Example",
      role: options.actorRole,
    })),
  }));
  vi.doMock("./federation.js", () => ({
    addFederatedOrganizationMember: vi.fn(),
    revokeFederatedOrganizationMember: revoke,
    syncOrganizationToIdentityHub: vi.fn(),
    updateFederatedOrganizationMemberRole: updateRole,
  }));
  vi.doMock("../server/h3-helpers.js", () => ({
    readBody: (event: { _body: unknown }) => Promise.resolve(event._body),
  }));

  const handlers = await import("./handlers.js");
  return { ...handlers, revoke, updateRole };
}

function event(path: string, body?: unknown) {
  return { _url: `https://app.example.test${path}`, _body: body } as any;
}

describe("member mutation guards (real pglite)", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("h3");
    vi.doUnmock("../db/client.js");
    vi.doUnmock("./context.js");
    vi.doUnmock("./federation.js");
    vi.doUnmock("../server/h3-helpers.js");
  });

  it.each([
    ["admin", "member"],
    ["owner", "admin"],
  ] as const)(
    "marks then removes a %s-authorized %s through the real conditional SQL",
    async (actorRole, memberRole) => {
      const pglite = await createTestPglite();
      await seedMembers(pglite);
      await pglite
        .prepare(
          `INSERT INTO org_members (id, org_id, email, role, joined_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run("member-1", "org-1", "Member@Example.test", memberRole, 1);

      try {
        const { removeMemberHandler, revoke } = await loadHandlers(pglite, {
          actorRole,
          revoke: async () => {
            const row = await pglite
              .prepare(
                `SELECT federation_removal_pending_at FROM org_members
                 WHERE org_id = ? AND LOWER(email) = ?`,
              )
              .get("org-1", "member@example.test");
            expect(row).toMatchObject({
              federation_removal_pending_at: expect.any(Number),
            });
            return true;
          },
        });

        await expect(
          removeMemberHandler(
            event("/_agent-native/org/members/member@example.test"),
          ),
        ).resolves.toEqual({ success: true });
        expect(revoke).toHaveBeenCalledTimes(1);
        expect(await pglite.prepare(`SELECT * FROM org_members`).all()).toEqual(
          [],
        );
      } finally {
        await pglite.close();
      }
    },
  );

  it("rolls back a partial marker claim before any remote revoke", async () => {
    const pglite = await createTestPglite();
    await seedMembers(pglite);
    await pglite
      .prepare(
        `INSERT INTO org_members (id, org_id, email, role, joined_at)
         VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
      )
      .run(
        "member-1",
        "org-1",
        "Member@Example.test",
        "member",
        1,
        "member-2",
        "org-1",
        "member@example.test",
        "member",
        2,
      );

    try {
      const { removeMemberHandler, revoke } = await loadHandlers(pglite, {
        actorRole: "owner",
        reportPartialMarker: true,
      });
      await expect(
        removeMemberHandler(
          event("/_agent-native/org/members/member@example.test"),
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(revoke).not.toHaveBeenCalled();
      expect(
        await pglite
          .prepare(
            `SELECT federation_removal_pending_at FROM org_members
             WHERE org_id = ? ORDER BY id`,
          )
          .all("org-1"),
      ).toEqual([
        { federation_removal_pending_at: null },
        { federation_removal_pending_at: null },
      ]);
    } finally {
      await pglite.close();
    }
  });

  it("accepts local cleanup when a shared authority already deleted the claimed row", async () => {
    const pglite = await createTestPglite();
    await seedMembers(pglite);
    await pglite
      .prepare(
        `INSERT INTO org_members (id, org_id, email, role, joined_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("member-1", "org-1", "member@example.test", "member", 1);

    try {
      const { removeMemberHandler } = await loadHandlers(pglite, {
        actorRole: "owner",
        revoke: async () => {
          await pglite
            .prepare(
              `DELETE FROM org_members
               WHERE org_id = ? AND LOWER(email) = ?
                 AND federation_removal_pending_at IS NOT NULL`,
            )
            .run("org-1", "member@example.test");
          return true;
        },
      });

      await expect(
        removeMemberHandler(
          event("/_agent-native/org/members/member@example.test"),
        ),
      ).resolves.toEqual({ success: true });
    } finally {
      await pglite.close();
    }
  });

  it.each(["owner", "admin"] as const)(
    "retries pending local cleanup through the original %s DELETE",
    async (actorRole) => {
      const pglite = await createTestPglite();
      await seedMembers(pglite);
      await pglite
        .prepare(
          `INSERT INTO org_members (id, org_id, email, role, joined_at)
         VALUES (?, ?, ?, ?, ?)`,
        )
        .run("member-1", "org-1", "member@example.test", "member", 1);

      try {
        let authorityMarker: number | undefined;
        const { removeMemberHandler, revoke } = await loadHandlers(pglite, {
          actorRole,
          failLocalCleanupOnce: true,
          revoke: async () => {
            const row = await pglite
              .prepare(
                `SELECT federation_removal_pending_at FROM org_members
               WHERE org_id = ? AND LOWER(email) = ?`,
              )
              .get("org-1", "member@example.test");
            const marker = Number(
              (row as { federation_removal_pending_at: number })
                .federation_removal_pending_at,
            );
            if (authorityMarker === undefined) authorityMarker = marker;
            else expect(marker).toBe(authorityMarker);
            return true;
          },
        });
        const memberPath = "/_agent-native/org/members/member@example.test";

        await expect(
          removeMemberHandler(event(memberPath)),
        ).rejects.toMatchObject({
          statusCode: 503,
        });
        const pending = await pglite
          .prepare(
            `SELECT federation_removal_pending_at FROM org_members
           WHERE org_id = ? AND LOWER(email) = ?`,
          )
          .get("org-1", "member@example.test");
        expect(pending).toMatchObject({
          federation_removal_pending_at: expect.any(Number),
        });

        await expect(removeMemberHandler(event(memberPath))).resolves.toEqual({
          success: true,
        });
        expect(revoke).toHaveBeenCalledTimes(2);
        expect(await pglite.prepare(`SELECT * FROM org_members`).all()).toEqual(
          [],
        );
      } finally {
        await pglite.close();
      }
    },
  );

  it("retries after the authority revokes the member but loses its response", async () => {
    const pglite = await createTestPglite();
    await seedMembers(pglite);
    await pglite
      .prepare(
        `INSERT INTO org_members (id, org_id, email, role, joined_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("member-1", "org-1", "member@example.test", "member", 1);

    try {
      let authorityHasMember = true;
      const { removeMemberHandler, revoke } = await loadHandlers(pglite, {
        actorRole: "owner",
        revoke: async () => {
          if (authorityHasMember) {
            authorityHasMember = false;
            throw new Error("lost authority response after revocation");
          }
          return true;
        },
      });
      const memberPath = "/_agent-native/org/members/member@example.test";

      await expect(
        removeMemberHandler(event(memberPath)),
      ).rejects.toMatchObject({
        statusCode: 503,
      });
      expect(authorityHasMember).toBe(false);
      expect(
        await pglite
          .prepare(
            `SELECT federation_removal_pending_at FROM org_members WHERE id = ?`,
          )
          .get("member-1"),
      ).toMatchObject({ federation_removal_pending_at: expect.any(Number) });

      await expect(removeMemberHandler(event(memberPath))).resolves.toEqual({
        success: true,
      });
      expect(revoke).toHaveBeenCalledTimes(2);
      expect(await pglite.prepare(`SELECT * FROM org_members`).all()).toEqual(
        [],
      );
    } finally {
      await pglite.close();
    }
  });

  it("reauthorizes a pending target before retrying local cleanup", async () => {
    const pglite = await createTestPglite();
    await seedMembers(pglite);
    await pglite
      .prepare(
        `INSERT INTO org_members
          (id, org_id, email, role, joined_at, federation_removal_pending_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("admin-1", "org-1", "admin@example.test", "admin", 1, 1);

    try {
      const { removeMemberHandler, revoke } = await loadHandlers(pglite, {
        actorRole: "admin",
      });

      await expect(
        removeMemberHandler(
          event("/_agent-native/org/members/admin@example.test"),
        ),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(revoke).not.toHaveBeenCalled();
      expect(
        await pglite
          .prepare(
            `SELECT federation_removal_pending_at FROM org_members WHERE id = ?`,
          )
          .get("admin-1"),
      ).toEqual({ federation_removal_pending_at: 1 });
    } finally {
      await pglite.close();
    }
  });

  it("fails closed when duplicate target rows disagree on pending state", async () => {
    const pglite = await createTestPglite();
    await seedMembers(pglite);
    await pglite
      .prepare(
        `INSERT INTO org_members
          (id, org_id, email, role, joined_at, federation_removal_pending_at)
         VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "member-1",
        "org-1",
        "Member@Example.test",
        "member",
        1,
        1,
        "member-2",
        "org-1",
        "member@example.test",
        "member",
        2,
        null,
      );

    try {
      const { removeMemberHandler, revoke } = await loadHandlers(pglite, {
        actorRole: "owner",
      });

      await expect(
        removeMemberHandler(
          event("/_agent-native/org/members/member@example.test"),
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(revoke).not.toHaveBeenCalled();
      expect(
        await pglite
          .prepare(
            `SELECT federation_removal_pending_at FROM org_members
             WHERE org_id = ? ORDER BY id`,
          )
          .all("org-1"),
      ).toEqual([
        { federation_removal_pending_at: 1 },
        { federation_removal_pending_at: null },
      ]);
    } finally {
      await pglite.close();
    }
  });

  it("reports a stale role promotion after removal starts instead of claiming local success", async () => {
    const pglite = await createTestPglite();
    await seedMembers(pglite);
    await pglite
      .prepare(
        `INSERT INTO org_members (id, org_id, email, role, joined_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("member-1", "org-1", "member@example.test", "member", 1);

    try {
      const { changeMemberRoleHandler, updateRole } = await loadHandlers(
        pglite,
        {
          actorRole: "owner",
          updateRole: async () => {
            await pglite
              .prepare(
                `UPDATE org_members SET federation_removal_pending_at = ?
                 WHERE org_id = ? AND LOWER(email) = ?`,
              )
              .run(Date.now(), "org-1", "member@example.test");
            return true;
          },
        },
      );

      await expect(
        changeMemberRoleHandler(
          event("/_agent-native/org/members/member@example.test/role", {
            role: "admin",
          }),
        ),
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(updateRole).toHaveBeenCalledTimes(1);
      expect(
        await pglite
          .prepare(`SELECT role FROM org_members WHERE id = ?`)
          .get("member-1"),
      ).toEqual({ role: "member" });
    } finally {
      await pglite.close();
    }
  });

  it("rejects a role change for a removal already in progress before federation", async () => {
    const pglite = await createTestPglite();
    await seedMembers(pglite);
    await pglite
      .prepare(
        `INSERT INTO org_members
          (id, org_id, email, role, joined_at, federation_removal_pending_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("member-1", "org-1", "member@example.test", "member", 1, Date.now());

    try {
      const { changeMemberRoleHandler, updateRole } = await loadHandlers(
        pglite,
        { actorRole: "owner" },
      );

      await expect(
        changeMemberRoleHandler(
          event("/_agent-native/org/members/member@example.test/role", {
            role: "admin",
          }),
        ),
      ).rejects.toMatchObject({ statusCode: 503 });
      expect(updateRole).not.toHaveBeenCalled();
    } finally {
      await pglite.close();
    }
  });

  it("accepts the desired role when a shared authority applied it first", async () => {
    const pglite = await createTestPglite();
    await seedMembers(pglite);
    await pglite
      .prepare(
        `INSERT INTO org_members (id, org_id, email, role, joined_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("member-1", "org-1", "member@example.test", "member", 1);

    try {
      const { changeMemberRoleHandler, updateRole } = await loadHandlers(
        pglite,
        {
          actorRole: "owner",
          updateRole: async () => {
            await pglite
              .prepare(
                `UPDATE org_members SET role = ?
                 WHERE org_id = ? AND LOWER(email) = ?`,
              )
              .run("admin", "org-1", "member@example.test");
            return true;
          },
        },
      );

      await expect(
        changeMemberRoleHandler(
          event("/_agent-native/org/members/member@example.test/role", {
            role: "admin",
          }),
        ),
      ).resolves.toEqual({ email: "member@example.test", role: "admin" });
      expect(updateRole).toHaveBeenCalledTimes(1);
    } finally {
      await pglite.close();
    }
  });
});
