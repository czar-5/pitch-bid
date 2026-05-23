import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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

const schema = z.object({
  first_name: z.string().min(1).max(60),
  last_name: z.string().min(1).max(60),
  display_name: z.string().max(80).nullable().optional(),
  player_role: z.enum(["batsman", "bowler", "all_rounder", "wicketkeeper"]),
  country: z.string().max(60).nullable().optional(),
  cricinfo_url: z.string().url().nullable().optional().or(z.literal("")),
  photo_url: z.string().nullable(),
});
type FormValues = z.infer<typeof schema>;

type Player = {
  id: string;
  first_name: string;
  last_name: string;
  display_name: string | null;
  player_role: "batsman" | "bowler" | "all_rounder" | "wicketkeeper";
  country: string | null;
  cricinfo_url: string | null;
  photo_url: string | null;
};

interface PlayerFormDialogProps {
  trigger: React.ReactNode;
  player?: Player;
}

export function PlayerFormDialog({ trigger, player }: PlayerFormDialogProps) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      first_name: player?.first_name ?? "",
      last_name: player?.last_name ?? "",
      display_name: player?.display_name ?? "",
      player_role: player?.player_role ?? "batsman",
      country: player?.country ?? "",
      cricinfo_url: player?.cricinfo_url ?? "",
      photo_url: player?.photo_url ?? null,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        first_name: player?.first_name ?? "",
        last_name: player?.last_name ?? "",
        display_name: player?.display_name ?? "",
        player_role: player?.player_role ?? "batsman",
        country: player?.country ?? "",
        cricinfo_url: player?.cricinfo_url ?? "",
        photo_url: player?.photo_url ?? null,
      });
    }
  }, [open, player, form]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        ...values,
        display_name: values.display_name?.trim() || null,
        country: values.country?.trim() || null,
        cricinfo_url: values.cricinfo_url?.trim() || null,
      };
      if (player) {
        const { error } = await supabase.from("players").update(payload).eq("id", player.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("players").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(player ? "Player updated" : "Player created");
      qc.invalidateQueries({ queryKey: ["players"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{player ? "Edit player" : "Create player"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="first_name" render={({ field }) => (
                <FormItem><FormLabel>First name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="last_name" render={({ field }) => (
                <FormItem><FormLabel>Last name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="display_name" render={({ field }) => (
              <FormItem>
                <FormLabel>Display name <span className="text-muted-foreground">(optional)</span></FormLabel>
                <FormControl><Input placeholder="MS Dhoni" {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="player_role" render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="batsman">Batsman</SelectItem>
                      <SelectItem value="bowler">Bowler</SelectItem>
                      <SelectItem value="all_rounder">All-rounder</SelectItem>
                      <SelectItem value="wicketkeeper">Wicketkeeper</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="country" render={({ field }) => (
                <FormItem><FormLabel>Country</FormLabel><FormControl><Input placeholder="India" {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="cricinfo_url" render={({ field }) => (
              <FormItem>
                <FormLabel>Cricinfo URL <span className="text-muted-foreground">(optional)</span></FormLabel>
                <FormControl><Input placeholder="https://…" {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="photo_url" render={({ field }) => (
              <FormItem>
                <FormLabel>Photo</FormLabel>
                <FormControl>
                  <ImageUploader bucket="player-photos" value={field.value} onChange={field.onChange} shape="circle" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {player ? "Save changes" : "Create player"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}