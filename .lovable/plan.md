# Offline auctions

Add a second auction style — "offline" — run by a single auctioneer in the room, alongside the existing "online" style where each team manager bids from their own device.

## 1. Auction setup

- On the first step of Create Auction, below the name, a toggle: **Online / Offline** (defaults to Online).
- When Offline is chosen, an extra field appears on the same step: **Auctioneer email** — the person who will run the bidding. The email must belong to an existing signed-up user; if it doesn't, the wizard shows an inline error.
- Money rules: for offline auctions the "Round closure (sec)" field is hidden (there is no countdown). Budget, baseline, min/max squad and the bid increment slabs stay exactly as they are.
- Teams, Players and Captains & Icons steps are unchanged.
- Editing an upcoming auction shows the same fields, so method and auctioneer can be changed before it starts.
- All existing auctions are marked "online".

## 2. Auction list

Each auction card shows an "Online"/"Offline" tag next to the date and time. Everything else on the card stays the same.

## 3. Lobby (offline)

- The "Team managers joined" row and the round timer are hidden.
- "Start auction" / "Bring up next player" are available to the auctioneer and to admins.
- The "Up next" player card stays exactly as it is today, for everyone including signed-out viewers.

## 4. Auctioneer bidding page (offline, live)

Visible only to the assigned auctioneer and to admins.

```text
+---------------------------+---------------------------+
|  CURRENT BID              |  NEXT BID                 |
|  4,200  ·  Team name      |  4,400                    |
+---------------------------+---------------------------+
|  [ Team A ]  [ Team B ]  [ Team C ]  [ Team D ]       |
|  (logo + name, big tap targets)                       |
+-------------------------------------------------------+
|      Undo           Reset            SOLD             |
+-------------------------------------------------------+
```

- Pressing a team button records that team as the bidder at the current "next bid" amount. The widgets then roll forward: current bid becomes that amount, next bid becomes the following increment from the slab rules.
- The first press on any team registers the **base price**.
- A team that is already the highest bidder, is out of budget, has a full squad, or must reserve budget for its minimum squad is shown greyed out with the reason — pressing does nothing.
- **Undo** removes the most recent bid; pressing it again goes back another step, repeatedly, down to no bids.
- **Reset** clears every bid on the current player and returns to base price.
- **Sold** finalises: highest bidder wins the player at the current bid; if there are no bids the player is marked unsold and returns to the pool for a later round.

## 5. Everyone else during an offline auction

The existing "on the block" spectator view, unchanged except the "Time left" element is hidden. Team managers do not get bid buttons in offline auctions — all bidding goes through the auctioneer. Bids appear live on every screen as the auctioneer presses team buttons.

## 6. Between players

Lobby/intermission view stays the same; "Bring up next player" shows for the auctioneer and admins.

---

## Technical notes

**Database**

- `auctions.method` — new enum (`online` | `offline`), default `online`; backfill existing rows to `online`.
- `auctions.auctioneer_user_id` — nullable uuid referencing a user; set from the email typed in the wizard via the existing `admin_find_user_by_email` function.
- New helper `is_auction_controller(_auction_id, _user_id)` — true for admins and for the auction's auctioneer. Used by the RPCs below.
- New RPC `place_bid_for_team(_auction_player_id, _team_id)` — SECURITY DEFINER, auctioneer/admin only, offline auctions only. Same slab/budget/reserve/max-squad/duplicate-leader validation as `place_bid`, but no round-timer checks and no team-membership requirement; does not set `round_ends_at`.
- New RPC `undo_last_bid(_auction_id)` — auctioneer/admin only; deletes the most recent bid row for the current player.
- Relax `go_live_auction`, `next_player`, `finalize_current`, `sell_current`, `reset_bid` from `has_role(admin)` to `is_auction_controller(...)` so the auctioneer can drive the round. For offline auctions `go_live_auction`/`next_player` leave `round_ends_at` NULL.
- Grants: existing `authenticated` execute grants extended to the new functions; no `anon` execute.

**Frontend**

- `AuctionWizardDialog.tsx`: method toggle + auctioneer email field on Basics, conditional round-closure field on Money rules, save/load both new columns, validation in `canAdvance()`.
- `_authenticated/auctions.tsx`: method badge on the card.
- `_public/auctions_.$auctionId.tsx`: read `method` and `auctioneer_user_id`; derive `isController`. Lobby hides the joined-teams row and timer for offline; `LiveRoom` renders a new `AuctioneerPanel` for the controller and the existing spectator layout (timer hidden) for everyone else; team-manager bid controls suppressed when offline.
- Realtime bid subscription already refetches on insert and delete, so Undo/Reset propagate to all screens without reload.
