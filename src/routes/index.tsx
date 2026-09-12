import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PitchBid | Cricket Player Auctions" },
      { name: "description", content: "Browse cricket teams, players, and live player auctions on PitchBid." },
      { property: "og:title", content: "PitchBid | Cricket Player Auctions" },
      { property: "og:description", content: "Browse cricket teams, players, and live player auctions on PitchBid." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/auctions" });
  },
});
