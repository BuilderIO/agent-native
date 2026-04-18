/**
 * Database migrations for the scheduling template.
 *
 * All tables come from the @agent-native/scheduling schema package, but
 * Drizzle doesn't auto-create tables — we materialize them here with
 * dialect-agnostic CREATE TABLE statements that work on SQLite/libsql,
 * Postgres, and D1.
 *
 * Conventions:
 * - INTEGER is rewritten to BIGINT on Postgres by runMigrations; safe everywhere.
 * - Boolean columns are INTEGER 0/1 on SQLite and BIGINT 0/1 on Postgres.
 * - Timestamps are TEXT ISO-8601 strings.
 * - `datetime('now')` is rewritten to `CURRENT_TIMESTAMP` on Postgres.
 * - Each `ownableColumns()` adds owner_email / org_id / visibility.
 * - Each `createSharesTable()` is a companion shares table.
 */
import { runMigrations } from "@agent-native/core/db";

export default runMigrations([
  // ---------- Event types ----------
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS event_types (
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
    )`,
  },
  {
    version: 2,
    sql: `CREATE TABLE IF NOT EXISTS event_type_hosts (
      event_type_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      is_fixed INTEGER NOT NULL DEFAULT 0,
      weight INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 2,
      schedule_id TEXT,
      group_id TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (event_type_id, user_email)
    )`,
  },
  {
    version: 3,
    sql: `CREATE TABLE IF NOT EXISTS event_type_host_groups (
      id TEXT PRIMARY KEY,
      event_type_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 4,
    sql: `CREATE TABLE IF NOT EXISTS event_type_slug_redirects (
      old_key TEXT PRIMARY KEY,
      new_key TEXT NOT NULL,
      event_type_id TEXT,
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 5,
    sql: `CREATE TABLE IF NOT EXISTS hashed_links (
      id TEXT PRIMARY KEY,
      hash TEXT NOT NULL UNIQUE,
      event_type_id TEXT NOT NULL,
      expires_at TEXT,
      is_single_use INTEGER NOT NULL DEFAULT 0,
      used_at TEXT,
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 6,
    sql: `CREATE TABLE IF NOT EXISTS event_type_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },

  // ---------- Schedules ----------
  {
    version: 7,
    sql: `CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
  },
  {
    version: 8,
    sql: `CREATE TABLE IF NOT EXISTS schedule_availability (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      day INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 9,
    sql: `CREATE TABLE IF NOT EXISTS date_overrides (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL,
      date TEXT NOT NULL,
      intervals TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 10,
    sql: `CREATE TABLE IF NOT EXISTS travel_schedules (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      timezone TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 11,
    sql: `CREATE TABLE IF NOT EXISTS out_of_office_entries (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT,
      notes TEXT,
      redirect_user_email TEXT,
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 12,
    sql: `CREATE TABLE IF NOT EXISTS schedule_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },

  // ---------- Bookings ----------
  {
    version: 13,
    sql: `CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      uid TEXT NOT NULL UNIQUE,
      event_type_id TEXT NOT NULL,
      host_email TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      status TEXT NOT NULL DEFAULT 'confirmed',
      location TEXT,
      custom_responses TEXT,
      cancel_token TEXT,
      reschedule_token TEXT,
      from_reschedule TEXT,
      cancellation_reason TEXT,
      rescheduling_reason TEXT,
      ical_uid TEXT NOT NULL,
      ical_sequence INTEGER NOT NULL DEFAULT 0,
      recurring_event_id TEXT,
      paid INTEGER NOT NULL DEFAULT 0,
      no_show_host INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
  },
  {
    version: 14,
    sql: `CREATE TABLE IF NOT EXISTS booking_attendees (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      timezone TEXT,
      locale TEXT,
      no_show INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 15,
    sql: `CREATE TABLE IF NOT EXISTS booking_references (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      type TEXT NOT NULL,
      external_id TEXT NOT NULL,
      meeting_url TEXT,
      meeting_password TEXT,
      credential_id TEXT,
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 16,
    sql: `CREATE TABLE IF NOT EXISTS booking_seats (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      attendee_id TEXT NOT NULL,
      reference_uid TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 17,
    sql: `CREATE TABLE IF NOT EXISTS booking_notes (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      author_email TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 18,
    sql: `CREATE TABLE IF NOT EXISTS booking_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },

  // ---------- Teams ----------
  {
    version: 19,
    sql: `CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      logo_url TEXT,
      brand_color TEXT,
      dark_brand_color TEXT,
      bio TEXT,
      hide_branding INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
  },
  {
    version: 20,
    sql: `CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      accepted INTEGER NOT NULL DEFAULT 0,
      invite_token TEXT,
      invited_at TEXT NOT NULL,
      joined_at TEXT
    )`,
  },
  {
    version: 21,
    sql: `CREATE TABLE IF NOT EXISTS team_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },

  // ---------- Credentials & integrations ----------
  {
    version: 22,
    sql: `CREATE TABLE IF NOT EXISTS scheduling_credentials (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      user_email TEXT,
      team_id TEXT,
      app_id TEXT,
      oauth_token_id TEXT,
      display_name TEXT,
      external_email TEXT,
      invalid INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  },
  {
    version: 23,
    sql: `CREATE TABLE IF NOT EXISTS selected_calendars (
      id TEXT PRIMARY KEY,
      credential_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      external_id TEXT NOT NULL,
      integration TEXT NOT NULL,
      event_type_id TEXT,
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 24,
    sql: `CREATE TABLE IF NOT EXISTS destination_calendars (
      id TEXT PRIMARY KEY,
      credential_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      integration TEXT NOT NULL,
      external_id TEXT NOT NULL,
      primary_email TEXT,
      event_type_id TEXT,
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 25,
    sql: `CREATE TABLE IF NOT EXISTS verified_emails (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      user_email TEXT,
      team_id TEXT,
      verified_at TEXT NOT NULL
    )`,
  },
  {
    version: 26,
    sql: `CREATE TABLE IF NOT EXISTS verified_numbers (
      id TEXT PRIMARY KEY,
      phone_number TEXT NOT NULL,
      user_email TEXT,
      team_id TEXT,
      verified_at TEXT NOT NULL
    )`,
  },
  {
    version: 27,
    sql: `CREATE TABLE IF NOT EXISTS calendar_cache (
      id TEXT PRIMARY KEY,
      credential_id TEXT NOT NULL,
      cache_key TEXT NOT NULL UNIQUE,
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      busy_json TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  },

  // ---------- Workflows ----------
  {
    version: 28,
    sql: `CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger TEXT NOT NULL,
      team_id TEXT,
      disabled INTEGER NOT NULL DEFAULT 0,
      active_on_event_type_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
  },
  {
    version: 29,
    sql: `CREATE TABLE IF NOT EXISTS workflow_steps (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      "order" INTEGER NOT NULL DEFAULT 0,
      action TEXT NOT NULL,
      offset_minutes INTEGER NOT NULL DEFAULT 0,
      send_to TEXT,
      email_subject TEXT,
      email_body TEXT,
      sms_body TEXT,
      webhook_url TEXT,
      template TEXT,
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 30,
    sql: `CREATE TABLE IF NOT EXISTS scheduled_reminders (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      workflow_step_id TEXT NOT NULL,
      method TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      sent INTEGER NOT NULL DEFAULT 0,
      sent_at TEXT,
      failed INTEGER NOT NULL DEFAULT 0,
      failure_reason TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 31,
    sql: `CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      name TEXT,
      subscriber_url TEXT NOT NULL,
      secret TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      event_triggers TEXT NOT NULL DEFAULT '[]',
      team_id TEXT,
      event_type_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
  },
  {
    version: 32,
    sql: `CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      triggered_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      response_status INTEGER,
      response_body TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0
    )`,
  },
  {
    version: 33,
    sql: `CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      hashed_key TEXT NOT NULL UNIQUE,
      note TEXT,
      user_email TEXT,
      team_id TEXT,
      expires_at TEXT,
      last_used_at TEXT,
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 34,
    sql: `CREATE TABLE IF NOT EXISTS workflow_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },

  // ---------- Routing forms ----------
  {
    version: 35,
    sql: `CREATE TABLE IF NOT EXISTS routing_forms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      team_id TEXT,
      disabled INTEGER NOT NULL DEFAULT 0,
      fields TEXT NOT NULL DEFAULT '[]',
      rules TEXT NOT NULL DEFAULT '[]',
      fallback TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      owner_email TEXT NOT NULL DEFAULT 'local@localhost',
      org_id TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
    )`,
  },
  {
    version: 36,
    sql: `CREATE TABLE IF NOT EXISTS routing_form_responses (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL,
      response TEXT NOT NULL,
      booking_id TEXT,
      matched_rule_id TEXT,
      routed_to TEXT,
      submitter_email TEXT,
      submitter_ip TEXT,
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 37,
    sql: `CREATE TABLE IF NOT EXISTS routing_form_shares (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      principal_type TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },

  // ---------- Indexes ----------
  {
    version: 38,
    sql: `CREATE INDEX IF NOT EXISTS idx_event_types_owner ON event_types(owner_email)`,
  },
  {
    version: 39,
    sql: `CREATE INDEX IF NOT EXISTS idx_event_types_slug ON event_types(owner_email, slug)`,
  },
  {
    version: 40,
    sql: `CREATE INDEX IF NOT EXISTS idx_schedules_owner ON schedules(owner_email)`,
  },
  {
    version: 41,
    sql: `CREATE INDEX IF NOT EXISTS idx_schedule_availability_schedule ON schedule_availability(schedule_id)`,
  },
  {
    version: 42,
    sql: `CREATE INDEX IF NOT EXISTS idx_date_overrides_schedule ON date_overrides(schedule_id)`,
  },
  {
    version: 43,
    sql: `CREATE INDEX IF NOT EXISTS idx_bookings_host ON bookings(host_email)`,
  },
  {
    version: 44,
    sql: `CREATE INDEX IF NOT EXISTS idx_bookings_event_type ON bookings(event_type_id)`,
  },
  {
    version: 45,
    sql: `CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status)`,
  },
  {
    version: 46,
    sql: `CREATE INDEX IF NOT EXISTS idx_booking_attendees_booking ON booking_attendees(booking_id)`,
  },
  {
    version: 47,
    sql: `CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_due ON scheduled_reminders(sent, failed, scheduled_for)`,
  },
]);
