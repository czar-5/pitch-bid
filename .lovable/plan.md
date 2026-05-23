## Lobby teams: tap to expand and show roster

Change the lobby's team grid into an accordion. Each team row remains compact (logo, name, join tick), and tapping it expands to show players already sold to that team in the current auction.

### UI

- Replace the 3-col grid in `LobbyRoom` with a single-column shadcn `Accordion` (`type="single"`, `collapsible`).
- Each `AccordionItem` header keeps the existing look: colored logo tile, team name, players-bought count badge, joined `CheckCircle2` / `Circle`. The chevron rotates on open.
- `AccordionContent` shows:
  - Budget remaining (small label).
  - Player list: photo (or initials), name, role pill, sold price on the right.
  - Empty state: "No players yet" when the team has nothing sold in this auction.

### Data

- Add a query in `LobbyRoom` keyed `["auction-team-roster", auctionId]` that reads `auction_players` where `auction_id = auctionId` and `status = 'sold'`, selecting `sold_team_id, sold_price, player:players(first_name,last_name,display_name,player_role,photo_url)`.
- Group rows by `sold_team_id` in a `useMemo` and render the matching list inside each accordion item.
- No schema or RLS changes — `auction_players_select_all` already permits the read.

### Files

- `src/routes/_authenticated/auctions_.$auctionId.tsx` — refactor `LobbyRoom` to the accordion layout and add the roster query.
