import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { CalendarIcon, ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type BidRule = { min: number; max: number | null; increment: number };

type AuctionMethod = "online" | "offline";

type WizardState = {
  name: string;
  method: AuctionMethod;
  auctioneerEmail: string;
  scheduledDate: Date | undefined;
  scheduledTime: string;
  team_budget: number;
  baseline_price: number;
  round_closure_seconds: number;
  min_players_per_team: number;
  max_players_per_team: number;
  bid_rules: BidRule[];
  selectedTeams: Set<string>;
  selectedPlayers: Set<string>;
  captains: Record<string, string | null>;       // teamId -> playerId | null
  iconCounts: Record<string, number>;            // teamId -> N
  iconPlayers: Record<string, string[]>;         // teamId -> playerIds
};

const DEFAULT_BID_RULES: BidRule[] = [
  { min: 0, max: null, increment: 100 },
];

const NO_SPIN =
  "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

const STEPS = ["Basics", "Money rules", "Teams", "Players", "Captains & Icons", "Review"] as const;

export function AuctionWizardDialog({ trigger, auctionId }: { trigger: React.ReactNode; auctionId?: string }) {
  const isEdit = !!auctionId;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(initial);
  const qc = useQueryClient();

  function initial(): WizardState {
    return {
      name: "",
      method: "online",
      auctioneerEmail: "",
      scheduledDate: undefined,
      scheduledTime: "19:00",
      team_budget: 100000,
      baseline_price: 500,
      round_closure_seconds: 15,
      min_players_per_team: 10,
      max_players_per_team: 12,
      bid_rules: DEFAULT_BID_RULES,
      selectedTeams: new Set(),
      selectedPlayers: new Set(),
      captains: {},
      iconCounts: {},
      iconPlayers: {},
    };
  }

  useEffect(() => {
    if (!open) {
      setTimeout(() => { setStep(0); setState(initial()); }, 200);
    }
  }, [open]);

  // Load existing auction when editing
  const existingQ = useQuery({
    queryKey: ["auction-edit", auctionId],
    enabled: open && isEdit,
    queryFn: async () => {
      const [a, at, ap] = await Promise.all([
        supabase.from("auctions").select("*").eq("id", auctionId!).single(),
        supabase.from("auction_teams").select("team_id").eq("auction_id", auctionId!),
        supabase.from("auction_players").select("player_id,auction_order,is_captain,is_icon,icon_team_id,sold_team_id").eq("auction_id", auctionId!).order("auction_order", { ascending: true }),
      ]);
      if (a.error) throw a.error;
      if (at.error) throw at.error;
      if (ap.error) throw ap.error;
      let auctioneerEmail = "";
      const auctioneerId = (a.data as any).auctioneer_user_id as string | null;
      if (auctioneerId) {
        const { data: emails } = await supabase.rpc("admin_get_user_emails", { _ids: [auctioneerId] });
        auctioneerEmail = (emails as any[])?.[0]?.email ?? "";
      }
      return { auction: a.data, teams: at.data, players: ap.data, auctioneerEmail };
    },
  });

  useEffect(() => {
    if (!open || !isEdit || !existingQ.data) return;
    const { auction, teams, players, auctioneerEmail } = existingQ.data;
    const scheduled = new Date(auction.scheduled_at);
    const rules = (auction.bid_rules_json as BidRule[] | null) ?? DEFAULT_BID_RULES;
    const captains: Record<string, string | null> = {};
    const iconPlayers: Record<string, string[]> = {};
    const iconCounts: Record<string, number> = {};
    for (const p of players as any[]) {
      if (p.is_captain && p.sold_team_id) captains[p.sold_team_id] = p.player_id;
      if (p.is_icon && p.icon_team_id) {
        iconPlayers[p.icon_team_id] = [...(iconPlayers[p.icon_team_id] ?? []), p.player_id];
      }
    }
    for (const t of teams) {
      iconCounts[t.team_id] = (iconPlayers[t.team_id] ?? []).length;
    }
    setState({
      name: auction.name,
      method: (((auction as any).method as AuctionMethod) ?? "online"),
      auctioneerEmail: auctioneerEmail ?? "",
      scheduledDate: scheduled,
      scheduledTime: `${String(scheduled.getHours()).padStart(2, "0")}:${String(scheduled.getMinutes()).padStart(2, "0")}`,
      team_budget: auction.team_budget,
      baseline_price: auction.baseline_price,
      round_closure_seconds: auction.round_closure_seconds,
      min_players_per_team: auction.min_players_per_team,
      max_players_per_team: auction.max_players_per_team,
      bid_rules: rules.length ? rules : DEFAULT_BID_RULES,
      selectedTeams: new Set(teams.map((t) => t.team_id)),
      selectedPlayers: new Set((players as any[]).map((p) => p.player_id)),
      captains,
      iconCounts,
      iconPlayers,
    });
  }, [open, isEdit, existingQ.data]);

  const teamsQ = useQuery({
    queryKey: ["teams-pick"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("id,name,primary_color,logo_url").order("name");
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const playersQ = useQuery({
    queryKey: ["players-pick"],
    queryFn: async () => {
      const { data, error } = await supabase.from("players").select("id,name,role").order("name");
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!state.scheduledDate) throw new Error("Pick a date");
      const [hh, mm] = state.scheduledTime.split(":").map(Number);
      const scheduled = new Date(state.scheduledDate);
      scheduled.setHours(hh, mm, 0, 0);

      let auctioneerUserId: string | null = null;
      if (state.method === "offline") {
        const email = state.auctioneerEmail.trim().toLowerCase();
        if (!email) throw new Error("Enter the auctioneer's email");
        const { data: found, error: findErr } = await supabase.rpc("admin_find_user_by_email", { _email: email });
        if (findErr) throw findErr;
        if (!found) throw new Error(`No user found with email ${email}. They must sign up first.`);
        auctioneerUserId = found as string;
      }

      const payload = {
        name: state.name,
        method: state.method,
        auctioneer_user_id: auctioneerUserId,
        scheduled_at: scheduled.toISOString(),
        team_budget: state.team_budget,
        baseline_price: state.baseline_price,
        round_closure_seconds: state.method === "offline" ? 0 : state.round_closure_seconds,
        min_players_per_team: state.min_players_per_team,
        max_players_per_team: state.max_players_per_team,
        bid_rules_json: state.bid_rules.map((r, i, arr) => ({
          min: i === 0 ? state.baseline_price : (arr[i - 1].max ?? state.baseline_price),
          max: r.max,
          increment: r.increment,
        })),
      } as any;

      let savedId: string;
      if (isEdit && auctionId) {
        const { error } = await supabase.from("auctions").update(payload).eq("id", auctionId);
        if (error) throw error;
        savedId = auctionId;
        // Replace teams and players (auction is still upcoming, no bids yet)
        await supabase.from("auction_players").delete().eq("auction_id", savedId);
        await supabase.from("auction_teams").delete().eq("auction_id", savedId);
      } else {
        const { data: auction, error } = await supabase
          .from("auctions")
          .insert({ ...payload, status: "upcoming" })
          .select("id")
          .single();
        if (error) throw error;
        savedId = auction.id;
      }

      // Build pre-sold (captain/icon) assignments
      const preSoldRows: any[] = [];
      const preSoldByTeam = new Map<string, number>();
      const assignedPlayerIds = new Set<string>();
      for (const teamId of state.selectedTeams) {
        const cap = state.captains[teamId];
        if (cap && state.selectedPlayers.has(cap) && !assignedPlayerIds.has(cap)) {
          preSoldRows.push({
            auction_id: savedId, player_id: cap, status: "sold",
            sold_team_id: teamId, sold_price: 0, is_captain: true, is_icon: false,
          });
          assignedPlayerIds.add(cap);
          preSoldByTeam.set(teamId, (preSoldByTeam.get(teamId) ?? 0) + 1);
        }
        for (const pid of state.iconPlayers[teamId] ?? []) {
          if (!state.selectedPlayers.has(pid) || assignedPlayerIds.has(pid)) continue;
          preSoldRows.push({
            auction_id: savedId, player_id: pid, status: "sold",
            sold_team_id: teamId, sold_price: 0, is_icon: true, is_captain: false, icon_team_id: teamId,
          });
          assignedPlayerIds.add(pid);
          preSoldByTeam.set(teamId, (preSoldByTeam.get(teamId) ?? 0) + 1);
        }
      }

      if (state.selectedTeams.size > 0) {
        const teamRows = Array.from(state.selectedTeams).map((team_id) => ({
          auction_id: savedId,
          team_id,
          budget_remaining: state.team_budget,
          players_bought: preSoldByTeam.get(team_id) ?? 0,
        }));
        const { error: e2 } = await supabase.from("auction_teams").insert(teamRows);
        if (e2) throw e2;
      }

      const queuedIds = Array.from(state.selectedPlayers).filter((id) => !assignedPlayerIds.has(id));
      const queuedRows = queuedIds.map((player_id, i) => ({
        auction_id: savedId,
        player_id,
        auction_order: i + 1,
        status: "queued" as const,
        is_captain: false,
        is_icon: false,
      }));
      const allPlayerRows = [...queuedRows, ...preSoldRows];
      if (allPlayerRows.length > 0) {
        const { error: e3 } = await supabase.from("auction_players").insert(allPlayerRows);
        if (e3) throw e3;
      }

      return savedId;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Auction updated" : "Auction created");
      qc.invalidateQueries({ queryKey: ["auctions"] });
      if (isEdit && auctionId) {
        qc.invalidateQueries({ queryKey: ["auction", auctionId] });
        qc.invalidateQueries({ queryKey: ["auction-teams", auctionId] });
        qc.invalidateQueries({ queryKey: ["auction-players", auctionId] });
      }
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function canAdvance() {
    if (step === 0) return (
      state.name.trim().length > 0 &&
      !!state.scheduledDate &&
      (state.method === "online" || state.auctioneerEmail.trim().length > 0)
    );
    if (step === 1) return (
      state.team_budget > 0 &&
      state.baseline_price > 0 &&
      (state.method === "offline" || state.round_closure_seconds > 0) &&
      state.min_players_per_team >= 0 &&
      state.max_players_per_team >= 1 &&
      state.min_players_per_team <= state.max_players_per_team
    );
    if (step === 2) return state.selectedTeams.size >= 2;
    if (step === 3) return state.selectedPlayers.size >= 1;
    if (step === 4) {
      // Each team's icon picker must match its count; no duplicates across teams.
      const seen = new Set<string>();
      for (const teamId of state.selectedTeams) {
        const cap = state.captains[teamId];
        if (cap) {
          if (seen.has(cap)) return false;
          seen.add(cap);
        }
        const icons = state.iconPlayers[teamId] ?? [];
        const need = state.iconCounts[teamId] ?? 0;
        if (icons.length !== need) return false;
        for (const p of icons) {
          if (seen.has(p)) return false;
          seen.add(p);
        }
      }
      // Ensure at least one queued player remains for the bidding auction.
      const totalAssigned = seen.size;
      if (state.selectedPlayers.size - totalAssigned < 1) return false;
      return true;
    }
    return true;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Auction" : "New Auction"} · {STEPS[step]}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-1 mb-2">
          {STEPS.map((s, i) => (
            <div key={s} className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-muted")} />
          ))}
        </div>

        {step === 0 && <StepBasics state={state} setState={setState} />}
        {step === 1 && <StepMoney state={state} setState={setState} />}
        {step === 2 && <StepTeams state={state} setState={setState} teams={teamsQ.data ?? []} loading={teamsQ.isLoading} />}
        {step === 3 && <StepPlayers state={state} setState={setState} players={playersQ.data ?? []} loading={playersQ.isLoading} />}
        {step === 4 && <StepCaptainsIcons state={state} setState={setState} teams={teamsQ.data ?? []} players={playersQ.data ?? []} />}
        {step === 5 && <StepReview state={state} teams={teamsQ.data ?? []} players={playersQ.data ?? []} />}

        <div className="flex items-center justify-between pt-4 border-t border-border mt-4">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance()}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {isEdit ? "Save changes" : "Create auction"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Setter = React.Dispatch<React.SetStateAction<WizardState>>;

function StepBasics({ state, setState }: { state: WizardState; setState: Setter }) {
  return (
    <div className="space-y-4">
      <div>
        <Label>Auction name</Label>
        <Input value={state.name} onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))} placeholder="IPL 2026 Mega Auction" />
      </div>
      <div>
        <Label>Method</Label>
        <div className="mt-1 inline-flex rounded-lg border border-border p-1">
          {(["online", "offline"] as const).map((m) => (
            <Button
              key={m}
              type="button"
              variant={state.method === m ? "default" : "ghost"}
              size="sm"
              onClick={() => setState((s) => ({ ...s, method: m }))}
              className="capitalize"
            >
              {m}
            </Button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {state.method === "online"
            ? "Each team manager bids from their own device, with a round timer."
            : "One auctioneer runs the bidding in the room; no round timer."}
        </p>
      </div>
      {state.method === "offline" && (
        <div>
          <Label>Auctioneer email</Label>
          <Input
            type="email"
            value={state.auctioneerEmail}
            onChange={(e) => setState((s) => ({ ...s, auctioneerEmail: e.target.value }))}
            placeholder="auctioneer@example.com"
          />
          <p className="mt-1 text-xs text-muted-foreground">Must be someone who has already signed up. Only they (and admins) get the bidding controls.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Date</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !state.scheduledDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {state.scheduledDate ? format(state.scheduledDate, "PPP") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={state.scheduledDate} onSelect={(d) => setState((s) => ({ ...s, scheduledDate: d ?? undefined }))} initialFocus className={cn("p-3 pointer-events-auto")} />
            </PopoverContent>
          </Popover>
        </div>
        <div>
          <Label>Time</Label>
          <Input type="time" value={state.scheduledTime} onChange={(e) => setState((s) => ({ ...s, scheduledTime: e.target.value }))} />
        </div>
      </div>
    </div>
  );
}

function StepMoney({ state, setState }: { state: WizardState; setState: Setter }) {
  function updRule(i: number, patch: Partial<BidRule>) {
    setState((s) => ({ ...s, bid_rules: s.bid_rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  }
  function insertBefore(i: number) {
    setState((s) => ({
      ...s,
      bid_rules: [
        ...s.bid_rules.slice(0, i),
        { min: 0, max: 0, increment: s.bid_rules[i]?.increment ?? 100 },
        ...s.bid_rules.slice(i),
      ],
    }));
  }
  function delRule(i: number) {
    setState((s) => ({ ...s, bid_rules: s.bid_rules.filter((_, idx) => idx !== i) }));
  }
  return (
    <div className="space-y-4">
      <div className={cn("grid gap-3", state.method === "online" ? "grid-cols-3" : "grid-cols-2")}>
        <div><Label>Team budget</Label><Input type="number" className={NO_SPIN} value={state.team_budget} onChange={(e) => setState((s) => ({ ...s, team_budget: Number(e.target.value) }))} /></div>
        <div><Label>Baseline price</Label><Input type="number" className={NO_SPIN} value={state.baseline_price} onChange={(e) => setState((s) => ({ ...s, baseline_price: Number(e.target.value) }))} /></div>
        {state.method === "online" && (
          <div><Label>Round closure (sec)</Label><Input type="number" className={NO_SPIN} value={state.round_closure_seconds} onChange={(e) => setState((s) => ({ ...s, round_closure_seconds: Number(e.target.value) }))} /></div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Min players / team</Label><Input type="number" className={NO_SPIN} value={state.min_players_per_team} onChange={(e) => setState((s) => ({ ...s, min_players_per_team: Number(e.target.value) }))} /></div>
        <div><Label>Max players / team</Label><Input type="number" className={NO_SPIN} value={state.max_players_per_team} onChange={(e) => setState((s) => ({ ...s, max_players_per_team: Number(e.target.value) }))} /></div>
      </div>
      {state.min_players_per_team > state.max_players_per_team && (
        <p className="text-xs text-destructive">Min players cannot exceed max players.</p>
      )}
      <div>
        <Label>Bid increment</Label>
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-[2rem_3rem_1fr_1fr_2rem] gap-2 items-center text-xs text-muted-foreground px-1">
            <span />
            <span />
            <span />
            <span>Value</span>
            <span />
          </div>
          {state.bid_rules.map((r, i) => {
            const isLast = i === state.bid_rules.length - 1;
            return (
              <div key={i} className="grid grid-cols-[2rem_3rem_1fr_1fr_2rem] gap-2 items-center">
                <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => insertBefore(i)} title="Insert slab before">
                  <Plus className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">upto</span>
                {isLast ? (
                  <Input value="Max" disabled />
                ) : (
                  <Input
                    type="number"
                    className={NO_SPIN}
                    placeholder="Ceiling"
                    value={r.max ?? ""}
                    onChange={(e) => updRule(i, { max: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                )}
                <Input
                  type="number"
                  className={NO_SPIN}
                  placeholder="Increment"
                  value={r.increment}
                  onChange={(e) => updRule(i, { increment: Number(e.target.value) })}
                />
                {isLast ? (
                  <span />
                ) : (
                  <Button type="button" variant="ghost" size="icon" onClick={() => delRule(i)} className="text-destructive h-8 w-8">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type TeamOpt = { id: string; name: string; primary_color: string | null; logo_url: string | null };
function StepTeams({ state, setState, teams, loading }: { state: WizardState; setState: Setter; teams: TeamOpt[]; loading: boolean }) {
  function toggle(id: string) {
    setState((s) => {
      const next = new Set(s.selectedTeams);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...s, selectedTeams: next };
    });
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Pick at least 2 teams. Each gets the team budget set in step 2.</p>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && teams.length === 0 && <p className="text-sm text-muted-foreground">No teams yet — create teams first.</p>}
      <div className="grid sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto">
        {teams.map((t) => (
          <label key={t.id} className={cn("flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition", state.selectedTeams.has(t.id) ? "border-primary bg-primary/5" : "border-border hover:border-primary/50")}>
            <Checkbox checked={state.selectedTeams.has(t.id)} onCheckedChange={() => toggle(t.id)} />
            <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-xs font-bold" style={{ background: t.primary_color ?? undefined }}>
              {t.logo_url ? <img src={t.logo_url} alt="" className="h-full w-full rounded object-cover" /> : t.name.slice(0, 2).toUpperCase()}
            </div>
            <span className="text-sm font-medium">{t.name}</span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground pt-2">{state.selectedTeams.size} selected</p>
    </div>
  );
}

type PlayerOpt = { id: string; name: string; role: string };
function StepPlayers({ state, setState, players, loading }: { state: WizardState; setState: Setter; players: PlayerOpt[]; loading: boolean }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => players.filter((p) => (p.name ?? "").toLowerCase().includes(q.toLowerCase())), [players, q]);
  function toggle(id: string) {
    setState((s) => {
      const next = new Set(s.selectedPlayers);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...s, selectedPlayers: next };
    });
  }
  function toggleAll() {
    setState((s) => ({ ...s, selectedPlayers: s.selectedPlayers.size === filtered.length ? new Set() : new Set(filtered.map((p) => p.id)) }));
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input placeholder="Search players…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="button" variant="outline" size="sm" onClick={toggleAll}>Toggle all</Button>
      </div>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && filtered.length === 0 && <p className="text-sm text-muted-foreground">No players found.</p>}
      <div className="space-y-1 max-h-80 overflow-y-auto">
        {filtered.map((p) => (
          <label key={p.id} className={cn("flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition", state.selectedPlayers.has(p.id) ? "border-primary bg-primary/5" : "border-border hover:border-primary/50")}>
            <Checkbox checked={state.selectedPlayers.has(p.id)} onCheckedChange={() => toggle(p.id)} />
            <div className="flex-1">
              <div className="text-sm font-medium">{p.name}</div>
              <div className="text-xs text-muted-foreground capitalize">{p.role.replace(/_/g, " ")}</div>
            </div>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground pt-2">{state.selectedPlayers.size} selected</p>
    </div>
  );
}

function StepReview({ state, teams, players }: { state: WizardState; teams: TeamOpt[]; players: PlayerOpt[] }) {
  const teamNames = teams.filter((t) => state.selectedTeams.has(t.id)).map((t) => t.name);
  const totalCaps = Array.from(state.selectedTeams).filter((id) => !!state.captains[id]).length;
  const totalIcons = Array.from(state.selectedTeams).reduce((sum, id) => sum + (state.iconPlayers[id]?.length ?? 0), 0);
  return (
    <div className="space-y-3 text-sm">
      <Row label="Name" value={state.name} />
      <Row label="Method" value={state.method === "offline" ? "Offline" : "Online"} />
      {state.method === "offline" && <Row label="Auctioneer" value={state.auctioneerEmail} />}
      <Row label="Scheduled" value={state.scheduledDate ? `${format(state.scheduledDate, "PPP")} at ${state.scheduledTime}` : "—"} />
      <Row label="Team budget" value={state.team_budget.toLocaleString()} />
      <Row label="Baseline" value={state.baseline_price.toLocaleString()} />
      {state.method === "online" && <Row label="Round closure" value={`${state.round_closure_seconds}s`} />}
      <Row label="Squad size" value={`min ${state.min_players_per_team} · max ${state.max_players_per_team}`} />
      <Row label="Bid rules" value={`${state.bid_rules.length} tiers`} />
      <Row label="Teams" value={`${teamNames.length} · ${teamNames.slice(0, 4).join(", ")}${teamNames.length > 4 ? "…" : ""}`} />
      <Row label="Players" value={`${state.selectedPlayers.size} of ${players.length}`} />
      <Row label="Pre-assigned" value={`${totalCaps} captain(s) · ${totalIcons} icon(s)`} />
    </div>
  );
}

function StepCaptainsIcons({
  state, setState, teams, players,
}: { state: WizardState; setState: Setter; teams: TeamOpt[]; players: PlayerOpt[] }) {
  const selectedTeams = teams.filter((t) => state.selectedTeams.has(t.id));
  const selectedPlayers = players.filter((p) => state.selectedPlayers.has(p.id));

  // All players already taken across all teams (used to disable in pickers).
  const takenGlobal = useMemo(() => {
    const s = new Set<string>();
    for (const tid of state.selectedTeams) {
      const cap = state.captains[tid];
      if (cap) s.add(cap);
      for (const p of state.iconPlayers[tid] ?? []) s.add(p);
    }
    return s;
  }, [state.selectedTeams, state.captains, state.iconPlayers]);

  function setCaptain(teamId: string, playerId: string | null) {
    setState((s) => ({ ...s, captains: { ...s.captains, [teamId]: playerId } }));
  }
  function setIconCount(teamId: string, n: number) {
    setState((s) => {
      const current = s.iconPlayers[teamId] ?? [];
      const trimmed = current.slice(0, Math.max(0, n));
      return {
        ...s,
        iconCounts: { ...s.iconCounts, [teamId]: Math.max(0, n) },
        iconPlayers: { ...s.iconPlayers, [teamId]: trimmed },
      };
    });
  }
  function toggleIcon(teamId: string, playerId: string) {
    setState((s) => {
      const current = s.iconPlayers[teamId] ?? [];
      const max = s.iconCounts[teamId] ?? 0;
      const has = current.includes(playerId);
      const next = has ? current.filter((p) => p !== playerId) : (current.length < max ? [...current, playerId] : current);
      return { ...s, iconPlayers: { ...s.iconPlayers, [teamId]: next } };
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Optionally assign a captain and a fixed number of icon players to each team. These players are marked sold before the auction and don't enter the bidding queue.
      </p>
      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
        {selectedTeams.map((t) => {
          const cap = state.captains[t.id] ?? null;
          const iconCount = state.iconCounts[t.id] ?? 0;
          const iconPicked = state.iconPlayers[t.id] ?? [];
          // Players this team can choose from = selected pool minus taken-by-others.
          const teamTaken = new Set<string>();
          if (cap) teamTaken.add(cap);
          for (const p of iconPicked) teamTaken.add(p);
          const others = new Set<string>();
          for (const p of takenGlobal) if (!teamTaken.has(p)) others.add(p);
          const captainOpts = selectedPlayers.filter((p) => !others.has(p.id));
          const iconOpts = selectedPlayers.filter((p) => p.id !== cap && !others.has(p.id));
          return (
            <div key={t.id} className="rounded-lg border border-border p-3 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-xs font-bold overflow-hidden" style={{ background: t.primary_color ?? undefined }}>
                  {t.logo_url ? <img src={t.logo_url} alt="" className="h-full w-full object-cover" /> : t.name.slice(0, 2).toUpperCase()}
                </div>
                <span className="font-semibold text-sm">{t.name}</span>
              </div>

              <div className="grid grid-cols-[1fr_8rem] gap-3">
                <div>
                  <Label className="text-xs">Captain (optional)</Label>
                  <select
                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={cap ?? ""}
                    onChange={(e) => setCaptain(t.id, e.target.value || null)}
                  >
                    <option value="">None</option>
                    {captainOpts.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} · {p.role.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Icon players</Label>
                  <Input
                    type="number"
                    min={0}
                    className={cn("mt-1", NO_SPIN)}
                    value={iconCount}
                    onChange={(e) => setIconCount(t.id, Number(e.target.value) || 0)}
                  />
                </div>
              </div>

              {iconCount > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs">Pick {iconCount} icon player{iconCount === 1 ? "" : "s"}</Label>
                    <span className="text-[10px] text-muted-foreground">{iconPicked.length}/{iconCount}</span>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded border border-border divide-y divide-border">
                    {iconOpts.length === 0 && <p className="p-2 text-xs text-muted-foreground">No players available.</p>}
                    {iconOpts.map((p) => {
                      const checked = iconPicked.includes(p.id);
                      const atCap = !checked && iconPicked.length >= iconCount;
                      return (
                        <label key={p.id} className={cn("flex items-center gap-2 p-2 text-sm", atCap ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-muted/50")}>
                          <Checkbox checked={checked} disabled={atCap} onCheckedChange={() => toggleIcon(t.id, p.id)} />
                          <span className="flex-1 truncate">{p.name}</span>
                          <span className="text-xs text-muted-foreground capitalize">{p.role.replace(/_/g, " ")}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-border last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}