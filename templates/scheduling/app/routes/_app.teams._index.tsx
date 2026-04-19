import { Button } from "@/components/ui/button";
import { IconPlus, IconUsersGroup } from "@tabler/icons-react";

export default function TeamsIndex() {
  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a team to co-host event types with others.
          </p>
        </div>
        <Button disabled>
          <IconPlus className="mr-1.5 h-4 w-4" />
          New team
        </Button>
      </header>
      <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border p-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <IconUsersGroup className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-base font-semibold">
            You're not part of a team yet
          </h2>
          <p className="text-sm text-muted-foreground">
            Collaborate with colleagues on events with round-robin and
            collective bookings.
          </p>
        </div>
      </div>
    </div>
  );
}
