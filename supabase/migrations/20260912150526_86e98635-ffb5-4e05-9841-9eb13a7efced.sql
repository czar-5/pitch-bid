REVOKE ALL ON FUNCTION public.admin_find_user_by_email(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_user_emails(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_find_user_by_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user_emails(uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.guard_auction_teams_updates() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_team_updates() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_team_member_role() FROM PUBLIC, anon, authenticated;