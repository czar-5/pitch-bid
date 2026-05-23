## Add a bid-slab ladder to the auction header

On the auction detail page, the header card (the one in your screenshot showing name, schedule, budget, baseline) does not communicate the bidding step rules. Add a compact visual at the bottom of that card that shows each slab boundary and the increment between them.

### Visual design

A horizontal "ladder" rail spanning the full width of the card footer:

```text
   +50            +100              +500
●━━━━━━━━━●━━━━━━━━━━━━━━●━━━━━━━━━━━━━━▶
500       1,000           5,000          ∞
baseline                                  no cap
```

- A thin horizontal rule (`border-border`, 2px) runs across the card.
- A filled circle (primary color) sits at each slab boundary: the baseline price, then each `min`/`max` from `bid_rules_json`. The final open-ended slab ends in a right-pointing chevron / arrow instead of a circle.
- Below each dot: the price (e.g. `500`, `1,000`, `5,000`). The first one is labeled `Baseline`; the last gets `No cap`.
- Above each segment, centered between its two dots: `+50`, `+100`, `+500` as small pill badges (`bg-muted`, monospace-ish, `text-xs`).
- The ladder uses `flex` with each segment as `flex-1` so it scales responsively. On narrow viewports (<480px) it stacks the increment badge above and price below in a smaller variant.

### Alternative considered

A simple table of slabs (Range / Increment) was considered but rejected — the ladder reads in one glance, fits the broadcast feel of the rest of the page, and pairs naturally with the existing Baseline chip.

### Scope

- Only the upcoming/non-minimal header card. Hidden during live rounds (already inside the `{!minimal && ...}` block).
- Read-only — no schema or RLS change. Pulls from `auction.bid_rules_json` and `auction.baseline_price` already loaded.

### Files

- `src/routes/_authenticated/auctions_.$auctionId.tsx`
  - Add a `BidSlabLadder` component (same file, near the bottom with the other small components).
  - Render `<BidSlabLadder baseline={a.baseline_price} rules={a.bid_rules_json} />` inside the header card, below the meta row (after the `Baseline` chip line, separated by a `border-t border-border pt-4 mt-4`).

No other files change.
