import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Plus, Calendar, Users, Radio, Trash2, Play, ArrowRight, Pencil } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { AuctionWizardDialog } from "@/components/admin/AuctionWizardDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/auctions")({
  component: AuctionsPage,
});

type Auction = {
  id: string; name: string; scheduled_at: string;
  status: "upcoming" | "live" | "paused" | "completed" | "archived";
  team_budget: number;
};

function AuctionsPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("auction_players").delete().eq("auction_id", id);
      await supabase.from("auction_teams").delete().eq("auction_id", id);
      const { error } = await supabase.from("auctions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Auction deleted"); qc.invalidateQueries({ queryKey: ["auctions"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const start = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("start_auction", { _auction_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Auction started"); qc.invalidateQueries({ queryKey: ["auctions"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const { data, isLoading } = useQuery({
    queryKey: ["auctions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auctions")
        .select("id,name,scheduled_at,status,team_budget,auction_teams(count)")
        .order("scheduled_at", { ascending: false });
      if (error) throw error;
      return data as unknown as (Auction & { auction_teams: { count: number }[] })[];
    },
  });

  const groups = {
    live: data?.filter((a) => a.status === "live" || a.status === "paused" || (a.status as string) === "lobby") ?? [],
    upcoming: data?.filter((a) => a.status === "upcoming") ?? [],
    completed: data?.filter((a) => a.status === "completed" || a.status === "archived") ?? [],
  };

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Auctions</h1>
          <p className="text-sm text-muted-foreground">Live and upcoming tournament auctions.</p>
        </div>
        {isAdmin && (
          <AuctionWizardDialog trigger={<Button><Plus className="h-4 w-4 mr-1" /> Create Auction</Button>} />
        )}
      </div>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {!isLoading && (data?.length ?? 0) === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          No auctions yet. {isAdmin ? "Create one to get started." : "Check back soon."}
        </div>
      )}

      <Section title="Live" tone="live" items={groups.live} isAdmin={isAdmin} onDelete={(id) => del.mutate(id)} onStart={(id) => start.mutate(id)} />
      <Section title="Upcoming" tone="upcoming" items={groups.upcoming} isAdmin={isAdmin} onDelete={(id) => del.mutate(id)} onStart={(id) => start.mutate(id)} />
      <Section title="Completed" tone="completed" items={groups.completed} isAdmin={isAdmin} onDelete={(id) => del.mutate(id)} onStart={(id) => start.mutate(id)} />
    </div>
  );
}

function Section({
  title, tone, items, isAdmin, onDelete, onStart,
}: {
  title: string;
  tone: "live" | "upcoming" | "completed";
  items: (Auction & { auction_teams: { count: number }[] })[];
  isAdmin: boolean;
  onDelete: (id: string) => void;
  onStart: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted-foreground">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((a) => (
          <div key={a.id} className="group relative rounded-xl border border-border bg-card p-4 transition hover:border-primary hover:shadow-[var(--shadow-glow)]">
            <Link
              to="/auctions/$auctionId"
              params={{ auctionId: a.id }}
              className="block"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold leading-tight">{a.name}</h3>
                <StatusBadge tone={tone} />
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{format(new Date(a.scheduled_at), "MMM d, p")}</span>
                <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{a.auction_teams?.[0]?.count ?? 0} teams</span>
              </div>
            </Link>
            {isAdmin && (
              <div className="mt-3 flex justify-end gap-1 border-t border-border pt-2">
                {tone === "upcoming" && (
                  <>
                    <AuctionWizardDialog
                      auctionId={a.id}
                      trigger={
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Edit auction"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      }
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-primary"
                      title="Start auction"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onStart(a.id); }}
                    >
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete auction?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently remove {a.name} and all linked teams and players.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => onDelete(a.id)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
            {tone === "live" && (
              <Link
                to="/auctions/$auctionId"
                params={{ auctionId: a.id }}
                className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90"
              >
                Enter live auction <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function StatusBadge({ tone }: { tone: "live" | "upcoming" | "completed" }) {
  if (tone === "live")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/20 px-2 py-0.5 text-[10px] font-bold uppercase text-destructive">
        <Radio className="h-3 w-3 animate-pulse" /> Live
      </span>
    );
  if (tone === "upcoming")
    return <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-bold uppercase text-accent">Upcoming</span>;
  return <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">Done</span>;
}