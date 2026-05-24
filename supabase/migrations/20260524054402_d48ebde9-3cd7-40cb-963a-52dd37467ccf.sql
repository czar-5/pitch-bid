CREATE OR REPLACE FUNCTION public.get_next_player(_auction_id uuid)
RETURNS TABLE (
  player_id uuid,
  first_name text,
  last_name text,
  display_name text,
  player_role text,
  photo_url text,
  country text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT 
    p.id AS player_id,
    p.first_name,
    p.last_name,
    p.display_name,
    p.player_role::text,
    p.photo_url,
    p.country
  FROM auction_players ap
  JOIN players p ON p.id = ap.player_id
  WHERE ap.auction_id = _auction_id AND ap.status = 'queued'
  ORDER BY ap.auction_order NULLS LAST, ap.created_at
  LIMIT 1;
$$;