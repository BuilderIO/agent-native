import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("scoping", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  describe("buildScopingSqlite", () => {
    it("returns inactive scoping in dev mode", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("AGENT_USER_EMAIL", "user@test.com");
      const { buildScopingSqlite } = await import("./scoping.js");

      const mockClient = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      };

      const ctx = await buildScopingSqlite(mockClient);
      expect(ctx.active).toBe(false);
      expect(ctx.setup).toEqual([]);
      expect(ctx.teardown).toEqual([]);
      expect(ctx.userEmail).toBeNull();
    });

    it("returns inactive scoping when no AGENT_USER_EMAIL in prod", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "");
      const { buildScopingSqlite } = await import("./scoping.js");

      const mockClient = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      };

      const ctx = await buildScopingSqlite(mockClient);
      expect(ctx.active).toBe(false);
      expect(ctx.userEmail).toBeNull();
    });

    it("builds scoping views for core tables in prod mode", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "alice@test.com");
      const { buildScopingSqlite } = await import("./scoping.js");

      // Mock SQLite client that returns tables with their columns
      const mockClient = {
        execute: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("sqlite_master")) {
            return {
              rows: [
                { name: "settings" },
                { name: "application_state" },
                { name: "oauth_tokens" },
                { name: "sessions" },
                { name: "custom_table" },
              ],
            };
          }
          // PRAGMA table_info responses
          if (sql.includes("settings")) {
            return {
              rows: [
                { name: "key" },
                { name: "value" },
                { name: "updated_at" },
              ],
            };
          }
          if (sql.includes("application_state")) {
            return {
              rows: [
                { name: "session_id" },
                { name: "key" },
                { name: "value" },
                { name: "updated_at" },
              ],
            };
          }
          if (sql.includes("oauth_tokens")) {
            return {
              rows: [
                { name: "provider" },
                { name: "account_id" },
                { name: "owner" },
                { name: "tokens" },
                { name: "updated_at" },
              ],
            };
          }
          if (sql.includes("sessions")) {
            return {
              rows: [
                { name: "token" },
                { name: "email" },
                { name: "created_at" },
              ],
            };
          }
          if (sql.includes("custom_table")) {
            return {
              rows: [{ name: "id" }, { name: "owner_email" }, { name: "data" }],
            };
          }
          return { rows: [] };
        }),
      };

      const ctx = await buildScopingSqlite(mockClient);
      expect(ctx.active).toBe(true);
      expect(ctx.userEmail).toBe("alice@test.com");

      // Should have views for all 4 core tables + custom_table with owner_email
      expect(ctx.setup.length).toBe(5);
      expect(ctx.teardown.length).toBe(5);

      // Settings uses prefix mode (LIKE)
      const settingsView = ctx.setup.find((s) => s.includes('"settings"'));
      expect(settingsView).toBeDefined();
      expect(settingsView).toContain("LIKE");
      expect(settingsView).toContain("u:alice@test.com:");

      // application_state uses exact match
      const appStateView = ctx.setup.find((s) =>
        s.includes('"application_state"'),
      );
      expect(appStateView).toBeDefined();
      expect(appStateView).toContain('"session_id" = ');

      // custom_table uses owner_email convention
      const customView = ctx.setup.find((s) => s.includes('"custom_table"'));
      expect(customView).toBeDefined();
      expect(customView).toContain('"owner_email"');
      expect(customView).toContain("alice@test.com");

      // owner_email tables tracking
      expect(ctx.ownerEmailTables.has("custom_table")).toBe(true);
      expect(ctx.ownerEmailTables.has("settings")).toBe(false);

      // Teardown should drop views
      for (const sql of ctx.teardown) {
        expect(sql).toContain("DROP VIEW IF EXISTS");
      }
    });

    it("scopes by org_id when AGENT_ORG_ID is set", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "alice@test.com");
      vi.stubEnv("AGENT_ORG_ID", "org-123");
      const { buildScopingSqlite } = await import("./scoping.js");

      const mockClient = {
        execute: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("sqlite_master")) {
            return {
              rows: [
                { name: "notes" },
                { name: "org_only_table" },
                { name: "plain_table" },
              ],
            };
          }
          if (sql.includes("notes")) {
            return {
              rows: [
                { name: "id" },
                { name: "owner_email" },
                { name: "org_id" },
                { name: "content" },
              ],
            };
          }
          if (sql.includes("org_only_table")) {
            return {
              rows: [{ name: "id" }, { name: "org_id" }, { name: "data" }],
            };
          }
          if (sql.includes("plain_table")) {
            return {
              rows: [{ name: "id" }, { name: "data" }],
            };
          }
          return { rows: [] };
        }),
      };

      const ctx = await buildScopingSqlite(mockClient);
      expect(ctx.active).toBe(true);
      expect(ctx.orgId).toBe("org-123");

      // notes has both owner_email AND org_id — both should appear
      const notesView = ctx.setup.find((s) => s.includes('"notes"'));
      expect(notesView).toContain('"owner_email" = ');
      expect(notesView).toContain('"org_id" = ');
      expect(notesView).toContain("AND");

      // org_only_table has only org_id
      const orgOnlyView = ctx.setup.find((s) => s.includes('"org_only_table"'));
      expect(orgOnlyView).toContain('"org_id" = ');
      expect(orgOnlyView).not.toContain("owner_email");

      // plain_table has neither — should not be scoped
      const plainView = ctx.setup.find((s) => s.includes('"plain_table"'));
      expect(plainView).toBeUndefined();

      // Track org_id tables
      expect(ctx.orgIdTables.has("notes")).toBe(true);
      expect(ctx.orgIdTables.has("org_only_table")).toBe(true);
      expect(ctx.orgIdTables.has("plain_table")).toBe(false);
    });

    it("skips org_id scoping when AGENT_ORG_ID is not set", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "alice@test.com");
      delete process.env.AGENT_ORG_ID;
      const { buildScopingSqlite } = await import("./scoping.js");

      const mockClient = {
        execute: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("sqlite_master")) {
            return { rows: [{ name: "notes" }] };
          }
          return {
            rows: [
              { name: "id" },
              { name: "owner_email" },
              { name: "org_id" },
              { name: "content" },
            ],
          };
        }),
      };

      const ctx = await buildScopingSqlite(mockClient);
      expect(ctx.orgId).toBeNull();

      // Should scope by owner_email but NOT org_id
      const notesView = ctx.setup.find((s) => s.includes('"notes"'));
      expect(notesView).toContain('"owner_email"');
      expect(notesView).not.toContain("org_id");
    });

    it("escapes single quotes in email for SQL safety", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "o'malley@test.com");
      const { buildScopingSqlite } = await import("./scoping.js");

      const mockClient = {
        execute: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("sqlite_master")) {
            return { rows: [{ name: "sessions" }] };
          }
          return {
            rows: [
              { name: "token" },
              { name: "email" },
              { name: "created_at" },
            ],
          };
        }),
      };

      const ctx = await buildScopingSqlite(mockClient);
      const sessionsView = ctx.setup.find((s) => s.includes('"sessions"'));
      // Single quote should be escaped as ''
      expect(sessionsView).toContain("o''malley@test.com");
    });
  });

  describe("buildScopingPostgres", () => {
    it("returns inactive scoping in dev mode", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("AGENT_USER_EMAIL", "user@test.com");
      const { buildScopingPostgres } = await import("./scoping.js");

      const mockPgSql: any = {};
      const ctx = await buildScopingPostgres(mockPgSql);
      expect(ctx.active).toBe(false);
    });

    it("returns inactive scoping when no AGENT_USER_EMAIL", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "");
      const { buildScopingPostgres } = await import("./scoping.js");

      const mockPgSql: any = {};
      const ctx = await buildScopingPostgres(mockPgSql);
      expect(ctx.active).toBe(false);
    });

    it("builds scoping views for postgres with public. qualifier", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "bob@test.com");
      const { buildScopingPostgres } = await import("./scoping.js");

      // Mock template-tagged postgres query
      const mockPgSql: any = async function (
        strings: TemplateStringsArray,
      ): Promise<any[]> {
        return [
          { table_name: "settings", column_name: "key" },
          { table_name: "settings", column_name: "value" },
          { table_name: "settings", column_name: "updated_at" },
          { table_name: "tasks", column_name: "id" },
          { table_name: "tasks", column_name: "owner_email" },
          { table_name: "tasks", column_name: "data" },
        ];
      };

      const ctx = await buildScopingPostgres(mockPgSql);
      expect(ctx.active).toBe(true);
      expect(ctx.userEmail).toBe("bob@test.com");

      // Postgres views should use public. prefix
      const settingsView = ctx.setup.find((s) => s.includes('"settings"'));
      expect(settingsView).toContain("public.");

      const tasksView = ctx.setup.find((s) => s.includes('"tasks"'));
      expect(tasksView).toBeDefined();
      expect(tasksView).toContain("public.");
      expect(tasksView).toContain('"owner_email"');

      expect(ctx.ownerEmailTables.has("tasks")).toBe(true);
    });
  });
});
