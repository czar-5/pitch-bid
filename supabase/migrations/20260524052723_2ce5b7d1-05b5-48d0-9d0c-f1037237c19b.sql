
ALTER TABLE public.auction_players
  ADD COLUMN IF NOT EXISTS paused_remaining_seconds integer;

CREATE OR REPLACE FUNCTION public.pause_round(_auction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _ap_id uuid; _ends timestamptz; _remaining int;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT current_player_id INTO _ap_id FROM auctions WHERE id=_auction_id;
  IF _ap_id IS NULL THEN RAISE EXCEPTION 'no current player'; END IF;
  SELECT round_ends_at INTO _ends FROM auction_players WHERE id=_ap_id;
  IF _ends IS NULL THEN RETURN; END IF; -- already paused
  _remaining := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (_ends - now()))))::int;
  UPDATE auction_players
    SET paused_remaining_seconds = _remaining,
        round_ends_at = NULL
    WHERE id=_ap_id;
END $$;

CREATE OR REPLACE FUNCTION public.resume_round(_auction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _ap_id uuid; _remaining int; _secs int;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT current_player_id INTO _ap_id FROM auctions WHERE id=_auction_id;
  IF _ap_id IS NULL THEN RAISE EXCEPTION 'no current player'; END IF;
  SELECT paused_remaining_seconds INTO _remaining FROM auction_players WHERE id=_ap_id;
  IF _remaining IS NULL THEN RETURN; END IF; -- not paused
  IF _remaining <= 0 THEN
    SELECT round_closure_seconds INTO _secs FROM auctions WHERE id=_auction_id;
    _remaining := _secs;
  END IF;
  UPDATE auction_players
    SET round_ends_at = now() + (_remaining * interval '1 second'),
        paused_remaining_seconds = NULL
    WHERE id=_ap_id;
END $$;

CREATE OR REPLACE FUNCTION public.reset_round(_auction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _ap_id uuid; _secs int;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT current_player_id INTO _ap_id FROM auctions WHERE id=_auction_id;
  IF _ap_id IS NULL THEN RAISE EXCEPTION 'no current player'; END IF;
  SELECT round_closure_seconds INTO _secs FROM auctions WHERE id=_auction_id;
  UPDATE auction_players
    SET round_ends_at = now() + (_secs * interval '1 second'),
        paused_remaining_seconds = NULL
    WHERE id=_ap_id;
END $$;

-- Block bids while paused
CREATE OR REPLACE FUNCTION public.place_bid(_auction_player_id uuid, _team_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ap auction_players%ROWTYPE;
  _auction auctions%ROWTYPE;
  _high bigint;
  _next bigint;
  _inc bigint;
  _budget bigint;
  _bought int;
  _remaining_min int;
  _reserve bigint;
BEGIN
  SELECT * INTO _ap FROM auction_players WHERE id=_auction_player_id FOR UPDATE;
  IF _ap.status <> 'live' THEN RAISE EXCEPTION 'player not live'; END IF;
  IF _ap.paused_remaining_seconds IS NOT NULL THEN
    RAISE EXCEPTION 'round paused';
  END IF;
  IF _ap.round_ends_at IS NOT NULL AND _ap.round_ends_at <= now() THEN
    RAISE EXCEPTION 'round closed';
  END IF;
  SELECT * INTO _auction FROM auctions WHERE id=_ap.auction_id;
  IF _auction.status <> 'live' THEN RAISE EXCEPTION 'auction not live'; END IF;
  IF NOT EXISTS (SELECT 1 FROM team_members WHERE team_id=_team_id AND user_id=auth.uid())
     AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'not a team member';
  END IF;
  SELECT budget_remaining, players_bought INTO _budget, _bought
    FROM auction_teams WHERE auction_id=_auction.id AND team_id=_team_id;
  IF _budget IS NULL THEN RAISE EXCEPTION 'team not in this auction'; END IF;

  IF _bought >= _auction.max_players_per_team THEN
    RAISE EXCEPTION 'team has reached max players (%))', _auction.max_players_per_team;
  END IF;

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

  _remaining_min := GREATEST(0, _auction.min_players_per_team - (_bought + 1));
  _reserve := _remaining_min::bigint * _auction.baseline_price;
  IF (_budget - _next) < _reserve THEN
    RAISE EXCEPTION 'must reserve budget for minimum squad (% players at baseline)', _remaining_min;
  END IF;

  INSERT INTO bids (auction_player_id, team_id, bidder_user_id, amount)
    VALUES (_auction_player_id, _team_id, auth.uid(), _next);
  UPDATE auction_players SET round_ends_at = now() + (_auction.round_closure_seconds * interval '1 second')
    WHERE id=_auction_player_id;
  RETURN _next;
END $function$;
