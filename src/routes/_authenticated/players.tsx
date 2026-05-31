import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, ExternalLink, Pencil, Trash2, Upload } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { PlayerFormDialog } from "@/components/admin/PlayerFormDialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/players")({
  component: PlayersPage,
});

const roleLabel: Record<string, string> = {
  batter: "Batter",
  bowler: "Bowler",
  allrounder: "Allrounder",
  batting_allrounder: "Batting Allrounder",
  bowling_allrounder: "Bowling Allrounder",
  wicket_keeper: "Wicket Keeper",
  none: "—",
};

function PlayersPage() {
  const { isAdmin } = useAuth();
  const [q, setQ] = useState("");
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("players").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Player deleted"); qc.invalidateQueries({ queryKey: ["players"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const { data, isLoading } = useQuery({
    queryKey: ["players"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("players")
        .select("id,name,role,batting_style,bowling_style,matches,runs,wickets,batting_avg,batting_sr,bowling_economy,photo,cric_heroes_link")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const filtered = (data ?? []).filter((p) => {
    return (p.name ?? "").toLowerCase().includes(q.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Players</h1>
          <p className="text-sm text-muted-foreground">Master player pool.</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/players/import"><Upload className="h-4 w-4 mr-1" /> Bulk import</Link>
            </Button>
            <PlayerFormDialog trigger={<Button><Plus className="h-4 w-4 mr-1" /> Create Player</Button>} />
          </div>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search players…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {!isLoading && filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          No players found.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((p) => (
          <div key={p.id} className="rounded-xl border border-border bg-card p-4 flex gap-3 group relative">
            <div className="h-14 w-14 rounded-full bg-muted overflow-hidden flex-shrink-0">
              {p.photo ? (
                <img src={p.photo} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm font-bold text-muted-foreground">
                  {(p.name ?? "?").slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-tight truncate">
                {p.name}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {roleLabel[p.role] ?? p.role}
                {p.batting_style ? ` · ${p.batting_style}` : ""}
                {p.bowling_style ? ` · ${p.bowling_style}` : ""}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/80 font-mono">
                M {p.matches} · R {p.runs} · Avg {Number(p.batting_avg).toFixed(2)} · SR {Number(p.batting_sr).toFixed(2)} · W {p.wickets} · Econ {Number(p.bowling_economy).toFixed(2)}
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
            {isAdmin && (
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                <PlayerFormDialog
                  player={p}
                  trigger={<Button size="icon" variant="ghost" className="h-7 w-7"><Pencil className="h-3.5 w-3.5" /></Button>}
                />
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete player?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently remove {p.name} from the master pool.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => del.mutate(p.id)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}