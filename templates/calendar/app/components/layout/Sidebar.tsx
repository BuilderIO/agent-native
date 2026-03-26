import { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "react-router";
import {
  CalendarDays,
  Clock,
  Users,
  Settings,
  ExternalLink,
  ChevronUp,
  ChevronDown,
  Plus,
  X,
} from "lucide-react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  isToday,
  format,
} from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useGoogleAuthStatus, useGoogleAuthUrl } from "@/hooks/use-google-auth";
import {
  useOverlayPeople,
  useRemoveOverlayPerson,
} from "@/hooks/use-overlay-people";
import { useCalendarContext } from "./AppLayout";
import { ThemeToggle } from "@/components/ThemeToggle";

const navItems = [
  { path: "/", label: "Calendar", icon: CalendarDays },
  { path: "/availability", label: "Availability", icon: Clock },
  { path: "/bookings", label: "Bookings", icon: Users },
  { path: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

function MiniCalendar({
  selectedDate,
  onDateSelect,
}: {
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selectedDate));

  // Sync viewMonth when selectedDate changes to a different month
  useEffect(() => {
    if (!isSameMonth(viewMonth, selectedDate)) {
      setViewMonth(startOfMonth(selectedDate));
    }
  }, [selectedDate]);

  const days = useMemo(() => {
    const monthStart = startOfMonth(viewMonth);
    const monthEnd = endOfMonth(viewMonth);
    const calStart = startOfWeek(monthStart);
    const calEnd = endOfWeek(monthEnd);

    const result: Date[] = [];
    let current = calStart;
    while (current <= calEnd) {
      result.push(current);
      current = addDays(current, 1);
    }
    return result;
  }, [viewMonth]);

  const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  return (
    <div className="px-3 py-3">
      {/* Month header with navigation */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">
          {format(viewMonth, "MMMM yyyy")}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setViewMonth(subMonths(viewMonth, 1))}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setViewMonth(addMonths(viewMonth, 1))}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="mb-0.5 grid grid-cols-7">
        {weekdays.map((d) => (
          <div
            key={d}
            className="flex h-6 items-center justify-center text-[10px] font-medium text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Date grid */}
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const inMonth = isSameMonth(day, viewMonth);
          const today = isToday(day);
          const selected = isSameDay(day, selectedDate);

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onDateSelect(day)}
              className={cn(
                "flex h-6 w-full items-center justify-center rounded-full text-[11px] transition-colors",
                !inMonth && "text-muted-foreground/40",
                inMonth &&
                  !today &&
                  !selected &&
                  "text-foreground/80 hover:bg-accent",
                today &&
                  !selected &&
                  "bg-primary font-semibold text-primary-foreground",
                selected &&
                  !today &&
                  "ring-1 ring-primary font-semibold text-primary",
                selected &&
                  today &&
                  "bg-primary font-semibold text-primary-foreground ring-1 ring-primary ring-offset-1 ring-offset-card",
              )}
            >
              {format(day, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GoogleConnectSidebarButton() {
  const [wantAuthUrl, setWantAuthUrl] = useState(false);
  const authUrl = useGoogleAuthUrl(wantAuthUrl);

  useEffect(() => {
    if (authUrl.data?.url) {
      window.open(authUrl.data.url, "_blank");
      setWantAuthUrl(false);
    }
  }, [authUrl.data]);

  return (
    <div className="border-t border-border p-3">
      <div className="rounded-lg bg-primary/10 p-3">
        <p className="mb-1 text-xs font-semibold text-foreground">
          Connect Google Calendar
        </p>
        <p className="mb-2.5 text-[11px] leading-relaxed text-muted-foreground">
          Sync your events and manage everything in one place.
        </p>
        <Button
          size="sm"
          className="w-full gap-1.5 text-xs font-semibold"
          onClick={() => setWantAuthUrl(true)}
          disabled={authUrl.isLoading || authUrl.isFetching}
        >
          <ExternalLink className="h-3 w-3" />
          {authUrl.isLoading ? "Connecting..." : "Connect"}
        </Button>
      </div>
    </div>
  );
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const location = useLocation();
  const { selectedDate, setSelectedDate, setPeopleSearchOpen } =
    useCalendarContext();
  const googleStatus = useGoogleAuthStatus();
  const { data: overlayPeople = [] } = useOverlayPeople();
  const removePerson = useRemoveOverlayPerson();
  const isConnected = googleStatus.data?.connected ?? false;

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 z-50 flex h-full w-56 flex-col border-r border-border bg-card transition-transform duration-200 lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Logo */}
        <div className="flex h-14 items-center justify-between gap-2.5 border-b border-border px-4">
          <span className="text-base font-semibold tracking-tight">
            Calendar
          </span>
        </div>

        {/* Mini calendar */}
        <MiniCalendar
          selectedDate={selectedDate}
          onDateSelect={setSelectedDate}
        />

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 border-t border-border p-2.5">
          {navItems.map((item) => {
            const isActive =
              item.path === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.path);

            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* People overlay */}
        <div className="border-t border-border px-3 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              People
            </span>
            <button
              type="button"
              onClick={() => setPeopleSearchOpen(true)}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {overlayPeople.length > 0 && (
            <div className="space-y-1">
              {overlayPeople.map((person) => (
                <div
                  key={person.email}
                  className="flex items-center gap-2 text-xs"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: person.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {person.name || person.email}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePerson.mutate(person.email)}
                    className="shrink-0 rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {overlayPeople.length === 0 && (
            <p className="text-[11px] text-muted-foreground/60">
              View teammates' calendars
            </p>
          )}
        </div>

        {/* Google status / connect CTA */}
        {!googleStatus.isLoading && !isConnected && (
          <GoogleConnectSidebarButton />
        )}

        {isConnected && googleStatus.data?.accounts?.length > 0 && (
          <div className="border-t border-border px-3 py-3">
            {googleStatus.data.accounts.map((account) => (
              <div key={account.email} className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-foreground/40" />
                <p className="truncate text-xs text-muted-foreground">
                  {account.email}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Theme toggle */}
        <div className="border-t border-border px-3 py-2 flex items-center">
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
