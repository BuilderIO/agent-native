import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { getBookingByUid } from "@agent-native/scheduling/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { agentNativePath } from "@agent-native/core/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  IconCalendar,
  IconCheck,
  IconClock,
  IconExternalLink,
  IconGlobe,
  IconVideo,
  IconX,
} from "@tabler/icons-react";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const booking = await getBookingByUid(params.uid!);
  if (!booking) throw new Response("Not found", { status: 404 });
  const token = new URL(request.url).searchParams.get("token") ?? undefined;
  const userEmail = getRequestUserEmail();
  const isHost = !!userEmail && userEmail === booking.hostEmail;
  const hasManageToken =
    !!token &&
    (token === booking.cancelToken || token === booking.rescheduleToken);
  return {
    booking,
    manageToken: hasManageToken ? token : undefined,
    canManage: isHost || hasManageToken,
  };
}

export default function BookingDetail() {
  const { booking, manageToken, canManage } = useLoaderData<typeof loader>();
  const tz = booking.timezone;
  const start = new TZDate(new Date(booking.startTime).getTime(), tz);
  const end = new TZDate(new Date(booking.endTime).getTime(), tz);
  const videoUrl = booking.references.find((r) => r.meetingUrl)?.meetingUrl;

  return (
    <main className="mx-auto max-w-xl p-6 py-12">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col items-center gap-3 p-6 pb-4 text-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: "hsl(var(--brand-accent) / 0.12)" }}
          >
            <IconCheck className="booker-accent h-6 w-6" strokeWidth={3} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">
              {booking.status === "cancelled"
                ? "This booking was cancelled"
                : "This meeting is scheduled"}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A calendar invitation was sent to your email.
            </p>
          </div>
        </div>

        <Separator />

        <div className="space-y-4 p-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              What
            </div>
            <div className="mt-1 font-medium">{booking.title}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              When
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-sm">
              <IconCalendar className="h-3.5 w-3.5 text-muted-foreground" />
              {format(start, "EEEE, MMMM d, yyyy")}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-sm">
              <IconClock className="h-3.5 w-3.5 text-muted-foreground" />
              {format(start, "h:mm a")} – {format(end, "h:mm a")}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <IconGlobe className="h-3.5 w-3.5" />
              {tz}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Who
            </div>
            <ul className="mt-1 space-y-1.5">
              {booking.attendees.map((a: any) => (
                <li key={a.email} className="flex items-center gap-2 text-sm">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-[10px]">
                      {a.name
                        ?.split(/\s+/)
                        .map((p: string) => p[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span>{a.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {a.email}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {booking.status === "confirmed" && (
            <Badge variant="secondary">Confirmed</Badge>
          )}
          {booking.status === "cancelled" && (
            <Badge variant="destructive">Cancelled</Badge>
          )}
        </div>

        {videoUrl && booking.status !== "cancelled" && (
          <>
            <Separator />
            <div className="p-6">
              <Button asChild className="w-full">
                <a href={videoUrl} target="_blank" rel="noreferrer">
                  <IconVideo className="mr-1.5 h-4 w-4" />
                  Join meeting
                  <IconExternalLink className="ml-1.5 h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          </>
        )}

        {booking.status === "confirmed" && canManage && (
          <>
            <Separator />
            <div className="flex items-center justify-center gap-2 p-6">
              <Button asChild variant="outline" size="sm">
                <Link
                  to={
                    manageToken
                      ? `/reschedule/${booking.uid}?token=${encodeURIComponent(manageToken)}`
                      : `/reschedule/${booking.uid}`
                  }
                >
                  <IconCalendar className="mr-1.5 h-3.5 w-3.5" />
                  Reschedule
                </Link>
              </Button>
              <form
                method="post"
                action={agentNativePath("/_agent-native/actions/cancel-booking")}
                className="inline"
              >
                <input type="hidden" name="uid" value={booking.uid} />
                {manageToken && (
                  <input type="hidden" name="token" value={manageToken} />
                )}
                <input type="hidden" name="cancelledBy" value="attendee" />
                <Button type="submit" variant="ghost" size="sm">
                  <IconX className="mr-1.5 h-3.5 w-3.5" />
                  Cancel
                </Button>
              </form>
            </div>
          </>
        )}
      </div>
      <footer className="mt-6 text-center text-xs text-muted-foreground">
        Powered by Scheduling
      </footer>
    </main>
  );
}
