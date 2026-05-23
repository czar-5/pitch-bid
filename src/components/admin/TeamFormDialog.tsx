import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageUploader } from "./ImageUploader";
import { Loader2, UserPlus, X } from "lucide-react";

const schema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  primary_color: z.string().regex(/^#([0-9a-fA-F]{6})$/, "Must be a 6-digit hex color"),
  logo_url: z.string().nullable(),
});
type FormValues = z.infer<typeof schema>;

type MembershipRole = "manager" | "co_manager";
type PendingMember = { email: string; role: MembershipRole };
type ExistingMember = {
  id: string;
  user_id: string;
  membership_role: MembershipRole;
  profile?: { name: string; email: string | null } | null;
};

interface TeamFormDialogProps {
  trigger: React.ReactNode;
  team?: { id: string; name: string; primary_color: string | null; logo_url: string | null };
  onSuccess?: () => void;
}

export function TeamFormDialog({ trigger, team, onSuccess }: TeamFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingMember[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<MembershipRole>("manager");
  const qc = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: team?.name ?? "",
      primary_color: team?.primary_color ?? "#2dd4a8",
      logo_url: team?.logo_url ?? null,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: team?.name ?? "",
        primary_color: team?.primary_color ?? "#2dd4a8",
        logo_url: team?.logo_url ?? null,
      });
      setPending([]);
      setNewEmail("");
      setNewRole("manager");
    }
  }, [open, team, form]);

  // Load existing members when editing
  const membersQ = useQuery({
    queryKey: ["team-members", team?.id],
    enabled: open && !!team?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_members")
        .select("id,user_id,membership_role")
        .eq("team_id", team!.id);
      if (error) throw error;
      const ids = (data ?? []).map((m) => m.user_id);
      if (ids.length === 0) return [] as ExistingMember[];
      const { data: profiles } = await supabase.from("profiles").select("id,name,email").in("id", ids);
      const map = new Map((profiles ?? []).map((p) => [p.id, p]));
      return (data ?? []).map((m) => ({
        ...m,
        membership_role: m.membership_role as MembershipRole,
        profile: map.get(m.user_id) ?? null,
      })) as ExistingMember[];
    },
  });

  async function resolveEmailToUserId(email: string): Promise<string> {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) throw new Error("Email required");
    const { data: profile, error: pErr } = await supabase
      .from("profiles").select("id").eq("email", trimmed).maybeSingle();
    if (pErr) throw pErr;
    if (!profile) throw new Error(`No user found for ${trimmed} — they must sign up first`);
    return profile.id;
  }

  const addExistingMember = useMutation({
    mutationFn: async (m: PendingMember) => {
      if (!team) throw new Error("Save team first");
      const userId = await resolveEmailToUserId(m.email);
      const { error } = await supabase.from("team_members")
        .insert({ team_id: team.id, user_id: userId, membership_role: m.role });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Member added");
      setNewEmail("");
      qc.invalidateQueries({ queryKey: ["team-members", team?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeExistingMember = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("team_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["team-members", team?.id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (team) {
        const { error } = await supabase.from("teams").update(values).eq("id", team.id);
        if (error) throw error;
        return team.id;
      } else {
        const { data, error } = await supabase.from("teams").insert(values).select("id").single();
        if (error) throw error;
        const newId = data.id as string;
        // Insert pending members for the new team
        for (const m of pending) {
          try {
            const userId = await resolveEmailToUserId(m.email);
            const { error: mErr } = await supabase.from("team_members")
              .insert({ team_id: newId, user_id: userId, membership_role: m.role });
            if (mErr) throw mErr;
          } catch (e) {
            toast.error(`${m.email}: ${(e as Error).message}`);
          }
        }
        return newId;
      }
    },
    onSuccess: () => {
      toast.success(team ? "Team updated" : "Team created");
      qc.invalidateQueries({ queryKey: ["teams"] });
      if (team) qc.invalidateQueries({ queryKey: ["team", team.id] });
      setOpen(false);
      onSuccess?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function addPending() {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    if (pending.some((p) => p.email === email)) {
      toast.error("Already added");
      return;
    }
    setPending((p) => [...p, { email, role: newRole }]);
    setNewEmail("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{team ? "Edit team" : "Create team"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl><Input placeholder="Mumbai Indians" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="primary_color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Primary color</FormLabel>
                  <FormControl>
                    <div className="flex gap-2">
                      <input type="color" value={field.value} onChange={(e) => field.onChange(e.target.value)} className="h-10 w-14 rounded-md border border-border bg-transparent cursor-pointer" />
                      <Input value={field.value} onChange={field.onChange} className="font-mono" maxLength={7} />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="logo_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Logo</FormLabel>
                  <FormControl>
                    <ImageUploader bucket="team-logos" value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Managers</span>
                <span className="text-xs text-muted-foreground">
                  Roles are granted automatically
                </span>
              </div>

              {/* Existing members (edit mode) */}
              {team && (
                <div className="space-y-1.5">
                  {membersQ.isLoading && (
                    <p className="text-xs text-muted-foreground">Loading…</p>
                  )}
                  {membersQ.data?.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5">
                      <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-xs">
                        {(m.profile?.name ?? m.profile?.email ?? "U").charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{m.profile?.name ?? "Unknown"}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{m.profile?.email}</p>
                      </div>
                      <span className="text-[10px] rounded-full bg-muted px-2 py-0.5 capitalize">
                        {m.membership_role.replace("_", "-")}
                      </span>
                      <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-destructive"
                        onClick={() => removeExistingMember.mutate(m.id)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  {membersQ.data && membersQ.data.length === 0 && (
                    <p className="text-xs text-muted-foreground">No managers yet.</p>
                  )}
                </div>
              )}

              {/* Pending members (create mode) */}
              {!team && pending.length > 0 && (
                <div className="space-y-1.5">
                  {pending.map((p) => (
                    <div key={p.email} className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5">
                      <span className="flex-1 text-xs truncate">{p.email}</span>
                      <span className="text-[10px] rounded-full bg-muted px-2 py-0.5 capitalize">
                        {p.role.replace("_", "-")}
                      </span>
                      <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-destructive"
                        onClick={() => setPending((arr) => arr.filter((x) => x.email !== p.email))}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add manager form */}
              <div className="flex gap-2 items-center pt-1">
                <Input
                  type="email"
                  placeholder="user@email.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="flex-1"
                />
                <Select value={newRole} onValueChange={(v) => setNewRole(v as MembershipRole)}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="co_manager">Co-manager</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  disabled={!newEmail.trim() || addExistingMember.isPending}
                  onClick={() => {
                    if (team) {
                      addExistingMember.mutate({ email: newEmail, role: newRole });
                    } else {
                      addPending();
                    }
                  }}
                >
                  {addExistingMember.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                </Button>
              </div>
              {!team && (
                <p className="text-[11px] text-muted-foreground">
                  Managers will be added after the team is created.
                </p>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {team ? "Save changes" : "Create team"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}