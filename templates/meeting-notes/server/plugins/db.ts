import { runMigrations } from "@agent-native/core/db";
import { registerEvent } from "@agent-native/core/event-bus";
import { z } from "zod";
// Side-effect import — registers `meeting` as a shareable resource with the
// framework before any HTTP request runs.
import "../db/index.js";

const migrations = runMigrations([
  // ---------------------------------------------------------------------------
  // Meetings — the core resource
  // ---------------------------------------------------------------------------
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled meeting',
      start_time TEXT,
      end_time TEXT,
      calendar_event_id TEXT,
      calendar_provider TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      folder_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
  },
  {
    version: 2,
    sql: `CREATE TABLE IF NOT EXISTS meeting_shares (
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
  // Transcripts
  // ---------------------------------------------------------------------------
  {
    version: 3,
    sql: `CREATE TABLE IF NOT EXISTS meeting_transcripts (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      segments_json TEXT NOT NULL DEFAULT '[]',
      full_text TEXT NOT NULL DEFAULT '',
      speaker_labels TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      failure_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  // ---------------------------------------------------------------------------
  // Notes
  // ---------------------------------------------------------------------------
  {
    version: 4,
    sql: `CREATE TABLE IF NOT EXISTS meeting_notes (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      raw_content TEXT NOT NULL DEFAULT '{}',
      enhanced_content TEXT,
      template_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------
  {
    version: 5,
    sql: `CREATE TABLE IF NOT EXISTS meeting_templates (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      is_built_in BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
  },
  // ---------------------------------------------------------------------------
  // Attendees
  // ---------------------------------------------------------------------------
  {
    version: 6,
    sql: `CREATE TABLE IF NOT EXISTS meeting_attendees (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      person_id TEXT,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'required'
    )`,
  },
  // ---------------------------------------------------------------------------
  // Folders
  // ---------------------------------------------------------------------------
  {
    version: 7,
    sql: `CREATE TABLE IF NOT EXISTS meeting_folders (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  // ---------------------------------------------------------------------------
  // People
  // ---------------------------------------------------------------------------
  {
    version: 8,
    sql: `CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      company_id TEXT,
      title TEXT,
      avatar_url TEXT,
      last_seen_at TEXT,
      meeting_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  // ---------------------------------------------------------------------------
  // Companies
  // ---------------------------------------------------------------------------
  {
    version: 9,
    sql: `CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      domain TEXT,
      logo_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  // ---------------------------------------------------------------------------
  // Recipes
  // ---------------------------------------------------------------------------
  {
    version: 10,
    sql: `CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'single',
      is_public BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
  },
]);

export default async (nitroApp: any): Promise<void> => {
  await migrations(nitroApp);

  // ---------------------------------------------------------------------------
  // Register meeting-notes template events for the automations system.
  // ---------------------------------------------------------------------------
  registerEvent({
    name: "meeting.created",
    description: "A new meeting was created.",
    payloadSchema: z.object({
      meetingId: z.string(),
      title: z.string().optional(),
      createdBy: z.string().optional(),
      startTime: z.string().optional(),
    }) as any,
  });

  registerEvent({
    name: "meeting.enhanced",
    description:
      "A meeting's notes were enhanced by merging raw notes with the transcript.",
    payloadSchema: z.object({
      meetingId: z.string(),
      title: z.string().optional(),
      templateId: z.string().optional(),
    }) as any,
  });

  registerEvent({
    name: "meeting.shared",
    description: "A meeting was shared with a new member.",
    payloadSchema: z.object({
      meetingId: z.string().optional(),
      sharedWith: z.string(),
      sharedBy: z.string().optional(),
    }) as any,
  });
};
