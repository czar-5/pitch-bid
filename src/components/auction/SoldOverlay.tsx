import { useEffect, useRef } from "react";

/**
 * Everything the celebration needs, captured at the moment the sale lands.
 *
 * Deliberately a flat snapshot rather than the live rows: the auction room refetches
 * constantly (every bid, every realtime nudge), and reading through to the cache during
 * the animation would let a later refetch change the name or the number on screen
 * mid-stamp. `id` is the auction_players row, used only to tell one sale from the next.
 */
export type SoldCelebration = {
  id: string;
  playerName: string;
  playerPhoto: string | null;
  teamName: string;
  teamLogo: string | null;
  teamColor: string | null;
  amount: number;
};

/**
 * Full-screen "SOLD" announcement, held between the hammer falling and the room moving
 * on to the next player.
 *
 * Not a Radix Dialog, despite looking like one: a dialog takes keyboard focus, traps it,
 * and waits to be dismissed. This takes no input at all -- it appears for everyone in the
 * room at once, including the auctioneer, and clears itself.
 */
export function SoldOverlay({
  sale,
  onDone,
  holdMs = 6000,
}: {
  sale: SoldCelebration;
  onDone: () => void;
  holdMs?: number;
}) {
  // The timer is keyed on the sale alone. Parking onDone in a ref keeps a parent that
  // re-renders (which this one does, constantly) from handing us a fresh function
  // identity every time and restarting the countdown -- which would hold the overlay up
  // forever on a busy auction.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    const t = setTimeout(() => onDoneRef.current(), holdMs);
    return () => clearTimeout(t);
  }, [sale.id, holdMs]);

  const initials = (sale.teamName || "??").slice(0, 2).toUpperCase();

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/92 backdrop-blur-sm p-4 animate-in fade-in-0 duration-300"
    >
      {/* A single flash of the pitch gradient behind the card, timed with the stamp. */}
      <div
        className="pointer-events-none absolute inset-0 animate-sold-flash"
        style={{ background: "var(--gradient-mint)" }}
        aria-hidden
      />

      <div className="relative w-full max-w-2xl animate-in fade-in-0 zoom-in-95 duration-500">
        <div className="rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/15 to-card p-6 sm:p-10 shadow-[var(--shadow-glow)]">
          {/* Player and buyer, side by side: photo above name, badge above team name.
              Also the anchor for the stamp -- see the note where it is rendered. */}
          <div className="relative grid grid-cols-2 gap-4 sm:gap-8 items-start">
            <div className="flex flex-col items-center gap-3 min-w-0">
              <div className="h-28 w-28 sm:h-44 sm:w-44 rounded-2xl bg-muted overflow-hidden flex-shrink-0">
                {sale.playerPhoto ? (
                  <img src={sale.playerPhoto} alt="" className="block h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-5xl sm:text-7xl font-bold text-muted-foreground">
                    {(sale.playerName || "?")[0]}
                  </div>
                )}
              </div>
              <p className="w-full text-center text-lg sm:text-3xl font-bold leading-tight break-words">
                {sale.playerName}
              </p>
            </div>

            <div className="flex flex-col items-center gap-3 min-w-0">
              <div
                className="h-28 w-28 sm:h-44 sm:w-44 rounded-2xl bg-muted overflow-hidden flex-shrink-0 flex items-center justify-center text-4xl sm:text-6xl font-bold"
                style={{ background: sale.teamColor ?? undefined }}
              >
                {sale.teamLogo ? (
                  <img src={sale.teamLogo} alt="" className="block h-full w-full object-cover" />
                ) : (
                  initials
                )}
              </div>
              <p className="w-full text-center text-lg sm:text-3xl font-bold leading-tight break-words">
                {sale.teamName}
              </p>
            </div>

            {/* The stamp, landing about 600ms in -- see the keyframes in styles.css.
                It is struck across the two photos rather than the middle of the card, so
                it never covers the three things the room is here to read: the two names
                and the price. The offset is half a photo's height (h-28 / sm:h-44), which
                keeps it centred on the photos however many lines a long team name takes.
                The offset lives on this wrapper because the span's own transform belongs
                to the animation. pointer-events-none so it never swallows a tap meant for
                the screen underneath. */}
            <div className="pointer-events-none absolute inset-x-0 top-14 sm:top-22 -translate-y-1/2 flex justify-center">
              <span className="animate-sold-stamp select-none rounded-xl border-[6px] border-destructive px-6 py-2 text-5xl sm:text-7xl font-black uppercase tracking-[0.2em] text-destructive [text-shadow:0_2px_12px_rgb(0_0_0_/_0.45)]">
                Sold
              </span>
            </div>
          </div>

          {/* The number, on its own line and bigger than anything else on screen. */}
          <p className="mt-6 sm:mt-10 text-center text-5xl sm:text-7xl font-extrabold tabular-nums tracking-tight text-primary">
            {sale.amount.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}
