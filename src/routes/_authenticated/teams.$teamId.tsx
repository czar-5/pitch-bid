import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Trash2, UserPlus, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { TeamFormDialog } from "@/components/admin/TeamFormDialog";

export const Route = createFileRoute("/_authenticated/teams/$teamId")({
  component: TeamDetail,
});

type Member = {
  id: string;
  user_id: string;
  membership_role: "manager" | "co_manager";
  profile?: { name: string; email: string | null } | null;
};

function TeamDetail() {
  const { teamId } = Route.useParams();
  const { isAdmin, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const teamQ = useQuery({
    queryKey: ["team", teamId],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("*").eq("id", teamId).single();
      if (error) throw error;
      return data;
    },
  });

  const membersQ = useQuery({
    queryKey: ["team-members", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_members")
        .select("id,user_id,membership_role")
        .eq("team_id", teamId);
      if (error) throw error;
      // hydrate profiles
      const ids = (data ?? []).map((m) => m.user_id);
      if (ids.length === 0) return [] as Member[];
      const { data: profiles } = await supabase.from("profiles").select("id,name,email").in("id", ids);
      const map = new Map((profiles ?? []).map((p) => [p.id, p]));
      return (data ?? []).map((m) => ({ ...m, profile: map.get(m.user_id) ?? null })) as Member[];
    },
  });

  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("teams").delete().eq("id", teamId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Team deleted"); qc.invalidateQueries({ queryKey: ["teams"] }); navigate({ to: "/teams" }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("team_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Member removed"); qc.invalidateQueries({ queryKey: ["team-members", teamId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (teamQ.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!teamQ.data) return <p className="text-muted-foreground">Team not found.</p>;
  const team = teamQ.data;
  const isTeamManager = !!membersQ.data?.some(
    (m) => m.user_id === user?.id && m.membership_role === "manager"
  );
  const canManageCoManagers = isAdmin || isTeamManager;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/teams" })}>
        <ArrowLeft className="h-4 w-4 mr-1" /> All teams
      </Button>

      <div className="rounded-xl border border-border bg-card p-6 flex items-center gap-4">
        <div className="h-20 w-20 rounded-xl flex items-center justify-center font-bold text-2xl" style={{ background: team.primary_color ?? undefined }}>
          {team.logo_url ? <img src={team.logo_url} alt="" className="h-full w-full rounded-xl object-cover" /> : team.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{team.name}</h1>
          <p className="text-xs text-muted-foreground font-mono">{team.primary_color}</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <TeamFormDialog team={team} trigger={<Button variant="outline" size="sm"><Pencil className="h-4 w-4 mr-1" /> Edit</Button>} />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive"><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this team?</AlertDialogTitle>
                  <AlertDialogDescription>Cannot be undone. The team will also be removed from any auctions it has been added to.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => del.mutate()}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-3">Managers</h2>
        {membersQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {membersQ.data && membersQ.data.length === 0 && (
          <p className="text-sm text-muted-foreground">No managers yet.</p>
        )}
        <div className="space-y-2">
          {membersQ.data?.map((m) => (
            <div key={m.id} className="rounded-lg border border-border bg-card p-3 flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm">
                {(m.profile?.name ?? "U").charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{m.profile?.name ?? "Unknown"}</p>
                <p className="text-xs text-muted-foreground truncate">{m.profile?.email ?? m.user_id}</p>
              </div>
              <span className="text-xs rounded-full bg-muted px-2 py-0.5 capitalize">{m.membership_role.replace("_", "-")}</span>
              {(isAdmin || (isTeamManager && m.membership_role === "co_manager")) && (
                <Button size="icon" variant="ghost" className="text-destructive h-7 w-7" onClick={() => removeMember.mutate(m.id)}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
        {canManageCoManagers && (
          <AddMemberForm
            teamId={teamId}
            allowManagerRole={isAdmin}
            onAdded={() => qc.invalidateQueries({ queryKey: ["team-members", teamId] })}
          />
        )}
      </section>
    </div>
  );
}

function AddMemberForm({ teamId, allowManagerRole, onAdded }: { teamId: string; allowManagerRole: boolean; onAdded: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "co_manager">(allowManagerRole ? "manager" : "co_manager");
  const add = useMutation({
    mutationFn: async () => {
      const trimmed = email.trim().toLowerCase();
      if (!trimmed) throw new Error("Email required");
      const { data: profile, error: pErr } = await supabase.from("profiles").select("id").eq("email", trimmed).maybeSingle();
      if (pErr) throw pErr;
      if (!profile) throw new Error("No user found with that email — they must sign up first");
      const { error } = await supabase.from("team_members").insert({ team_id: teamId, user_id: profile.id, membership_role: role });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(role === "manager" ? "Manager added" : "Co-manager added"); setEmail(""); onAdded(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="mt-4 rounded-lg border border-dashed border-border p-3 flex gap-2 items-center">
      <Input placeholder="user@email.com" value={email} onChange={(e) => setEmail(e.target.value)} className="flex-1" />
      {allowManagerRole ? (
        <Select value={role} onValueChange={(v) => setRole(v as "manager" | "co_manager")}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="manager">Manager</SelectItem>
            <SelectItem value="co_manager">Co-manager</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <span className="text-xs rounded-full bg-muted px-3 py-1.5 capitalize">Co-manager</span>
      )}
      <Button onClick={() => add.mutate()} disabled={add.isPending}>
        {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
      </Button>
    </div>
  );
}