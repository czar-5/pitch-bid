## Problem

`place_bid` has no "you're already leading" check. After the RPC returns, `placeBid.isPending` flips to `false` immediately, but the new high-bid row arrives via realtime a moment later. In that gap the button still shows `Bid <next>` and a second click fires another bid — the team out-bids itself and the amount jumps by two increments.

## Fix (two layers)

### 1. Server-side guard (authoritative)

Add a check inside the `public.place_bid` SQL function, right after computing `_high`:

```sql
IF EXISTS (
  SELECT 1 FROM bids
  WHERE auction_player_id = _auction_player_id
    AND amount = _high
    AND team_id = _team_id
) THEN
  RAISE EXCEPTION 'your team is already the highest bidder';
END IF;
```

This guarantees no team can ever out-bid itself, even from rapid double-clicks, two browser tabs, or two managers of the same team clicking simultaneously. The second click gets a clean error toast instead of doubling the price.

### 2. Client-side lock (UX polish)

In `LiveRoom` (`src/routes/_public/auctions_.$auctionId.tsx`), keep the bid button disabled until the UI catches up with the server, not just until the RPC promise resolves:

- Track the amount the user just submitted (e.g. `lastSubmittedAmount` set in `placeBid.onMutate` to the current `nextAmount`, cleared when `highBid?.amount` reaches or exceeds it, or when `currentAp.id` changes).
- Extend the button's `disabled` condition to also disable while `lastSubmittedAmount != null && (highBid?.amount ?? 0) < lastSubmittedAmount`.
- Show "Bidding…" label during that window so users know the click was accepted.

This eliminates the visual gap entirely so users rarely hit the server guard in practice.

## Files touched

- New migration: add the duplicate-leader guard inside `public.place_bid`.
- `src/routes/_public/auctions_.$auctionId.tsx`: add `lastSubmittedAmount` state, wire it into `placeBid.onMutate` + a `useEffect` that clears it, and extend the button's `disabled` + label logic.

No schema changes, no new tables, no RLS changes.