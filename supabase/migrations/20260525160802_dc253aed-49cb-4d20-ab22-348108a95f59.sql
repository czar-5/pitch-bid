GRANT EXECUTE ON FUNCTION public.get_next_player(uuid) TO anon;

DROP POLICY IF EXISTS bids_select_authenticated ON public.bids;
CREATE POLICY bids_select_all ON public.bids FOR SELECT TO public USING (true);