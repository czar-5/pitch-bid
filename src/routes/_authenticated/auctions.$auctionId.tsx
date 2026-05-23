import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Calendar, Coins, Gavel, Play, SkipForward, Check, ChevronsRight, Trash2, Users, Timer } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/auctions/$auctionId")({
  component: AuctionDetail,
});

function AuctionDetail() {
  const { auctionId } = Route.useParams();
  const { isAdmin, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const auctionQ = useQuery({
    queryKey: ["auction", auctionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("auctions").select("*").eq("id", auctionId).single();
      if (error) throw error;
      return data;
    },
  });

  const teamsQ = useQuery({
    queryKey: ["auction-teams", auctionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auction_teams")
        .select("id,budget_remaining,players_bought,team:teams(id,name,logo_url,primary_color)")
        .eq("auction_id", auctionId);
      if (error) throw error;
      return data;
    },
  });

  const playersQ = useQuery({
    queryKey: ["auction-players", auctionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auction_players")
        .select("id,auction_order,status,sold_price,sold_team_id,round_ends_at,player:players(id,first_name,last_name,display_name,player_role,photo_url,country)")
        .eq("auction_id", auctionId)
        .order("auction_order", { nullsFirst: false });
      if (error) throw error;
      return data;
    },
  });

  // Realtime: refresh on changes
  useEffect(() => {
    const ch = supabase
      .channel(`auction-${auctionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "auctions", filter: `id=eq.${auctionId}` },
        () => qc.invalidateQueries({ queryKey: ["auction", auctionId] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "auction_players", filter: `auction_id=eq.${auctionId}` },
        () => qc.invalidateQueries({ queryKey: ["auction-players", auctionId] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "auction_teams", filter: `auction_id=eq.${auctionId}` },
        () => qc.invalidateQueries({ queryKey: ["auction-teams", auctionId] }))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "bids" },
        () => qc.invalidateQueries({ queryKey: ["live-bids", auctionId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [auctionId, qc]);

  const del = useMutation({
    mutationFn: async () => {
      // cleanup children manually since we have no FK cascades
      await supabase.from("auction_players").delete().eq("auction_id", auctionId);
      await supabase.from("auction_teams").delete().eq("auction_id", auctionId);
      const { error } = await supabase.from("auctions").delete().eq("id", auctionId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Auction deleted"); qc.invalidateQueries({ queryKey: ["auctions"] }); navigate({ to: "/auctions" }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const start = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("start_auction", { _auction_id: auctionId });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Auction started"); qc.invalidateQueries({ queryKey: ["auction", auctionId] }); qc.invalidateQueries({ queryKey: ["auction-players", auctionId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (auctionQ.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!auctionQ.data) return <p className="text-muted-foreground">Auction not found.</p>;
  const a = auctionQ.data;

  const isLive = a.status === "live";
  const currentAp = playersQ.data?.find((p) => p.id === a.current_player_id) ?? null;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/auctions" })}>
        <ArrowLeft className="h-4 w-4 mr-1" /> All auctions
      </Button>

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground mb-2">{a.status}</span>
            <h1 className="text-2xl font-bold">{a.name}</h1>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><Calendar className="h-4 w-4" />{format(new Date(a.scheduled_at), "PPP p")}</span>
              <span className="flex items-center gap-1"><Coins className="h-4 w-4" />Budget {a.team_budget.toLocaleString()}</span>
              <span className="flex items-center gap-1"><Gavel className="h-4 w-4" />Baseline {a.baseline_price.toLocaleString()}</span>
            </div>
          </div>
          {isAdmin && a.status === "upcoming" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive"><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this auction?</AlertDialogTitle>
                  <AlertDialogDescription>All linked teams and players will be removed. Cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => del.mutate()}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        {isAdmin && a.status === "upcoming" && (
          <div className="mt-4">
            <Button onClick={() => start.mutate()} disabled={start.isPending || (playersQ.data?.length ?? 0) === 0}>
              <Play className="h-4 w-4 mr-1" /> Start auction
            </Button>
          </div>
        )}
      </div>

      {isLive && (
        <LiveRoom
          auctionId={auctionId}
          auction={a}
          currentAp={currentAp}
          teams={teamsQ.data ?? []}
          isAdmin={isAdmin}
          userId={user?.id ?? null}
        />
      )}

      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
          <Users className="h-4 w-4" /> Teams ({teamsQ.data?.length ?? 0})
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {teamsQ.data?.map((at) => (
            <div key={at.id} className="rounded-lg border border-border bg-card p-3 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-xs font-bold" style={{ background: at.team?.primary_color ?? undefined }}>
                {at.team?.logo_url ? <img src={at.team.logo_url} alt="" className="h-full w-full rounded-lg object-cover" /> : at.team?.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{at.team?.name}</p>
                <p className="text-xs text-muted-foreground">Budget {at.budget_remaining.toLocaleString()} · {at.players_bought} bought</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Player pool ({playersQ.data?.length ?? 0})
        </h2>
        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {playersQ.data?.map((ap) => (
            <div key={ap.id} className="p-3 flex items-center gap-3 text-sm">
              <span className="text-xs text-muted-foreground font-mono w-8">#{ap.auction_order}</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{ap.player?.display_name ?? `${ap.player?.first_name} ${ap.player?.last_name}`}</p>
                <p className="text-xs text-muted-foreground capitalize">{ap.player?.player_role.replace("_", " ")}</p>
              </div>
              {ap.sold_price != null && <span className="text-xs text-muted-foreground">{ap.sold_price.toLocaleString()}</span>}
              <span className="text-xs rounded-full bg-muted px-2 py-0.5 capitalize">{ap.status}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

type AuctionRow = NonNullable<ReturnType<typeof useQuery<{ id: string }>>["data"]>;

function LiveRoom({
  auctionId, auction, currentAp, teams, isAdmin, userId,
}: {
  auctionId: string;
  auction: any;
  currentAp: any;
  teams: any[];
  isAdmin: boolean;
  userId: string | null;
}) {
  const qc = useQueryClient();

  const bidsQ = useQuery({
    queryKey: ["live-bids", auctionId, currentAp?.id],
    enabled: !!currentAp?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bids")
        .select("id,amount,created_at,team:teams(id,name,primary_color)")
        .eq("auction_player_id", currentAp.id)
        .order("amount", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  // teams I can bid for
  const membershipsQ = useQuery({
    queryKey: ["my-memberships", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("team_members").select("team_id").eq("user_id", userId!);
      if (error) throw error;
      return data.map((r) => r.team_id);
    },
  });

  const myTeams = useMemo(() => {
    const mine = new Set(membershipsQ.data ?? []);
    return teams.filter((t) => mine.has(t.team?.id));
  }, [teams, membershipsQ.data]);

  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedTeam && myTeams[0]) setSelectedTeam(myTeams[0].team.id);
  }, [myTeams, selectedTeam]);

  // countdown
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const remaining = currentAp?.round_ends_at
    ? Math.max(0, Math.ceil((new Date(currentAp.round_ends_at).getTime() - now) / 1000))
    : null;

  const highBid = bidsQ.data?.[0] ?? null;
  const nextAmount = useMemo(() => {
    if (!highBid) return auction.baseline_price as number;
    const rules: Array<{ min: number; max: number | null; increment: number }> = auction.bid_rules_json ?? [];
    const rule = [...rules].reverse().find((r) => r.min <= highBid.amount && (r.max == null || r.max > highBid.amount));
    return highBid.amount + (rule?.increment ?? 100);
  }, [highBid, auction]);

  const placeBid = useMutation({
    mutationFn: async () => {
      if (!currentAp || !selectedTeam) throw new Error("Pick a team first");
      const { error } = await supabase.rpc("place_bid", { _auction_player_id: currentAp.id, _team_id: selectedTeam });
      if (error) throw error;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sell = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("sell_current", { _auction_id: auctionId });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Sold"); qc.invalidateQueries({ queryKey: ["auction", auctionId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const skip = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("skip_current", { _auction_id: auctionId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auction", auctionId] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const next = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("next_player", { _auction_id: auctionId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auction", auctionId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!currentAp) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center space-y-3">
        <p className="text-muted-foreground">No player on the block.</p>
        {isAdmin && (
          <Button onClick={() => next.mutate()}><ChevronsRight className="h-4 w-4 mr-1" /> Bring up next player</Button>
        )}
      </div>
    );
  }

  const p = currentAp.player;
  const leadingTeam = highBid ? teams.find((t) => t.team?.id === highBid.team?.id) : null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/40 bg-gradient-to-br from-primary/15 to-card p-5">
        <div className="flex items-start gap-4">
          <div className="h-20 w-20 rounded-xl bg-muted overflow-hidden flex-shrink-0">
            {p?.photo_url
              ? <img src={p.photo_url} alt="" className="h-full w-full object-cover" />
              : <div className="h-full w-full flex items-center justify-center text-2xl font-bold text-muted-foreground">{(p?.first_name ?? "?")[0]}</div>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-primary font-bold">On the block</p>
            <h2 className="text-xl font-bold truncate">{p?.display_name ?? `${p?.first_name} ${p?.last_name}`}</h2>
            <p className="text-xs text-muted-foreground capitalize">{p?.player_role?.replace("_", " ")}{p?.country ? ` · ${p.country}` : ""}</p>
          </div>
          {remaining != null && (
            <div className={`flex items-center gap-1 text-lg font-mono font-bold ${remaining <= 5 ? "text-destructive" : "text-foreground"}`}>
              <Timer className="h-4 w-4" /> {remaining}s
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-background/60 p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Current bid</p>
            <p className="text-2xl font-bold">{highBid ? highBid.amount.toLocaleString() : auction.baseline_price.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground truncate">{highBid ? `by ${highBid.team?.name}` : "Baseline price"}</p>
          </div>
          <div className="rounded-lg bg-background/60 p-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Next bid</p>
            <p className="text-2xl font-bold">{nextAmount.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">+{(nextAmount - (highBid?.amount ?? auction.baseline_price)).toLocaleString()}</p>
          </div>
        </div>
      </div>

      {myTeams.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Bid as</p>
          <div className="flex flex-wrap gap-2">
            {myTeams.map((at) => (
              <button
                key={at.team.id}
                onClick={() => setSelectedTeam(at.team.id)}
                className={`text-xs rounded-full px-3 py-1.5 border ${selectedTeam === at.team.id ? "border-primary bg-primary/15" : "border-border bg-muted"}`}
              >
                {at.team.name} · {at.budget_remaining.toLocaleString()}
              </button>
            ))}
          </div>
          <Button
            className="w-full h-12 text-base font-bold"
            onClick={() => placeBid.mutate()}
            disabled={placeBid.isPending || !selectedTeam || (leadingTeam?.team?.id === selectedTeam)}
          >
            <Gavel className="h-4 w-4 mr-2" />
            {leadingTeam?.team?.id === selectedTeam ? "You're leading" : `Bid ${nextAmount.toLocaleString()}`}
          </Button>
        </div>
      )}

      {isAdmin && (
        <div className="grid grid-cols-3 gap-2">
          <Button variant="default" onClick={() => sell.mutate()} disabled={sell.isPending}>
            <Check className="h-4 w-4 mr-1" /> Sold
          </Button>
          <Button variant="outline" onClick={() => skip.mutate()} disabled={skip.isPending}>
            <SkipForward className="h-4 w-4 mr-1" /> Skip
          </Button>
          <Button variant="outline" onClick={() => next.mutate()} disabled={next.isPending}>
            <ChevronsRight className="h-4 w-4 mr-1" /> Next
          </Button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card">
        <p className="px-4 py-2 text-[10px] uppercase tracking-widest font-bold text-muted-foreground border-b border-border">Bid history</p>
        <div className="divide-y divide-border">
          {bidsQ.data?.length ? bidsQ.data.map((b) => (
            <div key={b.id} className="px-4 py-2 flex items-center justify-between text-sm">
              <span className="font-medium">{b.team?.name}</span>
              <span className="font-mono">{b.amount.toLocaleString()}</span>
            </div>
          )) : <p className="px-4 py-3 text-xs text-muted-foreground">No bids yet — baseline {auction.baseline_price.toLocaleString()}</p>}
        </div>
      </div>
    </div>
  );
}