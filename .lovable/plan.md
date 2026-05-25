## Lobby: replace teams tab strip with a join-status icon row

In the auction lobby, the `<TeamsTabs joinedTeamIds={...}>` browser-tab block doesn't add real info — it duplicates the "Teams" section below. Replace it in the lobby only with a compact horizontal row of team logos, each with a green tick when that team's manager has joined.

### Changes (single file: `src/routes/_authenticated/auctions_.$auctionId.tsx`)

1. **LobbyRoom** — remove `<TeamsTabs ... joinedTeamIds={...} />` and render a new inline status row:
   - Header: "Team managers joined — {joinedCount} / {totalTeams}"
   - Below: flex-wrap row of team chips, each showing the team logo (or initials with `primary_color` background), team name, and a join indicator:
     - joined → `CheckCircle2` in `text-primary`
     - not joined → `Circle` in `text-muted-foreground/40`
   - Chips are presentational (no click, no roster panel).

2. **TeamsTabs component** — remove the now-unused `joinedTeamIds` prop and the join-indicator code inside its tab buttons. The lower "Teams" section keeps using TeamsTabs for the roster browsing UI (unchanged behavior).

3. No backend / RPC / presence changes — presence tracking stays as is, only the rendering changes.

### Out of scope
No styling/theming overhaul, no changes to LiveRoom, IntermissionRoom, or the lower Teams roster section.