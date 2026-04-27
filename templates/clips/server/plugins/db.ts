import { runMigrations, getDbExec, isPostgres } from "@agent-native/core/db";
import { registerEvent } from "@agent-native/core/event-bus";
import { z } from "zod";
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
 * matching framework `organizations` row (same id), an
 * `organization_settings` row, and — where owner has not already been
 * seeded — an admin `org_members` row. Invites are copied into
 * `org_invitations`.
 *
 * The framework ships two parallel org systems — the simpler email-based
 * one (`organizations` / `org_members` / `org_invitations`, which `/_agent-native/org/*`
 * endpoints + `useOrg` read) and better-auth's own `organization` / `member` /
 * `invitation` tables. Clips rides on the simpler system because the
 * framework client hooks and the `share-resource` action both resolve
 * membership there.
 *
 * Runs on every startup after the schema migrations. Safe to re-run: all
 * inserts are guarded with WHERE-NOT-EXISTS so it only writes rows that
 * aren't there yet.
 */
async function syncWorkspacesToOrganizations(): Promise<void> {
  const exec = getDbExec();
  const pg = isPostgres();

  // 0) Skip cleanly if either source or dest tables don't exist yet. The
  //    source may be missing on fresh installs after the workspace tables
  //    are eventually dropped; the framework org tables are created via
  //    their own migration bundle which may race with this plugin on
  //    very first boot.
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
    !(await hasTable("organizations")) ||
    !(await hasTable("org_members")) ||
    !(await hasTable("organization_settings"))
  ) {
    return;
  }

  // 1) Copy workspaces → organizations. Use the workspace id as the org id
  //    so every downstream FK (`spaces.workspace_id`, `recordings.workspace_id`,
  //    etc.) already points at the right org without a remap. The framework
  //    `organizations` table has a simple shape: id, name, created_by, created_at.
  try {
    if (pg) {
      await exec.execute(`
        INSERT INTO organizations (id, name, created_by, created_at)
        SELECT
          w.id,
          w.name,
          w.owner_email,
          EXTRACT(EPOCH FROM COALESCE(w.created_at::TIMESTAMPTZ, NOW())) * 1000
        FROM workspaces w
        WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = w.id)
      `);
    } else {
      await exec.execute(`
        INSERT INTO organizations (id, name, created_by, created_at)
        SELECT
          w.id,
          w.name,
          w.owner_email,
          strftime('%s','now') * 1000
        FROM workspaces w
        WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = w.id)
      `);
    }
  } catch (err) {
    console.warn(
      `[db] workspaces → organizations sync failed:`,
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

  // 3a) Seed each workspace owner as an admin `org_members` row. Owners
  //     were implicitly members in the old Clips workspace model — this is
  //     the step that lands the current user inside their new org.
  try {
    if (pg) {
      await exec.execute(`
        INSERT INTO org_members (id, org_id, email, role, joined_at)
        SELECT
          'ownr-' || w.id,
          w.id,
          w.owner_email,
          'admin',
          EXTRACT(EPOCH FROM NOW()) * 1000
        FROM workspaces w
        WHERE NOT EXISTS (
          SELECT 1 FROM org_members m
          WHERE m.org_id = w.id AND LOWER(m.email) = LOWER(w.owner_email)
        )
      `);
    } else {
      await exec.execute(`
        INSERT INTO org_members (id, org_id, email, role, joined_at)
        SELECT
          'ownr-' || w.id,
          w.id,
          w.owner_email,
          'admin',
          strftime('%s','now') * 1000
        FROM workspaces w
        WHERE NOT EXISTS (
          SELECT 1 FROM org_members m
          WHERE m.org_id = w.id AND LOWER(m.email) = LOWER(w.owner_email)
        )
      `);
    }
  } catch (err) {
    console.warn(
      `[db] workspace owners → org_members sync failed:`,
      (err as Error)?.message ?? err,
    );
  }

  // 3b) Copy workspace_members → org_members. Role mapping: clips `admin` →
  //     framework `admin`, everything else (`creator`, `creator-lite`,
  //     `viewer`) → `member`.
  try {
    if (pg) {
      await exec.execute(`
        INSERT INTO org_members (id, org_id, email, role, joined_at)
        SELECT
          wm.id,
          wm.workspace_id,
          wm.email,
          CASE WHEN wm.role = 'admin' THEN 'admin' ELSE 'member' END,
          EXTRACT(EPOCH FROM NOW()) * 1000
        FROM workspace_members wm
        WHERE NOT EXISTS (
          SELECT 1 FROM org_members m
          WHERE m.org_id = wm.workspace_id AND LOWER(m.email) = LOWER(wm.email)
        )
      `);
    } else {
      await exec.execute(`
        INSERT INTO org_members (id, org_id, email, role, joined_at)
        SELECT
          wm.id,
          wm.workspace_id,
          wm.email,
          CASE WHEN wm.role = 'admin' THEN 'admin' ELSE 'member' END,
          strftime('%s','now') * 1000
        FROM workspace_members wm
        WHERE NOT EXISTS (
          SELECT 1 FROM org_members m
          WHERE m.org_id = wm.workspace_id AND LOWER(m.email) = LOWER(wm.email)
        )
      `);
    }
  } catch (err) {
    console.warn(
      `[db] workspace_members → org_members sync failed:`,
      (err as Error)?.message ?? err,
    );
  }

  // 4) Copy invites → org_invitations (pending only).
  try {
    if (pg) {
      await exec.execute(`
        INSERT INTO org_invitations (id, org_id, email, invited_by, created_at, status)
        SELECT
          i.id,
          i.workspace_id,
          i.email,
          i.invited_by,
          EXTRACT(EPOCH FROM NOW()) * 1000,
          CASE WHEN i.accepted_at IS NOT NULL THEN 'accepted' ELSE 'pending' END
        FROM invites i
        WHERE NOT EXISTS (
          SELECT 1 FROM org_invitations x WHERE x.id = i.id
        )
      `);
    } else {
      await exec.execute(`
        INSERT INTO org_invitations (id, org_id, email, invited_by, created_at, status)
        SELECT
          i.id,
          i.workspace_id,
          i.email,
          i.invited_by,
          strftime('%s','now') * 1000,
          CASE WHEN i.accepted_at IS NOT NULL THEN 'accepted' ELSE 'pending' END
        FROM invites i
        WHERE NOT EXISTS (
          SELECT 1 FROM org_invitations x WHERE x.id = i.id
        )
      `);
    }
  } catch (err) {
    console.warn(
      `[db] invites → org_invitations sync failed:`,
      (err as Error)?.message ?? err,
    );
  }

  // 5) Set each user's `active-org-id` user-setting so the framework's
  //    `getOrgContext()` resolves to their newest org on first load. The
  //    value is stored as JSON in the settings table under the key
  //    `u:<email>:active-org-id`. `settings.updated_at` is NOT NULL so we
  //    set it to now.
  try {
    if (pg) {
      await exec.execute(`
        INSERT INTO settings (key, value, updated_at)
        SELECT
          'u:' || LOWER(sub.email) || ':active-org-id',
          '{"orgId":"' || sub.org_id || '"}',
          EXTRACT(EPOCH FROM NOW()) * 1000
        FROM (
          SELECT DISTINCT ON (LOWER(email)) email, org_id
          FROM org_members
          ORDER BY LOWER(email), joined_at DESC
        ) sub
        WHERE NOT EXISTS (
          SELECT 1 FROM settings s
          WHERE s.key = 'u:' || LOWER(sub.email) || ':active-org-id'
        )
      `);
    } else {
      await exec.execute(`
        INSERT INTO settings (key, value, updated_at)
        SELECT
          'u:' || LOWER(sub.email) || ':active-org-id',
          '{"orgId":"' || sub.org_id || '"}',
          strftime('%s','now') * 1000
        FROM (
          SELECT email, org_id, MAX(joined_at) AS jmax
          FROM org_members
          GROUP BY LOWER(email)
        ) sub
        WHERE NOT EXISTS (
          SELECT 1 FROM settings s
          WHERE s.key = 'u:' || LOWER(sub.email) || ':active-org-id'
        )
      `);
    }
  } catch (err) {
    console.warn(
      `[db] active-org-id user-setting backfill failed:`,
      (err as Error)?.message ?? err,
    );
  }
}

/**
 * Sweep orphaned recording-chunk scratch rows out of `application_state`.
 *
 * Why: `/api/uploads/:id/chunk` base64-encodes each MediaRecorder chunk and
 * stores it in `application_state` keyed `recording-chunks-<recordingId>-<idx>`.
 * `finalize-recording` is responsible for deleting those rows after assembling
 * the final blob — but before this sweep existed, a finalize that threw
 * mid-way (uploadFile failure, DB hiccup, dev-server restart between chunk
 * arrival and finalize) left every chunk in place forever. Each chunk is ~1 MB
 * of base64; a 30-minute recording is ~1.5 GB of orphaned scratch space, and
 * those rows are resident in memory as soon as the server fetches them. This
 * was the server-side half of the 70 GB memory leak Steve reported.
 *
 * Safe rules: we only delete chunks whose matching `recordings` row is either
 * (a) absent (the recording was deleted but chunks remained), or
 * (b) in status=`ready` or `failed` (finalize ran and should have cleaned, or
 *     bailed), AND last updated more than 1 hour ago (don't race a finalize
 *     that's CURRENTLY running).
 *
 * Runs once on server startup. Best-effort — any individual delete or probe
 * failure is logged and ignored; the rest of the sweep continues.
 */
async function sweepOrphanedRecordingChunks(): Promise<void> {
  const exec = getDbExec();
  const pg = isPostgres();

  let chunkRows: Array<{ key: string }> = [];
  try {
    const probe = await exec.execute({
      sql: pg
        ? `SELECT key FROM application_state WHERE key LIKE 'recording-chunks-%'`
        : `SELECT key FROM application_state WHERE key LIKE 'recording-chunks-%'`,
      args: [],
    });
    chunkRows = (probe.rows as Array<{ key: string }>) ?? [];
  } catch (err) {
    // application_state table may not exist on a fresh dev DB — bail quietly.
    console.warn(
      "[db] chunk sweep: application_state probe failed (table missing?)",
      (err as Error)?.message ?? err,
    );
    return;
  }

  if (chunkRows.length === 0) return;

  // Group by recordingId so one probe per recording, not per chunk.
  const keysByRecording = new Map<string, string[]>();
  for (const row of chunkRows) {
    // Key shape: recording-chunks-<recordingId>-<paddedIdx>. `recordingId` may
    // contain hyphens, so we peel off the trailing `-<idx>` first and then
    // the `recording-chunks-` prefix.
    const stripped = row.key.replace(/^recording-chunks-/, "");
    const lastDash = stripped.lastIndexOf("-");
    if (lastDash < 0) continue;
    const recordingId = stripped.slice(0, lastDash);
    const list = keysByRecording.get(recordingId) ?? [];
    list.push(row.key);
    keysByRecording.set(recordingId, list);
  }

  const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let totalDeleted = 0;
  let recordingsCleaned = 0;

  for (const [recordingId, keys] of keysByRecording) {
    let shouldSweep = false;
    try {
      const probe = await exec.execute({
        sql: pg
          ? `SELECT status, updated_at FROM recordings WHERE id = $1 LIMIT 1`
          : `SELECT status, updated_at FROM recordings WHERE id = ? LIMIT 1`,
        args: [recordingId],
      });
      const row = (
        probe.rows as Array<{ status?: string; updated_at?: string }>
      )[0];
      if (!row) {
        // Recording row gone — chunks are orphaned.
        shouldSweep = true;
      } else if (
        (row.status === "ready" || row.status === "failed") &&
        (row.updated_at ?? "") < oneHourAgoIso
      ) {
        // Finalize ran (ready) or bailed (failed) and it's been >1h — safe.
        shouldSweep = true;
      }
    } catch (err) {
      console.warn("[db] chunk sweep: recording probe failed", {
        recordingId,
        err: (err as Error)?.message ?? err,
      });
      continue;
    }

    if (!shouldSweep) continue;

    for (const key of keys) {
      try {
        await exec.execute({
          sql: pg
            ? `DELETE FROM application_state WHERE key = $1`
            : `DELETE FROM application_state WHERE key = ?`,
          args: [key],
        });
        totalDeleted += 1;
      } catch (err) {
        console.warn("[db] chunk sweep: delete failed", {
          key,
          err: (err as Error)?.message ?? err,
        });
      }
    }
    recordingsCleaned += 1;
  }

  if (totalDeleted > 0) {
    console.log("[db] swept orphaned recording chunks", {
      totalDeleted,
      recordingsCleaned,
    });
  }
}

async function backfillRecordingOrgId(): Promise<void> {
  const exec = getDbExec();
  const pg = isPostgres();
  try {
    await exec.execute(
      pg
        ? `UPDATE recordings SET org_id = workspace_id WHERE org_id IS NULL AND workspace_id IS NOT NULL`
        : `UPDATE recordings SET org_id = workspace_id WHERE org_id IS NULL AND workspace_id IS NOT NULL`,
    );
  } catch (err) {
    console.warn(
      "[db] backfill recording org_id failed:",
      (err as Error)?.message ?? err,
    );
  }
}

export default async (nitroApp: any): Promise<void> => {
  await migrations(nitroApp);
  await retypeBooleanColumnsOnPostgres();
  await syncWorkspacesToOrganizations();
  await backfillRecordingOrgId();
  // Best-effort chunk sweep — don't block startup on failures.
  sweepOrphanedRecordingChunks().catch((err) => {
    console.warn("[db] chunk sweep failed:", (err as Error)?.message ?? err);
  });

  // ---------------------------------------------------------------------------
  // Register Clips template events for the automations system.
  // ---------------------------------------------------------------------------
  registerEvent({
    name: "clip.created",
    description:
      "A new screen recording (clip) was created and is ready to view.",
    payloadSchema: z.object({
      clipId: z.string(),
      title: z.string().optional(),
      createdBy: z.string().optional(),
      duration: z.number().optional(),
      url: z.string().optional(),
    }) as any,
  });

  registerEvent({
    name: "clip.shared",
    description:
      "A clip's organization was shared with a new member via invite.",
    payloadSchema: z.object({
      clipId: z.string().optional(),
      sharedWith: z.string(),
      sharedBy: z.string().optional(),
    }) as any,
  });

  registerEvent({
    name: "clip.viewed",
    description: "A clip was viewed by someone.",
    payloadSchema: z.object({
      clipId: z.string(),
      viewerEmail: z.string().nullable().optional(),
      viewedAt: z.string(),
    }) as any,
  });
};
