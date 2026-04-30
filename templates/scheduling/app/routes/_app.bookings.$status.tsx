import { useLoaderData, Link, NavLink, useRevalidator } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { useMemo, useState } from "react";
import { TZDate } from "@date-fns/tz";

export function meta() {
  return [
    { title: "Bookings — Scheduling" },
    {
      name: "description",
      content:
        "Upcoming, past, pending, and cancelled bookings — reschedule, cancel, or mark no-shows.",
    },
  ];
}

import {
  format,
  isToday,
  isTomorrow,
  isYesterday,
  parseISO,
  startOfDay,
} from "date-fns";
import { listBookings } from "@agent-native/scheduling/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  IconCalendarOff,
  IconCopy,
  IconDotsVertical,
  IconEyeOff,
  IconRefresh,
  IconSearch,
  IconUser,
  IconUsersGroup,
  IconVideo,
} from "@tabler/icons-react";
import { callAction } from "@/lib/api";
import { toast } from "sonner";

export async function loader({ params }: LoaderFunctionArgs) {
  const email = getRequestUserEmail();
  if (!email) throw new Response("Unauthenticated", { status: 401 });
  const status = (params.status as any) ?? "upcoming";
  const bookings = await listBookings({ hostEmail: email, status });
  return { bookings, status };
}

const TABS = [
  { id: "upcoming", label: "Upcoming" },
  { id: "unconfirmed", label: "Unconfirmed" },
  { id: "recurring", label: "Recurring" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Canceled" },
];

export default function BookingsPage() {
  const { bookings, status } = useLoaderData<typeof loader>();
  const rv = useRevalidator();
  const [q, setQ] = useState("");
  const [cancelTarget, setCancelTarget] = useState<any | null>(null);

  const filtered = useMemo(() => {
    if (!q.trim()) return bookings as any[];
    const term = q.toLowerCase();
    return (bookings as any[]).filter(
      (b) =>
        b.title?.toLowerCase().includes(term) ||
        b.attendees?.some(
          (a: any) =>
            a.name?.toLowerCase().includes(term) ||
            a.email?.toLowerCase().includes(term),
        ),
    );
  }, [bookings, q]);

  // Group by local-day ISO
  const groups = useMemo(() => {
    const byDay = new Map<string, any[]>();
    for (const b of filtered) {
      const tz = b.timezone || "UTC";
      const dayIso = format(
        startOfDay(new TZDate(new Date(b.startTime).getTime(), tz)),
        "yyyy-MM-dd",
      );
      if (!byDay.has(dayIso)) byDay.set(dayIso, []);
      byDay.get(dayIso)!.push(b);
    }
    const entries = Array.from(byDay.entries()).sort((a, b) =>
      a[0] < b[0] ? -1 : 1,
    );
    // For past/cancelled, reverse chronological
    if (status === "past" || status === "cancelled") entries.reverse();
    return entries;
  }, [filtered, status]);

  const cancelBooking = async () => {
    if (!cancelTarget) return;
    try {
      await callAction("cancel-booking", {
        uid: cancelTarget.uid,
        cancelledBy: "host",
      });
      toast.success("Booking cancelled");
      setCancelTarget(null);
      rv.revalidate();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex items-center gap-1 rounded-md bg-muted p-1">
          {TABS.map((t) => (
            <NavLink
              key={t.id}
              to={`/bookings/${t.id}`}
              className={({ isActive }) =>
                cn(
                  "rounded px-3 py-1 text-sm transition-none",
                  isActive
                    ? "bg-background font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="relative">
          <IconSearch className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            className="w-64 pl-9"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyBookings status={status} />
      ) : (
        <div className="space-y-6">
          {groups.map(([day, items]) => (
            <section key={day}>
              <h2 className="bookings-date-header mb-2 border-b border-border py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {formatDayLabel(day)}
              </h2>
              <ul className="divide-y divide-border rounded-md border border-border bg-card">
                {items.map((b) => (
                  <BookingRow
                    key={b.id}
                    booking={b}
                    onCancel={() => setCancelTarget(b)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <AlertDialog
        open={!!cancelTarget}
        onOpenChange={(o) => !o && setCancelTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget?.title
                ? `The attendee(s) will be notified that "${cancelTarget.title}" is cancelled.`
                : "The attendee(s) will be notified."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep booking</AlertDialogCancel>
            <AlertDialogAction
              onClick={cancelBooking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancel booking
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BookingRow({
  booking: b,
  onCancel,
}: {
  booking: any;
  onCancel: () => void;
}) {
  const tz = b.timezone || "UTC";
  const start = new TZDate(new Date(b.startTime).getTime(), tz);
  const end = new TZDate(new Date(b.endTime).getTime(), tz);
  const initials =
    b.attendees?.[0]?.name
      ?.split(/\s+/)
      .map((p: string) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ?? "?";
  const meetingUrl =
    b.references?.find((r: any) => r.meetingUrl)?.meetingUrl ?? null;

  const copyMeetingLink = () => {
    if (!meetingUrl) {
      toast.error("No meeting link");
      return;
    }
    navigator.clipboard?.writeText(meetingUrl);
    toast.success("Meeting link copied");
  };

  return (
    <li className="booking-row relative flex items-start gap-3 p-4 hover:bg-muted/30">
      <div className="mt-0.5 w-28 shrink-0 text-sm">
        <div className="font-medium">{format(start, "h:mm a")}</div>
        <div className="text-xs text-muted-foreground">
          {format(end, "h:mm a")}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/booking/${b.uid}`}
            className="truncate font-medium hover:underline"
          >
            {b.title}
          </Link>
          {b.status === "pending" && (
            <Badge
              variant="outline"
              className="border-amber-500/40 text-amber-600 dark:text-amber-400"
            >
              Unconfirmed
            </Badge>
          )}
          {b.status === "cancelled" && (
            <Badge variant="destructive">Cancelled</Badge>
          )}
          {b.status === "rescheduled" && (
            <Badge variant="secondary">Rescheduled</Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Avatar className="h-5 w-5">
              <AvatarFallback className="text-[10px]">
                {initials}
              </AvatarFallback>
            </Avatar>
            {b.attendees?.map((a: any) => a.name).join(", ")}
          </span>
          <span>•</span>
          <span>
            {format(start, "EEE, MMM d")} · {tz}
          </span>
          {b.location?.kind && (
            <>
              <span>•</span>
              <span className="flex items-center gap-1">
                <IconVideo className="h-3.5 w-3.5" />
                {locationLabel(b.location.kind)}
              </span>
            </>
          )}
        </div>
        {b.description && (
          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
            {b.description}
          </p>
        )}
      </div>
      <div className="hover-actions flex shrink-0 items-center gap-1">
        {meetingUrl && (
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={copyMeetingLink}
          >
            <IconCopy className="mr-1 h-3.5 w-3.5" /> Copy link
          </Button>
        )}
        <Button asChild size="sm" variant="outline" className="h-8">
          <Link to={`/reschedule/${b.uid}`}>
            <IconRefresh className="mr-1 h-3.5 w-3.5" />
            Reschedule
          </Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label="More"
            >
              <IconDotsVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to={`/booking/${b.uid}`}>View details</Link>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <IconEyeOff className="mr-2 h-4 w-4" />
              Mark as no-show
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onCancel}
            >
              <IconCalendarOff className="mr-2 h-4 w-4" />
              Cancel booking
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function EmptyBookings({ status }: { status: string }) {
  const label =
    status === "unconfirmed"
      ? "No bookings waiting for confirmation"
      : status === "recurring"
        ? "No recurring bookings"
        : status === "past"
          ? "No past bookings"
          : status === "cancelled"
            ? "No cancelled bookings"
            : "No upcoming bookings";
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <IconUsersGroup className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-base font-semibold">{label}</h2>
        <p className="text-sm text-muted-foreground">
          You'll see bookings here as they come in.
        </p>
      </div>
    </div>
  );
}

function formatDayLabel(iso: string): string {
  const d = parseISO(iso);
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE, MMMM d");
}

function locationLabel(kind: string): string {
  if (kind === "builtin-video") return "Video call";
  if (kind === "google-meet") return "Google Meet";
  if (kind === "zoom") return "Zoom";
  if (kind === "teams") return "Teams";
  if (kind === "phone") return "Phone";
  if (kind === "in-person") return "In person";
  return kind;
}

// suppress unused import warning in light of lazy features
void IconUser;
