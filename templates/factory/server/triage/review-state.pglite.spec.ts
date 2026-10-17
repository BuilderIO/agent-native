import { createRequire } from "node:module";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { PGlite } = createRequire(
  new URL("../../package.json", import.meta.url),
)("@electric-sql/pglite");

import { triageItems } from "../db/schema.js";
import { triageSourceUpsertGuard } from "./review-state.js";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;

const BEFORE_POLL = "2026-10-16T10:00:00.000Z";
const POLL_STARTED_AT = "2026-10-16T10:01:00.000Z";
const MANUAL_UPDATE_AT = "2026-10-16T10:02:00.000Z";

let client: PGliteClient;
let db: ReturnType<typeof drizzle>;

beforeEach(async () => {
  client = await PGlite.create("memory://");
  db = drizzle(client);
  await client.exec(`
    CREATE TABLE factory_items (
      id text PRIMARY KEY,
      source text NOT NULL,
      external_id text NOT NULL,
      source_url text,
      title text NOT NULL,
      summary text,
      status text NOT NULL DEFAULT 'received',
      risk text NOT NULL DEFAULT 'unknown',
      confidence text NOT NULL DEFAULT 'unknown',
      channel_id text,
      thread_ts text,
      repository text,
      pull_request_number integer,
      head_sha text,
      coverage text NOT NULL,
      dedupe_key text NOT NULL,
      metadata_json text NOT NULL DEFAULT '{}',
      last_seen_at text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      owner_email text NOT NULL,
      org_id text,
      factory_id text
    )
  `);
});

afterEach(async () => {
  await client.close();
});

async function insertItem(id: string, status: string, updatedAt: string) {
  await db.insert(triageItems).values({
    id,
    source: "slack",
    externalId: id,
    title: "Issue",
    status,
    risk: "unknown",
    coverage: "complete",
    dedupeKey: id,
    metadataJson: "{}",
    createdAt: BEFORE_POLL,
    updatedAt,
    ownerEmail: "owner@example.test",
  });
}

describe("triage source upsert guard", () => {
  it("keeps a manual outcome committed after the poller read its snapshot", async () => {
    await insertItem("stale-snapshot", "needs_manual", BEFORE_POLL);
    const existing = (
      await db
        .select({
          status: triageItems.status,
          updatedAt: triageItems.updatedAt,
        })
        .from(triageItems)
        .where(eq(triageItems.id, "stale-snapshot"))
    )[0];

    await db
      .update(triageItems)
      .set({ status: "resolved", updatedAt: MANUAL_UPDATE_AT })
      .where(eq(triageItems.id, "stale-snapshot"));

    await db
      .insert(triageItems)
      .values({
        id: "stale-snapshot",
        source: "slack",
        externalId: "stale-snapshot",
        title: "New provider title",
        status: "received",
        risk: "unknown",
        coverage: "complete",
        dedupeKey: "stale-snapshot",
        metadataJson: "{}",
        createdAt: BEFORE_POLL,
        updatedAt: POLL_STARTED_AT,
        ownerEmail: "owner@example.test",
      })
      .onConflictDoUpdate({
        target: triageItems.id,
        set: { status: "received", updatedAt: POLL_STARTED_AT },
        setWhere: triageSourceUpsertGuard(
          existing,
          "received",
          POLL_STARTED_AT,
        ),
      });

    const current = (
      await db
        .select({
          status: triageItems.status,
          updatedAt: triageItems.updatedAt,
        })
        .from(triageItems)
        .where(eq(triageItems.id, "stale-snapshot"))
    )[0];
    expect(current).toEqual({
      status: "resolved",
      updatedAt: MANUAL_UPDATE_AT,
    });
  });

  it("does not replace a row created and manually changed after polling began", async () => {
    await insertItem("concurrent-insert", "resolved", MANUAL_UPDATE_AT);

    await db
      .insert(triageItems)
      .values({
        id: "concurrent-insert",
        source: "slack",
        externalId: "concurrent-insert",
        title: "Provider title",
        status: "received",
        risk: "unknown",
        coverage: "complete",
        dedupeKey: "concurrent-insert",
        metadataJson: "{}",
        createdAt: POLL_STARTED_AT,
        updatedAt: POLL_STARTED_AT,
        ownerEmail: "owner@example.test",
      })
      .onConflictDoUpdate({
        target: triageItems.id,
        set: { status: "received", updatedAt: POLL_STARTED_AT },
        setWhere: triageSourceUpsertGuard(
          undefined,
          "received",
          POLL_STARTED_AT,
        ),
      });

    const current = (
      await db
        .select({
          status: triageItems.status,
          updatedAt: triageItems.updatedAt,
        })
        .from(triageItems)
        .where(eq(triageItems.id, "concurrent-insert"))
    )[0];
    expect(current).toEqual({
      status: "resolved",
      updatedAt: MANUAL_UPDATE_AT,
    });
  });
});
