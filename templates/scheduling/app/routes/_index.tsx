import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { IconArrowRight } from "@tabler/icons-react";

// Minimal landing. In production this would be the marketing page; locally
// it's a thin shim pointing to the dashboard. Monochrome, no brand accent.
export default function Index() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Scheduling</h1>
        <p className="text-sm text-muted-foreground">
          Go to your dashboard to manage event types, availability, and
          bookings.
        </p>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Button asChild>
          <Link to="/event-types">
            Go to dashboard
            <IconArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
        </Button>
        <Link
          to="/bookings/upcoming"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          View my bookings
        </Link>
      </div>
    </main>
  );
}
