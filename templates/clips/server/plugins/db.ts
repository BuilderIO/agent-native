import { runMigrations } from "@agent-native/core/db";
// Side-effect import — registers `recording` as a shareable resource with the
// framework before any HTTP request runs. The framework's auto-mounted
// share-resource / set-resource-visibility / list-resource-shares actions
// are loaded in a separate Vite SSR bundle from user actions, so we trigger
// the registration eagerly from the always-loaded db plugin.
import "../db/index.js";

// Clips schema migrations — dialect-agnostic SQL. Drizzle schema lives in
// server/db/schema.ts; this plugin creates the tables on first boot.
export default runMigrations([
  // ---------------------------------------------------------------------------
  // Workspaces & members
  // ---------------------------------------------------------------------------
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'My Workspace',
      slug TEXT NOT NULL,
      brand_color TEXT NOT NULL DEFAULT '#625DF5',
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
      color TEXT NOT NULL DEFAULT '#625DF5',
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
      color TEXT NOT NULL DEFAULT '#625DF5',
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
]);
