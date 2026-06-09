import { runMigrations } from "@agent-native/core/db";

const LEGACY_DEV_OWNER_SQL = "'local@localhost'"; // guard:allow-localhost-fallback - migration marker for legacy dev-owned rows, not an auth fallback

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    "start" TEXT NOT NULL,
    "end" TEXT NOT NULL,
    slug TEXT NOT NULL,
    event_title TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'cancelled')),
    created_at TEXT NOT NULL
  )`,
    },
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS booking_links (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    duration INTEGER NOT NULL DEFAULT 30,
    color TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
    },
    {
      version: 3,
      sql: `ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS durations TEXT`,
    },
    {
      version: 4,
      sql: `ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS custom_fields TEXT`,
    },
    {
      version: 5,
      sql: `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS field_responses TEXT`,
    },
    {
      version: 6,
      sql: `ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS conferencing TEXT`,
    },
    {
      version: 7,
      sql: `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS meeting_link TEXT`,
    },
    {
      version: 8,
      sql: `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancel_token TEXT`,
    },
    {
      version: 9,
      sql: `CREATE TABLE IF NOT EXISTS booking_slug_redirects (
    old_slug TEXT PRIMARY KEY,
    new_slug TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
    },
    // v10-v12: sharing columns for booking_links.
    {
      version: 10,
      sql: `ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost'`,
    },
    {
      version: 11,
      sql: `ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS org_id TEXT`,
    },
    {
      version: 12,
      sql: `ALTER TABLE booking_links ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'`,
    },
    // v13: companion shares table for per-principal grants.
    {
      version: 13,
      sql: `CREATE TABLE IF NOT EXISTS booking_link_shares (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    principal_type TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    },
    // v14: on Postgres, `is_active` was originally created as INTEGER (v2's
    // `INTEGER NOT NULL DEFAULT 1` got adapted to BIGINT). The Drizzle schema
    // maps `integer({mode: "boolean"})` to BOOLEAN on Postgres, so inserts pass
    // `true`/`false`, which BIGINT rejects. Coerce to BOOLEAN on Postgres only;
    // SQLite keeps is_active as INTEGER 0/1 and needs no migration.
    {
      version: 14,
      sql: {
        postgres: `
        ALTER TABLE booking_links ALTER COLUMN is_active DROP DEFAULT;
        ALTER TABLE booking_links ALTER COLUMN is_active TYPE boolean USING (is_active::int != 0);
        ALTER TABLE booking_links ALTER COLUMN is_active SET DEFAULT true;
      `,
      },
    },
    {
      version: 15,
      sql: `CREATE TABLE IF NOT EXISTS booking_usernames (
    username TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
    },
    {
      version: 16,
      sql: `CREATE TABLE IF NOT EXISTS booking_username_changes (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    old_username TEXT,
    new_username TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
    },
    {
      version: 17,
      sql: `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS google_event_id TEXT`,
    },
    {
      version: 18,
      // Backfill owner_email + org_id on existing bookings. Direct slug match
      // covers the common case; the redirect-aware subquery picks up bookings
      // created under a slug that's since been renamed (the booking_links row
      // now lives at the new slug, with booking_slug_redirects mapping the
      // historical old_slug → current new_slug).
      sql: `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS owner_email TEXT NOT NULL DEFAULT 'local@localhost';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS org_id TEXT;
UPDATE bookings
SET owner_email = COALESCE(
    (SELECT booking_links.owner_email FROM booking_links WHERE booking_links.slug = bookings.slug LIMIT 1),
    (SELECT booking_links.owner_email FROM booking_links
       JOIN booking_slug_redirects ON booking_slug_redirects.new_slug = booking_links.slug
       WHERE booking_slug_redirects.old_slug = bookings.slug LIMIT 1),
    owner_email
  ),
  org_id = COALESCE(
    (SELECT booking_links.org_id FROM booking_links WHERE booking_links.slug = bookings.slug LIMIT 1),
    (SELECT booking_links.org_id FROM booking_links
       JOIN booking_slug_redirects ON booking_slug_redirects.new_slug = booking_links.slug
       WHERE booking_slug_redirects.old_slug = bookings.slug LIMIT 1),
    org_id
  )
WHERE owner_email = ${LEGACY_DEV_OWNER_SQL}`,
    },
    // v19: performance indexes for the ownable booking_links table, its shares
    // companion, and the bookings child rows. Plain CREATE INDEX IF NOT EXISTS
    // only (no DESC / partial / Postgres-only syntax) so it runs on both
    // Postgres and SQLite.
    // - booking_links: accessFilter() predicates on (owner_email, org_id) plus
    //   the list ordering by updated_at. slug already has a UNIQUE index from v2.
    // - booking_link_shares: accessFilter()'s correlated EXISTS subqueries match
    //   on (resource_id, principal_type, principal_id).
    // - bookings: listed/joined by slug and filtered/ordered by the start time
    //   range. There is no booking_link_id FK column — bookings link to
    //   booking_links via slug.
    {
      version: 19,
      sql: `CREATE INDEX IF NOT EXISTS idx_booking_links_owner ON booking_links (owner_email, org_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_booking_link_shares_lookup ON booking_link_shares (resource_id, principal_type, principal_id);
CREATE INDEX IF NOT EXISTS idx_bookings_slug_start ON bookings (slug, "start");`,
    },
  ],
  { table: "calendar_migrations" },
);
