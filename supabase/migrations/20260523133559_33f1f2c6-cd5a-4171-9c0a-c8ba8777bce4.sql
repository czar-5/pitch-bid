
ALTER TYPE public.auction_status ADD VALUE IF NOT EXISTS 'lobby' BEFORE 'live';

-- start_auction now moves to lobby (no player selected yet)
CREATE OR REPLACE FUNCTION public.start_auction(_auction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auction_players WHERE auction_id=_auction_id AND status='queued') THEN
    RAISE EXCEPTION 'no queued players';
  END IF;
  UPDATE auctions SET status='lobby', current_player_id=NULL WHERE id=_auction_id;
END $function$;

-- go_live_auction: picks first player and flips to live
CREATE OR REPLACE FUNCTION public.go_live_auction(_auction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
END $function$;

-- end_auction: admin ends a live auction
CREATE OR REPLACE FUNCTION public.end_auction(_auction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _ap_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT current_player_id INTO _ap_id FROM auctions WHERE id=_auction_id;
  IF _ap_id IS NOT NULL THEN
    UPDATE auction_players SET status='unsold', round_ends_at=NULL WHERE id=_ap_id AND status='live';
  END IF;
  UPDATE auction_players SET status='unsold' WHERE auction_id=_auction_id AND status='queued';
  UPDATE auctions SET status='completed', current_player_id=NULL WHERE id=_auction_id;
END $function$;
