import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/teams")({
  component: TeamsPage,
});

function TeamsPage() {
  const { isAdmin } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("id,name,logo_url,primary_color").order("name");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Teams</h1>
          <p className="text-sm text-muted-foreground">Master list of teams.</p>
        </div>
        {isAdmin && (
          <Button disabled><Plus className="h-4 w-4 mr-1" /> Create Team</Button>
        )}
      </div>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {!isLoading && (data?.length ?? 0) === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          No teams yet.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((t) => (
          <Link
            key={t.id}
            to="/teams/$teamId"
            params={{ teamId: t.id }}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition hover:border-primary"
          >
            <div
              className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center font-bold"
              style={{ background: t.primary_color ?? undefined }}
            >
              {t.logo_url ? (
                <img src={t.logo_url} alt={t.name} className="h-full w-full rounded-lg object-cover" />
              ) : (
                <span className="text-primary-foreground">{t.name.slice(0, 2).toUpperCase()}</span>
              )}
            </div>
            <span className="font-semibold">{t.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}