-- Allow team managers to add/remove co-managers for their own team
CREATE POLICY "team_members_manager_add_comanager"
ON public.team_members
FOR INSERT
TO authenticated
WITH CHECK (
  membership_role = 'co_manager'
  AND EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.team_id = team_members.team_id
      AND tm.user_id = auth.uid()
      AND tm.membership_role = 'manager'
  )
);

CREATE POLICY "team_members_manager_remove_comanager"
ON public.team_members
FOR DELETE
TO authenticated
USING (
  membership_role = 'co_manager'
  AND EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.team_id = team_members.team_id
      AND tm.user_id = auth.uid()
      AND tm.membership_role = 'manager'
  )
);