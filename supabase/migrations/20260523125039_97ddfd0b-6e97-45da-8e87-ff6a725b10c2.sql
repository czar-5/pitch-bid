
CREATE OR REPLACE FUNCTION public.start_auction(_auction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _first uuid; _secs int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT id INTO _first FROM auction_players
    WHERE auction_id = _auction_id AND status = 'queued'
    ORDER BY auction_order NULLS LAST, created_at LIMIT 1;
  IF _first IS NULL THEN RAISE EXCEPTION 'no queued players'; END IF;
  SELECT round_closure_seconds INTO _secs FROM auctions WHERE id=_auction_id;
  UPDATE auction_players SET status='live', round_ends_at = now() + (_secs * interval '1 second') WHERE id=_first;
  UPDATE auctions SET status='live', current_player_id=_first WHERE id=_auction_id;
END $$;

CREATE OR REPLACE FUNCTION public.place_bid(_auction_player_id uuid, _team_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ap auction_players%ROWTYPE;
  _auction auctions%ROWTYPE;
  _high bigint;
  _next bigint;
  _inc bigint;
  _budget bigint;
BEGIN
  SELECT * INTO _ap FROM auction_players WHERE id=_auction_player_id FOR UPDATE;
  IF _ap.status <> 'live' THEN RAISE EXCEPTION 'player not live'; END IF;
  SELECT * INTO _auction FROM auctions WHERE id=_ap.auction_id;
  IF _auction.status <> 'live' THEN RAISE EXCEPTION 'auction not live'; END IF;
  IF NOT EXISTS (SELECT 1 FROM team_members WHERE team_id=_team_id AND user_id=auth.uid())
     AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'not a team member';
  END IF;
  SELECT budget_remaining INTO _budget FROM auction_teams WHERE auction_id=_auction.id AND team_id=_team_id;
  IF _budget IS NULL THEN RAISE EXCEPTION 'team not in this auction'; END IF;

  SELECT COALESCE(MAX(amount), 0) INTO _high FROM bids WHERE auction_player_id=_auction_player_id;
  IF _high = 0 THEN
    _next := _auction.baseline_price;
  ELSE
    SELECT (r->>'increment')::bigint INTO _inc
      FROM jsonb_array_elements(_auction.bid_rules_json) r
      WHERE (r->>'min')::bigint <= _high
        AND ((r->'max') IS NULL OR (r->>'max') = 'null' OR (r->>'max')::bigint > _high)
      ORDER BY (r->>'min')::bigint DESC LIMIT 1;
    IF _inc IS NULL THEN _inc := 100; END IF;
    _next := _high + _inc;
  END IF;

  IF _budget < _next THEN RAISE EXCEPTION 'insufficient budget'; END IF;

  INSERT INTO bids (auction_player_id, team_id, bidder_user_id, amount)
    VALUES (_auction_player_id, _team_id, auth.uid(), _next);
  UPDATE auction_players SET round_ends_at = now() + (_auction.round_closure_seconds * interval '1 second')
    WHERE id=_auction_player_id;
  RETURN _next;
END $$;

CREATE OR REPLACE FUNCTION public.sell_current(_auction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ap_id uuid; _team uuid; _amt bigint;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
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
  UPDATE auctions SET current_player_id=NULL WHERE id=_auction_id;
END $$;

CREATE OR REPLACE FUNCTION public.next_player(_auction_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _next uuid; _secs int;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT id INTO _next FROM auction_players WHERE auction_id=_auction_id AND status='queued'
    ORDER BY auction_order NULLS LAST, created_at LIMIT 1;
  IF _next IS NULL THEN
    UPDATE auctions SET status='completed', current_player_id=NULL WHERE id=_auction_id;
    RETURN NULL;
  END IF;
  SELECT round_closure_seconds INTO _secs FROM auctions WHERE id=_auction_id;
  UPDATE auction_players SET status='live', round_ends_at=now()+(_secs * interval '1 second') WHERE id=_next;
  UPDATE auctions SET current_player_id=_next, status='live' WHERE id=_auction_id;
  RETURN _next;
END $$;

CREATE OR REPLACE FUNCTION public.skip_current(_auction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ap_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT current_player_id INTO _ap_id FROM auctions WHERE id=_auction_id;
  IF _ap_id IS NULL THEN RETURN; END IF;
  UPDATE auction_players SET status='skipped', round_ends_at=NULL WHERE id=_ap_id;
  UPDATE auctions SET current_player_id=NULL WHERE id=_auction_id;
END $$;

GRANT EXECUTE ON FUNCTION public.start_auction(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_bid(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sell_current(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_player(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.skip_current(uuid) TO authenticated;
