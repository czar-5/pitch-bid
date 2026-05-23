-- Allow team managers to update their own team row
CREATE POLICY "teams_manager_update"
ON public.teams
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.team_id = teams.id
      AND tm.user_id = auth.uid()
      AND tm.membership_role = 'manager'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.team_id = teams.id
      AND tm.user_id = auth.uid()
      AND tm.membership_role = 'manager'
  )
);

-- Prevent non-admins from changing name / primary_color via a trigger.
CREATE OR REPLACE FUNCTION public.guard_team_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  -- Non-admin managers may only change logo_url.
  NEW.name := OLD.name;
  NEW.primary_color := OLD.primary_color;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_team_updates ON public.teams;
CREATE TRIGGER guard_team_updates
BEFORE UPDATE ON public.teams
FOR EACH ROW
EXECUTE FUNCTION public.guard_team_updates();