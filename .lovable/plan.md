## Fix: recycle unsold + skipped players for unlimited rounds

Rewrite `public.next_player(_auction_id)` so that when no `queued` players remain it recycles **both** `unsold` and `skipped` players back into the queue, unlimited times. Admin still drives the round manually via the existing "Next" button — no auto-advance, no UI changes.

### SQL change (single migration)

Replace the body of `public.next_player` so it:

1. Picks the next `queued` player ordered by `auction_order NULLS LAST, created_at`.
2. If none, recycles in one statement:
   ```sql
   UPDATE auction_players
      SET status='queued',
          round_ends_at=NULL,
          paused_remaining_seconds=NULL,
          sold_team_id=NULL,
          sold_price=NULL,
          auction_order=NULL          -- re-shuffle below
    WHERE auction_id=_auction_id
      AND status IN ('unsold','skipped');
   ```
3. If `ROW_COUNT = 0` → mark auction `completed`, return NULL.
4. Otherwise re-shuffle the just-recycled batch with `row_number() OVER (ORDER BY random())` written into `auction_order` (so round 2+ isn't the same order as round 1), then pick the first one and set it `live` with a fresh `round_ends_at` exactly like today.

No new columns, no cap, no changes to `finalize_current` / `sell_current` / `skip_current` / `end_auction`.

### What this fixes vs. today

- Skipped players now come back in the next round (currently lost forever).
- Recycled players get a stale-state cleanup (`paused_remaining_seconds`, `round_ends_at`) so the first bid of round 2 isn't rejected with `round paused`.
- Each new round is reshuffled instead of replaying round 1's order.
- Unlimited rounds: as long as at least one unsold/skipped player exists when admin clicks Next, another round starts.

### Out of scope

- No frontend changes.
- No changes to `end_auction` semantics — admin can still hard-stop.
- No round-counter UI (can add later if you want to show "Round 2", etc.).
