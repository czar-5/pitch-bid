import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { ImageUploader } from "./ImageUploader";
import { Loader2 } from "lucide-react";

const schema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  primary_color: z.string().regex(/^#([0-9a-fA-F]{6})$/, "Must be a 6-digit hex color"),
  logo_url: z.string().nullable(),
});
type FormValues = z.infer<typeof schema>;

interface TeamFormDialogProps {
  trigger: React.ReactNode;
  team?: { id: string; name: string; primary_color: string | null; logo_url: string | null };
  onSuccess?: () => void;
}

export function TeamFormDialog({ trigger, team, onSuccess }: TeamFormDialogProps) {
  const [open, setOpen] = useState(false);
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
    }
  }, [open, team, form]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (team) {
        const { error } = await supabase.from("teams").update(values).eq("id", team.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("teams").insert(values);
        if (error) throw error;
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
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