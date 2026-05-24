import { Link, Outlet, useRouter } from "@tanstack/react-router";
import { Gavel, Users, UserRound, LogOut, Trophy } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

const nav = [
  { to: "/auctions", label: "Auctions", icon: Gavel },
  { to: "/teams", label: "Teams", icon: Users },
  { to: "/players", label: "Players", icon: UserRound },
] as const;

export function AppShell() {
  const { user, isAdmin, signOut, isAuthenticated } = useAuth();
  const router = useRouter();
  const initial = (user?.user_metadata?.name || user?.user_metadata?.full_name || user?.email || "G")
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/auctions" className="flex items-center gap-2 font-bold tracking-tight">
            <Trophy className="h-5 w-5 text-primary" />
            <span className="text-lg">PitchBid</span>
            {isAdmin && (
              <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase text-accent-foreground">
                Admin
              </span>
            )}
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "rounded-md px-3 py-2 text-sm font-medium bg-secondary text-foreground" }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/profile"
              aria-label="My profile"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
              activeProps={{ className: "flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground ring-2 ring-ring ring-offset-2 ring-offset-background" }}
            >
              {initial}
            </Link>
            {isAuthenticated && (
              <Button
                size="icon"
                variant="ghost"
                onClick={async () => { await signOut(); router.navigate({ to: "/auctions" }); }}
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6 pb-24 md:pb-6">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card/95 backdrop-blur md:hidden">
        <div className="grid grid-cols-3">
          {nav.map((n) => {
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className="flex flex-col items-center gap-1 py-3 text-xs font-medium text-muted-foreground"
                activeProps={{ className: "flex flex-col items-center gap-1 py-3 text-xs font-semibold text-primary" }}
              >
                <Icon className="h-5 w-5" />
                {n.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <Toaster />
    </div>
  );
}