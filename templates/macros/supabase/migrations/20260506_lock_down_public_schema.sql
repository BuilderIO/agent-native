-- ============================================================
-- Lock down the entire public schema from PostgREST
-- ============================================================
-- Supabase auto-grants full CRUD on every table in `public` to the `anon`
-- and `authenticated` roles. Combined with the publicly-shipped anon key
-- (VITE_SUPABASE_ANON_KEY in the frontend bundle), this exposes every table
-- in `public` over PostgREST: framework tables (chat_threads,
-- application_state, app_secrets, agent_run_events, tool_data, user,
-- sessions, etc.) plus app tables (meals, exercises, weights).
--
-- The macros app does NOT use PostgREST. It connects directly via
-- postgres.js as the `postgres` superuser (see packages/core/src/db/client.ts)
-- which bypasses both grants and RLS. So we revoke all PostgREST access and
-- the app keeps working.
--
-- Idempotent: re-running this is safe.
-- ============================================================

-- 1. Revoke all CRUD privileges from anon and authenticated on existing
--    tables, sequences, and functions in public schema.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- 2. Make this the default for any FUTURE objects created by the postgres
--    role (which is who runMigrations runs as). New tables added later will
--    automatically inherit "no access from anon/authenticated".
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- 3. Defense in depth: enable RLS on every public table that doesn't have
--    it yet. Without policies, RLS denies all access from non-superusers
--    by default. The postgres superuser the app connects as bypasses RLS,
--    so the app is unaffected. This silences Supabase's Security Advisor.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT relname FROM pg_class
    WHERE relnamespace = 'public'::regnamespace
      AND relkind = 'r'
      AND NOT relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;
