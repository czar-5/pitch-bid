## Bug

In the `place_bid()` Postgres function, the WHERE clause that picks the active bid slab can never match a rule whose `max` is JSON `null` (the top/unbounded slab). When the high bid is in that range, the rule lookup returns no row, `_inc` is NULL, and the function falls back to the hard-coded `_inc := 100`. The frontend's `nextAmount` uses correct JS null-checks, so the UI shows the configured increment (e.g. +500) but the server inserts a bid using +100. This is the intermittent failure you've been seeing — it only occurs once bidding crosses into the top slab.

Root cause: `(r->'max') IS NULL` is false for a JSONB `null` value, and `(r->>'max')` returns SQL NULL (not the text `'null'`) for a JSON null, so all three OR branches fail.

## Fix

One migration that replaces `public.place_bid(uuid, uuid)` with the same body, changing only the slab-lookup WHERE clause to correctly treat a JSON-null / missing `max` as "no upper bound":

```sql
AND COALESCE((r->>'max')::bigint, 9223372036854775807) > _high
```

Everything else in `place_bid()` (locks, status checks, budget/reserve checks, insert into `bids`, round timer extension) stays identical.

## Verification

- Re-run a manual auction sequence past the top-slab boundary and confirm the inserted `bids.amount` matches the UI's "Next bid" (e.g. 5000 → 5500, not 5100).
- No frontend changes are needed; `nextAmount` in `LiveRoom` and `BidSlabLadder` are already correct.

## Out of scope

- No changes to slab data model, UI, or admin wizard.
- No change to the `_inc := 100` safety fallback itself — it stays as a last-resort guard for genuinely malformed `bid_rules_json`.
