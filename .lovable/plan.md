## Plan: Add "Reset bid" admin control to live auction

Add a new admin button next to **Pause timer** / **Reset timer** in the live auction page that clears all bids placed on the current player so bidding restarts from the baseline price. The countdown timer is left untouched (admin can use Reset timer separately if needed).

### 1. Database — new SECURITY DEFINER function

Add `public.reset_bid(_auction_id uuid)` via migration:

- Admin-only guard (`has_role(auth.uid(), 'admin')`).
- Look up `current_player_id` on the auction; no-op if null.
- `DELETE FROM bids WHERE auction_player_id = <current>` — wipes bid history for the live player.
- Leaves `auction_players.round_ends_at` / `paused_remaining_seconds` as-is (timer unaffected, matching the user's wording).

### 2. Frontend — `src/routes/_public/auctions_.$auctionId.tsx`

- Add a `resetBid` `useMutation` alongside `pauseRound` / `resetRound` that calls `supabase.rpc("reset_bid", { _auction_id: auctionId })` and invalidates the `["auction", auctionId]` and bids queries on success.
- Add a `<Button variant="outline">` with an `Eraser` (lucide) icon labelled **"Reset bid"** in the admin controls row right after **Reset timer**. Disabled while the mutation is pending or when there is no current player.
- Same admin-visibility gating as the existing Pause/Reset timer buttons.

### Notes

- No changes to RLS; the RPC is `SECURITY DEFINER` and self-guards on admin role, consistent with the other auction control RPCs.
- After deletion, existing UI selectors (`highBid`, leading team, current bid display) will naturally recompute to baseline once the bids query refetches via realtime + invalidation.
