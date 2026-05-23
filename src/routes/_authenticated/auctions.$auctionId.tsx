import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/auctions/$auctionId")({
  component: AuctionDetail,
});

function AuctionDetail() {
  const { auctionId } = Route.useParams();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Auction details</h1>
      <p className="text-muted-foreground">
        Coming in Phase 2 — auction <code className="text-xs">{auctionId}</code> details, team roster, and live room.
      </p>
    </div>
  );
}