
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'co_manager', 'viewer');
CREATE TYPE public.membership_role AS ENUM ('manager', 'co_manager');
CREATE TYPE public.player_role AS ENUM ('batsman', 'bowler', 'all_rounder', 'wicketkeeper');
CREATE TYPE public.auction_status AS ENUM ('upcoming', 'live', 'paused', 'completed', 'archived');
CREATE TYPE public.auction_player_status AS ENUM ('queued', 'live', 'sold', 'unsold', 'skipped');

-- Profiles (mirrors auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User roles (separate table to prevent privilege escalation)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin') $$;

-- Auto-create profile + default viewer role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)), NEW.email);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'viewer');
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Teams
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  logo_url TEXT,
  primary_color TEXT DEFAULT '#2dd4a8',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  membership_role membership_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id)
);

-- Players
CREATE TABLE public.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  display_name TEXT,
  photo_url TEXT,
  player_role player_role NOT NULL DEFAULT 'batsman',
  country TEXT,
  cricinfo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auctions
CREATE TABLE public.auctions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status auction_status NOT NULL DEFAULT 'upcoming',
  team_budget BIGINT NOT NULL DEFAULT 100000,
  baseline_price BIGINT NOT NULL DEFAULT 500,
  round_closure_seconds INT NOT NULL DEFAULT 15,
  bid_rules_json JSONB NOT NULL DEFAULT '[{"min":0,"max":1000,"increment":50},{"min":1000,"max":5000,"increment":100},{"min":5000,"max":null,"increment":500}]'::jsonb,
  current_player_id UUID,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.auction_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  budget_remaining BIGINT NOT NULL DEFAULT 0,
  players_bought INT NOT NULL DEFAULT 0,
  is_ready BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(auction_id, team_id)
);

CREATE TABLE public.auction_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  auction_order INT,
  status auction_player_status NOT NULL DEFAULT 'queued',
  sold_team_id UUID REFERENCES public.teams(id),
  sold_price BIGINT,
  is_icon BOOLEAN NOT NULL DEFAULT false,
  icon_team_id UUID REFERENCES public.teams(id),
  round_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(auction_id, player_id)
);

CREATE TABLE public.bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_player_id UUID NOT NULL REFERENCES public.auction_players(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL,
  bidder_user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX bids_auction_player_idx ON public.bids(auction_player_id, created_at DESC);
CREATE INDEX auction_players_auction_idx ON public.auction_players(auction_id, auction_order);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER auctions_updated_at BEFORE UPDATE ON public.auctions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;

-- Profiles: own read/update, public name read
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- User roles: self read, admin manage
CREATE POLICY "roles_select_self_or_admin" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "roles_admin_insert" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "roles_admin_update" ON public.user_roles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "roles_admin_delete" ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- Teams: everyone read, admin write
CREATE POLICY "teams_select_all" ON public.teams FOR SELECT TO authenticated USING (true);
CREATE POLICY "teams_admin_all" ON public.teams FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Team members: everyone read, admin write
CREATE POLICY "team_members_select_all" ON public.team_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "team_members_admin_all" ON public.team_members FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Players: everyone read, admin write
CREATE POLICY "players_select_all" ON public.players FOR SELECT TO authenticated USING (true);
CREATE POLICY "players_admin_all" ON public.players FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Auctions: everyone read, admin write
CREATE POLICY "auctions_select_all" ON public.auctions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auctions_admin_all" ON public.auctions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Auction teams: read all, admin write, managers can mark ready
CREATE POLICY "auction_teams_select_all" ON public.auction_teams FOR SELECT TO authenticated USING (true);
CREATE POLICY "auction_teams_admin_all" ON public.auction_teams FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "auction_teams_manager_ready" ON public.auction_teams FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = auction_teams.team_id AND tm.user_id = auth.uid()));

-- Auction players: read all, admin write
CREATE POLICY "auction_players_select_all" ON public.auction_players FOR SELECT TO authenticated USING (true);
CREATE POLICY "auction_players_admin_all" ON public.auction_players FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Bids: read all, insert only via server function (no direct insert from client)
CREATE POLICY "bids_select_all" ON public.bids FOR SELECT TO authenticated USING (true);
-- intentionally no insert policy: bids must be placed via server function with service role

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.auctions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.auction_teams;
ALTER PUBLICATION supabase_realtime ADD TABLE public.auction_players;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bids;
