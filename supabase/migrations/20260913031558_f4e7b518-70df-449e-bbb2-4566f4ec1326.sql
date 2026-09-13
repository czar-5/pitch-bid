DO $$ BEGIN
  CREATE TYPE public.malayali_status AS ENUM ('malayali', 'non_malayali');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS malayali public.malayali_status;

ALTER TABLE public.auctions
  ADD COLUMN IF NOT EXISTS non_malayali_rule_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS non_malayali_players_per_team integer NOT NULL DEFAULT 0;

ALTER TABLE public.auctions
  DROP CONSTRAINT IF EXISTS auctions_non_malayali_quota_valid;
ALTER TABLE public.auctions
  ADD CONSTRAINT auctions_non_malayali_quota_valid CHECK (
    (NOT non_malayali_rule_enabled AND non_malayali_players_per_team = 0)
    OR
    (non_malayali_rule_enabled AND non_malayali_players_per_team > 0 AND non_malayali_players_per_team <= max_players_per_team)
  );

CREATE OR REPLACE FUNCTION public.validate_non_malayali_auction(_auction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _auction public.auctions%ROWTYPE;
  _team_count integer;
  _unclassified integer;
  _non_malayali_pool integer;
  _team record;
BEGIN
  SELECT * INTO _auction FROM public.auctions WHERE id = _auction_id;
  IF _auction.id IS NULL THEN RAISE EXCEPTION 'auction not found'; END IF;
  IF NOT _auction.non_malayali_rule_enabled THEN RETURN; END IF;
  IF _auction.non_malayali_players_per_team <= 0 OR _auction.non_malayali_players_per_team > _auction.max_players_per_team THEN
    RAISE EXCEPTION 'Non-Malayali players per team must be between 1 and the maximum squad size';
  END IF;

  SELECT count(*) INTO _unclassified
  FROM public.auction_players ap
  JOIN public.players p ON p.id = ap.player_id
  WHERE ap.auction_id = _auction_id AND p.malayali IS NULL;
  IF _unclassified > 0 THEN
    RAISE EXCEPTION '% selected player(s) have a blank Malayali classification', _unclassified;
  END IF;

  SELECT count(*) INTO _team_count FROM public.auction_teams WHERE auction_id = _auction_id;
  SELECT count(*) INTO _non_malayali_pool
  FROM public.auction_players ap
  JOIN public.players p ON p.id = ap.player_id
  WHERE ap.auction_id = _auction_id AND p.malayali = 'non_malayali';
  IF _non_malayali_pool < _team_count * _auction.non_malayali_players_per_team THEN
    RAISE EXCEPTION 'Not enough Non-Malayali players: need %, selected %', _team_count * _auction.non_malayali_players_per_team, _non_malayali_pool;
  END IF;

  FOR _team IN
    SELECT at.team_id,
      count(*) FILTER (WHERE ap.status = 'sold')::integer AS assigned_count,
      count(*) FILTER (WHERE ap.status = 'sold' AND p.malayali = 'non_malayali')::integer AS assigned_non_malayali
    FROM public.auction_teams at
    LEFT JOIN public.auction_players ap ON ap.auction_id = at.auction_id AND ap.sold_team_id = at.team_id
    LEFT JOIN public.players p ON p.id = ap.player_id
    WHERE at.auction_id = _auction_id
    GROUP BY at.team_id
  LOOP
    IF _team.assigned_non_malayali > _auction.non_malayali_players_per_team THEN
      RAISE EXCEPTION 'A team has more preassigned Non-Malayali players than the rule allows';
    END IF;
    IF (_auction.max_players_per_team - _team.assigned_count) < (_auction.non_malayali_players_per_team - _team.assigned_non_malayali) THEN
      RAISE EXCEPTION 'A team does not have enough squad places left to meet the Non-Malayali rule';
    END IF;
  END LOOP;
END $function$;

REVOKE ALL ON FUNCTION public.validate_non_malayali_auction(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.go_live_auction(_auction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _first uuid; _secs int; _method public.auction_method;
BEGIN
  IF NOT public.is_auction_controller(_auction_id, auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM public.validate_non_malayali_auction(_auction_id);
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

CREATE OR REPLACE FUNCTION public.place_bid(_auction_player_id uuid, _team_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ap auction_players%ROWTYPE;
  _auction auctions%ROWTYPE;
  _high bigint; _high_team uuid; _next bigint; _inc bigint;
  _budget bigint; _bought int; _remaining_min int; _reserve bigint;
  _player_status public.malayali_status;
  _non_malayali_bought integer;
  _remaining_required integer;
  _slots_after integer;
BEGIN
  SELECT * INTO _ap FROM auction_players WHERE id=_auction_player_id FOR UPDATE;
  IF _ap.id IS NULL THEN RAISE EXCEPTION 'player not found'; END IF;
  IF _ap.status <> 'live' THEN RAISE EXCEPTION 'player not live'; END IF;
  IF _ap.paused_remaining_seconds IS NOT NULL THEN RAISE EXCEPTION 'round paused'; END IF;
  IF _ap.round_ends_at IS NOT NULL AND _ap.round_ends_at <= now() THEN RAISE EXCEPTION 'round closed'; END IF;
  SELECT * INTO _auction FROM auctions WHERE id=_ap.auction_id;
  IF _auction.status <> 'live' THEN RAISE EXCEPTION 'auction not live'; END IF;
  IF NOT EXISTS (SELECT 1 FROM team_members WHERE team_id=_team_id AND user_id=auth.uid())
     AND NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'not a team member'; END IF;

  SELECT budget_remaining, players_bought INTO _budget, _bought
  FROM auction_teams WHERE auction_id=_auction.id AND team_id=_team_id FOR UPDATE;
  IF _budget IS NULL THEN RAISE EXCEPTION 'team not in this auction'; END IF;
  IF _bought >= _auction.max_players_per_team THEN RAISE EXCEPTION 'team has reached max players (%)', _auction.max_players_per_team; END IF;

  IF _auction.non_malayali_rule_enabled THEN
    SELECT malayali INTO _player_status FROM players WHERE id = _ap.player_id;
    IF _player_status IS NULL THEN RAISE EXCEPTION 'player Malayali classification is blank'; END IF;
    SELECT count(*) INTO _non_malayali_bought
    FROM auction_players sold_ap JOIN players sold_p ON sold_p.id = sold_ap.player_id
    WHERE sold_ap.auction_id = _auction.id AND sold_ap.sold_team_id = _team_id
      AND sold_ap.status = 'sold' AND sold_p.malayali = 'non_malayali';
    _remaining_required := GREATEST(0, _auction.non_malayali_players_per_team - _non_malayali_bought);
    IF _player_status = 'non_malayali' AND _remaining_required = 0 THEN
      RAISE EXCEPTION 'team has reached its Non-Malayali player limit (%)', _auction.non_malayali_players_per_team;
    END IF;
    _slots_after := _auction.max_players_per_team - (_bought + 1);
    IF _player_status <> 'non_malayali' AND _slots_after < _remaining_required THEN
      RAISE EXCEPTION 'team must fill its remaining Non-Malayali places';
    END IF;
  END IF;

  SELECT amount, team_id INTO _high, _high_team FROM bids WHERE auction_player_id=_auction_player_id ORDER BY amount DESC, created_at ASC LIMIT 1;
  IF _high IS NULL THEN _next := _auction.baseline_price;
  ELSE
    IF _high_team = _team_id THEN RAISE EXCEPTION 'your team is already the highest bidder'; END IF;
    SELECT (r->>'increment')::bigint INTO _inc FROM jsonb_array_elements(_auction.bid_rules_json) r
    WHERE (r->>'min')::bigint <= _high AND COALESCE(NULLIF(r->>'max', 'null')::bigint, 9223372036854775807) > _high
    ORDER BY (r->>'min')::bigint DESC LIMIT 1;
    IF _inc IS NULL THEN _inc := 100; END IF;
    _next := _high + _inc;
  END IF;
  IF _budget < _next THEN RAISE EXCEPTION 'insufficient budget'; END IF;
  _remaining_min := GREATEST(0, _auction.min_players_per_team - (_bought + 1));
  _reserve := _remaining_min::bigint * _auction.baseline_price;
  IF (_budget - _next) < _reserve THEN RAISE EXCEPTION 'must reserve budget for minimum squad (% players at baseline)', _remaining_min; END IF;
  INSERT INTO bids (auction_player_id, team_id, bidder_user_id, amount) VALUES (_auction_player_id, _team_id, auth.uid(), _next);
  UPDATE auction_players SET round_ends_at = now() + (_auction.round_closure_seconds * interval '1 second') WHERE id=_auction_player_id;
  RETURN _next;
END $function$;

CREATE OR REPLACE FUNCTION public.place_bid_for_team(_auction_player_id uuid, _team_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _ap auction_players%ROWTYPE;
  _auction auctions%ROWTYPE;
  _high bigint; _high_team uuid; _next bigint; _inc bigint;
  _budget bigint; _bought int; _remaining_min int; _reserve bigint;
  _player_status public.malayali_status;
  _non_malayali_bought integer;
  _remaining_required integer;
  _slots_after integer;
BEGIN
  SELECT * INTO _ap FROM auction_players WHERE id=_auction_player_id FOR UPDATE;
  IF _ap.id IS NULL THEN RAISE EXCEPTION 'player not found'; END IF;
  SELECT * INTO _auction FROM auctions WHERE id=_ap.auction_id;
  IF NOT public.is_auction_controller(_auction.id, auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _auction.method <> 'offline' THEN RAISE EXCEPTION 'not an offline auction'; END IF;
  IF _ap.status <> 'live' THEN RAISE EXCEPTION 'player not live'; END IF;
  IF _auction.status <> 'live' THEN RAISE EXCEPTION 'auction not live'; END IF;

  SELECT budget_remaining, players_bought INTO _budget, _bought
  FROM auction_teams WHERE auction_id=_auction.id AND team_id=_team_id FOR UPDATE;
  IF _budget IS NULL THEN RAISE EXCEPTION 'team not in this auction'; END IF;
  IF _bought >= _auction.max_players_per_team THEN RAISE EXCEPTION 'team has reached max players (%)', _auction.max_players_per_team; END IF;

  IF _auction.non_malayali_rule_enabled THEN
    SELECT malayali INTO _player_status FROM players WHERE id = _ap.player_id;
    IF _player_status IS NULL THEN RAISE EXCEPTION 'player Malayali classification is blank'; END IF;
    SELECT count(*) INTO _non_malayali_bought
    FROM auction_players sold_ap JOIN players sold_p ON sold_p.id = sold_ap.player_id
    WHERE sold_ap.auction_id = _auction.id AND sold_ap.sold_team_id = _team_id
      AND sold_ap.status = 'sold' AND sold_p.malayali = 'non_malayali';
    _remaining_required := GREATEST(0, _auction.non_malayali_players_per_team - _non_malayali_bought);
    IF _player_status = 'non_malayali' AND _remaining_required = 0 THEN
      RAISE EXCEPTION 'team has reached its Non-Malayali player limit (%)', _auction.non_malayali_players_per_team;
    END IF;
    _slots_after := _auction.max_players_per_team - (_bought + 1);
    IF _player_status <> 'non_malayali' AND _slots_after < _remaining_required THEN
      RAISE EXCEPTION 'team must fill its remaining Non-Malayali places';
    END IF;
  END IF;

  SELECT amount, team_id INTO _high, _high_team FROM bids WHERE auction_player_id=_auction_player_id ORDER BY amount DESC, created_at ASC LIMIT 1;
  IF _high IS NULL THEN _next := _auction.baseline_price;
  ELSE
    IF _high_team = _team_id THEN RAISE EXCEPTION 'this team is already the highest bidder'; END IF;
    SELECT (r->>'increment')::bigint INTO _inc FROM jsonb_array_elements(_auction.bid_rules_json) r
    WHERE (r->>'min')::bigint <= _high AND COALESCE(NULLIF(r->>'max', 'null')::bigint, 9223372036854775807) > _high
    ORDER BY (r->>'min')::bigint DESC LIMIT 1;
    IF _inc IS NULL THEN _inc := 100; END IF;
    _next := _high + _inc;
  END IF;
  IF _budget < _next THEN RAISE EXCEPTION 'insufficient budget'; END IF;
  _remaining_min := GREATEST(0, _auction.min_players_per_team - (_bought + 1));
  _reserve := _remaining_min::bigint * _auction.baseline_price;
  IF (_budget - _next) < _reserve THEN RAISE EXCEPTION 'must reserve budget for minimum squad (% players at baseline)', _remaining_min; END IF;
  INSERT INTO bids (auction_player_id, team_id, bidder_user_id, amount) VALUES (_auction_player_id, _team_id, auth.uid(), _next);
  RETURN _next;
END $function$;

REVOKE ALL ON FUNCTION public.place_bid(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_bid(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.place_bid_for_team(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_bid_for_team(uuid, uuid) TO authenticated;