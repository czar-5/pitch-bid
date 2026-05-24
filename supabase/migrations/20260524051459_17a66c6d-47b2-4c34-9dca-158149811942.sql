
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

  WITH shuffled AS (
    SELECT id, row_number() OVER (ORDER BY random()) AS new_order
      FROM auction_players
     WHERE auction_id = _auction_id AND status = 'queued'
  )
  UPDATE auction_players ap
     SET auction_order = s.new_order
    FROM shuffled s
   WHERE ap.id = s.id;

  UPDATE auctions SET status='lobby', current_player_id=NULL WHERE id=_auction_id;
END $function$;
