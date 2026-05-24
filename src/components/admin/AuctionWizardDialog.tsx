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

type WizardState = {
  name: string;
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
};

const DEFAULT_BID_RULES: BidRule[] = [
  { min: 0, max: null, increment: 100 },
];

const NO_SPIN =
  "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

const STEPS = ["Basics", "Money rules", "Teams", "Players", "Review"] as const;

export function AuctionWizardDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(initial);
  const qc = useQueryClient();

  function initial(): WizardState {
    return {
      name: "",
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
    };
  }

  useEffect(() => {
    if (!open) {
      setTimeout(() => { setStep(0); setState(initial()); }, 200);
    }
  }, [open]);

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
      const { data, error } = await supabase.from("players").select("id,first_name,last_name,display_name,player_role").order("first_name");
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

      const { data: auction, error } = await supabase
        .from("auctions")
        .insert({
          name: state.name,
          scheduled_at: scheduled.toISOString(),
          team_budget: state.team_budget,
          baseline_price: state.baseline_price,
          round_closure_seconds: state.round_closure_seconds,
          min_players_per_team: state.min_players_per_team,
          max_players_per_team: state.max_players_per_team,
          bid_rules_json: state.bid_rules.map((r, i, arr) => ({
            min: i === 0 ? state.baseline_price : (arr[i - 1].max ?? state.baseline_price),
            max: r.max,
            increment: r.increment,
          })),
          status: "upcoming",
        })
        .select("id")
        .single();
      if (error) throw error;
      const auctionId = auction.id;

      if (state.selectedTeams.size > 0) {
        const teamRows = Array.from(state.selectedTeams).map((team_id) => ({
          auction_id: auctionId,
          team_id,
          budget_remaining: state.team_budget,
        }));
        const { error: e2 } = await supabase.from("auction_teams").insert(teamRows);
        if (e2) throw e2;
      }

      if (state.selectedPlayers.size > 0) {
        const playerRows = Array.from(state.selectedPlayers).map((player_id, i) => ({
          auction_id: auctionId,
          player_id,
          auction_order: i + 1,
          status: "queued" as const,
        }));
        const { error: e3 } = await supabase.from("auction_players").insert(playerRows);
        if (e3) throw e3;
      }

      return auctionId;
    },
    onSuccess: () => {
      toast.success("Auction created");
      qc.invalidateQueries({ queryKey: ["auctions"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function canAdvance() {
    if (step === 0) return state.name.trim().length > 0 && !!state.scheduledDate;
    if (step === 1) return (
      state.team_budget > 0 &&
      state.baseline_price > 0 &&
      state.round_closure_seconds > 0 &&
      state.min_players_per_team >= 0 &&
      state.max_players_per_team >= 1 &&
      state.min_players_per_team <= state.max_players_per_team
    );
    if (step === 2) return state.selectedTeams.size >= 2;
    if (step === 3) return state.selectedPlayers.size >= 1;
    return true;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Auction · {STEPS[step]}</DialogTitle>
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
        {step === 4 && <StepReview state={state} teams={teamsQ.data ?? []} players={playersQ.data ?? []} />}

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
              Create auction
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
      <div className="grid grid-cols-3 gap-3">
        <div><Label>Team budget</Label><Input type="number" className={NO_SPIN} value={state.team_budget} onChange={(e) => setState((s) => ({ ...s, team_budget: Number(e.target.value) }))} /></div>
        <div><Label>Baseline price</Label><Input type="number" className={NO_SPIN} value={state.baseline_price} onChange={(e) => setState((s) => ({ ...s, baseline_price: Number(e.target.value) }))} /></div>
        <div><Label>Round closure (sec)</Label><Input type="number" className={NO_SPIN} value={state.round_closure_seconds} onChange={(e) => setState((s) => ({ ...s, round_closure_seconds: Number(e.target.value) }))} /></div>
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

type PlayerOpt = { id: string; first_name: string; last_name: string; display_name: string | null; player_role: string };
function StepPlayers({ state, setState, players, loading }: { state: WizardState; setState: Setter; players: PlayerOpt[]; loading: boolean }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => players.filter((p) => `${p.first_name} ${p.last_name} ${p.display_name ?? ""}`.toLowerCase().includes(q.toLowerCase())), [players, q]);
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
              <div className="text-sm font-medium">{p.display_name ?? `${p.first_name} ${p.last_name}`}</div>
              <div className="text-xs text-muted-foreground capitalize">{p.player_role.replace("_", " ")}</div>
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
  return (
    <div className="space-y-3 text-sm">
      <Row label="Name" value={state.name} />
      <Row label="Scheduled" value={state.scheduledDate ? `${format(state.scheduledDate, "PPP")} at ${state.scheduledTime}` : "—"} />
      <Row label="Team budget" value={state.team_budget.toLocaleString()} />
      <Row label="Baseline" value={state.baseline_price.toLocaleString()} />
      <Row label="Round closure" value={`${state.round_closure_seconds}s`} />
      <Row label="Squad size" value={`min ${state.min_players_per_team} · max ${state.max_players_per_team}`} />
      <Row label="Bid rules" value={`${state.bid_rules.length} tiers`} />
      <Row label="Teams" value={`${teamNames.length} · ${teamNames.slice(0, 4).join(", ")}${teamNames.length > 4 ? "…" : ""}`} />
      <Row label="Players" value={`${state.selectedPlayers.size} of ${players.length}`} />
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