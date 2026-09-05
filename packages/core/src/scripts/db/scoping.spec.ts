import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("scoping", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe("buildScopingPostgres", () => {
    it("activates scoping in dev mode when a user is set (was previously inactive — now scopes always when user is present)", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("AGENT_USER_EMAIL", "user+qa@test.com");
      const { buildScopingPostgres } = await import("./scoping.js");

      const mockClient = {
        unsafe: vi.fn().mockResolvedValue([
          { table_name: "settings", column_name: "key" },
          { table_name: "application_state", column_name: "session_id" },
          { table_name: "oauth_tokens", column_name: "owner" },
          { table_name: "sessions", column_name: "email" },
          { table_name: "custom_table", column_name: "owner_email" },
        ]),
      };

      const ctx = await buildScopingPostgres(mockClient);
      expect(ctx.active).toBe(true);
      expect(ctx.userEmail).toBe("user+qa@test.com");
      expect(ctx.setup.length).toBeGreaterThan(0);
    });

    it("throws when there is no request user (no inactive fallback — would silently land writes with the dev sentinel owner_email)", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "");
      const { buildScopingPostgres } = await import("./scoping.js");

      const mockClient = {
        unsafe: vi.fn(),
      };

      await expect(buildScopingPostgres(mockClient)).rejects.toThrow(
        "require an authenticated user identity",
      );
      expect(mockClient.unsafe).not.toHaveBeenCalled();
    });

    it("builds scoping views for core tables in prod mode", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "alice+qa@test.com");
      const { buildScopingPostgres } = await import("./scoping.js");

      // Mock PostgreSQL client that returns tables with their columns
      const mockClient = {
        unsafe: vi.fn().mockResolvedValue([
          { table_name: "settings", column_name: "key" },
          { table_name: "application_state", column_name: "session_id" },
          { table_name: "oauth_tokens", column_name: "owner" },
          { table_name: "sessions", column_name: "email" },
          { table_name: "custom_table", column_name: "owner_email" },
        ]),
      };

      const ctx = await buildScopingPostgres(mockClient);
      expect(ctx.active).toBe(true);
      expect(ctx.userEmail).toBe("alice+qa@test.com");

      // Should have views for all 4 core tables + custom_table with owner_email
      expect(ctx.setup.length).toBe(5);
      expect(ctx.teardown.length).toBe(5);

      // Settings uses prefix mode (LIKE)
      const settingsView = ctx.setup.find((s) => s.includes('"settings"'));
      expect(settingsView).toBeDefined();
      expect(settingsView).toContain("LIKE");
      expect(settingsView).toContain("u:alice+qa@test.com:");

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
      expect(customView).toContain("alice+qa@test.com");

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
      vi.stubEnv("AGENT_USER_EMAIL", "alice+qa@test.com");
      vi.stubEnv("AGENT_ORG_ID", "org-123");
      const { buildScopingPostgres } = await import("./scoping.js");

      const mockClient = {
        unsafe: vi.fn().mockResolvedValue([
          { table_name: "notes", column_name: "id" },
          { table_name: "notes", column_name: "owner_email" },
          { table_name: "notes", column_name: "org_id" },
          { table_name: "notes", column_name: "content" },
          { table_name: "org_only_table", column_name: "id" },
          { table_name: "org_only_table", column_name: "org_id" },
          { table_name: "org_only_table", column_name: "data" },
          { table_name: "plain_table", column_name: "id" },
          { table_name: "plain_table", column_name: "data" },
        ]),
      };

      const ctx = await buildScopingPostgres(mockClient);
      expect(ctx.active).toBe(true);
      expect(ctx.orgId).toBe("org-123");

      // notes has both owner_email AND org_id — the user owns rows in the
      // current org plus legacy/personal rows with no org.
      const notesView = ctx.setup.find((s) => s.includes('"notes"'));
      expect(notesView).toContain('"owner_email" = ');
      expect(notesView).toContain('"org_id" = ');
      expect(notesView).toContain('OR "org_id" IS NULL');

      // org_only_table has only org_id
      const orgOnlyView = ctx.setup.find((s) => s.includes('"org_only_table"'));
      expect(orgOnlyView).toContain('"org_id" = ');
      expect(orgOnlyView).not.toContain("owner_email");

      // plain_table has neither — raw DB tools must fail closed instead of
      // falling through to a cross-tenant base table.
      const plainView = ctx.setup.find((s) => s.includes('"plain_table"'));
      expect(plainView).toBeDefined();
      expect(plainView).toContain("WHERE 1 = 0");

      // Track org_id tables
      expect(ctx.orgIdTables.has("notes")).toBe(true);
      expect(ctx.orgIdTables.has("org_only_table")).toBe(true);
      expect(ctx.orgIdTables.has("plain_table")).toBe(false);
    });

    it("scopes resources by the nonstandard owner column", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "reader+qa@test.com");
      const { buildScopingPostgres } = await import("./scoping.js");

      const mockClient = {
        unsafe: vi.fn().mockResolvedValue([
          { table_name: "resources", column_name: "id" },
          { table_name: "resources", column_name: "path" },
          { table_name: "resources", column_name: "owner" },
          { table_name: "resources", column_name: "content" },
        ]),
      };

      const ctx = await buildScopingPostgres(mockClient);
      const resourcesView = ctx.setup.find((s) => s.includes('"resources"'));
      expect(resourcesView).toBeDefined();
      expect(resourcesView).toContain(`"owner" = 'reader+qa@test.com'`);
      expect(resourcesView).not.toContain("__shared__");
    });

    it("skips org_id scoping when AGENT_ORG_ID is not set", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "alice+qa@test.com");
      delete process.env.AGENT_ORG_ID;
      const { buildScopingPostgres } = await import("./scoping.js");

      const mockClient = {
        unsafe: vi.fn().mockResolvedValue([
          { table_name: "notes", column_name: "id" },
          { table_name: "notes", column_name: "owner_email" },
          { table_name: "notes", column_name: "org_id" },
          { table_name: "notes", column_name: "content" },
        ]),
      };

      const ctx = await buildScopingPostgres(mockClient);
      expect(ctx.orgId).toBeNull();

      // Should scope by owner_email but NOT org_id
      const notesView = ctx.setup.find((s) => s.includes('"notes"'));
      expect(notesView).toContain('"owner_email"');
      expect(notesView).not.toContain("org_id");
    });

    it("keeps owner legacy rows visible when org scoping is active", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "legacy-owner@test.com");
      vi.stubEnv("AGENT_ORG_ID", "org-current");
      const { buildScopingPostgres } = await import("./scoping.js");

      const mockClient = {
        unsafe: vi.fn().mockResolvedValue([
          { table_name: "decks", column_name: "id" },
          { table_name: "decks", column_name: "owner_email" },
          { table_name: "decks", column_name: "org_id" },
          { table_name: "decks", column_name: "title" },
        ]),
      };

      const ctx = await buildScopingPostgres(mockClient);
      const decksView = ctx.setup.find((s) => s.includes('"decks"'));

      expect(decksView).toContain(`"owner_email" = 'legacy-owner@test.com'`);
      expect(decksView).toContain(
        `("org_id" = 'org-current' OR "org_id" IS NULL)`,
      );
    });

    it("scopes tool_data to private user rows plus matching org rows", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "tools+qa@test.com");
      vi.stubEnv("AGENT_ORG_ID", "org-tools-qa");
      const { buildScopingPostgres } = await import("./scoping.js");

      const mockClient = {
        unsafe: vi.fn().mockResolvedValue([
          { table_name: "tool_data", column_name: "tool_id" },
          { table_name: "tool_data", column_name: "collection" },
          { table_name: "tool_data", column_name: "scope" },
          { table_name: "tool_data", column_name: "owner_email" },
          { table_name: "tool_data", column_name: "org_id" },
          { table_name: "tool_data", column_name: "data" },
        ]),
      };

      const ctx = await buildScopingPostgres(mockClient);
      const toolDataView = ctx.setup.find((s) => s.includes('"tool_data"'));

      expect(toolDataView).toContain(
        `"scope" = 'user' AND "owner_email" = 'tools+qa@test.com'`,
      );
      expect(toolDataView).toContain(
        `"scope" = 'org' AND "org_id" = 'org-tools-qa'`,
      );
      expect(toolDataView).toContain(" OR ");
    });

    it("refuses to scope DB scripts to the local fallback identity", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("AGENT_USER_EMAIL", "local@localhost");
      const { buildScopingPostgres } = await import("./scoping.js");

      const mockClient = {
        unsafe: vi.fn(),
      };

      await expect(buildScopingPostgres(mockClient)).rejects.toThrow(
        "require an authenticated user identity",
      );
      expect(mockClient.unsafe).not.toHaveBeenCalled();
    });

    it("escapes single quotes in email for SQL safety", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "o'malley+qa@test.com");
      const { buildScopingPostgres } = await import("./scoping.js");

      const mockClient = {
        unsafe: vi.fn().mockResolvedValue([
          { table_name: "sessions", column_name: "token" },
          { table_name: "sessions", column_name: "email" },
          { table_name: "sessions", column_name: "created_at" },
        ]),
      };

      const ctx = await buildScopingPostgres(mockClient);
      const sessionsView = ctx.setup.find((s) => s.includes('"sessions"'));
      // Single quote should be escaped as ''
      expect(sessionsView).toContain("o''malley+qa@test.com");
    });
  });

  describe("buildScopingPostgres", () => {
    it("activates scoping in dev mode when a user is set (was previously inactive — now scopes always when user is present)", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("AGENT_USER_EMAIL", "user+qa@test.com");
      const { buildScopingPostgres } = await import("./scoping.js");

      const mockPgSql: any = async function (
        _strings: TemplateStringsArray,
      ): Promise<any[]> {
        return [{ table_name: "tasks", column_name: "owner_email" }];
      };
      const ctx = await buildScopingPostgres({ unsafe: mockPgSql });
      expect(ctx.active).toBe(true);
      expect(ctx.userEmail).toBe("user+qa@test.com");
    });

    it("throws when there is no request user (matches postgres path — refuses to run unscoped against a multi-user database)", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "");
      const { buildScopingPostgres } = await import("./scoping.js");

      const mockPgSql = vi.fn();
      await expect(buildScopingPostgres({ unsafe: mockPgSql })).rejects.toThrow(
        "require an authenticated user identity",
      );
      expect(mockPgSql).not.toHaveBeenCalled();
    });

    it("refuses to scope Postgres DB scripts to the local fallback identity", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("AGENT_USER_EMAIL", "local@localhost");
      const { buildScopingPostgres } = await import("./scoping.js");

      const mockPgSql = vi.fn();

      await expect(buildScopingPostgres({ unsafe: mockPgSql })).rejects.toThrow(
        "require an authenticated user identity",
      );
      expect(mockPgSql).not.toHaveBeenCalled();
    });

    it("emits WITH LOCAL CHECK OPTION on scoped views (Postgres) so INSERTs/UPDATEs through the view can't escape the WHERE filter", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "alice+qa@test.com");
      const { buildScopingPostgres } = await import("./scoping.js");

      const mockPgSql: any = async function (): Promise<any[]> {
        return [
          { table_name: "tasks", column_name: "id" },
          { table_name: "tasks", column_name: "owner_email" },
          { table_name: "tasks", column_name: "data" },
        ];
      };

      const ctx = await buildScopingPostgres({ unsafe: mockPgSql });
      const tasksView = ctx.setup.find((s) => s.includes('"tasks"'));
      expect(tasksView).toBeDefined();
      expect(tasksView).toContain("CREATE OR REPLACE TEMPORARY VIEW");
      expect(tasksView).toContain("WITH LOCAL CHECK OPTION");
      expect(ctx.teardown).toContain('DROP VIEW IF EXISTS pg_temp."tasks"');
    });

    it("builds scoping views for postgres with public. qualifier", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "bob+qa@test.com");
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

      const ctx = await buildScopingPostgres({ unsafe: mockPgSql });
      expect(ctx.active).toBe(true);
      expect(ctx.userEmail).toBe("bob+qa@test.com");

      // Postgres views should use public. prefix
      const settingsView = ctx.setup.find((s) => s.includes('"settings"'));
      expect(settingsView).toContain("public.");

      const tasksView = ctx.setup.find((s) => s.includes('"tasks"'));
      expect(tasksView).toBeDefined();
      expect(tasksView).toContain("public.");
      expect(tasksView).toContain('"owner_email"');

      expect(ctx.ownerEmailTables.has("tasks")).toBe(true);
    });

    it("creates deny-all Postgres views for tables without scoping columns", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "deny+qa@test.com");
      const { buildScopingPostgres } = await import("./scoping.js");

      const mockPgSql: any = async function (): Promise<any[]> {
        return [
          { table_name: "bookings", column_name: "id" },
          { table_name: "bookings", column_name: "email" },
          { table_name: "bookings", column_name: "status" },
        ];
      };

      const ctx = await buildScopingPostgres({ unsafe: mockPgSql });
      const bookingsView = ctx.setup.find((s) => s.includes('"bookings"'));

      expect(bookingsView).toBeDefined();
      expect(bookingsView).toContain("WHERE 1 = 0");
      expect(bookingsView).toContain("WITH LOCAL CHECK OPTION");
    });

    it("keeps owner legacy rows visible in postgres when org scoping is active", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("AGENT_USER_EMAIL", "legacy-pg@test.com");
      vi.stubEnv("AGENT_ORG_ID", "org-pg");
      const { buildScopingPostgres } = await import("./scoping.js");

      const mockPgSql: any = async function (): Promise<any[]> {
        return [
          { table_name: "decks", column_name: "id" },
          { table_name: "decks", column_name: "owner_email" },
          { table_name: "decks", column_name: "org_id" },
          { table_name: "decks", column_name: "title" },
        ];
      };

      const ctx = await buildScopingPostgres({ unsafe: mockPgSql });
      const decksView = ctx.setup.find((s) => s.includes('"decks"'));

      expect(decksView).toContain(`"owner_email" = 'legacy-pg@test.com'`);
      expect(decksView).toContain(`("org_id" = 'org-pg' OR "org_id" IS NULL)`);
      expect(decksView).toContain("WITH LOCAL CHECK OPTION");
    });
  });
});
