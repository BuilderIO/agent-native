import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { getBookingByUid } from "@agent-native/scheduling/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconCalendar, IconExternalLink, IconX } from "@tabler/icons-react";

export async function loader({ params }: LoaderFunctionArgs) {
  const booking = await getBookingByUid(params.uid!);
  if (!booking) throw new Response("Not found", { status: 404 });
  return { booking };
}

export default function BookingDetail() {
  const { booking } = useLoaderData<typeof loader>();
  const tz = booking.timezone;
  const start = new TZDate(new Date(booking.startTime).getTime(), tz);
  const videoUrl = booking.references.find((r) => r.meetingUrl)?.meetingUrl;
  return (
    <main className="mx-auto max-w-xl p-6">
      <div className="rounded-md border border-border p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold">{booking.title}</h1>
            <div className="mt-1 text-sm text-muted-foreground">
              {format(start, "EEEE, MMMM d · h:mm a")} ({tz})
            </div>
          </div>
          <Badge
            variant={booking.status === "confirmed" ? "default" : "secondary"}
          >
            {booking.status}
          </Badge>
        </div>
        {videoUrl && (
          <Button asChild className="mb-2 w-full" variant="default">
            <a href={videoUrl} target="_blank" rel="noreferrer">
              <IconExternalLink className="mr-2 h-4 w-4" />
              Join meeting
            </a>
          </Button>
        )}
        <section className="mt-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            Attendees
          </h2>
          <ul className="mt-1 space-y-1 text-sm">
            {booking.attendees.map((a) => (
              <li key={a.email}>
                {a.name} &lt;{a.email}&gt;
              </li>
            ))}
          </ul>
        </section>
        {booking.status === "confirmed" && booking.rescheduleToken && (
          <div className="mt-6 flex gap-2">
            <Button asChild variant="outline">
              <Link to={`/reschedule/${booking.uid}`}>
                <IconCalendar className="mr-2 h-4 w-4" />
                Reschedule
              </Link>
            </Button>
            <form
              method="post"
              action={`/_agent-native/actions/cancel-booking`}
              className="inline"
            >
              <input type="hidden" name="uid" value={booking.uid} />
              <Button type="submit" variant="destructive">
                <IconX className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
