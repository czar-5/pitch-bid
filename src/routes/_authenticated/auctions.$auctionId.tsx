import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Calendar, Coins, Gavel, Trash2, Users } from "lucide-react";
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
  const { isAdmin } = useAuth();
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
        .select("id,auction_order,status,sold_price,player:players(id,first_name,last_name,display_name,player_role)")
        .eq("auction_id", auctionId)
        .order("auction_order", { nullsFirst: false });
      if (error) throw error;
      return data;
    },
  });

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

  if (auctionQ.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!auctionQ.data) return <p className="text-muted-foreground">Auction not found.</p>;
  const a = auctionQ.data;

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
      </div>

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
              <span className="text-xs rounded-full bg-muted px-2 py-0.5 capitalize">{ap.status}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}