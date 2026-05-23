## Phase 2 — CRUD forms + auction wizard

### 1. Storage buckets
Create two public buckets via migration:
- `team-logos` — public read, admin-only write
- `player-photos` — public read, admin-only write

### 2. Team CRUD (admin only)
- Replace disabled "Create Team" with a working dialog (shadcn `Dialog` + `Form`).
- Fields: name (required), primary color (color picker, defaults to `#2dd4a8`), logo upload (drag/drop, preview, optional).
- Same dialog reused for edit on the team detail page (`teams.$teamId.tsx`) with a delete button (confirm modal).
- Detail page also shows assigned members; add/remove team members (user picker by email, role = manager / co_manager).

### 3. Player CRUD (admin only)
- "Create Player" dialog on `/players` with: first name, last name, optional display name, role (batsman / bowler / all_rounder / wicketkeeper), country, cricinfo URL, photo upload.
- Inline edit + delete from each player card (admin only).

### 4. Auction creation wizard (admin only)
Multi-step `Dialog` on `/auctions`:
1. **Basics** — name, scheduled date/time
2. **Money rules** — team budget, baseline price, round closure seconds, bid increment table (editable rows of `min / max / increment` mapped to `bid_rules_json`)
3. **Teams** — pick teams from master list, allocate each one a budget (defaults to team_budget)
4. **Players** — multi-select players from master list, optionally mark "icon" + assign to a team
5. **Review & create** — inserts into `auctions`, `auction_teams`, `auction_players` in one transaction (server function with admin client to keep it atomic)

The wizard also supports "Edit" from the auction detail page until the auction goes `live`.

### Technical notes
- Image uploads use `supabase.storage.from(bucket).upload(...)`; store the returned public URL on the row.
- Wizard state lives in a single `useReducer`; navigation between steps is local — no URL changes.
- Atomic auction creation: `src/lib/auctions.functions.ts` exports `createAuction` (`createServerFn` + `requireSupabaseAuth`, checks admin role server-side, uses `supabaseAdmin` for the multi-insert).
- All mutations invalidate the relevant `useQuery` keys via `queryClient.invalidateQueries`.
- Validation with `zod` + `react-hook-form` (already in deps).

### Out of scope (deferred to Phase 3+)
- Live bidding logic, the auctioneer console, real-time presence, "ready" flow, sold/unsold transitions — all of that is Phase 3.
- Bulk CSV import for players.
