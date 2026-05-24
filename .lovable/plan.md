## Add min/max players per team to auctions

Introduce two per-auction settings — **minimum players per team (`x`)** and **maximum players per team (`y`)** — captured at auction creation, and enforce them server-side when bids are placed.

### Behavior

1. **Max cap (`y`)**: A team that already has `y` players bought cannot place any more bids. Server rejects with a clear error.
2. **Reserve budget (`x`)**: When a team is about to acquire its `n`-th player (1-indexed), it must retain enough budget to still buy the remaining `(x - n)` players at the baseline price. I.e. their bid amount must satisfy:
   ```
   budget_remaining - bid_amount ≥ max(0, (x - n)) * baseline_price
   ```
   where `n = players_bought + 1`. Once `n ≥ x` the reserve becomes 0 and only the normal "enough budget for this bid" rule applies.

### Database changes (migration)

- Add two columns to `auctions`:
  - `min_players_per_team integer NOT NULL DEFAULT 10`
  - `max_players_per_team integer NOT NULL DEFAULT 12`
- Update `public.place_bid(_auction_player_id, _team_id)`:
  - After resolving `_next` (the proposed bid amount) and reading the team's `players_bought` and `budget_remaining`, plus the auction's `min_players_per_team`, `max_players_per_team`, and `baseline_price`:
    - If `players_bought >= max_players_per_team` → `RAISE EXCEPTION 'team has reached max players (y)'`.
    - Compute `remaining_min := GREATEST(0, min_players_per_team - (players_bought + 1))`.
    - Require `budget_remaining - _next >= remaining_min * baseline_price`, otherwise `RAISE EXCEPTION 'must reserve budget for minimum players'`.
  - Existing `insufficient budget` check stays as the lower bound.

No RLS changes needed; both checks live inside the existing SECURITY DEFINER function.

### UI changes

**`src/components/admin/AuctionWizardDialog.tsx`** — Step 2 ("Money rules"):
- Add two number inputs next to the existing ones: **Min players / team** (default `10`) and **Max players / team** (default `12`).
- Validation in `canAdvance()` for step 1: `max >= 1`, `min >= 0`, `min <= max`.
- Include both in the `auctions` insert payload.
- Show both in Step 5 (Review).

**`src/routes/_authenticated/auctions_.$auctionId.tsx`** — upcoming auction header card:
- Add a small "Squad size: min `x` · max `y`" line near the Baseline chip / bid-slab ladder so participants see the rules before bidding.
- In the bid panel (where team managers click "Bid"), surface a helpful disabled state + tooltip when:
  - team has reached `y` players, OR
  - placing the next bid would break the reserve constraint.
  This is purely advisory — the server is the source of truth.

### Out of scope

- No retroactive changes to existing auctions beyond the column defaults (existing rows backfill to `10` / `12`).
- Admin "sell" / "finalize" flows already write to `auction_teams.players_bought`; no change needed there. The new caps only gate *new bids*, not admin overrides.

### Files touched

- New migration (adds 2 columns + replaces `place_bid`).
- `src/components/admin/AuctionWizardDialog.tsx` — wizard form + insert payload + review.
- `src/routes/_authenticated/auctions_.$auctionId.tsx` — show squad size, advisory disable on bid button.
