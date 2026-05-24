
-- Allow anonymous (logged-out) visitors to read public auction data.
-- profiles is intentionally excluded because it stores emails.

DROP POLICY IF EXISTS teams_select_all ON public.teams;
CREATE POLICY teams_select_all ON public.teams FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS players_select_all ON public.players;
CREATE POLICY players_select_all ON public.players FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS auctions_select_all ON public.auctions;
CREATE POLICY auctions_select_all ON public.auctions FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS auction_players_select_all ON public.auction_players;
CREATE POLICY auction_players_select_all ON public.auction_players FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS auction_teams_select_all ON public.auction_teams;
CREATE POLICY auction_teams_select_all ON public.auction_teams FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS bids_select_all ON public.bids;
CREATE POLICY bids_select_all ON public.bids FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS team_members_select_all ON public.team_members;
CREATE POLICY team_members_select_all ON public.team_members FOR SELECT TO public USING (true);
