import { useLoaderData, Link, NavLink } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { listBookings } from "@agent-native/scheduling/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export async function loader({ params }: LoaderFunctionArgs) {
  const email = getRequestUserEmail() ?? "local@localhost";
  const status = params.status as any;
  const bookings = await listBookings({ hostEmail: email, status });
  return { bookings, status };
}

const TABS = ["upcoming", "past", "unconfirmed", "cancelled"];

export default function BookingsPage() {
  const { bookings, status } = useLoaderData<typeof loader>();
  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
      </header>
      <nav className="mb-4 flex gap-1 rounded-md border border-border p-1">
        {TABS.map((t) => (
          <NavLink
            key={t}
            to={`/bookings/${t}`}
            className={({ isActive }) =>
              cn(
                "flex-1 rounded px-3 py-1.5 text-sm capitalize",
                isActive
                  ? "bg-muted font-medium"
                  : "text-muted-foreground hover:bg-muted/50",
              )
            }
          >
            {t}
          </NavLink>
        ))}
      </nav>
      {bookings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No {status} bookings.</p>
      ) : (
        <ul className="space-y-2">
          {bookings.map((b) => {
            const tz = b.timezone;
            return (
              <li
                key={b.id}
                className="flex items-start justify-between rounded-md border border-border bg-card p-4"
              >
                <div>
                  <Link
                    to={`/booking/${b.uid}`}
                    className="font-medium hover:underline"
                  >
                    {b.title}
                  </Link>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {format(
                      new TZDate(new Date(b.startTime).getTime(), tz),
                      "EEE, MMM d · h:mm a",
                    )}{" "}
                    ({tz})
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    with {b.attendees.map((a) => a.name).join(", ")}
                  </div>
                </div>
                <Badge
                  variant={
                    b.status === "confirmed"
                      ? "default"
                      : b.status === "cancelled"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {b.status}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
