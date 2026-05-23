import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/teams/$teamId")({
  component: TeamDetail,
});

function TeamDetail() {
  const { teamId } = Route.useParams();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Team details</h1>
      <p className="text-muted-foreground">
        Coming next — team <code className="text-xs">{teamId}</code> info, managers, and roster.
      </p>
    </div>
  );
}