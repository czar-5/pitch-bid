import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/users")({
  component: UsersPage,
});

const ALL_ROLES: AppRole[] = ["admin", "manager", "co_manager", "viewer"];

type Profile = { id: string; name: string; email: string | null };
type RoleRow = { id: string; user_id: string; role: AppRole };

function UsersPage() {
  const { isAdmin, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (!loading && !isAdmin) navigate({ to: "/auctions" });
  }, [loading, isAdmin, navigate]);

  const profilesQ = useQuery({
    queryKey: ["all-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id,name,email").order("name");
      if (error) throw error;
      return data as Profile[];
    },
    enabled: isAdmin,
  });

  const rolesQ = useQuery({
    queryKey: ["all-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("id,user_id,role");
      if (error) throw error;
      return data as RoleRow[];
    },
    enabled: isAdmin,
  });

  const addRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Role added"); qc.invalidateQueries({ queryKey: ["all-roles"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRole = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("user_roles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Role removed"); qc.invalidateQueries({ queryKey: ["all-roles"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!isAdmin) return null;

  const rolesByUser = new Map<string, RoleRow[]>();
  (rolesQ.data ?? []).forEach((r) => {
    const arr = rolesByUser.get(r.user_id) ?? [];
    arr.push(r);
    rolesByUser.set(r.user_id, arr);
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Users & roles</h1>
        <p className="text-sm text-muted-foreground">Assign roles to signed-up users.</p>
      </div>

      {(profilesQ.isLoading || rolesQ.isLoading) && <p className="text-muted-foreground">Loading…</p>}

      <div className="space-y-2">
        {profilesQ.data?.map((p) => {
          const userRoles = rolesByUser.get(p.id) ?? [];
          const heldRoleNames = new Set(userRoles.map((r) => r.role));
          const available = ALL_ROLES.filter((r) => !heldRoleNames.has(r));
          return (
            <div key={p.id} className="rounded-lg border border-border bg-card p-4 flex flex-wrap items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                {(p.name || p.email || "U").charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{p.name || "Unnamed"}</p>
                <p className="text-xs text-muted-foreground truncate">{p.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {userRoles.map((r) => (
                  <span key={r.id} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs capitalize">
                    {r.role.replace("_", "-")}
                    <button
                      type="button"
                      onClick={() => removeRole.mutate(r.id)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${r.role}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {userRoles.length === 0 && (
                  <span className="text-xs text-muted-foreground">No roles</span>
                )}
              </div>
              {available.length > 0 && (
                <Select
                  value=""
                  onValueChange={(role) => addRole.mutate({ userId: p.id, role: role as AppRole })}
                >
                  <SelectTrigger className="w-40"><SelectValue placeholder="Add role…" /></SelectTrigger>
                  <SelectContent>
                    {available.map((r) => (
                      <SelectItem key={r} value={r} className="capitalize">{r.replace("_", "-")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          );
        })}
      </div>

      {profilesQ.data && profilesQ.data.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
          No users yet.
        </div>
      )}
    </div>
  );
}