
-- Sync user_roles with team_members membership_role for manager/co_manager

CREATE OR REPLACE FUNCTION public.sync_team_member_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_role public.app_role;
  old_role public.app_role;
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    new_role := NEW.membership_role::text::public.app_role;
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.user_id, new_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.membership_role <> NEW.membership_role THEN
    old_role := OLD.membership_role::text::public.app_role;
    IF NOT EXISTS (
      SELECT 1 FROM public.team_members
      WHERE user_id = OLD.user_id
        AND membership_role = OLD.membership_role
        AND id <> OLD.id
    ) THEN
      DELETE FROM public.user_roles
      WHERE user_id = OLD.user_id AND role = old_role;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    old_role := OLD.membership_role::text::public.app_role;
    IF NOT EXISTS (
      SELECT 1 FROM public.team_members
      WHERE user_id = OLD.user_id
        AND membership_role = OLD.membership_role
        AND id <> OLD.id
    ) THEN
      DELETE FROM public.user_roles
      WHERE user_id = OLD.user_id AND role = old_role;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

-- Ensure (user_id, role) is unique on user_roles for ON CONFLICT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_roles_user_id_role_key'
      AND conrelid = 'public.user_roles'::regclass
  ) THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
  END IF;
END $$;

DROP TRIGGER IF EXISTS team_members_sync_role_ins ON public.team_members;
CREATE TRIGGER team_members_sync_role_ins
  AFTER INSERT ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_team_member_role();

DROP TRIGGER IF EXISTS team_members_sync_role_upd ON public.team_members;
CREATE TRIGGER team_members_sync_role_upd
  AFTER UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_team_member_role();

DROP TRIGGER IF EXISTS team_members_sync_role_del ON public.team_members;
CREATE TRIGGER team_members_sync_role_del
  AFTER DELETE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_team_member_role();

-- Backfill: ensure existing team_members rows have matching user_roles
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT tm.user_id, tm.membership_role::text::public.app_role
FROM public.team_members tm
ON CONFLICT (user_id, role) DO NOTHING;
