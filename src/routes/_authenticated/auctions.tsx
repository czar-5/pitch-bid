import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Plus, Calendar, Users, Radio, Trash2 } from "lucide-react";
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
    live: data?.filter((a) => a.status === "live" || a.status === "paused") ?? [],
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

      <Section title="Live" tone="live" items={groups.live} />
      <Section title="Upcoming" tone="upcoming" items={groups.upcoming} />
      <Section title="Completed" tone="completed" items={groups.completed} />
    </div>
  );
}

function Section({
  title, tone, items,
}: { title: string; tone: "live" | "upcoming" | "completed"; items: (Auction & { auction_teams: { count: number }[] })[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-muted-foreground">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((a) => (
          <Link
            key={a.id}
            to="/auctions/$auctionId"
            params={{ auctionId: a.id }}
            className="group rounded-xl border border-border bg-card p-4 transition hover:border-primary hover:shadow-[var(--shadow-glow)]"
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