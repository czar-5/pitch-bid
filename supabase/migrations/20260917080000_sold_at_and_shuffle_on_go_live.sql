-- Player pool ordering, and a random running order.
--
-- Two unrelated-looking requirements that turn out to share one cause. The auction
-- room asked PostgREST to sort the pool by the player's name and was silently
-- ignored, so the panel had been rendering rows in physical on-disk order all along.
-- That looked alphabetical in auctions built with "select all" (which inserts players
-- alphabetically) and looked chronological in the Sold section (because updating a row
-- usually rewrites it near the end of the table) -- neither was ever actually sorted.
-- Measured against bid timestamps, the Sold section was out of sale order in all three
-- existing auctions: 11 of 13 positions wrong in offline-test alone.
--
-- Fixing the pool to sort by name is a client change, but it takes the Sold section's
-- accidental chronology away with it, because one query carries one ORDER BY. Nothing
-- recorded WHEN a player sold -- created_at is when the player was added to the
-- auction -- so this adds sold_at and backfills it, which is what lets the client sort
-- the two sections by different rules.
--
-- Separately: nothing randomised a fresh auction's running order. The only shuffle in
-- the system was in next_player's recycle branch, for round 2 onward. go_live_auction
-- now shuffles at the start, which also keeps the running order out of the database
-- until bidding begins, so it cannot be read ahead of time.

ALTER TABLE public.auction_players
  ADD COLUMN IF NOT EXISTS sold_at timestamptz;

-- Backfill from the winning bid's time, the same source used to measure the problem.
-- Captains and icons are inserted pre-sold with no bids, so they stay NULL: they were
-- assigned before bidding began, and the client sorts NULLs first for that reason.
-- Guarded by sold_at IS NULL so re-running this file cannot overwrite a real sale time.
UPDATE public.auction_players ap
   SET sold_at = b.last_bid_at
  FROM (
    SELECT auction_player_id, max(created_at) AS last_bid_at
      FROM public.bids
     GROUP BY auction_player_id
  ) b
 WHERE ap.id = b.auction_player_id
   AND ap.status = 'sold'
   AND ap.sold_at IS NULL;

-- finalize_current and sell_current are the only two functions that write a sale.
-- Both bodies are carried forward unchanged apart from sold_at; a change applied to
-- one and not the other is how the pair drifts apart.
--
-- clock_timestamp() rather than now(), matching the bid-spacing guard in
-- 20260913140000_min_bid_gap.sql: now() is transaction start time, which can predate
-- the moment the hammer actually falls.

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
    UPDATE auction_players SET status='sold', sold_team_id=_team, sold_price=_amt,
      round_ends_at=NULL, sold_at=clock_timestamp() WHERE id=_ap_id;
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
    UPDATE auction_players SET status='sold', sold_team_id=_team, sold_price=_amt,
      round_ends_at=NULL, sold_at=clock_timestamp() WHERE id=_ap_id;
    UPDATE auction_teams SET budget_remaining = budget_remaining - _amt, players_bought = players_bought + 1
      WHERE auction_id=_auction_id AND team_id=_team;
  END IF;
  UPDATE auctions SET current_player_id=NULL, last_finalized_player_id=_ap_id WHERE id=_auction_id;
END $function$;

-- go_live_auction, carried forward from 20260913031558 with the shuffle added.
CREATE OR REPLACE FUNCTION public.go_live_auction(_auction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _first uuid; _secs int; _method public.auction_method;
BEGIN
  IF NOT public.is_auction_controller(_auction_id, auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM public.validate_non_malayali_auction(_auction_id);

  -- Randomise the running order, using the same shuffle as next_player's recycle
  -- branch rather than a second spelling of the same idea. Only for an auction that
  -- has not started: go_live_auction has no status guard of its own, and reshuffling a
  -- live auction would reorder the players still queued behind the one on the block.
  -- Only status='queued' rows are touched, which leaves captains and icons alone --
  -- they are inserted pre-sold and carry no auction_order.
  IF (SELECT status FROM auctions WHERE id = _auction_id) = 'upcoming' THEN
    WITH shuffled AS (
      SELECT id, row_number() OVER (ORDER BY random()) AS new_order
        FROM auction_players
       WHERE auction_id = _auction_id AND status = 'queued'
    )
    UPDATE auction_players ap SET auction_order = s.new_order
      FROM shuffled s WHERE ap.id = s.id;
  END IF;

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

REVOKE EXECUTE ON FUNCTION public.finalize_current(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.finalize_current(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.sell_current(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.sell_current(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.go_live_auction(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.go_live_auction(uuid) TO authenticated;
