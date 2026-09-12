REVOKE ALL ON FUNCTION public.reset_bid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_bid(uuid) TO authenticated;