import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { getDb } from "../db/index.js";
import * as schema from "../db/schema.js";

const state = vi.hoisted(() => ({
  db: undefined as ReturnType<typeof getDb> | undefined,
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
}));

import { listAccessibleAudienceIds } from "./audiences.js";
import {
  invalidateGoogleCaptureAudiences,
  invalidateGoogleSourceAudiences,
} from "./google-source-access.js";

let database: PGlite;
beforeEach(async () => {
  database = new PGlite();
  state.db = drizzle(database, { schema }) as unknown as ReturnType<
    typeof getDb
  >;
  await database.exec(`
    CREATE TABLE brain_sources (id text PRIMARY KEY);
    CREATE TABLE brain_audiences (id text PRIMARY KEY, source_id text, membership_state text, updated_at text);
    CREATE TABLE brain_audience_members (audience_id text, principal_type text, principal_id text, status text);
    CREATE TABLE brain_raw_captures (id text PRIMARY KEY, source_id text, external_id text);
    CREATE TABLE brain_capture_audiences (audience_id text, capture_id text);
    CREATE TABLE brain_audience_dependencies (audience_id text, depends_on_audience_id text);
    CREATE TABLE brain_audience_source_dependencies (audience_id text, source_id text);
    INSERT INTO brain_sources VALUES ('google-source'), ('unrelated-source');
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

describe("Google source access revalidation", () => {
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
