import { runMigrations, getDbExec, isPostgres } from "@agent-native/core/db";
// Side-effect import — registers `call` and `snippet` as shareable resources
// with the framework before any HTTP request runs.
import "../db/index.js";

/**
 * Post-migration fixup for Postgres: retype boolean-mode columns from bigint
 * to boolean. Matches the Clips pattern — `runMigrations` emits dialect-neutral
 * INTEGER which maps to BIGINT on Postgres; Drizzle sends booleans; Postgres
 * rejects the mismatch. We realign the types here.
 */
async function retypeBooleanColumnsOnPostgres(): Promise<void> {
  if (!isPostgres()) return;
  const exec = getDbExec();
  const alters: Array<[string, string, boolean]> = [
    ["calls", "share_includes_summary", true],
    ["calls", "share_includes_transcript", false],
    ["calls", "enable_comments", true],
    ["calls", "enable_downloads", false],
    ["spaces", "is_all_company", false],
    ["call_participants", "is_internal", false],
    ["call_comments", "resolved", false],
    ["call_viewers", "counted_view", false],
    ["snippet_viewers", "counted_view", false],
    ["tracker_definitions", "is_default", false],
    ["tracker_definitions", "enabled", true],
    ["zoom_connections", "auto_import", true],
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

const migrations = runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'My Workspace',
      slug TEXT NOT NULL,
      brand_color TEXT NOT NULL DEFAULT '#111111',
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
    {
      version: 4,
      sql: `CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#111111',
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
    {
      version: 7,
      sql: `CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      folder_id TEXT,
      space_ids TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'upload',
      source_meta TEXT NOT NULL DEFAULT '{}',
      title TEXT NOT NULL DEFAULT 'Untitled call',
      description TEXT NOT NULL DEFAULT '',
      account_id TEXT,
      deal_stage TEXT,
      thumbnail_url TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      media_url TEXT,
      media_kind TEXT NOT NULL DEFAULT 'video',
      media_format TEXT NOT NULL DEFAULT 'mp4',
      media_size_bytes INTEGER NOT NULL DEFAULT 0,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      recorded_at TEXT,
      timezone TEXT,
      status TEXT NOT NULL DEFAULT 'uploading',
      progress_pct INTEGER NOT NULL DEFAULT 0,
      failure_reason TEXT,
      password TEXT,
      expires_at TEXT,
      share_includes_summary BOOLEAN NOT NULL DEFAULT TRUE,
      share_includes_transcript BOOLEAN NOT NULL DEFAULT FALSE,
      enable_comments BOOLEAN NOT NULL DEFAULT TRUE,
      enable_downloads BOOLEAN NOT NULL DEFAULT FALSE,
      default_speed TEXT NOT NULL DEFAULT '1.0',
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
      sql: `CREATE TABLE IF NOT EXISTS call_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 9,
      sql: `CREATE TABLE IF NOT EXISTS call_participants (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
      speaker_label TEXT NOT NULL,
      display_name TEXT,
      email TEXT,
      is_internal BOOLEAN NOT NULL DEFAULT FALSE,
      avatar_url TEXT,
      color TEXT NOT NULL DEFAULT '#111111',
      talk_ms INTEGER NOT NULL DEFAULT 0,
      talk_pct INTEGER NOT NULL DEFAULT 0,
      longest_monologue_ms INTEGER NOT NULL DEFAULT 0,
      interruptions_count INTEGER NOT NULL DEFAULT 0,
      questions_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 10,
      sql: `CREATE TABLE IF NOT EXISTS call_transcripts (
      call_id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      language TEXT NOT NULL DEFAULT 'en',
      provider TEXT NOT NULL DEFAULT 'deepgram',
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
      sql: `CREATE TABLE IF NOT EXISTS call_summaries (
      call_id TEXT PRIMARY KEY,
      recap TEXT NOT NULL DEFAULT '',
      key_points_json TEXT NOT NULL DEFAULT '[]',
      next_steps_json TEXT NOT NULL DEFAULT '[]',
      topics_json TEXT NOT NULL DEFAULT '[]',
      questions_json TEXT NOT NULL DEFAULT '[]',
      action_items_json TEXT NOT NULL DEFAULT '[]',
      sentiment TEXT,
      generated_by TEXT NOT NULL DEFAULT 'agent',
      generated_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 12,
      sql: `CREATE TABLE IF NOT EXISTS tracker_definitions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'keyword',
      keywords_json TEXT NOT NULL DEFAULT '[]',
      classifier_prompt TEXT,
      color TEXT NOT NULL DEFAULT '#111111',
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 13,
      sql: `CREATE TABLE IF NOT EXISTS tracker_hits (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
      tracker_id TEXT NOT NULL,
      speaker_label TEXT,
      segment_start_ms INTEGER NOT NULL DEFAULT 0,
      segment_end_ms INTEGER NOT NULL DEFAULT 0,
      quote TEXT NOT NULL DEFAULT '',
      confidence INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 14,
      sql: `CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled snippet',
      description TEXT NOT NULL DEFAULT '',
      start_ms INTEGER NOT NULL DEFAULT 0,
      end_ms INTEGER NOT NULL DEFAULT 0,
      password TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      trashed_at TEXT,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
    },
    {
      version: 15,
      sql: `CREATE TABLE IF NOT EXISTS snippet_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 16,
      sql: `CREATE TABLE IF NOT EXISTS call_tags (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      tag TEXT NOT NULL
    )`,
    },
    {
      version: 17,
      sql: `CREATE TABLE IF NOT EXISTS call_comments (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
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
      version: 18,
      sql: `CREATE TABLE IF NOT EXISTS call_viewers (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
      viewer_email TEXT,
      viewer_name TEXT,
      first_viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
      total_watch_ms INTEGER NOT NULL DEFAULT 0,
      completed_pct INTEGER NOT NULL DEFAULT 0,
      counted_view BOOLEAN NOT NULL DEFAULT FALSE
    )`,
    },
    {
      version: 19,
      sql: `CREATE TABLE IF NOT EXISTS call_events (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL,
      viewer_id TEXT,
      kind TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 20,
      sql: `CREATE TABLE IF NOT EXISTS snippet_viewers (
      id TEXT PRIMARY KEY,
      snippet_id TEXT NOT NULL,
      viewer_email TEXT,
      viewer_name TEXT,
      first_viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
      total_watch_ms INTEGER NOT NULL DEFAULT 0,
      completed_pct INTEGER NOT NULL DEFAULT 0,
      counted_view BOOLEAN NOT NULL DEFAULT FALSE
    )`,
    },
    {
      version: 21,
      sql: `CREATE TABLE IF NOT EXISTS recall_bots (
      id TEXT PRIMARY KEY,
      call_id TEXT,
      workspace_id TEXT NOT NULL,
      meeting_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      scheduled_at TEXT,
      started_at TEXT,
      ended_at TEXT,
      created_by TEXT NOT NULL,
      raw_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 22,
      sql: `CREATE TABLE IF NOT EXISTS zoom_connections (
      email TEXT PRIMARY KEY,
      access_token_encrypted TEXT NOT NULL,
      refresh_token_encrypted TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      auto_import BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 23,
      sql: `CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      domain TEXT,
      logo_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    {
      version: 24,
      sql: `CREATE TABLE IF NOT EXISTS saved_views (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      name TEXT NOT NULL,
      filters_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    },
    // Indexes for common lookup paths
    {
      version: 25,
      sql: `CREATE INDEX IF NOT EXISTS idx_calls_workspace_created ON calls(workspace_id, created_at)`,
    },
    {
      version: 26,
      sql: `CREATE INDEX IF NOT EXISTS idx_call_participants_call ON call_participants(call_id)`,
    },
    {
      version: 27,
      sql: `CREATE INDEX IF NOT EXISTS idx_tracker_hits_call ON tracker_hits(call_id)`,
    },
    {
      version: 28,
      sql: `CREATE INDEX IF NOT EXISTS idx_tracker_hits_tracker ON tracker_hits(tracker_id)`,
    },
    {
      version: 29,
      sql: `CREATE INDEX IF NOT EXISTS idx_snippets_call ON snippets(call_id)`,
    },
    {
      version: 30,
      sql: `CREATE INDEX IF NOT EXISTS idx_call_tags_call ON call_tags(call_id)`,
    },
    {
      version: 31,
      sql: `CREATE INDEX IF NOT EXISTS idx_call_comments_call ON call_comments(call_id)`,
    },
    {
      version: 32,
      sql: `CREATE INDEX IF NOT EXISTS idx_call_viewers_call ON call_viewers(call_id)`,
    },
  ],
  { table: "calls_migrations" },
);

export default async (nitroApp: any): Promise<void> => {
  await migrations(nitroApp);
  await retypeBooleanColumnsOnPostgres();
};
