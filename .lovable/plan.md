## Hide and randomize player auction order

Currently players are auctioned in the order admins picked them in the wizard (sequential `auction_order`), and the Player pool list shows that number plainly (`#1`, `#2`, …) — both the order itself and its position are visible to everyone.

Goal: shuffle the order when the auction lobby opens, and never reveal it in any UI.

### Database change (migration)

Update `public.start_auction(_auction_id uuid)` so that, right before flipping the auction to `lobby`, it reassigns `auction_order` for every `queued` player to a fresh random sequence (1..N). Use `row_number() over (order by random())` inside a CTE:

```sql
WITH shuffled AS (
  SELECT id, row_number() OVER (ORDER BY random()) AS new_order
  FROM auction_players
  WHERE auction_id = _auction_id AND status = 'queued'
)
UPDATE auction_players ap
   SET auction_order = s.new_order
  FROM shuffled s
 WHERE ap.id = s.id;
```

This runs inside the existing SECURITY DEFINER function, so the shuffle happens server-side and the result is just a column — no client ever sees the original order. `next_player` continues to pick `ORDER BY auction_order NULLS LAST, created_at`, so the live flow is unchanged.

The recycle path in `next_player` (when unsold players go back into the queue) keeps their existing `auction_order`, which is fine — that order was already random.

### Frontend changes — `src/routes/_authenticated/auctions_.$auctionId.tsx`

The Player pool section currently:
- queries with `.order("auction_order", { nullsFirst: false })`
- renders `#{ap.auction_order}` in every row

Both leak the upcoming sequence. Change to:
- query ordered by player name (e.g. `.order("player(first_name)")`, or sort client-side by `display_name ?? first_name + last_name`)
- drop the `#auction_order` span entirely from the row (replace with nothing — status badge on the right is enough)

Also drop `auction_order` from the `.select(...)` list so it isn't even fetched. Keep showing `status` and `sold_price` as today.

### Out of scope

- The wizard still inserts players with sequential `auction_order: i + 1`; that placeholder is overwritten the moment the admin opens the lobby. No change needed there.
- Admin live controls (Next / Sell / Skip) don't need changes — they just trust the (now random) order.
- Bid history, leaderboards, and team rosters don't expose `auction_order`.

### Files touched

- New migration replacing `public.start_auction`.
- `src/routes/_authenticated/auctions_.$auctionId.tsx` — player pool query + row rendering.
