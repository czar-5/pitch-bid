CREATE OR REPLACE FUNCTION public.reset_bid(_auction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE _ap_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT current_player_id INTO _ap_id FROM auctions WHERE id=_auction_id;
  IF _ap_id IS NULL THEN RETURN; END IF;
  DELETE FROM bids WHERE auction_player_id = _ap_id;
END $function$;