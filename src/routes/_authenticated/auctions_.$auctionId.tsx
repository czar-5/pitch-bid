import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Calendar, Coins, Gavel, Play, ChevronsRight, Trash2, Users, Timer, CheckCircle2, Circle, StopCircle, AlertTriangle, Radio, Pause, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
// (Accordion replaced by browser-tab style TeamsTabs component below)

export const Route = createFileRoute("/_authenticated/auctions_/$auctionId")({
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
        .select("id,status,sold_price,sold_team_id,round_ends_at,paused_remaining_seconds,player:players(id,name,role,photo,batting_style,bowling_style,matches,runs,wickets,batting_avg,batting_sr)")
        .eq("auction_id", auctionId)
        .order("name", { foreignTable: "players", ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Realtime: refresh on changes
  useEffect(() => {
    const ch = supabase
      .channel(`auction-${auctionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "auctions", filter: `id=eq.${auctionId}` },
        () => { qc.invalidateQueries({ queryKey: ["auction", auctionId] }); qc.invalidateQueries({ queryKey: ["next-player", auctionId] }); })
      .on("postgres_changes", { event: "*", schema: "public", table: "auction_players", filter: `auction_id=eq.${auctionId}` },
        () => { qc.invalidateQueries({ queryKey: ["auction-players", auctionId] }); qc.invalidateQueries({ queryKey: ["next-player", auctionId] }); })
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
    onSuccess: () => { toast.success("Lobby opened — waiting for team managers"); qc.invalidateQueries({ queryKey: ["auction", auctionId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const endAuction = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("end_auction", { _auction_id: auctionId });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Auction ended"); qc.invalidateQueries({ queryKey: ["auction", auctionId] }); qc.invalidateQueries({ queryKey: ["auction-players", auctionId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (auctionQ.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!auctionQ.data) return <p className="text-muted-foreground">Auction not found.</p>;
  const a = auctionQ.data;

  const status = a.status as string;
  const isLive = status === "live";
  const isLobby = status === "lobby";
  const currentAp = playersQ.data?.find((p) => p.id === a.current_player_id) ?? null;
  const lastFinalizedAp = (a as { last_finalized_player_id?: string | null }).last_finalized_player_id
    ? playersQ.data?.find((p) => p.id === (a as { last_finalized_player_id?: string | null }).last_finalized_player_id) ?? null
    : null;
  // While a player is on the block during a live auction, hide the surrounding
  // chrome (banner, teams grid, player pool) so bidders focus on the round.
  const minimal = isLive && !!currentAp;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/auctions" })}>
        <ArrowLeft className="h-4 w-4 mr-1" /> All auctions
      </Button>

      {!minimal && (
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground mb-2">{a.status}</span>
            <h1 className="text-2xl font-bold">{a.name}</h1>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><Calendar className="h-4 w-4" />{format(new Date(a.scheduled_at), "PPP p")}</span>
              <span className="flex items-center gap-1"><Coins className="h-4 w-4" />Budget {a.team_budget.toLocaleString()}</span>
              <span className="flex items-center gap-1"><Gavel className="h-4 w-4" />Baseline {a.baseline_price.toLocaleString()}</span>
              <span className="flex items-center gap-1"><Users className="h-4 w-4" />Squad min {a.min_players_per_team} · max {a.max_players_per_team}</span>
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
          {isAdmin && isLive && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive">
                  <StopCircle className="h-4 w-4 mr-1" /> End auction
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>End this auction now?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Any remaining players will be marked unsold and bidding will stop immediately. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => endAuction.mutate()}>End auction</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        {isAdmin && a.status === "upcoming" && (
          <div className="mt-4">
            <Button onClick={() => start.mutate()} disabled={start.isPending || (playersQ.data?.length ?? 0) === 0}>
              <Play className="h-4 w-4 mr-1" /> Open lobby
            </Button>
          </div>
        )}
        <BidSlabLadder baseline={a.baseline_price} rules={a.bid_rules_json as Array<{ min: number; max: number | null; increment: number }>} />
      </div>
      )}

      {isLobby && (
        <LobbyRoom
          auctionId={auctionId}
          auction={a}
          teams={teamsQ.data ?? []}
          isAdmin={isAdmin}
          userId={user?.id ?? null}
        />
      )}

      {isLive && (
        <LiveRoom
          auctionId={auctionId}
          auction={a}
          currentAp={currentAp}
          lastFinalizedAp={lastFinalizedAp}
          teams={teamsQ.data ?? []}
          isAdmin={isAdmin}
          userId={user?.id ?? null}
        />
      )}

      {!minimal && (
      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
          <Users className="h-4 w-4" /> Teams ({teamsQ.data?.length ?? 0})
        </h2>
        <TeamsTabs auctionId={auctionId} teams={teamsQ.data ?? []} />
      </section>
      )}

      {!minimal && (
      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Player pool ({playersQ.data?.length ?? 0})
        </h2>
        {(() => {
          const all = playersQ.data ?? [];
          const sold = all.filter((ap) => ap.status === "sold");
          const unsold = all.filter((ap) => ap.status !== "sold");
          const teamById = new Map((teamsQ.data ?? []).map((t: any) => [t.team?.id, t.team]));
          const renderRow = (ap: any) => {
            const team = ap.sold_team_id ? teamById.get(ap.sold_team_id) : null;
            return (
              <div key={ap.id} className="p-3 flex items-center gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{ap.player?.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{ap.player?.role?.replace(/_/g, " ")}</p>
                </div>
                {ap.sold_price != null && <span className="text-xs text-muted-foreground">{ap.sold_price.toLocaleString()}</span>}
                {team && (
                  <div
                    className="h-7 w-7 rounded bg-muted overflow-hidden flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{ background: team.primary_color ?? undefined }}
                    title={team.name}
                  >
                    {team.logo_url
                      ? <img src={team.logo_url} alt={team.name} className="h-full w-full object-cover" />
                      : team.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <span className="text-xs rounded-full bg-muted px-2 py-0.5 capitalize">{ap.status}</span>
              </div>
            );
          };
          return (
            <div className="space-y-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">Available ({unsold.length})</p>
                <div className="rounded-xl border border-border bg-card divide-y divide-border">
                  {unsold.length === 0
                    ? <p className="p-3 text-xs text-muted-foreground">None</p>
                    : unsold.map(renderRow)}
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">Sold ({sold.length})</p>
                <div className="rounded-xl border border-border bg-card divide-y divide-border">
                  {sold.length === 0
                    ? <p className="p-3 text-xs text-muted-foreground">None yet</p>
                    : sold.map(renderRow)}
                </div>
              </div>
            </div>
          );
        })()}
      </section>
      )}

      {isLive && !currentAp && lastFinalizedAp && (
        <PreviousBidHistory auctionPlayerId={lastFinalizedAp.id} player={lastFinalizedAp.player} />
      )}
    </div>
  );
}

type AuctionRow = NonNullable<ReturnType<typeof useQuery<{ id: string }>>["data"]>;

function LobbyRoom({
  auctionId, auction, teams, isAdmin, userId,
}: {
  auctionId: string;
  auction: any;
  teams: any[];
  isAdmin: boolean;
  userId: string | null;
}) {
  const qc = useQueryClient();

  const nextPlayerQ = useQuery({
    queryKey: ["next-player", auctionId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_next_player", { _auction_id: auctionId });
      if (error) throw error;
      return (data && (data as any[]).length > 0) ? (data as any[])[ 0 ] : null;
    },
  });

  const [roundSecs, setRoundSecs] = useState<number>(auction.round_closure_seconds);
  useEffect(() => { setRoundSecs(auction.round_closure_seconds); }, [auction.round_closure_seconds]);
  const saveRoundSecs = useMutation({
    mutationFn: async (v: number) => {
      const { error } = await supabase.from("auctions").update({ round_closure_seconds: v }).eq("id", auctionId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Round timer updated"); qc.invalidateQueries({ queryKey: ["auction", auctionId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  // which teams does this user manage?
  const membershipsQ = useQuery({
    queryKey: ["my-memberships", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.from("team_members").select("team_id").eq("user_id", userId!);
      if (error) throw error;
      return data.map((r) => r.team_id);
    },
  });

  const myTeamIds = useMemo(() => {
    const mine = new Set(membershipsQ.data ?? []);
    return teams.filter((t) => mine.has(t.team?.id)).map((t) => t.team.id as string);
  }, [teams, membershipsQ.data]);

  // realtime presence: track joined team ids
  const [joinedTeamIds, setJoinedTeamIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel(`auction-lobby-${auctionId}`, {
      config: { presence: { key: userId } },
    });

    const refresh = () => {
      const state = channel.presenceState() as Record<string, Array<{ team_ids?: string[] }>>;
      const ids = new Set<string>();
      for (const arr of Object.values(state)) {
        for (const p of arr) {
          for (const tid of p.team_ids ?? []) ids.add(tid);
        }
      }
      setJoinedTeamIds(ids);
    };

    channel
      .on("presence", { event: "sync" }, refresh)
      .on("presence", { event: "join" }, refresh)
      .on("presence", { event: "leave" }, refresh)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ team_ids: myTeamIds, is_admin: isAdmin });
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [auctionId, userId, isAdmin, myTeamIds.join(",")]);

  const totalTeams = teams.length;
  const joinedCount = teams.filter((t) => joinedTeamIds.has(t.team?.id)).length;
  const allJoined = totalTeams > 0 && joinedCount === totalTeams;

  const goLive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("go_live_auction", { _auction_id: auctionId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Auction is live!");
      qc.invalidateQueries({ queryKey: ["auction", auctionId] });
      qc.invalidateQueries({ queryKey: ["auction-players", auctionId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-xl border border-primary/40 bg-gradient-to-br from-primary/10 to-card p-5 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-primary font-bold flex items-center gap-1">
            <Radio className="h-3 w-3 animate-pulse" /> Lobby
          </p>
          <h2 className="text-lg font-bold">Waiting room</h2>
          <p className="text-xs text-muted-foreground">
            {joinedCount} of {totalTeams} team managers joined
          </p>
        </div>
        {myTeamIds.length > 0 && (
          <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-bold text-primary">
            You're in
          </span>
        )}
      </div>

      {nextPlayerQ.data ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex items-center gap-4">
          <div className="h-14 w-14 rounded-lg bg-muted overflow-hidden flex-shrink-1 flex items-center justify-center text-lg font-bold text-muted-foreground">
            {nextPlayerQ.data.photo
              ? <img src={nextPlayerQ.data.photo} alt="" className="h-full w-full object-cover" />
              : (nextPlayerQ.data.name ?? "?")[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-primary font-bold">Up next</p>
            <p className="text-base font-bold truncate">
              {nextPlayerQ.data.name}
            </p>
            <p className="text-xs text-muted-foreground capitalize">
              {nextPlayerQ.data.role?.replace(/_/g, " ")}
              {nextPlayerQ.data.batting_style ? ` · ${nextPlayerQ.data.batting_style}` : ""}
            </p>
          </div>
          <ChevronsRight className="h-5 w-5 text-primary flex-shrink-0" />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
          No upcoming players — auction is ready to complete.
        </div>
      )}

      <TeamsTabs auctionId={auctionId} teams={teams} joinedTeamIds={joinedTeamIds} />

      {isAdmin && (
        <div className="rounded-lg border border-border bg-background/60 p-3 flex items-center gap-3">
          <Timer className="h-4 w-4 text-muted-foreground" />
          <label className="text-xs font-medium text-muted-foreground">Round timer</label>
          <input
            type="number"
            min={3}
            max={300}
            value={roundSecs}
            onChange={(e) => setRoundSecs(Math.max(3, Math.min(300, parseInt(e.target.value) || 0)))}
            className="w-20 rounded border border-border bg-background px-2 py-1 text-sm"
          />
          <span className="text-xs text-muted-foreground">seconds</span>
          <Button
            size="sm"
            variant="outline"
            disabled={saveRoundSecs.isPending || roundSecs === auction.round_closure_seconds}
            onClick={() => saveRoundSecs.mutate(roundSecs)}
          >
            Save
          </Button>
        </div>
      )}

      {isAdmin && (
        <div className="space-y-2">
          {!allJoined && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{totalTeams - joinedCount} team manager{totalTeams - joinedCount === 1 ? "" : "s"} haven't joined yet. You can still start, but they'll miss the opening bids.</span>
            </div>
          )}
          {allJoined ? (
            <Button className="w-full h-12 text-base font-bold" onClick={() => goLive.mutate()} disabled={goLive.isPending}>
              <Play className="h-4 w-4 mr-2" /> Start bidding
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button className="w-full h-12 text-base font-bold" variant="outline" disabled={goLive.isPending}>
                  <Play className="h-4 w-4 mr-2" /> Start bidding anyway
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Start without everyone?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {totalTeams - joinedCount} team manager{totalTeams - joinedCount === 1 ? " hasn't" : "s haven't"} joined the lobby yet. They can still join after bidding starts, but may miss the first player.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Wait</AlertDialogCancel>
                  <AlertDialogAction onClick={() => goLive.mutate()}>Start anyway</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}

      {!isAdmin && myTeamIds.length === 0 && (
        <p className="text-xs text-muted-foreground text-center">You're spectating — only team managers count toward the join check.</p>
      )}
    </div>
  );
}

function LiveRoom({
  auctionId, auction, currentAp, lastFinalizedAp, teams, isAdmin, userId,
}: {
  auctionId: string;
  auction: any;
  currentAp: any;
  lastFinalizedAp: any;
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
  const isPaused = currentAp?.paused_remaining_seconds != null;
  const remaining = isPaused
    ? (currentAp?.paused_remaining_seconds as number)
    : currentAp?.round_ends_at
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

  const finalize = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("finalize_current", { _auction_id: auctionId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auction", auctionId] });
      qc.invalidateQueries({ queryKey: ["auction-players", auctionId] });
      qc.invalidateQueries({ queryKey: ["auction-teams", auctionId] });
    },
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

  const pauseRound = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("pause_round", { _auction_id: auctionId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auction-players", auctionId] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const resumeRound = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("resume_round", { _auction_id: auctionId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auction-players", auctionId] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const resetRound = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("reset_round", { _auction_id: auctionId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auction-players", auctionId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!currentAp) {
    return (
      <IntermissionRoom
        auctionId={auctionId}
        lastFinalizedAp={lastFinalizedAp}
        isAdmin={isAdmin}
        onNext={() => next.mutate()}
        nextPending={next.isPending}
      />
    );
  }

  // (legacy intermission removed)

  const p = currentAp.player;
  const leadingTeam = highBid ? teams.find((t) => t.team?.id === highBid.team?.id) : null;
  const expired = !isPaused && remaining != null && remaining <= 0;
  const bigTimer = !isPaused && remaining != null && remaining <= 5;

  const selectedAt = selectedTeam ? myTeams.find((t) => t.team?.id === selectedTeam) : null;
  const minPlayers = (auction.min_players_per_team as number) ?? 0;
  const maxPlayers = (auction.max_players_per_team as number) ?? Infinity;
  const baseline = auction.baseline_price as number;
  const atMaxCap = !!selectedAt && selectedAt.players_bought >= maxPlayers;
  const nextN = selectedAt ? selectedAt.players_bought + 1 : 1;
  const reserveNeeded = Math.max(0, minPlayers - nextN) * baseline;
  const wouldBreakReserve = !!selectedAt && (selectedAt.budget_remaining - nextAmount) < reserveNeeded;
  const bidBlocked = atMaxCap || wouldBreakReserve;
  const blockedReason = atMaxCap
    ? `Squad full (${maxPlayers} players)`
    : wouldBreakReserve
      ? `Reserve ${reserveNeeded.toLocaleString()} for ${Math.max(0, minPlayers - nextN)} more`
      : null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/40 bg-gradient-to-br from-primary/15 to-card p-5">
        <div className="flex flex-row items-start gap-4">
          <div className="h-32 w-32 sm:h-48 sm:w-48 rounded-xl bg-muted overflow-hidden flex-shrink-0 aspect-square">
            {p?.photo
              ? <img src={p.photo} alt="" className="block h-full w-full object-cover" />
              : <div className="h-full w-full flex items-center justify-center text-5xl font-bold text-muted-foreground">{(p?.name ?? "?")[0]}</div>}
          </div>
          <div className="flex-1 min-w-0 w-full">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-widest text-primary font-bold">On the block</p>
                <h2 className="text-2xl sm:text-3xl font-bold truncate">{p?.name}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  <span className="capitalize">{p?.role?.replace(/_/g, " ") ?? "—"}</span>
                  {p?.batting_style ? <> · {p.batting_style}</> : null}
                  {p?.bowling_style ? <> · {p.bowling_style}</> : null}
                </p>
              </div>
              {/* Timer slot — fixed size so the big-timer state doesn't reflow layout */}
              <div className="relative w-20 h-16 flex-shrink-0">
                {remaining != null && (
                  <div
                    className={`absolute right-0 top-0 font-mono font-bold tabular-nums flex items-center justify-end gap-1 transition-all duration-200 origin-top-right ${
                      bigTimer
                        ? (expired ? "text-muted-foreground" : "text-destructive animate-pulse")
                        : "text-foreground"
                    }`}
                    style={bigTimer ? { fontSize: "5rem", lineHeight: 1 } : { fontSize: "1.25rem", lineHeight: 1.2 }}
                  >
                    {!bigTimer && (isPaused ? <Pause className="h-4 w-4" /> : <Timer className="h-4 w-4" />)}
                    <span>{remaining}s</span>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 sm:grid-cols-5 gap-2">
              {[
                { label: "Matches", value: p?.matches ?? 0 },
                { label: "Runs", value: p?.runs ?? 0 },
                { label: "Wickets", value: p?.wickets ?? 0 },
                { label: "Average", value: p?.batting_avg ?? 0 },
                { label: "Strike Rate", value: p?.batting_sr ?? 0 },
              ].map((s) => (
                <div key={s.label} className="rounded-lg bg-background/60 p-2 text-center">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.label}</p>
                  <p className="text-xl sm:text-2xl font-bold tabular-nums">{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sticky bid panel — pinned to bottom of viewport so users never have to scroll for bid actions */}
      <div className="sticky bottom-2 z-30 space-y-2">
        <div className="rounded-xl border border-primary/40 bg-card/95 backdrop-blur shadow-lg p-3 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-background/60 p-2 min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Current bid</p>
            <p className="text-xl sm:text-2xl font-extrabold truncate leading-tight">{highBid ? highBid.team?.name : "No bids yet"}</p>
            <p className="text-xl sm:text-2xl font-extrabold tabular-nums leading-tight">{highBid ? highBid.amount.toLocaleString() : (0).toLocaleString()}</p>
          </div>
          <div className="rounded-lg bg-background/60 p-2 min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Next bid</p>
            <p className="text-xl sm:text-2xl font-extrabold tabular-nums leading-tight">{nextAmount.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">+{(nextAmount - (highBid?.amount ?? auction.baseline_price)).toLocaleString()}</p>
          </div>
        </div>

        {myTeams.length > 0 && (
          <div className="rounded-xl border border-border bg-card/95 backdrop-blur shadow-lg p-3 space-y-2">
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
              disabled={placeBid.isPending || !selectedTeam || expired || isPaused || (leadingTeam?.team?.id === selectedTeam) || bidBlocked}
              title={blockedReason ?? undefined}
            >
              <Gavel className="h-4 w-4 mr-2" />
              {isPaused
                ? "Paused"
                : expired
                  ? "Round closed"
                  : leadingTeam?.team?.id === selectedTeam
                  ? "You're leading"
                  : blockedReason
                    ? blockedReason
                    : `Bid ${nextAmount.toLocaleString()}`}
            </Button>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {isPaused ? (
              <Button variant="outline" onClick={() => resumeRound.mutate()} disabled={resumeRound.isPending}>
                <Play className="h-4 w-4 mr-1" /> Resume timer
              </Button>
            ) : (
              <Button variant="outline" onClick={() => pauseRound.mutate()} disabled={pauseRound.isPending}>
                <Pause className="h-4 w-4 mr-1" /> Pause timer
              </Button>
            )}
            <Button variant="outline" onClick={() => resetRound.mutate()} disabled={resetRound.isPending}>
              <RotateCcw className="h-4 w-4 mr-1" /> Reset timer
            </Button>
          </div>
          <Button className="w-full" onClick={() => finalize.mutate()} disabled={finalize.isPending}>
            <ChevronsRight className="h-4 w-4 mr-1" />
            {highBid ? `Sell to ${highBid.team?.name} for ${highBid.amount.toLocaleString()} · Next` : "Mark unsold · Next"}
          </Button>
        </div>
      )}
    </div>
  );
}

function PreviousBidHistory({ auctionPlayerId, player }: { auctionPlayerId: string; player: any }) {
  const bidsQ = useQuery({
    queryKey: ["bids-history", auctionPlayerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bids")
        .select("id,amount,created_at,team:teams(id,name)")
        .eq("auction_player_id", auctionPlayerId)
        .order("amount", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const name = player?.name ?? "";
  return (
    <section>
      <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-3">
        Previous bid history · {name}
      </h2>
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {bidsQ.data?.length ? bidsQ.data.map((b) => (
          <div key={b.id} className="px-4 py-2 flex items-center justify-between text-sm">
            <span className="font-medium">{b.team?.name}</span>
            <span className="font-mono">{b.amount.toLocaleString()}</span>
          </div>
        )) : <p className="px-4 py-3 text-xs text-muted-foreground">No bids were placed.</p>}
      </div>
    </section>
  );
}

function IntermissionRoom({
  auctionId, isAdmin, onNext, nextPending,
}: {
  auctionId: string;
  lastFinalizedAp?: any;
  isAdmin: boolean;
  onNext: () => void;
  nextPending: boolean;
}) {
  const nextPlayerQ = useQuery({
    queryKey: ["next-player", auctionId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_next_player", { _auction_id: auctionId });
      if (error) throw error;
      return (data && (data as any[]).length > 0) ? (data as any[])[0] : null;
    },
  });

  const p = nextPlayerQ.data;

  return (
    <div className="rounded-xl border border-primary/40 bg-gradient-to-br from-primary/15 to-card p-5 space-y-5">
      <div className="text-center">
        <p className="text-[10px] uppercase tracking-widest text-primary font-bold">Next player</p>
        {!p && <p className="mt-2 text-muted-foreground">No more players queued.</p>}
      </div>

      {p && (
        <div className="flex flex-col sm:flex-row items-start gap-5">
          <div className="h-48 w-48 sm:h-56 sm:w-56 rounded-xl bg-muted overflow-hidden flex-shrink-0 mx-auto sm:mx-0">
            {p.photo
              ? <img src={p.photo} alt="" className="h-full w-full object-cover" />
              : <div className="h-full w-full flex items-center justify-center text-5xl font-bold text-muted-foreground">{(p.name ?? "?")[0]}</div>}
          </div>
          <div className="flex-1 min-w-0 w-full">
            <h2 className="text-2xl sm:text-3xl font-bold truncate">{p.name}</h2>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="rounded-lg bg-background/60 p-2">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Role</p>
                <p className="text-base font-bold capitalize">{p.role?.replace(/_/g, " ") ?? "—"}</p>
              </div>
              <div className="rounded-lg bg-background/60 p-2">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Batting</p>
                <p className="text-base font-bold">{p.batting_style ?? "—"}</p>
              </div>
              <div className="rounded-lg bg-background/60 p-2">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Bowling</p>
                <p className="text-base font-bold">{p.bowling_style ?? "—"}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { label: "Matches", value: p.matches ?? 0 },
                { label: "Runs", value: p.runs ?? 0 },
                { label: "Wickets", value: p.wickets ?? 0 },
                { label: "Average", value: p.batting_avg ?? 0 },
                { label: "Strike Rate", value: p.batting_sr ?? 0 },
              ].map((s) => (
                <div key={s.label} className="rounded-lg bg-background/60 p-2 text-center">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.label}</p>
                  <p className="text-2xl font-bold tabular-nums">{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="text-center">
          <Button size="lg" onClick={onNext} disabled={nextPending || !p}>
            <ChevronsRight className="h-4 w-4 mr-1" /> Bring up next player
          </Button>
        </div>
      )}
    </div>
  );
}

function TeamsTabs({
  auctionId, teams, joinedTeamIds,
}: {
  auctionId: string;
  teams: any[];
  joinedTeamIds?: Set<string>;
}) {
  const [activeId, setActiveId] = useState<string | null>(teams[0]?.team?.id ?? null);
  useEffect(() => {
    if (!activeId && teams[0]) setActiveId(teams[0].team.id);
  }, [teams, activeId]);

  const rosterQ = useQuery({
    queryKey: ["auction-team-roster", auctionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auction_players")
        .select("sold_team_id,sold_price,player:players(name,role,photo)")
        .eq("auction_id", auctionId)
        .eq("status", "sold");
      if (error) throw error;
      return data;
    },
  });

  const rosterByTeam = useMemo(() => {
    const map = new Map<string, Array<any>>();
    for (const r of rosterQ.data ?? []) {
      if (!r.sold_team_id) continue;
      const arr = map.get(r.sold_team_id) ?? [];
      arr.push(r);
      map.set(r.sold_team_id, arr);
    }
    return map;
  }, [rosterQ.data]);

  const active = teams.find((t) => t.team?.id === activeId) ?? teams[0];
  if (!active) return <p className="text-xs text-muted-foreground">No teams.</p>;
  const activeRoster = rosterByTeam.get(active.team?.id) ?? [];

  return (
    <div>
      {/* Browser-style tab strip */}
      <div className="flex items-end gap-1 overflow-x-auto -mb-px pb-0 scrollbar-thin">
        {teams.map((at) => {
          const isActive = at.team?.id === activeId;
          const joined = joinedTeamIds?.has(at.team?.id);
          return (
            <button
              key={at.id}
              type="button"
              onClick={() => setActiveId(at.team.id)}
              className={`group relative flex items-center gap-2 px-3 py-2 rounded-t-lg border border-b-0 text-xs font-medium whitespace-nowrap transition ${
                isActive
                  ? "bg-card border-border text-foreground z-10"
                  : "bg-muted/50 border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <div
                className="h-5 w-5 rounded bg-muted flex items-center justify-center text-[9px] font-bold overflow-hidden flex-shrink-0"
                style={{ background: at.team?.primary_color ?? undefined }}
              >
                {at.team?.logo_url
                  ? <img src={at.team.logo_url} alt="" className="h-full w-full object-cover" />
                  : (at.team?.name as string)?.slice(0, 2).toUpperCase()}
              </div>
              <span className="max-w-[10rem] truncate">{at.team?.name}</span>
              {joinedTeamIds && (
                joined
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  : <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />
              )}
            </button>
          );
        })}
      </div>

      {/* Active tab content panel */}
      <div className="rounded-b-xl rounded-tr-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-xs font-bold overflow-hidden flex-shrink-0"
            style={{ background: active.team?.primary_color ?? undefined }}
          >
            {active.team?.logo_url
              ? <img src={active.team.logo_url} alt="" className="h-full w-full object-cover" />
              : (active.team?.name as string)?.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{active.team?.name}</p>
            <p className="text-xs text-muted-foreground">
              Budget {(active.budget_remaining ?? 0).toLocaleString()} · {active.players_bought ?? 0} bought
            </p>
          </div>
          <span className="text-[10px] font-semibold text-muted-foreground rounded-full bg-muted px-2 py-0.5">
            {activeRoster.length} {activeRoster.length === 1 ? "player" : "players"}
          </span>
        </div>

        {activeRoster.length === 0 ? (
          <p className="text-xs text-muted-foreground italic text-center py-4">No players yet</p>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-1.5">
            {activeRoster.map((r: any, i: number) => {
              const p = r.player;
              const name = p?.name ?? "";
              return (
                <li key={i} className="flex items-center gap-2 rounded-md bg-background/60 border border-border/50 px-2 py-1.5">
                  <div className="h-7 w-7 rounded-full bg-muted overflow-hidden flex-shrink-0 flex items-center justify-center text-[10px] font-bold">
                    {p?.photo
                      ? <img src={p.photo} alt="" className="h-full w-full object-cover" />
                      : name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{name}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{p?.role?.replace(/_/g, " ")}</p>
                  </div>
                  <span className="text-xs font-semibold tabular-nums">{(r.sold_price ?? 0).toLocaleString()}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function BidSlabLadder({
  baseline,
  rules,
}: {
  baseline: number;
  rules: Array<{ min: number; max: number | null; increment: number }>;
}) {
  if (!rules?.length) return null;
  const sorted = [...rules].sort((a, b) => a.min - b.min);
  // Boundaries: baseline, then each rule.max (last one is null = ∞)
  const stops: Array<{ value: number | null; label: string }> = [
    { value: baseline, label: baseline.toLocaleString() },
  ];
  sorted.forEach((r, i) => {
    if (r.max == null) {
      stops.push({ value: null, label: "∞" });
    } else {
      stops.push({ value: r.max, label: r.max.toLocaleString() });
    }
    // ensure increments align with segments; nothing to push here
    void i;
  });
  // Number of segments = stops.length - 1, which should equal sorted.length
  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Bid increments</p>
      <div className="flex items-stretch">
        {stops.map((stop, i) => {
          const isLast = i === stops.length - 1;
          const isOpen = stop.value == null;
          return (
            <div key={i} className={isLast ? "flex flex-col items-center" : "flex flex-1 flex-col"}>
              {/* increments row */}
              <div className="flex h-5 items-end">
                {!isLast && (
                  <div className="flex w-full justify-center">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-foreground">
                      +{sorted[i].increment.toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
              {/* rail row */}
              <div className="relative flex h-3 items-center">
                {isOpen ? (
                  <div className="flex h-3 w-3 items-center justify-center text-primary">▶</div>
                ) : (
                  <div className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
                )}
                {!isLast && <div className="h-[2px] flex-1 bg-border" />}
              </div>
              {/* labels row */}
              <div className={`mt-1 flex flex-col ${isLast ? "items-center" : "items-start"}`}>
                <span className="text-xs font-semibold tabular-nums">{stop.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}