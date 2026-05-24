
ALTER TABLE public.auctions
  ADD COLUMN IF NOT EXISTS min_players_per_team integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS max_players_per_team integer NOT NULL DEFAULT 12;

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
