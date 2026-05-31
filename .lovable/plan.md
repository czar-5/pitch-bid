## Plan

Add a new value `allrounder` to the `player_role` Postgres enum so it becomes selectable alongside the existing roles (`batter`, `bowler`, `batting_allrounder`, `bowling_allrounder`, `wicket_keeper`).

### Steps

1. **Database migration** — `ALTER TYPE public.player_role ADD VALUE IF NOT EXISTS 'allrounder';`
   - Enum additions must run outside a transaction block; the migration will be a single standalone `ALTER TYPE` statement.
   - After it runs, `src/integrations/supabase/types.ts` will auto-regenerate to include the new value.

2. **UI updates** — wherever role is shown or selected, add the new option:
   - `src/components/admin/PlayerFormDialog.tsx` — role `<Select>` options.
   - `src/routes/_authenticated/players.tsx` and `players_.import.tsx` — any role label maps / filters.
   - `src/routes/_public/auctions_.$auctionId.tsx` — role badge/label rendering.
   I'll grep for `batting_allrounder` / `player_role` and update each occurrence with a short, human label like "All-rounder".

### Open question

You already have `batting_allrounder` and `bowling_allrounder`. Adding a generic `allrounder` gives three overlapping options. Do you want:
- **(a)** Keep all three (generic + batting + bowling all-rounder), or
- **(b)** Replace the two specific ones with just `allrounder` (this requires migrating existing player rows and is destructive)?

I'll proceed with **(a)** unless you say otherwise.
