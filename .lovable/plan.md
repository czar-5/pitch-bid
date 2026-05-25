## Fix truncated team name in sticky bid panel

**Where:** `src/routes/_authenticated/auctions_.$auctionId.tsx` line 752 — the "Current bid" cell uses `truncate` with a large `text-xl sm:text-2xl font-extrabold`, so names like "Signature K…" get cut on mobile.

**Change:** Allow the team name to wrap to 2 lines and scale down on small screens, keeping the amount stable underneath.

- Replace `truncate` with `break-words leading-tight line-clamp-2` so long names wrap instead of being clipped.
- Drop the team name from `text-xl sm:text-2xl` to `text-base sm:text-xl` so 2-word team names fit comfortably on a 390px viewport.
- Keep the amount on its own line at the current size for emphasis.

No layout/grid changes, no other panels touched.