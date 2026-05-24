
## 1. Database migration (wipe + restructure)

Single migration that:

- Deletes data in dependency order: `bids` → `auction_players` → `players` (auctions themselves stay).
- Replaces the `player_role` enum with new values: `batter`, `bowler`, `batting_allrounder`, `bowling_allrounder`, `wicket_keeper`.
- Drops columns: `first_name`, `last_name`, `display_name`, `photo_url`, `country`, `cricinfo_url`.
- Adds columns:
  - `name text not null`
  - `batting_style text` (nullable, free text)
  - `bowling_style text` (nullable, free text)
  - `matches integer not null default 0`
  - `runs integer not null default 0`
  - `wickets integer not null default 0`
  - `batting_avg numeric(6,2) not null default 0`
  - `batting_sr numeric(6,2) not null default 0`
  - `photo text` (nullable; stores public URL)
  - `cric_heroes_link text` (nullable; replaces the old Cricinfo link)
- Keeps `id`, `created_at`, and existing RLS policies untouched.

## 2. Frontend: Player form (`src/components/admin/PlayerFormDialog.tsx`)

Rewrite fields to match the new schema:

- `name` (text, required)
- `role` (select: Batter / Bowler / Batting Allrounder / Bowling Allrounder / Wicket Keeper)
- `batting_style`, `bowling_style` (text, optional)
- `matches`, `runs`, `wickets` (number inputs, min 0)
- `batting_avg`, `batting_sr` (number inputs, step 0.01, min 0)
- `photo` (existing `ImageUploader` against `player-photos` bucket)
- `cric_heroes_link` (URL text, optional)

Update zod schema, default values, and insert/update payload accordingly.

## 3. Frontend: Players list (`src/routes/_authenticated/players.tsx`)

- Select the new columns; order by `name`.
- Card shows: photo, name, role label, batting/bowling style line, small stats row (`M {matches} · R {runs} · W {wickets} · Avg {batting_avg} · SR {batting_sr}`), and a CricHeroes link when present (replaces the old Cricinfo link).
- Search filters on `name`.

## 4. Frontend: Other references to old player fields

Audit and update everywhere players are displayed using `first_name`/`last_name`/`display_name`/`photo_url`/`country`:

- `src/routes/_authenticated/auctions_.$auctionId.tsx` (lobby/live/sold cards, next-player card)
- `src/routes/_authenticated/teams_.$teamId.tsx` (roster, if it shows players)
- Any `auction_players` joins on `players(...)` — switch to `players(name, photo, role, batting_style, bowling_style)`.
- Update the `get_next_player` SQL function's return columns to `(player_id, name, role, photo)` and adjust the lobby card.

## 5. Bulk import page (admin only)

New route `src/routes/_authenticated/players_.import.tsx`, all client-side in the admin's browser (admin role bypasses RLS):

1. **File pickers**: one CSV input + one `.zip` input.
2. **Parse CSV** with `papaparse`. Expected headers: `name, role, batting_style, bowling_style, matches, runs, wickets, batting_avg, batting_sr, photo_filename, cric_heroes_link`.
3. **Unzip photos** with `jszip` into an in-memory `Map<filename, Blob>`.
4. **Validate** each row with zod (role maps to a valid enum; numbers parse; `photo_filename` exists in the zip if non-empty). Show a preview table with per-row OK/error status before the user confirms.
5. **On "Import"**:
   - Upload each `Blob` to `player-photos` at `bulk/{uuid}-{filename}` via `supabase.storage`, get public URL.
   - Build insert payload, batch insert into `players` in chunks of 50.
   - Progress bar + final summary (X inserted, Y failed, with reasons).
6. Add a `Bulk import` button on the Players page (admin only) linking here.
7. A `Download CSV template` button provides a sample file with the right headers and one example row.

New dependencies: `papaparse`, `jszip`.

## 6. Files touched

- New migration (wipe + schema).
- `src/components/admin/PlayerFormDialog.tsx` — rewritten fields.
- `src/routes/_authenticated/players.tsx` — list rendering + search + "Bulk import" link + CricHeroes link.
- `src/routes/_authenticated/players_.import.tsx` — new bulk import page.
- `src/routes/_authenticated/auctions_.$auctionId.tsx` — switch `first_name`/`last_name`/`display_name`/`photo_url` usages to `name`/`photo`; update role badges.
- `src/routes/_authenticated/teams_.$teamId.tsx` — same field swap if it lists players.
- Second migration updating `get_next_player` return shape.

## Out of scope

- Keeping any history of the deleted players (you chose wipe).
- Server-side CSV processing — everything runs in the admin's browser.
- Editing stats inline from the list view (use the edit dialog).
