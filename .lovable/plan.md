## Goal

Let admins pre-assign a captain and a configurable number of icon players to each team while creating an auction. These players skip the bidding queue, count toward the squad cap, cost nothing, and show as "Captain" / "Icon Player" wherever a sold price is normally displayed.

## 1. Database migration

`auction_players` already has `is_icon boolean` and `icon_team_id uuid`. Add captain support and tighten the schema:

- Add `is_captain boolean NOT NULL DEFAULT false` on `auction_players`.
- Update `place_bid` to also count pre-sold captain/icon rows against `max_players_per_team` — it already reads `players_bought` from `auction_teams`, which gets incremented at insert time below, so no function change is strictly required, but I'll double-check the increment path.
- No changes to `next_player`, `finalize_current`, `sell_current` — they only touch `status='queued'`/`'live'` rows, so pre-sold rows are naturally invisible to the bidding loop.

## 2. Wizard changes (`src/components/admin/AuctionWizardDialog.tsx`)

Insert a new step **"Captains & Icons"** between "Players" and "Review" (STEPS becomes 6 entries). State additions:

```ts
captains: Record<string, string | null>           // teamId -> playerId | null
iconCounts: Record<string, number>                // teamId -> N (default 0)
iconPlayers: Record<string, Set<string>>          // teamId -> set of playerIds
```

UI per selected team:
- Captain combobox: "None" + searchable list of selected players not already assigned to another team as captain/icon.
- "Icon players" number input (0 = none).
- If N>0, a multi-select picker (same exclusion rules) limited to N choices.
- Inline counter shows `assigned / N`.

Validation to advance from this step:
- For each team, icon picker length === iconCounts[teamId].
- No player assigned twice across all teams.
- (Captain may be left as "None" per team — optional.)

Edit-mode hydration: load existing `auction_players` rows where `is_captain` or `is_icon` is true and seed the maps.

## 3. Create / update mutation

When inserting `auction_players`:
- Bidding pool rows: all `selectedPlayers` minus everyone in any team's captain/icon assignment → `status='queued'`, sequential `auction_order`.
- Pre-sold rows (captains + icons): `status='sold'`, `sold_team_id=teamId`, `sold_price=0`, `is_captain=true` for captains, `is_icon=true` + `icon_team_id=teamId` for icons. No `auction_order`.

When inserting `auction_teams`, set `players_bought` to the count of pre-sold rows for that team (instead of the current default `0`), so the squad cap math in `place_bid` works from turn 1. `budget_remaining` stays at the full team budget (free assignments).

Edit path already deletes & re-inserts `auction_players` / `auction_teams`, so no separate cleanup needed.

## 4. UI labels — show "Captain" / "Icon Player" in place of sold price

In `src/routes/_authenticated/auctions_.$auctionId.tsx`:

- Extend the auction-players query select with `is_captain,is_icon`.
- Sold-list rendering around line 239: if `is_captain` show `<Badge>Captain</Badge>`, else if `is_icon` show `<Badge>Icon Player</Badge>`, else show `sold_price.toLocaleString()`.
- Team squad list around line 1018: same conditional — replace the numeric `sold_price` with the badge text for pre-sold rows.
- Extend the team-squad query select to include `is_captain,is_icon`.

No changes to the bid feed (these players never had bids, so they're naturally absent).

## 5. Out of scope

- No new RPC. No changes to the live auction loop (`next_player`, `place_bid`, `finalize_current`, `sell_current`, `end_auction`).
- No edits to `players` table — captain/icon status is per-auction, not per-player.
- No realtime broadcast changes — pre-sold rows are written before the auction goes live, so they appear in the first read.

## Open detail (will assume unless you flag it)

Pre-sold rows currently have `sold_price = 0`. If you'd rather store `NULL` to make "no price ever" semantically clearer, say so and I'll switch — but `0` keeps the column non-null friendly and the UI already keys off `is_captain`/`is_icon`.
