-- Supabase migration: enable RLS + create missing functions
-- Run this in: https://supabase.com/dashboard/project/wxwrgcxeaoczgqswmciv/sql/new

-- 1. Enable RLS on analyses (was never applied)
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

-- 2. Enable RLS on subscriptions (v3 migration never ran)
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);

-- 3. Enable RLS on user_usage (v3 migration never ran)
ALTER TABLE public.user_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own usage" ON public.user_usage;
CREATE POLICY "Users can view own usage"
  ON public.user_usage FOR SELECT USING (auth.uid() = user_id);

-- 4. Create check_and_increment_export() RPC (v3 migration never ran)
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

-- 5. Update check_analysis_limit trigger to be tier-aware (v3 version)
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

-- 6. Create default subscription trigger (for new signups)
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

-- 7. Backfill subscriptions for existing users
INSERT INTO public.subscriptions (user_id, status)
SELECT id, 'free' FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
