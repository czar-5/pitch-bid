
-- 1. Wipe dependent data
DELETE FROM public.bids;
DELETE FROM public.auction_players;
DELETE FROM public.players;

-- 2. Replace the player_role enum with new values
ALTER TABLE public.players ALTER COLUMN player_role DROP DEFAULT;
ALTER TYPE public.player_role RENAME TO player_role_old;
CREATE TYPE public.player_role AS ENUM ('batter','bowler','batting_allrounder','bowling_allrounder','wicket_keeper');

-- 3. Drop the old function that returns the old shape (we'll recreate)
DROP FUNCTION IF EXISTS public.get_next_player(uuid);

-- 4. Drop old columns from players
ALTER TABLE public.players
  DROP COLUMN first_name,
  DROP COLUMN last_name,
  DROP COLUMN display_name,
  DROP COLUMN photo_url,
  DROP COLUMN country,
  DROP COLUMN cricinfo_url,
  DROP COLUMN player_role;

DROP TYPE public.player_role_old;

-- 5. Add new columns
ALTER TABLE public.players
  ADD COLUMN name text NOT NULL,
  ADD COLUMN role public.player_role NOT NULL DEFAULT 'batter',
  ADD COLUMN batting_style text,
  ADD COLUMN bowling_style text,
  ADD COLUMN matches integer NOT NULL DEFAULT 0,
  ADD COLUMN runs integer NOT NULL DEFAULT 0,
  ADD COLUMN wickets integer NOT NULL DEFAULT 0,
  ADD COLUMN batting_avg numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN batting_sr numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN photo text,
  ADD COLUMN cric_heroes_link text;

-- 6. Recreate get_next_player with new shape
CREATE OR REPLACE FUNCTION public.get_next_player(_auction_id uuid)
RETURNS TABLE (
  player_id uuid,
  name text,
  role text,
  photo text,
  batting_style text,
  bowling_style text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.id AS player_id,
    p.name,
    p.role::text,
    p.photo,
    p.batting_style,
    p.bowling_style
  FROM auction_players ap
  JOIN players p ON p.id = ap.player_id
  WHERE ap.auction_id = _auction_id AND ap.status = 'queued'
  ORDER BY ap.auction_order NULLS LAST, ap.created_at
  LIMIT 1;
$$;
