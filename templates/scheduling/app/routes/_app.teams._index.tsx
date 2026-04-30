import { Button } from "@/components/ui/button";
import { IconPlus, IconUsersGroup } from "@tabler/icons-react";
import { useSetHeaderActions } from "@/components/layout/HeaderActions";

export function meta() {
  return [{ title: "Teams — Scheduling" }];
}

export default function TeamsIndex() {
  useSetHeaderActions(
    <Button disabled className="cursor-pointer">
      <IconPlus className="mr-1.5 h-4 w-4" />
      New team
    </Button>,
  );

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
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
