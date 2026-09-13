-- Two changes to both bidding functions: a minimum gap between consecutive bids,
-- and squad size counted from the sold rows rather than a stored counter.
--
-- 1. Minimum gap between consecutive bids on the same player.
--
-- Two managers tapping at the same moment both used to succeed. place_bid takes
-- FOR UPDATE on the auction_players row, so the calls are serialised, but
-- serialising only decided the ORDER: the second call still read the fresh high
-- bid, added the next increment and inserted it. The later tap therefore won the
-- player. Nothing anywhere expressed "leave a gap between bids".
--
-- The guard below sits after that same FOR UPDATE, which is what makes it
-- airtight: the second caller cannot begin until the first has committed its
-- bid, so it always sees that bid's timestamp and is refused rather than queued.
-- The losing bid is never written, so there is nothing to roll back and no
-- phantom high bid flashes on anyone's screen.
--
-- clock_timestamp() rather than now(): now() is the transaction start time, and
-- a caller that waited on the row lock started its transaction before the bid it
-- must be compared against was written.
--
-- 2. Squad size now comes from count(sold rows) rather than
-- auction_teams.players_bought -- see the comment at that line. This changes no
-- behaviour while the two agree; it only removes the way they can disagree.
-- players_bought is left in place and still maintained, since the UI reads it.

ALTER TABLE public.auctions
  ADD COLUMN IF NOT EXISTS min_bid_gap_seconds integer NOT NULL DEFAULT 3;

ALTER TABLE public.auctions
  DROP CONSTRAINT IF EXISTS auctions_min_bid_gap_valid;
ALTER TABLE public.auctions
  ADD CONSTRAINT auctions_min_bid_gap_valid
  CHECK (min_bid_gap_seconds >= 0 AND min_bid_gap_seconds <= 60);

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
  _last_bid_at timestamptz;
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

  -- Bid spacing, checked before the budget and quota rules so a rejected
  -- simultaneous tap reports the real reason rather than a misleading one.
  IF _auction.min_bid_gap_seconds > 0 THEN
    SELECT max(created_at) INTO _last_bid_at FROM bids WHERE auction_player_id=_auction_player_id;
    IF _last_bid_at IS NOT NULL
       AND _last_bid_at > clock_timestamp() - (_auction.min_bid_gap_seconds * interval '1 second') THEN
      RAISE EXCEPTION 'another team just bid - bids must be % second(s) apart', _auction.min_bid_gap_seconds;
    END IF;
  END IF;

  SELECT budget_remaining INTO _budget
  FROM auction_teams WHERE auction_id=_auction.id AND team_id=_team_id FOR UPDATE;
  IF _budget IS NULL THEN RAISE EXCEPTION 'team not in this auction'; END IF;

  -- Squad size is counted from the sold rows instead of read from
  -- auction_teams.players_bought. That column is a counter incremented by hand in
  -- sell_current and finalize_current, and a counter sitting one low makes every
  -- squad-size rule fire one player late -- including the Non-Malayali reserve
  -- below, which was reported doing exactly that and could not be reproduced
  -- afterwards. The sold rows ARE the squad, so there is nothing to keep in step.
  SELECT count(*) INTO _bought
  FROM auction_players
  WHERE auction_id=_auction.id AND sold_team_id=_team_id AND status='sold';
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
  _last_bid_at timestamptz;
BEGIN
  SELECT * INTO _ap FROM auction_players WHERE id=_auction_player_id FOR UPDATE;
  IF _ap.id IS NULL THEN RAISE EXCEPTION 'player not found'; END IF;
  SELECT * INTO _auction FROM auctions WHERE id=_ap.auction_id;
  IF NOT public.is_auction_controller(_auction.id, auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _auction.method <> 'offline' THEN RAISE EXCEPTION 'not an offline auction'; END IF;
  IF _ap.status <> 'live' THEN RAISE EXCEPTION 'player not live'; END IF;
  IF _auction.status <> 'live' THEN RAISE EXCEPTION 'auction not live'; END IF;

  -- The same spacing rule as the online path. One auctioneer drives every bid
  -- here, so in practice this guards a double-tap rather than a race between
  -- managers -- but these two functions carry near-identical rule blocks, and a
  -- rule changed in one and not the other is exactly how they drift apart.
  IF _auction.min_bid_gap_seconds > 0 THEN
    SELECT max(created_at) INTO _last_bid_at FROM bids WHERE auction_player_id=_auction_player_id;
    IF _last_bid_at IS NOT NULL
       AND _last_bid_at > clock_timestamp() - (_auction.min_bid_gap_seconds * interval '1 second') THEN
      RAISE EXCEPTION 'another team just bid - bids must be % second(s) apart', _auction.min_bid_gap_seconds;
    END IF;
  END IF;

  SELECT budget_remaining INTO _budget
  FROM auction_teams WHERE auction_id=_auction.id AND team_id=_team_id FOR UPDATE;
  IF _budget IS NULL THEN RAISE EXCEPTION 'team not in this auction'; END IF;

  -- Squad size is counted from the sold rows instead of read from
  -- auction_teams.players_bought. That column is a counter incremented by hand in
  -- sell_current and finalize_current, and a counter sitting one low makes every
  -- squad-size rule fire one player late -- including the Non-Malayali reserve
  -- below, which was reported doing exactly that and could not be reproduced
  -- afterwards. The sold rows ARE the squad, so there is nothing to keep in step.
  SELECT count(*) INTO _bought
  FROM auction_players
  WHERE auction_id=_auction.id AND sold_team_id=_team_id AND status='sold';
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
