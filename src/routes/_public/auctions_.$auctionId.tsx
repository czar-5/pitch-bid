import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Calendar, Coins, Gavel, Play, ChevronsRight, Trash2, Users, Timer, CheckCircle2, Circle, StopCircle, AlertTriangle, Radio, Pause, RotateCcw, Eraser, ExternalLink, Undo2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { roleLabel, playerMetaLine } from "@/lib/player-labels";
import { Button } from "@/components/ui/button";
import { SoldOverlay, type SoldCelebration } from "@/components/auction/SoldOverlay";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
// (Accordion replaced by browser-tab style TeamsTabs component below)

export const Route = createFileRoute("/_public/auctions_/$auctionId")({
  head: () => ({
    meta: [
      { title: "Live Auction | PitchBid" },
      { name: "description", content: "Follow live player bidding, team budgets, and auction results on PitchBid." },
      { property: "og:title", content: "Live Auction | PitchBid" },
      { property: "og:description", content: "Follow live player bidding, team budgets, and auction results on PitchBid." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
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
        .select("id,status,sold_price,sold_team_id,sold_at,is_captain,is_icon,round_ends_at,paused_remaining_seconds,player:players(id,name,role,malayali,photo,batting_style,bowling_style,matches,runs,wickets,batting_avg,batting_sr,bowling_economy,cric_heroes_link)")
        .eq("auction_id", auctionId)
        // Sorts the parent rows by the embedded player's name. The embed ALIAS goes in
        // the parentheses -- player, from player:players(...) above. Naming the table,
        // or using the foreignTable option, sorts rows *inside* an embedded list and is
        // silently ignored for a to-one embed: that is why this panel rendered unsorted.
        .order("player(name)", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const controllerQ = useQuery({
    queryKey: ["auction-controller", auctionId, user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      if (!user?.id) return false;
      const { data, error } = await supabase.rpc("is_auction_controller", {
        _auction_id: auctionId,
        _user_id: user.id,
      });
      if (error) throw error;
      return data === true;
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
      .on("postgres_changes", { event: "*", schema: "public", table: "bids" },
        () => {
          qc.invalidateQueries({ queryKey: ["live-bids", auctionId] });
          qc.invalidateQueries({ queryKey: ["bids-history"] });
        })
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

  // How many Non-Malayali players each team has already bought, keyed by team id.
  // Derived from the auction-players list rather than stored on auction_teams, so it
  // can never drift out of step with the sold rows the server enforces against.
  // Declared above the early returns below: hooks must run on every render.
  const nonMalayaliByTeam = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ap of playersQ.data ?? []) {
      const player = ap.player as { malayali?: string | null } | null;
      if (ap.status !== "sold" || !ap.sold_team_id) continue;
      if (player?.malayali !== "non_malayali") continue;
      counts[ap.sold_team_id] = (counts[ap.sold_team_id] ?? 0) + 1;
    }
    return counts;
  }, [playersQ.data]);

  // Player id -> Malayali classification. get_next_player() does not return that column,
  // so the "next player" cards look it up here from the list we already load. Also above
  // the early returns: hooks must run on every render.
  const malayaliByPlayer = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const ap of playersQ.data ?? []) {
      const player = ap.player as { id?: string; malayali?: string | null } | null;
      if (player?.id) m[player.id] = player.malayali ?? null;
    }
    return m;
  }, [playersQ.data]);

  // Team id -> team row, for anywhere a sold player has to be shown next to its buyer.
  // Above the early returns with the other memos, since the sale overlay below needs it.
  const teamById = useMemo(
    () => new Map<string, any>((teamsQ.data ?? []).map((t: any) => [t.team?.id, t.team])),
    [teamsQ.data],
  );

  // The sale celebration.
  //
  // Nothing in the data says a sale *just* happened. last_finalized_player_id is a stored
  // column, so someone who reloads the page during the intermission reads exactly what
  // someone who watched the hammer fall reads -- replaying the overlay for them would be
  // wrong. What separates the two is having seen the previous value. seenFinalizedId
  // starts undefined, takes its baseline silently on the first render that has data, and
  // only a change after that counts as a sale this browser witnessed. That test is exact
  // and needs no clock: comparing sold_at against Date.now() would swallow a real sale on
  // a device whose clock is off.
  const seenFinalizedId = useRef<string | null | undefined>(undefined);
  const [celebration, setCelebration] = useState<SoldCelebration | null>(null);

  useEffect(() => {
    const rows = playersQ.data;
    if (!auctionQ.data || !rows || !teamsQ.data) return;
    const finalizedId = auctionQ.data.last_finalized_player_id ?? null;

    if (seenFinalizedId.current === undefined) {
      seenFinalizedId.current = finalizedId;
      return;
    }
    if (finalizedId === seenFinalizedId.current) return;

    const ap = finalizedId ? rows.find((r) => r.id === finalizedId) : null;
    // The auction row and the player rows are separate queries that refetch
    // independently, so the new id -- and even the row it names -- can land a beat
    // before that row's status has caught up from "live" to "sold"/"unsold". Leave the
    // baseline alone and wait in both cases; this effect runs again when the row settles.
    if (finalizedId && (!ap || ap.status === "live")) return;
    seenFinalizedId.current = finalizedId;

    // An unsold finalize falls straight through to the intermission screen, as before.
    if (!ap || ap.status !== "sold" || !ap.sold_team_id) return;
    const team = teamById.get(ap.sold_team_id);
    setCelebration({
      id: ap.id,
      playerName: ap.player?.name ?? "",
      playerPhoto: ap.player?.photo ?? null,
      teamName: team?.name ?? "",
      teamLogo: team?.logo_url ?? null,
      teamColor: team?.primary_color ?? null,
      amount: ap.sold_price ?? 0,
    });
  }, [auctionQ.data, playersQ.data, teamsQ.data, teamById]);

  if (auctionQ.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!auctionQ.data) return <p className="text-muted-foreground">Auction not found.</p>;
  const a = auctionQ.data;

  const status = a.status as string;
  const isLive = status === "live";
  const isLobby = status === "lobby";
  const isOffline = String(a.method).toLowerCase() === "offline";
  const isController = isAdmin || controllerQ.data === true || (!!user?.id && a.auctioneer_user_id === user.id);
  const currentAp = playersQ.data?.find((p) => p.id === a.current_player_id) ?? null;
  const lastFinalizedAp = (a as { last_finalized_player_id?: string | null }).last_finalized_player_id
    ? playersQ.data?.find((p) => p.id === (a as { last_finalized_player_id?: string | null }).last_finalized_player_id) ?? null
    : null;
  // While a player is on the block during a live auction, hide the surrounding
  // chrome (banner, teams grid, player pool) so bidders focus on the round.
  const minimal = isLive && !!currentAp;

  return (
    <div className="space-y-6">
      {/* Top level, so it covers the live room, the intermission screen and the chrome
          alike -- the auctioneer sees the same announcement the room does. */}
      {celebration && <SoldOverlay sale={celebration} onDone={() => setCelebration(null)} />}

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
              <span className="rounded bg-muted px-2 py-0.5 font-semibold capitalize">{a.method}</span>
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
          malayaliByPlayer={malayaliByPlayer}
          teams={teamsQ.data ?? []}
          isAdmin={isAdmin}
          isController={isController}
          isOffline={isOffline}
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
          nonMalayaliByTeam={nonMalayaliByTeam}
          malayaliByPlayer={malayaliByPlayer}
          isAdmin={isAdmin}
          isController={isController}
          isOffline={isOffline}
          userId={user?.id ?? null}
        />
      )}

      {!minimal && (
      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-2">
          <Users className="h-4 w-4" /> Teams ({teamsQ.data?.length ?? 0})
        </h2>
        <TeamsTabs
          auctionId={auctionId}
          teams={teamsQ.data ?? []}
          quotaEnabled={a.non_malayali_rule_enabled === true}
        />
      </section>
      )}

      {!minimal && (
      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-3">
          Player pool ({playersQ.data?.length ?? 0})
        </h2>
        {(() => {
          const all = playersQ.data ?? [];
          // Three sections, three rules. Available inherits the query's alphabetical
          // order; the other two sort here, since one query carries one ORDER BY. Both
          // sort the filter() result, not all -- sort() mutates, and all is the cache.
          // Captains and icons are inserted pre-sold at creation and never bid on, so
          // they get their own section: Sold is the wrong word for them, and mixing them
          // into real sales would scatter each team's captain away from its icons. Sold
          // itself goes in the order the hammer fell, by the sold_at that
          // sell_current/finalize_current now stamps; name only breaks an exact tie.
          const preAssigned = all.filter((ap) => ap.is_captain || ap.is_icon).sort((a, b) => (teamById.get(a.sold_team_id ?? "")?.name ?? "").localeCompare(teamById.get(b.sold_team_id ?? "")?.name ?? "") || Number(b.is_captain) - Number(a.is_captain) || (a.player?.name ?? "").localeCompare(b.player?.name ?? ""));
          const sold = all.filter((ap) => ap.status === "sold" && !ap.is_captain && !ap.is_icon).sort((a, b) => (a.sold_at ?? "").localeCompare(b.sold_at ?? "") || (a.player?.name ?? "").localeCompare(b.player?.name ?? ""));
          const unsold = all.filter((ap) => ap.status !== "sold");
          const renderRow = (ap: any) => {
            const team = ap.sold_team_id ? teamById.get(ap.sold_team_id) : null;
            return (
              <div key={ap.id} className="p-3 flex items-center gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{ap.player?.name}</p>
                  <p className="text-xs text-muted-foreground">{roleLabel(ap.player?.role)}{a.non_malayali_rule_enabled === true && ap.player?.malayali === "non_malayali" && <span className="font-semibold text-amber-600 dark:text-amber-400">Non-Malayali</span>}</p>
                </div>
                {ap.is_captain ? (
                  <span className="text-xs font-semibold text-primary">Captain</span>
                ) : ap.is_icon ? (
                  <span className="text-xs font-semibold text-primary">Icon Player</span>
                ) : ap.sold_price != null ? (
                  <span className="text-xs text-muted-foreground">{ap.sold_price.toLocaleString()}</span>
                ) : null}
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
                {!ap.is_captain && !ap.is_icon && <span className="text-xs rounded-full bg-muted px-2 py-0.5 capitalize">{ap.status}</span>}
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
              {preAssigned.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">Captains &amp; Icons ({preAssigned.length})</p>
                <div className="rounded-xl border border-border bg-card divide-y divide-border">{preAssigned.map(renderRow)}</div>
              </div>
              )}
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

/**
 * Called out on the "next player" cards so the room can see a quota-relevant player
 * coming before bidding opens. Only rendered when the auction has the rule switched on;
 * Malayali players deliberately show nothing.
 */
function MalayaliFlag({ enabled, classification }: { enabled: boolean; classification?: string | null }) {
  if (!enabled) return null;
  if (classification == null) {
    // A blank classification silently disables every bid button, so say why.
    return (
      <div className="rounded-lg border-2 border-destructive bg-destructive/15 px-4 py-3 text-center">
        <p className="text-sm font-bold uppercase tracking-widest text-destructive">
          Classification not set — bidding blocked
        </p>
      </div>
    );
  }
  if (classification !== "non_malayali") return null;
  return (
    <div className="rounded-lg border-2 border-amber-500 bg-amber-500/15 px-4 py-3 text-center">
      <p className="text-sm font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400">
        Non-Malayali player
      </p>
    </div>
  );
}

function LobbyRoom({
  auctionId, auction, malayaliByPlayer, teams, isAdmin, isController, isOffline, userId,
}: {
  auctionId: string;
  auction: any;
  malayaliByPlayer: Record<string, string | null>;
  teams: any[];
  isAdmin: boolean;
  isController: boolean;
  isOffline: boolean;
  userId: string | null;
}) {
  const qc = useQueryClient();
  const offlineLobby = isOffline || String(auction.method).toLowerCase() === "offline";

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
    enabled: !!userId && !offlineLobby,
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
    if (!userId || offlineLobby) {
      setJoinedTeamIds(new Set());
      return;
    }
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
  }, [auctionId, userId, isAdmin, offlineLobby, myTeamIds.join(",")]);

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
        </div>
        {myTeamIds.length > 0 && (
          <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-bold text-primary">
            You're in
          </span>
        )}
      </div>

      {nextPlayerQ.data ? (
        <div className="rounded-xl border border-primary/40 bg-gradient-to-br from-primary/15 to-card p-5 space-y-4">
          <p className="text-[10px] uppercase tracking-widest text-primary font-bold text-center">Up next</p>
          <MalayaliFlag
            enabled={auction.non_malayali_rule_enabled === true}
            classification={malayaliByPlayer[nextPlayerQ.data.player_id]}
          />
          <div className="flex flex-row items-start gap-4">
            <div className="h-32 w-32 sm:h-48 sm:w-48 rounded-xl bg-muted overflow-hidden flex-shrink-0">
              {nextPlayerQ.data.photo
                ? <img src={nextPlayerQ.data.photo} alt="" className="h-full w-full object-cover" />
                : <div className="h-full w-full flex items-center justify-center text-5xl font-bold text-muted-foreground">{(nextPlayerQ.data.name ?? "?")[0]}</div>}
            </div>
            <div className="flex-1 min-w-0 w-full">
              <h2 className="text-xl sm:text-3xl font-bold truncate">{nextPlayerQ.data.name}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {playerMetaLine(
                  roleLabel(nextPlayerQ.data.role),
                  nextPlayerQ.data.batting_style,
                  nextPlayerQ.data.bowling_style,
                )}
              </p>
              {nextPlayerQ.data.cric_heroes_link && (
                <a
                  href={nextPlayerQ.data.cric_heroes_link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  CricHeroes <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {[
              { label: "Matches", value: nextPlayerQ.data.matches ?? 0 },
              { label: "Runs", value: nextPlayerQ.data.runs ?? 0 },
              { label: "Average", value: (nextPlayerQ.data.batting_avg ?? 0).toFixed(0) },
              { label: "Strike Rate", value: (nextPlayerQ.data.batting_sr ?? 0).toFixed(0) },
              { label: "Wickets", value: nextPlayerQ.data.wickets ?? 0 },
              { label: "Economy", value: (nextPlayerQ.data.bowling_economy ?? 1).toFixed(1) },
            ].map((s) => (
              <div key={s.label} className="rounded-lg bg-background/60 p-2 text-center">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.label}</p>
                <p className="text-xl sm:text-2xl font-bold tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/40 p-4 text-center text-sm text-muted-foreground">
          No upcoming players — auction is ready to complete.
        </div>
      )}

      {!offlineLobby && <div className="rounded-lg border border-border bg-background/60 p-3">
        <p className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
          Team managers joined — {joinedCount} / {totalTeams}
        </p>
        <div className="flex flex-wrap gap-2">
          {teams.map((at) => {
            const joined = joinedTeamIds.has(at.team?.id);
            return (
              <div
                key={at.id}
                className={`flex items-center gap-2 rounded-full border px-2 py-1 text-xs ${
                  joined ? "border-primary/40 bg-primary/10" : "border-border bg-muted/50"
                }`}
                title={joined ? `${at.team?.name} — joined` : `${at.team?.name} — waiting`}
              >
                <div
                  className="h-5 w-5 rounded bg-muted flex items-center justify-center text-[9px] font-bold overflow-hidden flex-shrink-0"
                  style={{ background: at.team?.primary_color ?? undefined }}
                >
                  {at.team?.logo_url
                    ? <img src={at.team.logo_url} alt="" className="h-full w-full object-cover" />
                    : (at.team?.name as string)?.slice(0, 2).toUpperCase()}
                </div>
                <span className="max-w-[10rem] truncate font-medium">{at.team?.name}</span>
                {joined
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  : <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />}
              </div>
            );
          })}
        </div>
      </div>}

      {isAdmin && !offlineLobby && (
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

      {isController && (
        <div className="space-y-2">
          <Button className="w-full h-12 text-base font-bold" onClick={() => goLive.mutate()} disabled={goLive.isPending}>
            <Play className="h-4 w-4 mr-2" /> Start bidding
          </Button>
          {!offlineLobby && <p className="text-[11px] text-muted-foreground text-center">
            {joinedCount} of {totalTeams} team manager{totalTeams === 1 ? "" : "s"} joined — others can still join after bidding starts.
          </p>}
        </div>
      )}

      {!offlineLobby && !isAdmin && myTeamIds.length === 0 && (
        <p className="text-xs text-muted-foreground text-center">You're spectating — only team managers count toward the join check.</p>
      )}
    </div>
  );
}

function LiveRoom({
  auctionId, auction, currentAp, lastFinalizedAp, teams, nonMalayaliByTeam, malayaliByPlayer,
  isAdmin, isController, isOffline, userId,
}: {
  auctionId: string;
  auction: any;
  currentAp: any;
  lastFinalizedAp: any;
  teams: any[];
  nonMalayaliByTeam: Record<string, number>;
  malayaliByPlayer: Record<string, string | null>;
  isAdmin: boolean;
  isController: boolean;
  isOffline: boolean;
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
    if (isOffline) return [];
    const mine = new Set(membershipsQ.data ?? []);
    return teams.filter((t) => mine.has(t.team?.id));
  }, [teams, membershipsQ.data, isOffline]);

  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedTeam && myTeams[0]) setSelectedTeam(myTeams[0].team.id);
  }, [myTeams, selectedTeam]);

  // Lock the bid button after a successful click until the new high bid arrives
  // (or the round changes / a new high bid arrives via realtime).
  const [lastSubmittedAmount, setLastSubmittedAmount] = useState<number | null>(null);

  // Set only when the server refuses a bid for being too soon -- see onBidError below.
  const [gapUntil, setGapUntil] = useState<number | null>(null);

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

  // Clear the post-click lock once the high bid catches up to (or exceeds)
  // what we submitted, or when the round/player changes.
  useEffect(() => {
    if (lastSubmittedAmount != null && (highBid?.amount ?? 0) >= lastSubmittedAmount) {
      setLastSubmittedAmount(null);
    }
  }, [highBid?.amount, lastSubmittedAmount]);
  useEffect(() => {
    setLastSubmittedAmount(null);
    setGapUntil(null);
  }, [currentAp?.id]);
  const awaitingBidEcho = lastSubmittedAmount != null && (highBid?.amount ?? 0) < lastSubmittedAmount;

  // Cooling-off period after the last bid. The database refuses a bid inside this
  // window (that is the rule that actually binds); this only makes the wait
  // visible, so a manager sees a countdown instead of tapping into an error.
  // It compares a server timestamp against the browser clock, exactly as the
  // round timer above already does, so a skewed clock shifts it slightly --
  // harmless, because the server decides.
  const bidGapSeconds = (auction.min_bid_gap_seconds as number) ?? 0;
  // gapUntil is folded in as a maximum, never a replacement: a refusal can only
  // extend the wait the high bid already implies, never cut it short.
  const gapMsLeft = Math.max(
    highBid?.created_at && bidGapSeconds > 0
      ? Math.max(0, new Date(highBid.created_at).getTime() + bidGapSeconds * 1000 - now)
      : 0,
    gapUntil != null ? Math.max(0, gapUntil - now) : 0,
  );
  const gapLocked = gapMsLeft > 0;
  const gapSecondsLeft = Math.ceil(gapMsLeft / 1000);

  // The countdown above can only start once this browser has heard about the rival's
  // bid, which takes a moment to arrive. A tap inside that moment sees a live button
  // and is refused by the server -- the simultaneous tap the rule exists to stop.
  // Start the same countdown from the refusal, so the manager gets the timer they
  // would have seen, rather than the database's own wording and a button still lit.
  const onBidError = (e: Error) => {
    if (e.message.includes("bids must be")) {
      setGapUntil(Date.now() + bidGapSeconds * 1000);
      toast.error(`Another team just bid. Wait ${bidGapSeconds}s.`);
      return;
    }
    toast.error(e.message);
  };

  const placeBid = useMutation({
    mutationFn: async () => {
      if (!currentAp || !selectedTeam) throw new Error("Pick a team first");
      const { error } = await supabase.rpc("place_bid", { _auction_player_id: currentAp.id, _team_id: selectedTeam });
      if (error) throw error;
    },
    onMutate: () => {
      setLastSubmittedAmount(nextAmount);
    },
    onError: (e: Error) => {
      setLastSubmittedAmount(null);
      onBidError(e);
    },
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
  const resetBid = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("reset_bid", { _auction_id: auctionId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auction", auctionId] });
      qc.invalidateQueries({ queryKey: ["auction-players", auctionId] });
      qc.invalidateQueries({ queryKey: ["live-bids", auctionId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const offlineBid = useMutation({
    mutationFn: async (teamId: string) => {
      if (!currentAp) throw new Error("No player is live");
      const { error } = await supabase.rpc("place_bid_for_team", { _auction_player_id: currentAp.id, _team_id: teamId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["live-bids", auctionId] }),
    onError: onBidError,
  });
  const undoBid = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("undo_last_bid", { _auction_id: auctionId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["live-bids", auctionId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!currentAp) {
    return (
      <IntermissionRoom
        auctionId={auctionId}
        lastFinalizedAp={lastFinalizedAp}
        quotaEnabled={auction.non_malayali_rule_enabled === true}
        malayaliByPlayer={malayaliByPlayer}
        isController={isController}
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
  const quotaEnabled = auction.non_malayali_rule_enabled === true;
  const quota = (auction.non_malayali_players_per_team as number) ?? 0;
  const nonMalayaliCount = selectedTeam ? (nonMalayaliByTeam[selectedTeam] ?? 0) : 0;
  const remainingNonMalayali = Math.max(0, quota - nonMalayaliCount);
  const slotsAfterBid = selectedAt ? maxPlayers - (selectedAt.players_bought + 1) : Infinity;
  const unclassifiedBlocked = quotaEnabled && p?.malayali == null;
  const quotaCeilingBlocked = quotaEnabled && p?.malayali === "non_malayali" && remainingNonMalayali === 0;
  const quotaReserveBlocked = quotaEnabled && p?.malayali !== "non_malayali" && slotsAfterBid < remainingNonMalayali;
  const bidBlocked = atMaxCap || wouldBreakReserve || unclassifiedBlocked || quotaCeilingBlocked || quotaReserveBlocked || gapLocked;
  const blockedReason = atMaxCap
    ? `Squad full (${maxPlayers} players)`
    : unclassifiedBlocked
      ? "Player classification is blank"
      : quotaCeilingBlocked
        ? `Non-Malayali limit reached (${quota})`
        : quotaReserveBlocked
          ? `Must fill ${remainingNonMalayali} Non-Malayali place${remainingNonMalayali === 1 ? "" : "s"}`
          : wouldBreakReserve
      ? `Reserve ${reserveNeeded.toLocaleString()} for ${Math.max(0, minPlayers - nextN)} more`
      : null;
  // Takes precedence over the standing reasons above: the gap clears in seconds,
  // so it is the one the manager can act on.
  const bidReason = gapLocked ? `Another team just bid — ${gapSecondsLeft}s` : blockedReason;

  return (
    <div className="space-y-4">
      {!(isOffline && isController) && (
      <div className="rounded-xl border border-primary/40 bg-gradient-to-br from-primary/15 to-card p-5 space-y-4">
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
                  {playerMetaLine(roleLabel(p?.role), p?.batting_style, p?.bowling_style)}
                </p>
                {p?.cric_heroes_link && (
                  <a
                    href={p.cric_heroes_link}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    CricHeroes <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {/* Timer is rendered next to the bid button below so all decision info is in one place */}
            </div>
          </div>
        </div>
        {/* Everyone except the offline controller watches this card during a round, so
            the flag has to live here too — the controller's own copy of this information
            is the reason text on the team bid buttons, which nobody else can see. */}
        <MalayaliFlag enabled={quotaEnabled} classification={p?.malayali} />
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { label: "Matches", value: p?.matches ?? 0 },
            { label: "Runs", value: p?.runs ?? 0 },
            { label: "Average", value: (p?.batting_avg ?? 0).toFixed(0) },
            { label: "Strike Rate", value: (p?.batting_sr ?? 0).toFixed(0) },
            { label: "Wickets", value: p?.wickets ?? 0 },
            { label: "Economy", value: (p?.bowling_economy ?? 1).toFixed(1) },
          ].map((s) => (
            <div key={s.label} className="rounded-lg bg-background/60 p-2 text-center">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.label}</p>
              <p className="text-xl sm:text-2xl font-bold tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Sticky bid panel — pinned to bottom of viewport so users never have to scroll for bid actions */}
        <div className="sticky bottom-2 z-30 space-y-2">
        <div className={`rounded-xl border border-primary/40 bg-card/95 backdrop-blur shadow-lg p-3 grid gap-3 ${myTeams.length === 0 ? (isOffline ? "grid-cols-2" : "grid-cols-3") : "grid-cols-1"}`}>
          <div className="rounded-lg bg-background/60 p-2 min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Current bid</p>
            <p className="text-base sm:text-xl font-extrabold break-words leading-tight line-clamp-2">{highBid ? highBid.team?.name : "No bids yet"}</p>
            <p className="text-xl sm:text-2xl font-extrabold tabular-nums leading-tight">{highBid ? highBid.amount.toLocaleString() : (0).toLocaleString()}</p>
          </div>
          {myTeams.length === 0 && (
            <>
              <div className="rounded-lg bg-background/60 p-2 min-w-0">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Next bid</p>
                <p className="text-xl sm:text-2xl font-extrabold tabular-nums leading-tight">{nextAmount.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">+{(nextAmount - (highBid?.amount ?? auction.baseline_price)).toLocaleString()}</p>
              </div>
              {!isOffline && remaining != null && (
                <div className={`rounded-lg bg-background/60 p-2 min-w-1 ${bigTimer ? (expired ? "" : "animate-pulse") : ""}`}>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Time left</p>
                  <p className={`text-xl sm:text-2xl font-extrabold tabular-nums leading-tight ${bigTimer && !expired ? "text-destructive" : ""}`}>{remaining}s</p>
                  <p className="text-xs text-muted-foreground">{isPaused ? "Paused" : expired ? "Closed" : "Remaining"}</p>
                </div>
              )}
            </>
          )}
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
            <div className="flex items-stretch gap-2">
              <Button
                className="flex-1 h-14 text-base font-bold"
                onClick={() => placeBid.mutate()}
                disabled={placeBid.isPending || awaitingBidEcho || !selectedTeam || expired || isPaused || (leadingTeam?.team?.id === selectedTeam) || bidBlocked}
                title={bidReason ?? undefined}
              >
                <Gavel className="h-4 w-4 mr-2" />
                {isPaused
                  ? "Paused"
                  : expired
                    ? "Round closed"
                    : leadingTeam?.team?.id === selectedTeam
                      ? "You're leading"
                      : placeBid.isPending || awaitingBidEcho
                        ? "Bidding…"
                        : bidReason
                          ? bidReason
                          : `Bid ${nextAmount.toLocaleString()}`}
              </Button>
              {remaining != null && (
                <div
                  className={`h-14 min-w-16 px-3 rounded-md border flex items-center justify-center gap-1 font-mono font-bold tabular-nums ${
                    bigTimer
                      ? (expired ? "border-border bg-muted text-muted-foreground" : "border-destructive bg-destructive/15 text-destructive animate-pulse")
                      : "border-border bg-background text-foreground"
                  }`}
                  style={{ fontSize: bigTimer ? "2rem" : "1.25rem", lineHeight: 1 }}
                  aria-label={`${remaining} seconds remaining`}
                >
                  {!bigTimer && (isPaused ? <Pause className="h-4 w-4" /> : <Timer className="h-4 w-4" />)}
                  <span>{remaining}s</span>
                </div>
              )}
            </div>
          </div>
        )}
        {isOffline && isController && (
          <div className="rounded-xl border border-primary/40 bg-card/95 shadow-lg p-3 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {teams.map((at) => {
                const teamId = at.team?.id as string;
                const playersAfterBid = at.players_bought + 1;
                const reserve = Math.max(0, minPlayers - playersAfterBid) * baseline;
                const alreadyLeading = highBid?.team?.id === teamId;
                const full = at.players_bought >= maxPlayers;
                const short = at.budget_remaining < nextAmount;
                const reserveBlocked = at.budget_remaining - nextAmount < reserve;
                const teamNonMalayali = nonMalayaliByTeam[at.team?.id] ?? 0;
                const teamRemaining = Math.max(0, quota - teamNonMalayali);
                const teamSlotsAfter = maxPlayers - playersAfterBid;
                const classificationBlocked = quotaEnabled && p?.malayali == null;
                const ceilingBlocked = quotaEnabled && p?.malayali === "non_malayali" && teamRemaining === 0;
                const placesBlocked = quotaEnabled && p?.malayali !== "non_malayali" && teamSlotsAfter < teamRemaining;
                const disabled = alreadyLeading || full || short || reserveBlocked || classificationBlocked || ceilingBlocked || placesBlocked || gapLocked || offlineBid.isPending;
                // "Leading" first: that team is blocked until someone outbids it, so the
                // gap countdown would only flash a wait that never actually applies to it.
                const reason = alreadyLeading ? "Leading" : gapLocked ? `Wait ${gapSecondsLeft}s` : full ? "Squad full" : short ? "No budget" : classificationBlocked ? "Classification blank" : ceilingBlocked ? "Non-Malayali limit" : placesBlocked ? "Non-Malayali places due" : reserveBlocked ? "Reserve needed" : null;
                return (
                  <Button
                    key={at.id}
                    variant="outline"
                    className="h-16 justify-start gap-2 px-3"
                    disabled={disabled}
                    title={reason ?? `Bid ${nextAmount.toLocaleString()} for ${at.team?.name}`}
                    onClick={() => offlineBid.mutate(teamId)}
                  >
                    <span className="h-9 w-9 shrink-0 overflow-hidden rounded bg-muted flex items-center justify-center text-xs font-bold">
                      {at.team?.logo_url ? <img src={at.team.logo_url} alt="" className="h-full w-full object-cover" /> : at.team?.name?.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 text-left">
                      <span className="block whitespace-normal break-words leading-tight">{at.team?.name}</span>
                      {reason && <span className="block text-[10px] text-muted-foreground">{reason}</span>}
                    </span>
                  </Button>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" onClick={() => undoBid.mutate()} disabled={!highBid || undoBid.isPending}>
                <Undo2 className="h-4 w-4 mr-1" /> Undo
              </Button>
              <Button variant="outline" onClick={() => resetBid.mutate()} disabled={!highBid || resetBid.isPending}>
                <Eraser className="h-4 w-4 mr-1" /> Reset
              </Button>
              <Button onClick={() => finalize.mutate()} disabled={finalize.isPending}>
                <Gavel className="h-4 w-4 mr-1" /> {highBid ? "Sold" : "Unsold"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {isAdmin && !isOffline && (
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
          <Button variant="outline" className="w-full" onClick={() => resetBid.mutate()} disabled={resetBid.isPending}>
            <Eraser className="h-4 w-4 mr-1" /> Reset bid
          </Button>
          <Button className="w-full" onClick={() => finalize.mutate()} disabled={finalize.isPending}>
            <ChevronsRight className="h-4 w-4 mr-1" />
            {highBid ? `Sell to ${highBid.team?.name} for ${highBid.amount.toLocaleString()} · Next` : "Mark unsold · Next"}
          </Button>
        </div>
      )}

      {isOffline && !isController && (
        <LiveBidHistory bids={bidsQ.data ?? []} />
      )}
    </div>
  );
}

function LiveBidHistory({ bids }: { bids: Array<any> }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted-foreground">
        Live bid history
      </h2>
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        {bids.length ? bids.map((bid) => (
          <div key={bid.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <span className="min-w-0 break-words font-medium">{bid.team?.name}</span>
            <span className="shrink-0 font-mono font-semibold tabular-nums">{bid.amount.toLocaleString()}</span>
          </div>
        )) : (
          <p className="px-4 py-3 text-xs text-muted-foreground">No bids yet.</p>
        )}
      </div>
    </section>
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
  auctionId, quotaEnabled, malayaliByPlayer, isController, onNext, nextPending,
}: {
  auctionId: string;
  lastFinalizedAp?: any;
  quotaEnabled: boolean;
  malayaliByPlayer: Record<string, string | null>;
  isController: boolean;
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
        {!p && (
          <p className="mt-2 text-muted-foreground">
            No queued players. Click below to start a new round with any unsold / skipped players.
          </p>
        )}
      </div>

      {p && (
        <div className="space-y-4">
          <MalayaliFlag enabled={quotaEnabled} classification={malayaliByPlayer[p.player_id]} />
          <div className="flex flex-row items-start gap-4">
            <div className="h-32 w-32 sm:h-56 sm:w-56 rounded-xl bg-muted overflow-hidden flex-shrink-0">
              {p.photo
                ? <img src={p.photo} alt="" className="h-full w-full object-cover" />
                : <div className="h-full w-full flex items-center justify-center text-5xl font-bold text-muted-foreground">{(p.name ?? "?")[0]}</div>}
            </div>
            <div className="flex-1 min-w-0 w-full">
              <h2 className="text-xl sm:text-3xl font-bold truncate">{p.name}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {playerMetaLine(roleLabel(p.role), p.batting_style, p.bowling_style)}
              </p>
              {p.cric_heroes_link && (
                <a
                  href={p.cric_heroes_link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  CricHeroes <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {[
              { label: "Matches", value: p.matches ?? 0 },
              { label: "Runs", value: p.runs ?? 0 },
              { label: "Average", value: (p.batting_avg ?? 0).toFixed(0) },
              { label: "Strike Rate", value: (p.batting_sr ?? 0).toFixed(0) },
              { label: "Wickets", value: p.wickets ?? 0 },
              { label: "Economy", value: (p.bowling_economy ?? 1).toFixed(1) },
            ].map((s) => (
              <div key={s.label} className="rounded-lg bg-background/60 p-2 text-center">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{s.label}</p>
                <p className="text-xl sm:text-2xl font-bold tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {isController && (
        <div className="text-center">
          <Button size="lg" onClick={onNext} disabled={nextPending}>
            <ChevronsRight className="h-4 w-4 mr-1" />
            {p ? "Bring up next player" : "Start next round"}
          </Button>
        </div>
      )}
    </div>
  );
}

function TeamsTabs({
  auctionId, teams, quotaEnabled,
}: {
  auctionId: string;
  teams: any[];
  quotaEnabled: boolean;
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
        .select("sold_team_id,sold_price,is_captain,is_icon,player:players(name,role,photo,malayali)")
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
    // The query carries no ORDER BY, so rows arrive in whatever order Postgres
    // finds them on disk -- which is why a squad read as randomly ordered. Rank
    // puts the captain first and that team's icons next; everyone bought at
    // auction follows, and name orders within each rank. Sorting each team's own
    // array is safe: the arrays are built here, not React Query's cached rows.
    const rank = (r: any) => (r.is_captain ? 0 : r.is_icon ? 1 : 2);
    for (const arr of map.values())
      arr.sort((a, b) => rank(a) - rank(b) || (a.player?.name ?? "").localeCompare(b.player?.name ?? ""));
    return map;
  }, [rosterQ.data]);

  const active = teams.find((t) => t.team?.id === activeId) ?? teams[0];
  if (!active) return <p className="text-xs text-muted-foreground">No teams.</p>;
  const activeRoster = rosterByTeam.get(active.team?.id) ?? [];
  // Counted from the rows listed below rather than a stored column, so the tally can
  // never disagree with the names it sits above.
  const activeNonMalayali = activeRoster.filter(
    (r: any) => r.player?.malayali === "non_malayali",
  ).length;

  return (
    <div>
      {/* Browser-style tab strip */}
      {/* auto-fit columns give the three behaviours in one rule, purely from the space
          available: while the tabs fit, each name stays on one line; as the screen
          narrows each tab shrinks to its 6.5rem floor and the name wraps inside it;
          below that the row can hold fewer tabs and they flow onto another row. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] items-end gap-1 -mb-px">
        {teams.map((at) => {
          const isActive = at.team?.id === activeId;
          return (
            <button
              key={at.id}
              type="button"
              onClick={() => setActiveId(at.team.id)}
              className={`group relative self-stretch rounded-t-lg border border-b-0 px-2 py-2 text-center text-xs font-medium leading-tight break-words transition ${
                isActive
                  ? "bg-card border-border text-foreground z-10"
                  : "bg-muted/50 border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {at.team?.name}
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
              {quotaEnabled && (
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  {" "}· {activeNonMalayali} Non-Malayali
                </span>
              )}
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
                    <p className="text-[10px] text-muted-foreground">{roleLabel(p?.role)}</p>
                  </div>
                  {/* Its own element, not part of the price/Captain/Icon branch below,
                      so captains and icons are tagged too. */}
                  {quotaEnabled && p?.malayali === "non_malayali" && (
                    <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                      (Non-Malayali)
                    </span>
                  )}
                  {r.is_captain ? (
                    <span className="text-[10px] font-semibold text-primary uppercase tracking-wide">Captain</span>
                  ) : r.is_icon ? (
                    <span className="text-[10px] font-semibold text-primary uppercase tracking-wide">Icon</span>
                  ) : (
                    <span className="text-xs font-semibold tabular-nums">{(r.sold_price ?? 0).toLocaleString()}</span>
                  )}
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