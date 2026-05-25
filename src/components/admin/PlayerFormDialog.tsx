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
  name: z.string().min(1).max(120),
  role: z.enum(["batter", "bowler", "batting_allrounder", "bowling_allrounder", "wicket_keeper"]),
  batting_style: z.string().max(60).nullable().optional(),
  bowling_style: z.string().max(60).nullable().optional(),
  matches: z.coerce.number().int().min(0),
  runs: z.coerce.number().int().min(0),
  wickets: z.coerce.number().int().min(0),
  batting_avg: z.coerce.number().min(0).max(9999),
  batting_sr: z.coerce.number().min(0).max(9999),
  bowling_economy: z.coerce.number().min(0).max(9999),
  photo: z.string().nullable(),
  cric_heroes_link: z.string().url().nullable().optional().or(z.literal("")),
});
type FormValues = z.infer<typeof schema>;

type Player = {
  id: string;
  name: string;
  role: "batter" | "bowler" | "batting_allrounder" | "bowling_allrounder" | "wicket_keeper";
  batting_style: string | null;
  bowling_style: string | null;
  matches: number;
  runs: number;
  wickets: number;
  batting_avg: number;
  batting_sr: number;
  bowling_economy: number;
  photo: string | null;
  cric_heroes_link: string | null;
};

interface PlayerFormDialogProps {
  trigger: React.ReactNode;
  player?: Player;
}

export function PlayerFormDialog({ trigger, player }: PlayerFormDialogProps) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const defaults = (): FormValues => ({
    name: player?.name ?? "",
    role: player?.role ?? "batter",
    batting_style: player?.batting_style ?? "",
    bowling_style: player?.bowling_style ?? "",
    matches: player?.matches ?? 0,
    runs: player?.runs ?? 0,
    wickets: player?.wickets ?? 0,
    batting_avg: player?.batting_avg ?? 0,
    batting_sr: player?.batting_sr ?? 0,
    bowling_economy: player?.bowling_economy ?? 0,
    photo: player?.photo ?? null,
    cric_heroes_link: player?.cric_heroes_link ?? "",
  });
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults(),
  });

  useEffect(() => {
    if (open) form.reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, player, form]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        ...values,
        batting_style: values.batting_style?.trim() || null,
        bowling_style: values.bowling_style?.trim() || null,
        cric_heroes_link: values.cric_heroes_link?.trim() || null,
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
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Name</FormLabel><FormControl><Input placeholder="MS Dhoni" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="role" render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="batter">Batter</SelectItem>
                      <SelectItem value="bowler">Bowler</SelectItem>
                      <SelectItem value="batting_allrounder">Batting Allrounder</SelectItem>
                      <SelectItem value="bowling_allrounder">Bowling Allrounder</SelectItem>
                      <SelectItem value="wicket_keeper">Wicket Keeper</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="batting_style" render={({ field }) => (
                <FormItem><FormLabel>Batting style</FormLabel><FormControl><Input placeholder="Right-hand bat" {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="bowling_style" render={({ field }) => (
                <FormItem><FormLabel>Bowling style</FormLabel><FormControl><Input placeholder="Right-arm offbreak" {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <FormField control={form.control} name="matches" render={({ field }) => (
                <FormItem><FormLabel>Matches</FormLabel><FormControl><Input type="number" min={0} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="runs" render={({ field }) => (
                <FormItem><FormLabel>Runs</FormLabel><FormControl><Input type="number" min={0} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="wickets" render={({ field }) => (
                <FormItem><FormLabel>Wickets</FormLabel><FormControl><Input type="number" min={0} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="batting_avg" render={({ field }) => (
                <FormItem><FormLabel>Batting average</FormLabel><FormControl><Input type="number" step="0.01" min={0} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="batting_sr" render={({ field }) => (
                <FormItem><FormLabel>Strike rate</FormLabel><FormControl><Input type="number" step="0.01" min={0} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="bowling_economy" render={({ field }) => (
                <FormItem><FormLabel>Bowling economy</FormLabel><FormControl><Input type="number" step="0.01" min={0} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="cric_heroes_link" render={({ field }) => (
              <FormItem>
                <FormLabel>CricHeroes link <span className="text-muted-foreground">(optional)</span></FormLabel>
                <FormControl><Input placeholder="https://…" {...field} value={field.value ?? ""} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="photo" render={({ field }) => (
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