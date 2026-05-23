import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/players")({
  component: PlayersPage,
});

const roleLabel: Record<string, string> = {
  batsman: "Batsman", bowler: "Bowler", all_rounder: "All-rounder", wicketkeeper: "Wicketkeeper",
};

function PlayersPage() {
  const { isAdmin } = useAuth();
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["players"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("players")
        .select("id,first_name,last_name,display_name,photo_url,player_role,country,cricinfo_url")
        .order("first_name");
      if (error) throw error;
      return data;
    },
  });

  const filtered = (data ?? []).filter((p) => {
    const name = `${p.first_name} ${p.last_name} ${p.display_name ?? ""}`.toLowerCase();
    return name.includes(q.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Players</h1>
          <p className="text-sm text-muted-foreground">Master player pool.</p>
        </div>
        {isAdmin && <Button disabled><Plus className="h-4 w-4 mr-1" /> Create Player</Button>}
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
          <div key={p.id} className="rounded-xl border border-border bg-card p-4 flex gap-3">
            <div className="h-14 w-14 rounded-full bg-muted overflow-hidden flex-shrink-0">
              {p.photo_url ? (
                <img src={p.photo_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm font-bold text-muted-foreground">
                  {p.first_name[0]}{p.last_name[0]}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold leading-tight truncate">
                {p.display_name ?? `${p.first_name} ${p.last_name}`}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {roleLabel[p.player_role] ?? p.player_role}
                {p.country ? ` · ${p.country}` : ""}
              </p>
              {p.cricinfo_url && (
                <a
                  href={p.cricinfo_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Cricinfo <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}