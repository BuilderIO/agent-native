import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic org members in a local PGlite database. Each case runs the real
// first-party query path as one member and checks which recordings come back.

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const database = vi.hoisted(() => ({
  client: null as null | {
    query: (
      sql: string,
      args: unknown[],
    ) => Promise<{ rows: unknown[]; affectedRows?: number }>;
  },
}));

vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  getDbExec: () => ({
    execute: async ({ sql, args }: { sql: string; args?: unknown[] }) => {
      if (!database.client) throw new Error("test database is not open");
      const result = await database.client.query(sql, args ?? []);
      return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
    },
  }),
}));
vi.mock("./first-party-analytics-backend.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("./first-party-analytics-backend.js")
  >()),
  getFirstPartyAnalyticsBackend: async () => ({
    sink: "postgres",
    table: null,
    backfillCursor: null,
    backfillCompleted: false,
  }),
}));
vi.mock("./first-party-analytics-health.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("./first-party-analytics-health.js")
  >()),
  recordFirstPartyAnalyticsQueryPressure: async () => {},
}));

import { firstPartyCacheKey } from "./first-party-analytics-cache.js";
import { queryFirstPartyAnalytics } from "./first-party-analytics.js";

const ALICE = { userEmail: "alice@example.test", orgId: "org_a" };
const BOB = { userEmail: "bob@example.test", orgId: "org_a" };
const CAROL = { userEmail: "carol@example.test", orgId: "org_b" };

describe("first-party session recording reads follow the app's sharing rules (PGlite)", () => {
  let client: PGliteClient;

  beforeEach(async () => {
    client = await PGlite.create("memory://");
    database.client = client;
    await client.exec(`
      CREATE TABLE session_recordings (
        id text PRIMARY KEY,
        session_id text NOT NULL,
        started_at text NOT NULL,
        owner_email text NOT NULL,
        org_id text,
        visibility text NOT NULL DEFAULT 'private'
      );
      CREATE TABLE session_recording_shares (
        id text PRIMARY KEY,
        resource_id text NOT NULL,
        principal_type text NOT NULL,
        principal_id text NOT NULL,
        role text NOT NULL DEFAULT 'viewer',
        created_by text NOT NULL DEFAULT '',
        created_at text NOT NULL DEFAULT ''
      );
      CREATE TABLE first_party_analytics_cache (
        key text PRIMARY KEY,
        sql text NOT NULL,
        result text NOT NULL,
        created_at text NOT NULL,
        expires_at text NOT NULL
      );
      INSERT INTO session_recordings (id, session_id, started_at, owner_email, org_id, visibility) VALUES
        ('alice-org-visible', 's1', '2026-01-10T00:00:00Z', 'alice@example.test', 'org_a', 'org'),
        ('alice-private', 's2', '2026-01-11T00:00:00Z', 'alice@example.test', 'org_a', 'private'),
        ('alice-private-shared-with-bob', 's3', '2026-01-12T00:00:00Z', 'alice@example.test', 'org_a', 'private'),
        ('alice-private-shared-with-org', 's4', '2026-01-13T00:00:00Z', 'alice@example.test', 'org_a', 'private'),
        ('alice-personal', 's5', '2026-01-14T00:00:00Z', 'alice@example.test', NULL, 'private'),
        ('bob-private', 's6', '2026-01-15T00:00:00Z', 'bob@example.test', 'org_a', 'private'),
        ('carol-org-visible', 's7', '2026-01-16T00:00:00Z', 'carol@example.test', 'org_b', 'org');
      INSERT INTO session_recording_shares (id, resource_id, principal_type, principal_id) VALUES
        ('share-bob', 'alice-private-shared-with-bob', 'user', 'bob@example.test'),
        ('share-org', 'alice-private-shared-with-org', 'org', 'org_a');
    `);
  });

  afterEach(async () => {
    database.client = null;
    await client?.close();
  });

  async function recordingIds(
    sql: string,
    scope: {
      userEmail: string;
      orgId: string | null;
      credentialScope?: "org";
    },
    options: { cache?: boolean } = {},
  ): Promise<string[]> {
    const result = await queryFirstPartyAnalytics(sql, scope, options);
    return result.rows.map((row) => String(row.id)).sort();
  }

  it("keeps another member's private recording out of an org member's reads", async () => {
    expect(
      await recordingIds("SELECT id FROM session_recordings ORDER BY id", BOB),
    ).toEqual([
      "alice-org-visible",
      "alice-private-shared-with-bob",
      "alice-private-shared-with-org",
      "bob-private",
    ]);
  });

  it("still gives the owner their private and personal recordings", async () => {
    expect(
      await recordingIds(
        "SELECT id FROM session_recordings ORDER BY id",
        ALICE,
      ),
    ).toEqual([
      "alice-org-visible",
      "alice-personal",
      "alice-private",
      "alice-private-shared-with-bob",
      "alice-private-shared-with-org",
    ]);
  });

  it("keeps org-credential reads on the organization's rows the viewer can access", async () => {
    expect(
      await recordingIds("SELECT id FROM session_recordings ORDER BY id", {
        ...BOB,
        credentialScope: "org",
      }),
    ).toEqual([
      "alice-org-visible",
      "alice-private-shared-with-bob",
      "alice-private-shared-with-org",
      "bob-private",
    ]);
    expect(
      await recordingIds("SELECT id FROM session_recordings ORDER BY id", {
        ...ALICE,
        credentialScope: "org",
      }),
    ).not.toContain("alice-personal");
  });

  it("never returns another organization's recordings", async () => {
    expect(
      await recordingIds(
        "SELECT id FROM session_recordings ORDER BY id",
        CAROL,
      ),
    ).toEqual(["carol-org-visible"]);
  });

  it("does not serve one member's cached recordings to another, cold or warm", async () => {
    const sql = "SELECT id FROM session_recordings AS cached_cold ORDER BY id";
    const orgCredentialAlice = { ...ALICE, credentialScope: "org" as const };
    const orgCredentialBob = { ...BOB, credentialScope: "org" as const };

    const aliceCold = await recordingIds(sql, orgCredentialAlice, {
      cache: true,
    });
    expect(aliceCold).toContain("alice-private");
    const bobWarm = await recordingIds(sql, orgCredentialBob, { cache: true });
    expect(bobWarm).not.toContain("alice-private");
    const aliceWarm = await recordingIds(sql, orgCredentialAlice, {
      cache: true,
    });
    expect(aliceWarm).toEqual(aliceCold);
  });

  it("does not share an in-flight cached read between members", async () => {
    const sql =
      "SELECT id FROM session_recordings AS cached_concurrent ORDER BY id";
    const [alice, bob] = await Promise.all([
      recordingIds(sql, { ...ALICE, credentialScope: "org" }, { cache: true }),
      recordingIds(sql, { ...BOB, credentialScope: "org" }, { cache: true }),
    ]);
    expect(alice).toContain("alice-private");
    expect(bob).not.toContain("alice-private");
  });
});

describe("firstPartyCacheKey", () => {
  it("names the actor and tenant even when the SQL and binds match", () => {
    const sql = "SELECT 1";
    const args = ["org_a", "2026-07-01"];
    const keys = new Set([
      firstPartyCacheKey(sql, args, ALICE),
      firstPartyCacheKey(sql, args, BOB),
      firstPartyCacheKey(sql, args, { ...ALICE, credentialScope: "org" }),
      firstPartyCacheKey(sql, args, { ...ALICE, orgId: "org_b" }),
    ]);
    expect(keys.size).toBe(4);
    expect(
      firstPartyCacheKey(sql, args, {
        ...ALICE,
        userEmail: " Alice@Example.test ",
      }),
    ).toBe(firstPartyCacheKey(sql, args, ALICE));
  });
});
