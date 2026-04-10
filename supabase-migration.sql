-- ═══════════════════════════════════════════════════════════════════
-- Sonic Pro — Supabase Database Migration v2
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ═══════════════════════════════════════════════════════════════════
--
-- If you ran the v1 migration already, run ONLY Sections 5, 6, 7 below.
-- If this is a fresh database, run the whole file.
--
-- Schema design:
--   Core metrics as typed columns — enables SQL filtering/sorting.
--   Full analysis blob as JSONB — flexible, no schema changes needed
--   when new DSP metrics are added.
--
-- Security: RLS enforces auth.uid() = user_id on every operation.
--   No client-side security checks — the database is the single
--   source of truth.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────
-- 1. CREATE TABLE (idempotent — safe to re-run)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.analyses (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  file_name       text        NOT NULL DEFAULT '',
  integrated_lufs float       NULL,
  peak_db         float       NULL,
  crest_factor    float       NULL,
  profile_id      text        NULL,
  full_data       jsonb       NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE  public.analyses IS 'Sonic Pro mix analysis snapshots. One row = one saved analysis.';
COMMENT ON COLUMN public.analyses.full_data IS
  'Complete JSON snapshot: mixHealth, vibeTimeline, delta, selectedProfile. Max 200KB enforced by CHECK constraint.';


-- ─────────────────────────────────────────────────────────────
-- 2. INDEXES (idempotent)
-- ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS analyses_user_id_idx
  ON public.analyses (user_id);

CREATE INDEX IF NOT EXISTS analyses_created_at_idx
  ON public.analyses (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS analyses_profile_id_idx
  ON public.analyses (user_id, profile_id)
  WHERE profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS analyses_integrated_lufs_idx
  ON public.analyses (user_id, integrated_lufs)
  WHERE integrated_lufs IS NOT NULL;


-- ─────────────────────────────────────────────────────────────
-- 3. ENABLE ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────
-- 4. RLS POLICIES (idempotent via DROP IF EXISTS + CREATE)
-- ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view their own analyses"   ON public.analyses;
DROP POLICY IF EXISTS "Users can insert their own analyses" ON public.analyses;
DROP POLICY IF EXISTS "Users can update their own analyses" ON public.analyses;
DROP POLICY IF EXISTS "Users can delete their own analyses" ON public.analyses;

CREATE POLICY "Users can view their own analyses"
  ON public.analyses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own analyses"
  ON public.analyses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own analyses"
  ON public.analyses FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own analyses"
  ON public.analyses FOR DELETE
  USING (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────
-- 5. JSONB SIZE CONSTRAINT — prevent storage bloat (NEW in v2)
-- ─────────────────────────────────────────────────────────────
-- Blocks any row where the full_data JSON exceeds 200KB as text.
-- A normal analysis snapshot is ~10-30KB. 200KB gives plenty of
-- headroom while blocking accidental or malicious oversized inserts.
-- This constraint is enforced by Postgres on every INSERT and UPDATE.

ALTER TABLE public.analyses
  DROP CONSTRAINT IF EXISTS analyses_full_data_size_check;

ALTER TABLE public.analyses
  ADD CONSTRAINT analyses_full_data_size_check
  CHECK (octet_length(full_data::text) <= 200000);


-- ─────────────────────────────────────────────────────────────
-- 6. PER-USER ANALYSIS LIMIT TRIGGER — 20 rows max (NEW in v2)
-- ─────────────────────────────────────────────────────────────
-- Why a trigger and not just the client check?
--   The client check in useLibrary.js gives instant feedback, but it
--   can be bypassed by anyone with your anon key + a curl command.
--   The trigger runs INSIDE Postgres — it cannot be bypassed by
--   any client, ever.
--
-- Why BEFORE INSERT (not AFTER)?
--   BEFORE fires before the row is written. If the check fails, the
--   INSERT is aborted and the row is never stored. AFTER would write
--   the row first and then try to undo it — wasteful and unreliable.
--
-- Free tier cap: 20 analyses per user.

CREATE OR REPLACE FUNCTION check_analysis_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.analyses
    WHERE user_id = NEW.user_id
  ) >= 20 THEN
    RAISE EXCEPTION 'Analysis limit reached (20 maximum per tier). Delete an existing analysis to save a new one.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_analysis_limit ON public.analyses;

CREATE TRIGGER enforce_analysis_limit
  BEFORE INSERT ON public.analyses
  FOR EACH ROW
  EXECUTE FUNCTION check_analysis_limit();


-- ─────────────────────────────────────────────────────────────
-- 7. VERIFY — run these to confirm everything is in place
-- ─────────────────────────────────────────────────────────────

-- 7a. Confirm RLS is active
SELECT schemaname, tablename, rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'analyses';
-- Expected:  rls_enabled = t

-- 7b. Confirm trigger exists
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_table = 'analyses';
-- Expected: enforce_analysis_limit | INSERT | BEFORE

-- 7c. Confirm CHECK constraint exists
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.analyses'::regclass AND contype = 'c';
-- Expected: analyses_full_data_size_check | CHECK (octet_length(...) <= 200000)
