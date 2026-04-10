-- ═══════════════════════════════════════════════════════════════════
-- Sonic Pro — Supabase Database Migration v3
-- Adds: subscriptions, user_usage, tier-aware analysis limit,
--       check_and_increment_export() RPC, auto-subscription trigger.
--
-- Run order:
--   If you ran v1/v2 already → run the whole file (idempotent).
--   Fresh database          → run the whole file.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────
-- 1. SUBSCRIPTIONS TABLE
--    One row per user. Created automatically via trigger below.
--    Updated by the stripe-webhook Edge Function (service role).
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id     text        NULL,
  stripe_subscription_id text        NULL,
  status                 text        NOT NULL DEFAULT 'free'
                         CHECK (status IN ('free','active','canceled','past_due','incomplete')),
  current_period_end     timestamptz NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_user_id_key UNIQUE (user_id)
);

COMMENT ON TABLE  public.subscriptions IS 'One row per user. status=active means Pro tier.';
COMMENT ON COLUMN public.subscriptions.status IS 'free|active|canceled|past_due|incomplete';

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx
  ON public.subscriptions (user_id);
CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_idx
  ON public.subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────
-- 2. USER_USAGE TABLE
--    One row per (user, ISO-week Monday).  Tracks free-tier
--    weekly feature usage.  Rows are created on first use of
--    each feature within a week.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_usage (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start       date        NOT NULL,          -- ISO Monday (date_trunc('week',now()))
  ai_audits_count  int         NOT NULL DEFAULT 0,
  exports_count    int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_usage_user_week_key UNIQUE (user_id, week_start)
);

COMMENT ON TABLE  public.user_usage IS 'Weekly feature usage counters for free-tier enforcement.';
COMMENT ON COLUMN public.user_usage.week_start IS 'ISO Monday — date_trunc(week, now())::date';

CREATE INDEX IF NOT EXISTS user_usage_user_week_idx
  ON public.user_usage (user_id, week_start);


-- ─────────────────────────────────────────────────────────────
-- 3. ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_usage     ENABLE ROW LEVEL SECURITY;

-- Subscriptions: users can only read their own row.
-- Writes come from Edge Functions using service role (bypasses RLS).
DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Usage: users can only read their own rows.
-- Writes come from Edge Functions (service role) and the RPC below.
DROP POLICY IF EXISTS "Users can view own usage" ON public.user_usage;
CREATE POLICY "Users can view own usage"
  ON public.user_usage FOR SELECT
  USING (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────
-- 4. check_and_increment_export() RPC
--
--    Called directly from the browser (anon/authenticated key).
--    Uses auth.uid() — cannot be spoofed.
--    Returns: { allowed, remaining?, limit?, resetDate?, isPro?, error? }
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_and_increment_export()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as postgres; bypasses RLS for the update
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid  := auth.uid();
  v_week_start date  := date_trunc('week', now())::date;
  v_is_pro     bool  := false;
  v_count      int   := 0;
  v_free_limit int   := 3;
BEGIN
  -- Must be authenticated
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'Not authenticated', 'code', 'AUTH_REQUIRED');
  END IF;

  -- Check subscription tier
  SELECT (status = 'active') INTO v_is_pro
  FROM public.subscriptions
  WHERE user_id = v_user_id;

  IF v_is_pro THEN
    RETURN jsonb_build_object('allowed', true, 'isPro', true);
  END IF;

  -- Ensure usage row exists for this week
  INSERT INTO public.user_usage (user_id, week_start)
  VALUES (v_user_id, v_week_start)
  ON CONFLICT (user_id, week_start) DO NOTHING;

  -- Read current count
  SELECT exports_count INTO v_count
  FROM public.user_usage
  WHERE user_id = v_user_id AND week_start = v_week_start;

  IF v_count >= v_free_limit THEN
    RETURN jsonb_build_object(
      'allowed',    false,
      'current',    v_count,
      'limit',      v_free_limit,
      'remaining',  0,
      'resetDate',  (v_week_start + 7)::text,
      'code',       'LIMIT_REACHED'
    );
  END IF;

  -- Increment atomically
  UPDATE public.user_usage
  SET exports_count = exports_count + 1,
      updated_at    = now()
  WHERE user_id = v_user_id AND week_start = v_week_start;

  RETURN jsonb_build_object(
    'allowed',   true,
    'current',   v_count + 1,
    'limit',     v_free_limit,
    'remaining', v_free_limit - v_count - 1
  );
END;
$$;

COMMENT ON FUNCTION public.check_and_increment_export IS
  'Atomically checks and increments weekly export count. Called from browser via supabase.rpc().';

-- Grant execute to authenticated role (needed for client calls)
GRANT EXECUTE ON FUNCTION public.check_and_increment_export() TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- 5. UPDATED check_analysis_limit TRIGGER
--    Replaces v2 trigger.  Now respects subscription tier:
--      free → max 5 saves
--      pro  → unlimited
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION check_analysis_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_is_pro  bool := false;
  v_count   int;
  v_limit   int  := 5;   -- free tier
BEGIN
  -- Check subscription
  SELECT (status = 'active') INTO v_is_pro
  FROM public.subscriptions
  WHERE user_id = NEW.user_id;

  IF v_is_pro THEN
    RETURN NEW;  -- No limit for Pro
  END IF;

  SELECT count(*) INTO v_count
  FROM public.analyses
  WHERE user_id = NEW.user_id;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'Library full (% saves on free tier). Upgrade to Pro for unlimited saves.', v_limit;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate trigger (function is already replaced above)
DROP TRIGGER IF EXISTS enforce_analysis_limit ON public.analyses;
CREATE TRIGGER enforce_analysis_limit
  BEFORE INSERT ON public.analyses
  FOR EACH ROW
  EXECUTE FUNCTION check_analysis_limit();


-- ─────────────────────────────────────────────────────────────
-- 6. AUTO-CREATE SUBSCRIPTION ROW ON SIGN-UP
--    Fires after a new auth.users row is inserted (email confirm
--    or OAuth).  Creates a free-tier subscription immediately so
--    every user always has exactly one row in subscriptions.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_default_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, status)
  VALUES (NEW.id, 'free')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_default_subscription();


-- ─────────────────────────────────────────────────────────────
-- 7. BACKFILL — create subscription rows for existing users
--    Safe to run even if already done (ON CONFLICT DO NOTHING).
-- ─────────────────────────────────────────────────────────────

INSERT INTO public.subscriptions (user_id, status)
SELECT id, 'free'
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- 8. VERIFY
-- ─────────────────────────────────────────────────────────────

-- 8a. Tables exist with RLS on
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('analyses','subscriptions','user_usage');

-- 8b. Triggers on analyses
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_table = 'analyses';

-- 8c. RPC callable
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'check_and_increment_export';
