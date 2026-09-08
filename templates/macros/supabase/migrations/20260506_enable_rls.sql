-- ============================================================
-- Macros — Row Level Security
-- ============================================================
-- The app connects to Supabase Postgres as the `postgres` superuser via
-- postgres.js (see packages/core/src/db/client.ts). That connection bypasses
-- RLS, so the running app is unaffected by the policies below. The policies
-- exist to lock down the PostgREST surface that Supabase exposes via the
-- public anon key, scoped per authenticated user's email.
--
-- Why auth.email() and not auth.uid(): meals/exercises/weights are keyed by
-- a `.notNull()` `owner_email` column; the legacy `user_id` column is unused
-- and nullable. See server/db/schema.ts.
--
-- Idempotent: drops + recreates each policy so re-running is safe.
-- ============================================================

-- ----------------------------------------------------------------
-- meals
-- ----------------------------------------------------------------
ALTER TABLE public.meals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meals_select_own" ON public.meals;
CREATE POLICY "meals_select_own"
  ON public.meals FOR SELECT
  TO authenticated
  USING (auth.email() = owner_email);

DROP POLICY IF EXISTS "meals_insert_own" ON public.meals;
CREATE POLICY "meals_insert_own"
  ON public.meals FOR INSERT
  TO authenticated
  WITH CHECK (auth.email() = owner_email);

DROP POLICY IF EXISTS "meals_update_own" ON public.meals;
CREATE POLICY "meals_update_own"
  ON public.meals FOR UPDATE
  TO authenticated
  USING (auth.email() = owner_email)
  WITH CHECK (auth.email() = owner_email);

DROP POLICY IF EXISTS "meals_delete_own" ON public.meals;
CREATE POLICY "meals_delete_own"
  ON public.meals FOR DELETE
  TO authenticated
  USING (auth.email() = owner_email);

-- ----------------------------------------------------------------
-- exercises
-- ----------------------------------------------------------------
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exercises_select_own" ON public.exercises;
CREATE POLICY "exercises_select_own"
  ON public.exercises FOR SELECT
  TO authenticated
  USING (auth.email() = owner_email);

DROP POLICY IF EXISTS "exercises_insert_own" ON public.exercises;
CREATE POLICY "exercises_insert_own"
  ON public.exercises FOR INSERT
  TO authenticated
  WITH CHECK (auth.email() = owner_email);

DROP POLICY IF EXISTS "exercises_update_own" ON public.exercises;
CREATE POLICY "exercises_update_own"
  ON public.exercises FOR UPDATE
  TO authenticated
  USING (auth.email() = owner_email)
  WITH CHECK (auth.email() = owner_email);

DROP POLICY IF EXISTS "exercises_delete_own" ON public.exercises;
CREATE POLICY "exercises_delete_own"
  ON public.exercises FOR DELETE
  TO authenticated
  USING (auth.email() = owner_email);

-- ----------------------------------------------------------------
-- weights
-- ----------------------------------------------------------------
ALTER TABLE public.weights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weights_select_own" ON public.weights;
CREATE POLICY "weights_select_own"
  ON public.weights FOR SELECT
  TO authenticated
  USING (auth.email() = owner_email);

DROP POLICY IF EXISTS "weights_insert_own" ON public.weights;
CREATE POLICY "weights_insert_own"
  ON public.weights FOR INSERT
  TO authenticated
  WITH CHECK (auth.email() = owner_email);

DROP POLICY IF EXISTS "weights_update_own" ON public.weights;
CREATE POLICY "weights_update_own"
  ON public.weights FOR UPDATE
  TO authenticated
  USING (auth.email() = owner_email)
  WITH CHECK (auth.email() = owner_email);

DROP POLICY IF EXISTS "weights_delete_own" ON public.weights;
CREATE POLICY "weights_delete_own"
  ON public.weights FOR DELETE
  TO authenticated
  USING (auth.email() = owner_email);
