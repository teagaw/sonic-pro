-- Combined v2+v3 migration: tables, RLS, triggers, RPC
-- Idempotent — safe to run on fresh or partially-migrated databases

-- ═══════════════════════════════════════════════════════════════
-- 1. SUBSCRIPTIONS TABLE (v3)
-- ═══════════════════════════════════════════════════════════════
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

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON public.subscriptions (user_id);
CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_id_idx
  ON public.subscriptions (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 2. USER_USAGE TABLE (v3)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.user_usage (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start       date        NOT NULL,
  ai_audits_count  int         NOT NULL DEFAULT 0,
  exports_count    int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_usage_user_week_key UNIQUE (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS user_usage_user_week_idx ON public.user_usage (user_id, week_start);

-- ═══════════════════════════════════════════════════════════════
-- 3. RLS ON ALL TABLES
-- ═══════════════════════════════════════════════════════════════

-- analyses (v2 — was never applied)
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own analyses" ON public.analyses;
DROP POLICY IF EXISTS "Users can insert their own analyses" ON public.analyses;
DROP POLICY IF EXISTS "Users can update their own analyses" ON public.analyses;
DROP POLICY IF EXISTS "Users can delete their own analyses" ON public.analyses;

CREATE POLICY "Users can view their own analyses"
  ON public.analyses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own analyses"
  ON public.analyses FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own analyses"
  ON public.analyses FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own analyses"
  ON public.analyses FOR DELETE USING (auth.uid() = user_id);

-- subscriptions (v3)
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);

-- user_usage (v3)
ALTER TABLE public.user_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own usage" ON public.user_usage;
CREATE POLICY "Users can view own usage"
  ON public.user_usage FOR SELECT USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════
-- 4. check_and_increment_export() RPC (v3)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.check_and_increment_export()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid  := auth.uid();
  v_week_start date  := date_trunc('week', now())::date;
  v_is_pro     bool  := false;
  v_count      int   := 0;
  v_free_limit int   := 3;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'Not authenticated', 'code', 'AUTH_REQUIRED');
  END IF;

  SELECT (status = 'active') INTO v_is_pro
  FROM public.subscriptions WHERE user_id = v_user_id;

  IF v_is_pro THEN
    RETURN jsonb_build_object('allowed', true, 'isPro', true);
  END IF;

  INSERT INTO public.user_usage (user_id, week_start)
  VALUES (v_user_id, v_week_start)
  ON CONFLICT (user_id, week_start) DO NOTHING;

  SELECT exports_count INTO v_count
  FROM public.user_usage
  WHERE user_id = v_user_id AND week_start = v_week_start;

  IF v_count >= v_free_limit THEN
    RETURN jsonb_build_object(
      'allowed', false, 'current', v_count, 'limit', v_free_limit,
      'remaining', 0, 'resetDate', (v_week_start + 7)::text, 'code', 'LIMIT_REACHED'
    );
  END IF;

  UPDATE public.user_usage
  SET exports_count = exports_count + 1, updated_at = now()
  WHERE user_id = v_user_id AND week_start = v_week_start;

  RETURN jsonb_build_object(
    'allowed', true, 'current', v_count + 1, 'limit', v_free_limit,
    'remaining', v_free_limit - v_count - 1
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_increment_export() TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 5. Tier-aware check_analysis_limit trigger (v3)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.check_analysis_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_is_pro bool := false;
  v_count  int;
  v_limit  int  := 5;
BEGIN
  SELECT (status = 'active') INTO v_is_pro
  FROM public.subscriptions WHERE user_id = NEW.user_id;

  IF v_is_pro THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_count
  FROM public.analyses WHERE user_id = NEW.user_id;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'Library full (% saves on free tier). Upgrade to Pro for unlimited saves.', v_limit;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_analysis_limit ON public.analyses;
CREATE TRIGGER enforce_analysis_limit
  BEFORE INSERT ON public.analyses
  FOR EACH ROW EXECUTE FUNCTION public.check_analysis_limit();

-- ═══════════════════════════════════════════════════════════════
-- 6. Auto-create subscription on signup (v3)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_default_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  FOR EACH ROW EXECUTE FUNCTION public.create_default_subscription();

-- ═══════════════════════════════════════════════════════════════
-- 7. Backfill subscriptions for existing users
-- ═══════════════════════════════════════════════════════════════
INSERT INTO public.subscriptions (user_id, status)
SELECT id, 'free' FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
