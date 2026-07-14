/**
 * Cross-tenant write (IDOR) regression tests for event-type-scoped actions
 * that mutate a resource owned by another tenant: revoking a private hashed
 * link and duplicating an event type. Mirrors the `assertAccess("event-type",
 * ..., <role>)` guard already used by `add-private-link.ts` /
 * `delete-event-type.ts`.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getRequestUserEmail,
  runWithRequestContext,
} from "@agent-native/core/server/request-context";
import {
  ForbiddenError,
  registerShareableResource,
} from "@agent-native/core/sharing";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as schema from "../schema/index.js";
import { setSchedulingContext } from "../server/context.js";
import duplicateEventType from "./duplicate-event-type.js";
import revokePrivateLink from "./revoke-private-link.js";

const OWNER_EMAIL = "owner@example.com";
const OUTSIDER_EMAIL = "outsider@example.com";
const EVENT_TYPE_ID = "event-type-1";
const HASH = "private-link-hash-1";

let client: Client;
let dbDir: string;

beforeEach(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "scheduling-eventtype-authz-test-"));
  client = createClient({ url: `file:${join(dbDir, `${randomUUID()}.db`)}` });
  await client.execute(`
    CREATE TABLE event_types (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      length INTEGER NOT NULL DEFAULT 30,
      durations TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      scheduling_type TEXT NOT NULL DEFAULT 'personal',
      team_id TEXT,
      locations TEXT,
      custom_fields TEXT,
      schedule_id TEXT,
      minimum_booking_notice INTEGER NOT NULL DEFAULT 0,
      before_event_buffer INTEGER NOT NULL DEFAULT 0,
      after_event_buffer INTEGER NOT NULL DEFAULT 0,
      slot_interval INTEGER,
      period_type TEXT NOT NULL DEFAULT 'rolling',
      period_days INTEGER DEFAULT 60,
      period_start_date TEXT,
      period_end_date TEXT,
      seats_per_time_slot INTEGER,
      requires_confirmation INTEGER NOT NULL DEFAULT 0,
      disable_guests INTEGER NOT NULL DEFAULT 0,
      hide_calendar_notes INTEGER NOT NULL DEFAULT 0,
      success_redirect_url TEXT,
      booking_limits TEXT,
      lock_time_zone_toggle INTEGER NOT NULL DEFAULT 0,
      recurring_event TEXT,
      event_name TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    );
  `);
  await client.execute(`
    CREATE TABLE hashed_links (
      id TEXT PRIMARY KEY,
      hash TEXT NOT NULL UNIQUE,
      event_type_id TEXT NOT NULL,
      expires_at TEXT,
      is_single_use INTEGER NOT NULL DEFAULT 0,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
  await client.execute(`
    CREATE TABLE event_type_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const db = drizzle(client, { schema });
  setSchedulingContext({
    getDb: () => db,
    schema,
    // Mirrors real app wiring (templates/scheduling's server plugin): the
    // scheduling package's own "current user" and the framework's
    // request-context ALS (used by `assertAccess`) both resolve to the same
    // identity.
    getCurrentUserEmail: () => getRequestUserEmail(),
  });
  registerShareableResource({
    type: "event-type",
    resourceTable: schema.eventTypes,
    sharesTable: schema.eventTypeShares,
    displayName: "Event Type",
    getDb: () => db,
  });

  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO event_types (
      id, title, slug, length, created_at, updated_at, owner_email, visibility
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      EVENT_TYPE_ID,
      "30 Min Meeting",
      "30min",
      30,
      now,
      now,
      OWNER_EMAIL,
      "private",
    ],
  });
  await client.execute({
    sql: `INSERT INTO hashed_links (id, hash, event_type_id, created_at) VALUES (?, ?, ?, ?)`,
    args: ["link-1", HASH, EVENT_TYPE_ID, now],
  });
});

afterEach(() => {
  client.close();
  rmSync(dbDir, { recursive: true, force: true });
});

async function hashedLinkExists(): Promise<boolean> {
  const { rows } = await client.execute({
    sql: "SELECT 1 FROM hashed_links WHERE hash = ?",
    args: [HASH],
  });
  return rows.length > 0;
}

async function eventTypeCount(): Promise<number> {
  const { rows } = await client.execute("SELECT * FROM event_types");
  return rows.length;
}

describe("revoke-private-link authorization", () => {
  it("returns the same idempotent result for an inaccessible link and keeps it", async () => {
    const result: any = await runWithRequestContext(
      { userEmail: OUTSIDER_EMAIL },
      () => revokePrivateLink.run({ hash: HASH }),
    );
    expect(result.ok).toBe(true);
    expect(await hashedLinkExists()).toBe(true);
  });

  it("allows the owning event type's editor (the owner) to revoke the link", async () => {
    const result: any = await runWithRequestContext(
      { userEmail: OWNER_EMAIL },
      () => revokePrivateLink.run({ hash: HASH }),
    );
    expect(result.ok).toBe(true);
    expect(await hashedLinkExists()).toBe(false);
  });

  it("is idempotent for an unknown hash without requiring access", async () => {
    const result: any = await runWithRequestContext(
      { userEmail: OUTSIDER_EMAIL },
      () => revokePrivateLink.run({ hash: "does-not-exist" }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("duplicate-event-type authorization", () => {
  it("rejects a caller with no access to the source event type and does not duplicate it", async () => {
    await expect(
      runWithRequestContext({ userEmail: OUTSIDER_EMAIL }, () =>
        duplicateEventType.run({ id: EVENT_TYPE_ID, newSlug: "copy" }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await eventTypeCount()).toBe(1);
  });

  it("allows the owner to duplicate their own event type", async () => {
    const result: any = await runWithRequestContext(
      { userEmail: OWNER_EMAIL },
      () => duplicateEventType.run({ id: EVENT_TYPE_ID, newSlug: "copy" }),
    );
    expect(result.eventType?.slug).toBe("copy");
    expect(await eventTypeCount()).toBe(2);
  });
});
