
DO $$ BEGIN
  CREATE TYPE public.auction_method AS ENUM ('online','offline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.auctions
  ADD COLUMN IF NOT EXISTS method public.auction_method NOT NULL DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS auctioneer_user_id uuid;

UPDATE public.auctions SET method = 'online' WHERE method IS NULL;

CREATE OR REPLACE FUNCTION public.is_auction_controller(_auction_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _user_id IS NOT NULL AND (
    public.has_role(_user_id, 'admin')
    OR EXISTS (SELECT 1 FROM public.auctions a WHERE a.id = _auction_id AND a.auctioneer_user_id = _user_id)
  );
$$;

-- Round control now allowed for admins and the assigned auctioneer

CREATE OR REPLACE FUNCTION public.go_live_auction(_auction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _first uuid; _secs int; _method public.auction_method;
BEGIN
  IF NOT public.is_auction_controller(_auction_id, auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT id INTO _first FROM auction_players
    WHERE auction_id = _auction_id AND status = 'queued'
    ORDER BY auction_order NULLS LAST, created_at LIMIT 1;
  IF _first IS NULL THEN RAISE EXCEPTION 'no queued players'; END IF;
  SELECT round_closure_seconds, method INTO _secs, _method FROM auctions WHERE id=_auction_id;
  IF _method = 'offline' THEN
    UPDATE auction_players SET status='live', round_ends_at = NULL WHERE id=_first;
  ELSE
    UPDATE auction_players SET status='live', round_ends_at = now() + (_secs * interval '1 second') WHERE id=_first;
  END IF;
  UPDATE auctions SET status='live', current_player_id=_first WHERE id=_auction_id;
END $function$;

CREATE OR REPLACE FUNCTION public.next_player(_auction_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _next uuid; _secs int; _recycled int; _method public.auction_method;
BEGIN
  IF NOT public.is_auction_controller(_auction_id, auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT id INTO _next FROM auction_players
    WHERE auction_id=_auction_id AND status='queued'
    ORDER BY auction_order NULLS LAST, created_at LIMIT 1;

  IF _next IS NULL THEN
    UPDATE auction_players
      SET status='queued', round_ends_at=NULL, paused_remaining_seconds=NULL,
          sold_team_id=NULL, sold_price=NULL, auction_order=NULL
      WHERE auction_id=_auction_id AND status IN ('unsold','skipped');
    GET DIAGNOSTICS _recycled = ROW_COUNT;

    IF _recycled = 0 THEN
      UPDATE auctions SET status='completed', current_player_id=NULL WHERE id=_auction_id;
      RETURN NULL;
    END IF;

    WITH shuffled AS (
      SELECT id, row_number() OVER (ORDER BY random()) AS new_order
        FROM auction_players
       WHERE auction_id=_auction_id AND status='queued'
    )
    UPDATE auction_players ap SET auction_order = s.new_order
      FROM shuffled s WHERE ap.id = s.id;

    SELECT id INTO _next FROM auction_players
      WHERE auction_id=_auction_id AND status='queued'
      ORDER BY auction_order NULLS LAST, created_at LIMIT 1;
  END IF;

  SELECT round_closure_seconds, method INTO _secs, _method FROM auctions WHERE id=_auction_id;
  IF _method = 'offline' THEN
    UPDATE auction_players SET status='live', round_ends_at=NULL WHERE id=_next;
  ELSE
    UPDATE auction_players SET status='live', round_ends_at=now()+(_secs * interval '1 second') WHERE id=_next;
  END IF;
  UPDATE auctions SET current_player_id=_next, status='live' WHERE id=_auction_id;
  RETURN _next;
END $function$;

CREATE OR REPLACE FUNCTION public.finalize_current(_auction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _ap_id uuid; _team uuid; _amt bigint;
BEGIN
  IF NOT public.is_auction_controller(_auction_id, auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT current_player_id INTO _ap_id FROM auctions WHERE id=_auction_id;
  IF _ap_id IS NULL THEN RETURN; END IF;
  SELECT team_id, amount INTO _team, _amt
    FROM bids WHERE auction_player_id=_ap_id
    ORDER BY amount DESC, created_at ASC LIMIT 1;
  IF _team IS NULL THEN
    UPDATE auction_players SET status='unsold', round_ends_at=NULL WHERE id=_ap_id;
  ELSE
    UPDATE auction_players SET status='sold', sold_team_id=_team, sold_price=_amt, round_ends_at=NULL WHERE id=_ap_id;
    UPDATE auction_teams SET budget_remaining = budget_remaining - _amt, players_bought = players_bought + 1
      WHERE auction_id=_auction_id AND team_id=_team;
  END IF;
  UPDATE auctions SET current_player_id=NULL, last_finalized_player_id=_ap_id WHERE id=_auction_id;
END $function$;

CREATE OR REPLACE FUNCTION public.sell_current(_auction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _ap_id uuid; _team uuid; _amt bigint;
BEGIN
  IF NOT public.is_auction_controller(_auction_id, auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT current_player_id INTO _ap_id FROM auctions WHERE id=_auction_id;
  IF _ap_id IS NULL THEN RAISE EXCEPTION 'no current player'; END IF;
  SELECT team_id, amount INTO _team, _amt FROM bids WHERE auction_player_id=_ap_id ORDER BY amount DESC, created_at ASC LIMIT 1;
  IF _team IS NULL THEN
    UPDATE auction_players SET status='unsold', round_ends_at=NULL WHERE id=_ap_id;
  ELSE
    UPDATE auction_players SET status='sold', sold_team_id=_team, sold_price=_amt, round_ends_at=NULL WHERE id=_ap_id;
    UPDATE auction_teams SET budget_remaining = budget_remaining - _amt, players_bought = players_bought + 1
      WHERE auction_id=_auction_id AND team_id=_team;
  END IF;
  UPDATE auctions SET current_player_id=NULL, last_finalized_player_id=_ap_id WHERE id=_auction_id;
END $function$;

CREATE OR REPLACE FUNCTION public.reset_bid(_auction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _ap_id uuid;
BEGIN
  IF NOT public.is_auction_controller(_auction_id, auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT current_player_id INTO _ap_id FROM auctions WHERE id=_auction_id;
  IF _ap_id IS NULL THEN RETURN; END IF;
  DELETE FROM bids WHERE auction_player_id = _ap_id;
END $function$;

CREATE OR REPLACE FUNCTION public.undo_last_bid(_auction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _ap_id uuid; _bid_id uuid;
BEGIN
  IF NOT public.is_auction_controller(_auction_id, auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT current_player_id INTO _ap_id FROM auctions WHERE id=_auction_id;
  IF _ap_id IS NULL THEN RETURN; END IF;
  SELECT id INTO _bid_id FROM bids WHERE auction_player_id=_ap_id
    ORDER BY created_at DESC, amount DESC LIMIT 1;
  IF _bid_id IS NULL THEN RETURN; END IF;
  DELETE FROM bids WHERE id = _bid_id;
END $function$;

CREATE OR REPLACE FUNCTION public.place_bid_for_team(_auction_player_id uuid, _team_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _ap auction_players%ROWTYPE;
  _auction auctions%ROWTYPE;
  _high bigint; _high_team uuid; _next bigint; _inc bigint;
  _budget bigint; _bought int; _remaining_min int; _reserve bigint;
BEGIN
  SELECT * INTO _ap FROM auction_players WHERE id=_auction_player_id FOR UPDATE;
  IF _ap.id IS NULL THEN RAISE EXCEPTION 'player not found'; END IF;
  SELECT * INTO _auction FROM auctions WHERE id=_ap.auction_id;
  IF NOT public.is_auction_controller(_auction.id, auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _auction.method <> 'offline' THEN RAISE EXCEPTION 'not an offline auction'; END IF;
  IF _ap.status <> 'live' THEN RAISE EXCEPTION 'player not live'; END IF;
  IF _auction.status <> 'live' THEN RAISE EXCEPTION 'auction not live'; END IF;

  SELECT budget_remaining, players_bought INTO _budget, _bought
    FROM auction_teams WHERE auction_id=_auction.id AND team_id=_team_id;
  IF _budget IS NULL THEN RAISE EXCEPTION 'team not in this auction'; END IF;
  IF _bought >= _auction.max_players_per_team THEN
    RAISE EXCEPTION 'team has reached max players (%)', _auction.max_players_per_team;
  END IF;

  SELECT amount, team_id INTO _high, _high_team
    FROM bids WHERE auction_player_id=_auction_player_id
    ORDER BY amount DESC, created_at ASC LIMIT 1;
  IF _high IS NULL THEN
    _next := _auction.baseline_price;
  ELSE
    IF _high_team = _team_id THEN RAISE EXCEPTION 'this team is already the highest bidder'; END IF;
    SELECT (r->>'increment')::bigint INTO _inc
      FROM jsonb_array_elements(_auction.bid_rules_json) r
      WHERE (r->>'min')::bigint <= _high
        AND COALESCE(NULLIF(r->>'max', 'null')::bigint, 9223372036854775807) > _high
      ORDER BY (r->>'min')::bigint DESC LIMIT 1;
    IF _inc IS NULL THEN _inc := 100; END IF;
    _next := _high + _inc;
  END IF;

  IF _budget < _next THEN RAISE EXCEPTION 'insufficient budget'; END IF;
  _remaining_min := GREATEST(0, _auction.min_players_per_team - (_bought + 1));
  _reserve := _remaining_min::bigint * _auction.baseline_price;
  IF (_budget - _next) < _reserve THEN
    RAISE EXCEPTION 'must reserve budget for minimum squad (% players at baseline)', _remaining_min;
  END IF;

  INSERT INTO bids (auction_player_id, team_id, bidder_user_id, amount)
    VALUES (_auction_player_id, _team_id, auth.uid(), _next);
  RETURN _next;
END $function$;

REVOKE ALL ON FUNCTION public.place_bid_for_team(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.undo_last_bid(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_auction_controller(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_bid_for_team(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_last_bid(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_auction_controller(uuid, uuid) TO authenticated;
