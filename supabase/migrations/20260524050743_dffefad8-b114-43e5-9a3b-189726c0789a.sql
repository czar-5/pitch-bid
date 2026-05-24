
CREATE OR REPLACE FUNCTION public.next_player(_auction_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _next uuid; _secs int; _recycled int;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT id INTO _next FROM auction_players
    WHERE auction_id=_auction_id AND status='queued'
    ORDER BY auction_order NULLS LAST, created_at LIMIT 1;

  -- No queued players: try to recycle unsold ones for another round.
  IF _next IS NULL THEN
    UPDATE auction_players
      SET status='queued', round_ends_at=NULL,
          sold_team_id=NULL, sold_price=NULL
      WHERE auction_id=_auction_id AND status='unsold';
    GET DIAGNOSTICS _recycled = ROW_COUNT;

    IF _recycled = 0 THEN
      UPDATE auctions SET status='completed', current_player_id=NULL WHERE id=_auction_id;
      RETURN NULL;
    END IF;

    SELECT id INTO _next FROM auction_players
      WHERE auction_id=_auction_id AND status='queued'
      ORDER BY auction_order NULLS LAST, created_at LIMIT 1;
  END IF;

  SELECT round_closure_seconds INTO _secs FROM auctions WHERE id=_auction_id;
  UPDATE auction_players SET status='live', round_ends_at=now()+(_secs * interval '1 second') WHERE id=_next;
  UPDATE auctions SET current_player_id=_next, status='live' WHERE id=_auction_id;
  RETURN _next;
END $function$;
