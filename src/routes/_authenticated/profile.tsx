import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { User, Mail, Shield, Calendar, LogIn } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

interface ProfileData {
  name: string;
  email: string | null;
  created_at: string;
}

function ProfilePage() {
  const { user, roles, isAuthenticated } = useAuth();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [fetchedRoles, setFetchedRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProfile() {
      if (!user) { setLoading(false); return; }
      const [{ data: p }, { data: r }] = await Promise.all([
        supabase.from("profiles").select("name, created_at").eq("id", user.id).single(),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
      ]);
      if (p) setProfile(p);
      if (r) setFetchedRoles(r.map((x) => x.role as string));
      setLoading(false);
    }
    loadProfile();
  }, [user]);

  const isGuest = !isAuthenticated;
  const displayRoles = isGuest
    ? ["viewer"]
    : ((roles && roles.length > 0 ? roles : fetchedRoles) as string[]);

  const displayName = isGuest ? "Guest" : (profile?.name || user?.email?.split("@")[0] || "User");
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const roleLabel: Record<string, string> = {
    admin: "Admin",
    manager: "Manager",
    co_manager: "Co-Manager",
    viewer: "Viewer",
  };

  const roleColor: Record<string, string> = {
    admin: "bg-destructive text-destructive-foreground",
    manager: "bg-primary text-primary-foreground",
    co_manager: "bg-secondary text-secondary-foreground",
    viewer: "bg-muted text-muted-foreground",
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarFallback className="text-lg bg-primary text-primary-foreground">
                {loading ? "…" : initials}
              </AvatarFallback>
            </Avatar>
            <div>
              <CardTitle className="text-xl">
                {loading ? <Skeleton className="h-6 w-32" /> : displayName}
              </CardTitle>
              <div className="flex flex-wrap gap-1 mt-1">
                {loading ? (
                  <Skeleton className="h-5 w-16" />
                ) : (
                  displayRoles.map((role) => (
                    <Badge
                      key={role}
                      className={roleColor[role] || "bg-muted"}
                      variant="secondary"
                    >
                      <Shield className="h-3 w-3 mr-1" />
                      {roleLabel[role] || role}
                    </Badge>
                  ))
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        {isGuest ? (
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You're browsing as a guest with view-only access. Sign in to manage teams and place bids.
            </p>
            <Button asChild className="w-full">
              <Link to="/login">
                <LogIn className="h-4 w-4 mr-2" /> Log in
              </Link>
            </Button>
          </CardContent>
        ) : (
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 text-sm">
            <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Email</span>
            <span className="ml-auto font-medium">
              {loading ? <Skeleton className="h-4 w-40" /> : profile?.email || user?.email}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <User className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Name</span>
            <span className="ml-auto font-medium">
              {loading ? <Skeleton className="h-4 w-32" /> : profile?.name || "—"}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Joined</span>
            <span className="ml-auto font-medium">
              {loading ? (
                <Skeleton className="h-4 w-24" />
              ) : profile?.created_at ? (
                new Date(profile.created_at).toLocaleDateString()
              ) : (
                "—"
              )}
            </span>
          </div>
        </CardContent>
        )}
      </Card>
    </div>
  );
}
