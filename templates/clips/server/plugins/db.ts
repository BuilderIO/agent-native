import { runMigrations, getDbExec, isPostgres } from "@agent-native/core/db";
// Side-effect import — registers `recording` as a shareable resource with the
// framework before any HTTP request runs. The framework's auto-mounted
// share-resource / set-resource-visibility / list-resource-shares actions
// are loaded in a separate Vite SSR bundle from user actions, so we trigger
// the registration eagerly from the always-loaded db plugin.
import "../db/index.js";

/**
 * Post-migration fixup for Postgres: retype boolean-mode columns from bigint
 * to boolean.
 *
 * The early table-create migrations (v4–v14 below) used `INTEGER` because
 * `runMigrations` needs dialect-neutral SQL; `adaptSqlForPostgres` rewrites
 * INTEGER → BIGINT on Postgres. But the Drizzle schema declares these
 * columns as `integer(..., { mode: "boolean" })` — which on Postgres maps
 * to the `boolean` type. Drizzle then sends `true`/`false` at insert, which
 * Postgres rejects against a bigint column (`invalid input syntax for type
 * bigint: "true"`).
 *
 * This function runs the ALTERs needed to realign live DBs. It's a no-op on
 * SQLite (where booleans are just 0/1 INTEGERs natively) and on Postgres
 * installations where the columns are already BOOLEAN (idempotent check).
 */
async function retypeBooleanColumnsOnPostgres(): Promise<void> {
  if (!isPostgres()) return;
  const exec = getDbExec();
  const alters: Array<[string, string, boolean]> = [
    ["recordings", "has_audio", true],
    ["recordings", "has_camera", false],
    ["recordings", "enable_comments", true],
    ["recordings", "enable_reactions", true],
    ["recordings", "enable_downloads", true],
    ["recordings", "animated_thumbnail_enabled", true],
    ["spaces", "is_all_company", false],
    ["recording_comments", "resolved", false],
    ["recording_viewers", "counted_view", false],
    ["recording_viewers", "cta_clicked", false],
  ];
  for (const [table, column, defaultTrue] of alters) {
    try {
      const probe = await exec.execute({
        sql: `SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
        args: [table, column],
      });
      const row = (probe.rows as Array<{ data_type?: string }>)[0];
      if (!row || row.data_type === "boolean") continue;
      const def = defaultTrue ? "TRUE" : "FALSE";
      await exec.execute(
        `ALTER TABLE ${table} ALTER COLUMN ${column} DROP DEFAULT, ALTER COLUMN ${column} TYPE BOOLEAN USING (${column} <> 0), ALTER COLUMN ${column} SET DEFAULT ${def}`,
      );
      console.log(`[db] Retyped ${table}.${column} → BOOLEAN`);
    } catch (err) {
      console.warn(
        `[db] Could not retype ${table}.${column}:`,
        (err as Error)?.message ?? err,
      );
    }
  }
}

const migrations = runMigrations([
  // ---------------------------------------------------------------------------
  // Workspaces & members
  // ---------------------------------------------------------------------------
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'My Workspace',
      slug TEXT NOT NULL,
      brand_color TEXT NOT NULL DEFAULT '#18181B',
      brand_logo_url TEXT,
      default_visibility TEXT NOT NULL DEFAULT 'private',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
  },
  {
    version: 2,
    sql: `CREATE TABLE IF NOT EXISTS workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'creator',
      invited_at TEXT,
      joined_at TEXT
    )`,
  },
  {
    version: 3,
    sql: `CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'creator',
      token TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      expires_at TEXT,
      accepted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  // ---------------------------------------------------------------------------
  // Spaces & folders
  // ---------------------------------------------------------------------------
  {
    version: 4,
    sql: `CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#18181B',
      icon_emoji TEXT,
      is_all_company BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    version: 5,
    sql: `CREATE TABLE IF NOT EXISTS space_members (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'contributor'
    )`,
  },
  {
    version: 6,
    sql: `CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      parent_id TEXT,
      space_id TEXT,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      name TEXT NOT NULL DEFAULT 'Untitled folder',
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  // ---------------------------------------------------------------------------
  // Recordings — the core resource
  // ---------------------------------------------------------------------------
  {
    version: 7,
    sql: `CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      folder_id TEXT,
      space_ids TEXT NOT NULL DEFAULT '[]',
      title TEXT NOT NULL DEFAULT 'Untitled recording',
      description TEXT NOT NULL DEFAULT '',
      thumbnail_url TEXT,
      animated_thumbnail_url TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      video_url TEXT,
      video_format TEXT NOT NULL DEFAULT 'webm',
      video_size_bytes INTEGER NOT NULL DEFAULT 0,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      has_audio BOOLEAN NOT NULL DEFAULT TRUE,
      has_camera BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'uploading',
      upload_progress INTEGER NOT NULL DEFAULT 0,
      failure_reason TEXT,
      edits_json TEXT NOT NULL DEFAULT '{}',
      chapters_json TEXT NOT NULL DEFAULT '[]',
      password TEXT,
      expires_at TEXT,
      enable_comments BOOLEAN NOT NULL DEFAULT TRUE,
      enable_reactions BOOLEAN NOT NULL DEFAULT TRUE,
      enable_downloads BOOLEAN NOT NULL DEFAULT TRUE,
      default_speed TEXT NOT NULL DEFAULT '1.2',
      animated_thumbnail_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT,
      trashed_at TEXT,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
  },
  {
    version: 8,
    sql: `CREATE TABLE IF NOT EXISTS recording_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  // ---------------------------------------------------------------------------
  // Tags, transcripts, CTAs
  // ---------------------------------------------------------------------------
  {
    version: 9,
    sql: `CREATE TABLE IF NOT EXISTS recording_tags (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      tag TEXT NOT NULL
    )`,
  },
  {
    version: 10,
    sql: `CREATE TABLE IF NOT EXISTS recording_transcripts (
      recording_id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      language TEXT NOT NULL DEFAULT 'en',
      segments_json TEXT NOT NULL DEFAULT '[]',
      full_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      failure_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    version: 11,
    sql: `CREATE TABLE IF NOT EXISTS recording_ctas (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#18181B',
      placement TEXT NOT NULL DEFAULT 'throughout',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  // ---------------------------------------------------------------------------
  // Comments & reactions
  // ---------------------------------------------------------------------------
  {
    version: 12,
    sql: `CREATE TABLE IF NOT EXISTS recording_comments (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      parent_id TEXT,
      author_email TEXT NOT NULL,
      author_name TEXT,
      content TEXT NOT NULL,
      video_timestamp_ms INTEGER NOT NULL DEFAULT 0,
      emoji_reactions_json TEXT NOT NULL DEFAULT '{}',
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    version: 13,
    sql: `CREATE TABLE IF NOT EXISTS recording_reactions (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL,
      viewer_email TEXT,
      viewer_name TEXT,
      emoji TEXT NOT NULL,
      video_timestamp_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------
  {
    version: 14,
    sql: `CREATE TABLE IF NOT EXISTS recording_viewers (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL,
      viewer_email TEXT,
      viewer_name TEXT,
      first_viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
      total_watch_ms INTEGER NOT NULL DEFAULT 0,
      completed_pct INTEGER NOT NULL DEFAULT 0,
      counted_view BOOLEAN NOT NULL DEFAULT FALSE,
      cta_clicked BOOLEAN NOT NULL DEFAULT FALSE
    )`,
  },
  {
    version: 15,
    sql: `CREATE TABLE IF NOT EXISTS recording_events (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL,
      viewer_id TEXT,
      kind TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  // ---------------------------------------------------------------------------
  // Organization settings — Clips-specific sidecar to better-auth `organization`
  //
  // One row per organization. Brand color + logo + default visibility live
  // here; membership and invitations live in better-auth's tables. This
  // replaces `workspaces.brand_color` / `.brand_logo_url` / `.default_visibility`
  // once callsites migrate.
  // ---------------------------------------------------------------------------
  {
    version: 16,
    sql: `CREATE TABLE IF NOT EXISTS organization_settings (
      organization_id TEXT PRIMARY KEY,
      brand_color TEXT NOT NULL DEFAULT '#18181B',
      brand_logo_url TEXT,
      default_visibility TEXT NOT NULL DEFAULT 'private',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
]);

/**
 * Idempotent sync: for every Clips `workspaces` row, ensure there's a
 * matching better-auth `organization` row (same id), an
 * `organization_settings` row, and — where the email resolves to a known
 * `user` — a `member` row. Invites are copied into `invitation`.
 *
 * Runs on every startup after the schema migrations. Safe to re-run: all
 * inserts are guarded with WHERE-NOT-EXISTS / ON CONFLICT DO NOTHING so it
 * only writes rows that aren't there yet.
 *
 * This is the one-way bridge that lets actions + UI switch from the old
 * `workspaces` / `workspace_members` / `invites` tables to the framework's
 * `organization` / `member` / `invitation` tables without a separate
 * migration script.
 */
async function syncWorkspacesToOrganizations(): Promise<void> {
  const exec = getDbExec();
  const pg = isPostgres();

  // 0) Skip cleanly if either source or dest tables don't exist yet. The
  //    source may be missing on fresh installs after the workspace tables
  //    are eventually dropped; the dest `organization` is owned by
  //    better-auth and created at auth init, which may race with this
  //    plugin on very first boot.
  const hasTable = async (name: string): Promise<boolean> => {
    try {
      if (pg) {
        const r = await exec.execute({
          sql: `SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1`,
          args: [name],
        });
        return (r.rows?.length ?? 0) > 0;
      }
      const r = await exec.execute({
        sql: `SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`,
        args: [name],
      });
      return (r.rows?.length ?? 0) > 0;
    } catch {
      return false;
    }
  };

  if (
    !(await hasTable("workspaces")) ||
    !(await hasTable("organization")) ||
    !(await hasTable("organization_settings"))
  ) {
    return;
  }

  // 1) Copy workspaces → organization. Use the workspace id as the org id
  //    so every downstream FK (`spaces.workspace_id`, `recordings.workspace_id`,
  //    etc.) already points at the right org without a remap. Slug
  //    collisions inside `organization.slug` (UNIQUE) are handled by
  //    appending the workspace id — works because ids are unique.
  try {
    if (pg) {
      await exec.execute(`
        INSERT INTO "organization" (id, name, slug, logo, metadata, created_at, updated_at)
        SELECT
          w.id,
          w.name,
          CASE
            WHEN EXISTS (SELECT 1 FROM "organization" o WHERE o.slug = w.slug AND o.id <> w.id)
            THEN w.slug || '-' || substring(w.id from 1 for 8)
            ELSE w.slug
          END,
          w.brand_logo_url,
          '{}',
          NOW(),
          NOW()
        FROM workspaces w
        WHERE NOT EXISTS (SELECT 1 FROM "organization" o2 WHERE o2.id = w.id)
      `);
    } else {
      await exec.execute(`
        INSERT INTO organization (id, name, slug, logo, metadata, created_at, updated_at)
        SELECT
          w.id,
          w.name,
          CASE
            WHEN EXISTS (SELECT 1 FROM organization o WHERE o.slug = w.slug AND o.id <> w.id)
            THEN w.slug || '-' || substr(w.id, 1, 8)
            ELSE w.slug
          END,
          w.brand_logo_url,
          '{}',
          strftime('%s','now') * 1000,
          strftime('%s','now') * 1000
        FROM workspaces w
        WHERE NOT EXISTS (SELECT 1 FROM organization o2 WHERE o2.id = w.id)
      `);
    }
  } catch (err) {
    console.warn(
      `[db] workspaces → organization sync failed:`,
      (err as Error)?.message ?? err,
    );
  }

  // 2) Copy workspaces → organization_settings (brand fields sidecar).
  try {
    await exec.execute(`
      INSERT INTO organization_settings (organization_id, brand_color, brand_logo_url, default_visibility, created_at, updated_at)
      SELECT w.id, w.brand_color, w.brand_logo_url, w.default_visibility, w.created_at, w.updated_at
      FROM workspaces w
      WHERE NOT EXISTS (
        SELECT 1 FROM organization_settings os WHERE os.organization_id = w.id
      )
    `);
  } catch (err) {
    console.warn(
      `[db] workspaces → organization_settings sync failed:`,
      (err as Error)?.message ?? err,
    );
  }

  // 3a) Seed each workspace's owner as an admin `member` row. The old Clips
  //     workspace model didn't require owners to also live in
  //     `workspace_members` (the owner's membership was implicit), so this
  //     is the step that actually lands the current user inside their
  //     new better-auth org. Skip if the owner email doesn't yet have a
  //     `user` row (they'll be joined on next login).
  try {
    if (pg) {
      await exec.execute(`
        INSERT INTO "member" (id, organization_id, user_id, role, created_at, updated_at)
        SELECT
          'ownr-' || w.id,
          w.id,
          u.id,
          'admin',
          NOW(),
          NOW()
        FROM workspaces w
        JOIN "user" u ON u.email = w.owner_email
        WHERE NOT EXISTS (
          SELECT 1 FROM "member" m
          WHERE m.organization_id = w.id AND m.user_id = u.id
        )
      `);
    } else {
      await exec.execute(`
        INSERT INTO member (id, organization_id, user_id, role, created_at, updated_at)
        SELECT
          'ownr-' || w.id,
          w.id,
          u.id,
          'admin',
          strftime('%s','now') * 1000,
          strftime('%s','now') * 1000
        FROM workspaces w
        JOIN user u ON u.email = w.owner_email
        WHERE NOT EXISTS (
          SELECT 1 FROM member m
          WHERE m.organization_id = w.id AND m.user_id = u.id
        )
      `);
    }
  } catch (err) {
    console.warn(
      `[db] workspace owners → member sync failed:`,
      (err as Error)?.message ?? err,
    );
  }

  // 3b) Copy workspace_members → member where the email resolves to a known
  //    user. Role mapping: clips `admin` → better-auth `admin`, everything
  //    else (`creator`, `creator-lite`, `viewer`) → `member`. Finer
  //    distinctions (if we reintroduce them) can go in a sidecar table.
  try {
    if (pg) {
      await exec.execute(`
        INSERT INTO "member" (id, organization_id, user_id, role, created_at, updated_at)
        SELECT
          wm.id,
          wm.workspace_id,
          u.id,
          CASE WHEN wm.role = 'admin' THEN 'admin' ELSE 'member' END,
          NOW(),
          NOW()
        FROM workspace_members wm
        JOIN "user" u ON u.email = wm.email
        WHERE NOT EXISTS (
          SELECT 1 FROM "member" m
          WHERE m.organization_id = wm.workspace_id AND m.user_id = u.id
        )
      `);
    } else {
      await exec.execute(`
        INSERT INTO member (id, organization_id, user_id, role, created_at, updated_at)
        SELECT
          wm.id,
          wm.workspace_id,
          u.id,
          CASE WHEN wm.role = 'admin' THEN 'admin' ELSE 'member' END,
          strftime('%s','now') * 1000,
          strftime('%s','now') * 1000
        FROM workspace_members wm
        JOIN user u ON u.email = wm.email
        WHERE NOT EXISTS (
          SELECT 1 FROM member m
          WHERE m.organization_id = wm.workspace_id AND m.user_id = u.id
        )
      `);
    }
  } catch (err) {
    console.warn(
      `[db] workspace_members → member sync failed:`,
      (err as Error)?.message ?? err,
    );
  }

  // 3c) Set `session.active_organization_id` for any active session that
  //     doesn't have one yet, picking the user's newest org membership.
  //     Without this, the UI would render "No organization" on first boot
  //     after the migration even though the user IS in an org — better-auth
  //     only auto-activates an org on login, not for pre-existing sessions.
  try {
    if (pg) {
      await exec.execute(`
        UPDATE "session" s
        SET active_organization_id = sub.organization_id
        FROM (
          SELECT DISTINCT ON (user_id) user_id, organization_id
          FROM "member"
          ORDER BY user_id, created_at DESC
        ) sub
        WHERE s.user_id = sub.user_id
          AND s.active_organization_id IS NULL
      `);
    } else {
      await exec.execute(`
        UPDATE session
        SET active_organization_id = (
          SELECT m.organization_id
          FROM member m
          WHERE m.user_id = session.user_id
          ORDER BY m.created_at DESC
          LIMIT 1
        )
        WHERE active_organization_id IS NULL
          AND EXISTS (SELECT 1 FROM member m2 WHERE m2.user_id = session.user_id)
      `);
    }
  } catch (err) {
    console.warn(
      `[db] session.active_organization_id backfill failed:`,
      (err as Error)?.message ?? err,
    );
  }

  // 4) Copy invites → invitation (pending only). Inviter has to resolve to
  //    a known user — if not, skip (invitation.inviter_id is NOT NULL).
  try {
    if (pg) {
      await exec.execute(`
        INSERT INTO "invitation" (id, organization_id, email, role, status, expires_at, inviter_id, created_at, updated_at)
        SELECT
          i.id,
          i.workspace_id,
          i.email,
          CASE WHEN i.role = 'admin' THEN 'admin' ELSE 'member' END,
          CASE WHEN i.accepted_at IS NOT NULL THEN 'accepted' ELSE 'pending' END,
          COALESCE(i.expires_at::TIMESTAMPTZ, NOW() + INTERVAL '30 days'),
          inv.id,
          NOW(),
          NOW()
        FROM invites i
        JOIN "user" inv ON inv.email = i.invited_by
        WHERE NOT EXISTS (
          SELECT 1 FROM "invitation" x WHERE x.id = i.id
        )
      `);
    } else {
      await exec.execute(`
        INSERT INTO invitation (id, organization_id, email, role, status, expires_at, inviter_id, created_at, updated_at)
        SELECT
          i.id,
          i.workspace_id,
          i.email,
          CASE WHEN i.role = 'admin' THEN 'admin' ELSE 'member' END,
          CASE WHEN i.accepted_at IS NOT NULL THEN 'accepted' ELSE 'pending' END,
          COALESCE(CAST(i.expires_at AS INTEGER), strftime('%s','now') * 1000 + 2592000000),
          inv.id,
          strftime('%s','now') * 1000,
          strftime('%s','now') * 1000
        FROM invites i
        JOIN user inv ON inv.email = i.invited_by
        WHERE NOT EXISTS (
          SELECT 1 FROM invitation x WHERE x.id = i.id
        )
      `);
    }
  } catch (err) {
    console.warn(
      `[db] invites → invitation sync failed:`,
      (err as Error)?.message ?? err,
    );
  }
}

export default async (nitroApp: any): Promise<void> => {
  await migrations(nitroApp);
  await retypeBooleanColumnsOnPostgres();
  await syncWorkspacesToOrganizations();
};
