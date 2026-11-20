import type { MigrationEntry } from "@agent-native/core/db";

const stamps = "created_at text NOT NULL, updated_at text NOT NULL";

export const journeysMigrations: MigrationEntry[] = [
  {
    version: 1,
    name: "journeys-core",
    sql: `
CREATE TABLE IF NOT EXISTS jn_journeys (id text PRIMARY KEY, name text NOT NULL, status text NOT NULL DEFAULT 'draft', kind text NOT NULL DEFAULT 'audience', audience_id text, goal text NOT NULL DEFAULT '', nodes jsonb NOT NULL DEFAULT '[]', edges jsonb NOT NULL DEFAULT '[]', settings jsonb NOT NULL DEFAULT '{}', report jsonb NOT NULL DEFAULT '{}', entered integer NOT NULL DEFAULT 0, exited integer NOT NULL DEFAULT 0, ${stamps});
CREATE TABLE IF NOT EXISTS jn_emails (id text PRIMARY KEY, name text NOT NULL, subject text NOT NULL DEFAULT '', preheader text NOT NULL DEFAULT '', from_name text NOT NULL DEFAULT '', from_email text NOT NULL DEFAULT '', reply_to text NOT NULL DEFAULT '', body text NOT NULL DEFAULT '', kind text NOT NULL DEFAULT 'marketing', status text NOT NULL DEFAULT 'draft', track_opens integer NOT NULL DEFAULT 1, track_clicks integer NOT NULL DEFAULT 1, ${stamps});
CREATE TABLE IF NOT EXISTS jn_audiences (id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL DEFAULT 'dynamic', filter jsonb NOT NULL DEFAULT '{}', member_ids jsonb NOT NULL DEFAULT '[]', ${stamps});
CREATE TABLE IF NOT EXISTS jn_accounts (id text PRIMARY KEY, name text NOT NULL, domain text NOT NULL DEFAULT '', industry text NOT NULL DEFAULT '', plan text NOT NULL DEFAULT '', owner text NOT NULL DEFAULT '', employees integer NOT NULL DEFAULT 0, renewal_date text, score integer NOT NULL DEFAULT 0, signals jsonb NOT NULL DEFAULT '[]', ${stamps});
CREATE TABLE IF NOT EXISTS jn_contacts (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, title text NOT NULL DEFAULT '', account_id text, country text NOT NULL DEFAULT '', state text NOT NULL DEFAULT '', lifecycle_stage text NOT NULL DEFAULT 'lead', source text NOT NULL DEFAULT '', subscribed integer NOT NULL DEFAULT 1, last_active text, activity jsonb NOT NULL DEFAULT '{}', lists jsonb NOT NULL DEFAULT '[]', ${stamps});
CREATE INDEX IF NOT EXISTS jn_contacts_email_idx ON jn_contacts(email);
CREATE TABLE IF NOT EXISTS jn_members (id text PRIMARY KEY, journey_id text NOT NULL, contact_id text NOT NULL, status text NOT NULL DEFAULT 'active', current_node_id text, entered_at text NOT NULL, exited_at text);
CREATE INDEX IF NOT EXISTS jn_members_journey_idx ON jn_members(journey_id);
CREATE TABLE IF NOT EXISTS jn_sends (id text PRIMARY KEY, journey_id text NOT NULL, email_id text NOT NULL, day text NOT NULL, sent integer NOT NULL DEFAULT 0, delivered integer NOT NULL DEFAULT 0, opened integer NOT NULL DEFAULT 0, clicked integer NOT NULL DEFAULT 0, bounced integer NOT NULL DEFAULT 0, unsubscribed integer NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS jn_sends_journey_idx ON jn_sends(journey_id);
CREATE TABLE IF NOT EXISTS jn_tokens (id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL DEFAULT 'text', source text NOT NULL DEFAULT '', fallback text NOT NULL DEFAULT '', rules jsonb NOT NULL DEFAULT '[]', ${stamps});
CREATE TABLE IF NOT EXISTS jn_conversions (id text PRIMARY KEY, name text NOT NULL, event_type text NOT NULL, window_days integer NOT NULL DEFAULT 30, journey_id text, count integer NOT NULL DEFAULT 0, ${stamps});
CREATE TABLE IF NOT EXISTS jn_connections (id text PRIMARY KEY, provider text NOT NULL, category text NOT NULL, status text NOT NULL DEFAULT 'disconnected', detail text NOT NULL DEFAULT '', last_sync_at text, config jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS jn_settings (key text PRIMARY KEY, value jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS jn_users (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, role text NOT NULL DEFAULT 'editor', status text NOT NULL DEFAULT 'active', ${stamps});
`,
  },
];
