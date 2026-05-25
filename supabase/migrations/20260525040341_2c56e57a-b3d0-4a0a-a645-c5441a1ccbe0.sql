
-- 1. bids: authenticated-only SELECT
DROP POLICY IF EXISTS bids_select_all ON public.bids;
CREATE POLICY bids_select_authenticated ON public.bids
  FOR SELECT TO authenticated USING (true);

-- 2. team_members: authenticated-only SELECT
DROP POLICY IF EXISTS team_members_select_all ON public.team_members;
CREATE POLICY team_members_select_authenticated ON public.team_members
  FOR SELECT TO authenticated USING (true);

-- 3. auction_teams: restrict manager update to is_ready only via trigger guard
CREATE OR REPLACE FUNCTION public.guard_auction_teams_updates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  -- Non-admins (team managers/co-managers) may only change is_ready.
  NEW.auction_id := OLD.auction_id;
  NEW.team_id := OLD.team_id;
  NEW.budget_remaining := OLD.budget_remaining;
  NEW.players_bought := OLD.players_bought;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_auction_teams_updates_trg ON public.auction_teams;
CREATE TRIGGER guard_auction_teams_updates_trg
  BEFORE UPDATE ON public.auction_teams
  FOR EACH ROW EXECUTE FUNCTION public.guard_auction_teams_updates();

-- 4. profiles: hide email column from regular users via column-level privileges
REVOKE SELECT ON public.profiles FROM anon, authenticated;
GRANT SELECT (id, name, created_at) ON public.profiles TO authenticated;
-- (Owner can still read their email via supabase.auth.getUser(); admins via RPC below.)

-- Admin-only helpers to retrieve emails
CREATE OR REPLACE FUNCTION public.admin_get_user_emails(_ids uuid[])
RETURNS TABLE(id uuid, name text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.email
  FROM public.profiles p
  WHERE p.id = ANY(_ids)
    AND public.has_role(auth.uid(), 'admin');
$$;

CREATE OR REPLACE FUNCTION public.admin_find_user_by_email(_email text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id FROM public.profiles p
  WHERE p.email = _email
    AND public.has_role(auth.uid(), 'admin')
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_user_emails(uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_find_user_by_email(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_user_emails(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_find_user_by_email(text) TO authenticated;

-- 5. Revoke EXECUTE from anon on SECURITY DEFINER admin RPCs
REVOKE EXECUTE ON FUNCTION public.start_auction(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.go_live_auction(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.end_auction(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.finalize_current(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.sell_current(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.skip_current(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.pause_round(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.resume_round(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.reset_round(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.next_player(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.place_bid(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_next_player(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.start_auction(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.go_live_auction(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_auction(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_current(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sell_current(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.skip_current(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_round(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_round(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_round(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_player(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_bid(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_player(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

-- 6. Storage: remove broad listing policies on public buckets.
-- Public buckets still serve direct file URLs via the CDN without RLS.
DROP POLICY IF EXISTS "Player photos public read" ON storage.objects;
DROP POLICY IF EXISTS "Team logos public read" ON storage.objects;
