import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { IconCalendar, IconCalendarTime } from "@tabler/icons-react";

// Marketing / entry page. In production this would link to a user's own
// booking page; for local dev it surfaces the dashboard.
export default function Index() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex items-center gap-3">
        <IconCalendarTime className="h-10 w-10 text-[color:var(--brand-accent,#7c3aed)]" />
        <h1 className="text-3xl font-semibold tracking-tight">Scheduling</h1>
      </div>
      <p className="max-w-md text-muted-foreground">
        Cal.com / Calendly clone with 1:1 scheduling, team round-robin, routing
        forms, and workflows.
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link to="/event-types">
            <IconCalendar className="mr-2 h-4 w-4" />
            Dashboard
          </Link>
        </Button>
      </div>
    </main>
  );
}
