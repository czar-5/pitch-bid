
-- Track the most recently finalized player so the intermission UI can show
-- the bid history of the player that just went under the hammer.
ALTER TABLE public.auctions
  ADD COLUMN IF NOT EXISTS last_finalized_player_id uuid;

-- finalize_current: closes the current player (sold to highest bidder OR unsold
-- if no bids), records it as the last finalized player, and clears
-- current_player_id WITHOUT advancing to the next player. Auction stays 'live'.
CREATE OR REPLACE FUNCTION public.finalize_current(_auction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _ap_id uuid; _team uuid; _amt bigint;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
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

-- Reject bids placed after the round timer has expired.
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
END $function$;
