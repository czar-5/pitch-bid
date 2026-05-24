DROP FUNCTION IF EXISTS public.get_next_player(uuid);
CREATE FUNCTION public.get_next_player(_auction_id uuid)
RETURNS TABLE (
  player_id uuid, name text, role text, photo text,
  batting_style text, bowling_style text,
  matches integer, runs integer, wickets integer,
  batting_avg numeric, batting_sr numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT p.id, p.name, p.role::text, p.photo, p.batting_style, p.bowling_style,
         p.matches, p.runs, p.wickets, p.batting_avg, p.batting_sr
  FROM public.auction_players ap
  JOIN public.players p ON p.id = ap.player_id
  WHERE ap.auction_id = _auction_id AND ap.status = 'queued'
  ORDER BY ap.created_at ASC
  LIMIT 1
$$;