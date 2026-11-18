import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { getDb } from "../db/index.js";
import * as schema from "../db/schema.js";

const state = vi.hoisted(() => ({
  db: undefined as ReturnType<typeof getDb> | undefined,
  request: vi.fn(),
  connection: vi.fn(),
}));
vi.mock("../db/index.js", async () => ({
  schema: await import("../db/schema.js"),
  getDb: () => {
    if (!state.db) throw new Error("Test database is not ready");
    return state.db;
  },
}));
vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >()),
    getRequestUserEmail: () => "qa-fleet@builder.io",
    getRequestOrgId: () => null,
  }),
);
vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  accessFilter: () => sql`true`,
  assertAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./provider-api.js", () => ({
  executeProviderApiRequest: state.request,
}));
vi.mock("@agent-native/core/workspace-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/workspace-connections")
  >()),
  resolveWorkspaceConnectionForApp: state.connection,
}));
import { listAccessibleAudienceIds } from "./audiences.js";
import { runConnectorSync } from "./connectors.js";
import {
  invalidateGoogleCaptureAudiences,
  invalidateGoogleSourceAudiences,
} from "./google-source-access.js";

let database: PGlite;
beforeEach(async () => {
  vi.clearAllMocks();
  state.connection.mockResolvedValue({
    available: true,
    connection: {
      id: "qa-google",
      accountId: "qa-fleet@builder.io",
      ownerEmail: "qa-fleet@builder.io",
    },
  });
  database = new PGlite();
  state.db = drizzle(database, { schema }) as unknown as ReturnType<
    typeof getDb
  >;
  await database.exec(`
    CREATE TABLE brain_sources (id text PRIMARY KEY, cursor_json text DEFAULT '{}', last_error text, status text DEFAULT 'active', updated_at text, last_synced_at text);
    CREATE TABLE brain_sync_runs (id text PRIMARY KEY, source_id text, active_source_id text UNIQUE, provider text, status text, stats_json text, error text, lease_token text, lease_expires_at text, started_at text, completed_at text);
    CREATE TABLE brain_audiences (id text PRIMARY KEY, source_id text, membership_state text, updated_at text);
    CREATE TABLE brain_audience_members (audience_id text, principal_type text, principal_id text, status text);
    CREATE TABLE brain_raw_captures (id text PRIMARY KEY, source_id text, external_id text);
    CREATE TABLE brain_capture_audiences (audience_id text, capture_id text);
    CREATE TABLE brain_audience_dependencies (audience_id text, depends_on_audience_id text);
    CREATE TABLE brain_audience_source_dependencies (audience_id text, source_id text);
    INSERT INTO brain_sources (id) VALUES ('google-source'), ('unrelated-source');
    INSERT INTO brain_audiences VALUES ('file-one', 'google-source', 'current', ''), ('file-two', 'google-source', 'current', ''), ('derived', 'google-source', 'current', ''), ('unrelated', 'unrelated-source', 'current', '');
    INSERT INTO brain_audience_members VALUES ('file-one', 'user', 'qa-fleet@builder.io', 'active'), ('file-two', 'user', 'qa-fleet@builder.io', 'active'), ('derived', 'user', 'qa-fleet@builder.io', 'active'), ('unrelated', 'user', 'qa-fleet@builder.io', 'active');
    INSERT INTO brain_raw_captures VALUES ('capture-one', 'google-source', 'google_drive:one'), ('capture-two', 'google-source', 'google_drive:two');
    INSERT INTO brain_capture_audiences VALUES ('file-one', 'capture-one'), ('file-two', 'capture-two');
    INSERT INTO brain_audience_dependencies VALUES ('derived', 'file-one'), ('derived', 'file-two');
    INSERT INTO brain_audience_source_dependencies VALUES ('derived', 'google-source');
  `);
});
afterEach(async () => {
  state.db = undefined;
  await database.close();
});

function source(
  ownerEmail = "qa-fleet@builder.io",
): typeof schema.brainSources.$inferSelect {
  return {
    id: "google-source",
    provider: "google_drive",
    title: "QA Drive",
    ownerEmail,
    visibility: "private",
    orgId: null,
    configJson: JSON.stringify({
      workspaceConnectionId: "qa-google",
      google: { fileIds: ["approved-doc"] },
    }),
    cursorJson: "{}",
    createdAt: "2026-11-18T00:00:00Z",
    updatedAt: "2026-11-18T00:00:00Z",
    status: "active",
    sourceKey: null,
    ingestTokenHash: null,
    lastSyncedAt: null,
    lastError: null,
  };
}

describe("Google source access revalidation", () => {
  it("rejects an authorized non-owner editor before leases, source writes, or audience invalidation", async () => {
    const beforeSources = await database.query(
      "SELECT * FROM brain_sources ORDER BY id",
    );
    const beforeAudiences = await database.query(
      "SELECT * FROM brain_audiences ORDER BY id",
    );
    await expect(
      runConnectorSync(source("another-owner@example.test")),
    ).rejects.toMatchObject({ errorCode: "google_source_owner_required" });
    expect(
      (await database.query("SELECT * FROM brain_sync_runs")).rows,
    ).toEqual([]);
    expect(
      (await database.query("SELECT * FROM brain_sources ORDER BY id")).rows,
    ).toEqual(beforeSources.rows);
    expect(
      (await database.query("SELECT * FROM brain_audiences ORDER BY id")).rows,
    ).toEqual(beforeAudiences.rows);
    expect(state.request).not.toHaveBeenCalled();
  });

  it("records quota failure and a bounded retry while withdrawing prior evidence", async () => {
    state.request.mockResolvedValueOnce({
      response: {
        json: { error: { errors: [{ reason: "rateLimitExceeded" }] } },
        status: 403,
        ok: false,
        truncated: false,
      },
    });
    const result = await runConnectorSync(source());
    expect(result).toMatchObject({
      status: "error",
      capturesCreated: 0,
      stats: { retryable: true },
    });
    expect(await listAccessibleAudienceIds()).toEqual(["unrelated"]);
    const persisted = (
      await database.query<{
        status: string;
        cursor_json: string;
        last_error: string;
      }>(
        "SELECT status, cursor_json, last_error FROM brain_sources WHERE id='google-source'",
      )
    ).rows.find((_row, index) => index === 0);
    if (!persisted) throw new Error("Expected persisted Google source");
    expect(persisted.status).toBe("error");
    expect(persisted.last_error).toContain("403");
    const cursor: unknown = JSON.parse(persisted.cursor_json);
    expect(cursor).toEqual({ transientRetryAt: expect.any(String) });
    expect(
      (await database.query("SELECT status FROM brain_sync_runs")).rows,
    ).toEqual([{ status: "error" }]);
  });

  it("removes a revoked file and multi-file derived audience until access is restored", async () => {
    expect((await listAccessibleAudienceIds()).sort()).toEqual([
      "derived",
      "file-one",
      "file-two",
      "unrelated",
    ]);
    await invalidateGoogleCaptureAudiences("google-source", [
      "google_drive:one",
    ]);
    expect((await listAccessibleAudienceIds()).sort()).toEqual([
      "file-two",
      "unrelated",
    ]);
    await database.exec(
      "UPDATE brain_audiences SET membership_state = 'current' WHERE id = 'file-one'",
    );
    expect((await listAccessibleAudienceIds()).sort()).toEqual([
      "derived",
      "file-one",
      "file-two",
      "unrelated",
    ]);
  });

  it("fails closed for every prior capture and derivative on source configuration or credential changes", async () => {
    await invalidateGoogleSourceAudiences("google-source");
    expect(await listAccessibleAudienceIds()).toEqual(["unrelated"]);
    await database.exec(
      "UPDATE brain_audiences SET membership_state = 'current' WHERE id = 'file-two'",
    );
    expect((await listAccessibleAudienceIds()).sort()).toEqual([
      "file-two",
      "unrelated",
    ]);
    await database.exec(
      "UPDATE brain_audiences SET membership_state = 'current' WHERE id = 'file-one'",
    );
    expect((await listAccessibleAudienceIds()).sort()).toEqual([
      "derived",
      "file-one",
      "file-two",
      "unrelated",
    ]);
  });
});
