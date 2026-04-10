import { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "react-router";
import {
  IconCalendar,
  IconSettings,
  IconLink,
  IconExternalLink,
  IconChevronUp,
  IconChevronDown,
  IconPlus,
  IconX,
  IconKeyboard,
  IconLogin,
  IconInfoCircle,
  IconCheck,
  IconEye,
  IconEyeOff,
} from "@tabler/icons-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useGoogleAuthStatus,
  useGoogleAuthUrl,
  useGoogleAddAccountUrl,
} from "@/hooks/use-google-auth";
import { useSession } from "@agent-native/core/client";
import { EVENT_CATEGORY_COLORS } from "@/lib/event-colors";
import {
  useOverlayPeople,
  useRemoveOverlayPerson,
  useUpdateOverlayPersonColor,
} from "@/hooks/use-overlay-people";
import {
  useExternalCalendars,
  useRemoveExternalCalendar,
  useUpdateExternalCalendarColor,
} from "@/hooks/use-external-calendars";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useCalendarContext } from "./AppLayout";
import { ThemeToggle } from "@/components/ThemeToggle";

const navItems = [
  { path: "/", label: "Calendar", icon: IconCalendar },
  { path: "/booking-links", label: "Booking Links", icon: IconLink },
  { path: "/settings", label: "Settings", icon: IconSettings },
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
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <IconChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMonth(addMonths(viewMonth, 1))}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <IconChevronDown className="h-3.5 w-3.5" />
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
          <IconExternalLink className="h-3 w-3" />
          {authUrl.isLoading ? "Connecting..." : "Connect"}
        </Button>
      </div>
    </div>
  );
}

const CALENDAR_COLORS = [
  "#5B9BD5", // blue
  "#7C9C6B", // sage
  "#B07CC6", // purple
  "#D4A053", // amber
  "#CD6B6B", // coral
  "#4ECDC4", // teal
  "#8B8FA3", // slate
];

const COLOR_MODE_KEY = "calendar-color-mode";
const CALENDAR_COLOR_KEY = "calendar-single-color";

/** A conic-gradient dot indicating "multiple colors" (by-type mode) */
function MultiColorDot({ className }: { className?: string }) {
  const colors = Object.values(EVENT_CATEGORY_COLORS).filter((_, i) => i < 4);
  const pct = 100 / colors.length;
  const stops = colors
    .map((c, i) => `${c} ${i * pct}% ${(i + 1) * pct}%`)
    .join(", ");
  return (
    <span
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{ background: `conic-gradient(${stops})` }}
    />
  );
}

/** Popover color picker for a single-color selection */
function ColorPickerPopover({
  color,
  onColorChange,
  children,
}: {
  color: string;
  onColorChange: (color: string) => void;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-auto p-2">
        <div className="flex flex-wrap gap-1.5" style={{ width: 120 }}>
          {CALENDAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onColorChange(c)}
              className="relative h-5 w-5 rounded-full"
              style={{ backgroundColor: c }}
            >
              {c === color && (
                <IconCheck className="absolute inset-0 m-auto h-3 w-3 text-white drop-shadow" />
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GoogleAccountsSection({
  accounts,
}: {
  accounts: Array<{ email: string }>;
}) {
  const { toggleHiddenCalendar, isHiddenCalendar } = useCalendarContext();
  const [wantAddAccount, setWantAddAccount] = useState(false);
  const addAccountUrl = useGoogleAddAccountUrl(wantAddAccount);
  const [colorMode, setColorMode] = useState<"multi" | "single">(() => {
    try {
      return (
        (localStorage.getItem(COLOR_MODE_KEY) as "multi" | "single") || "multi"
      );
    } catch {
      return "multi";
    }
  });
  const [singleColor, setSingleColor] = useState(() => {
    try {
      return localStorage.getItem(CALENDAR_COLOR_KEY) || CALENDAR_COLORS[0];
    } catch {
      return CALENDAR_COLORS[0];
    }
  });

  useEffect(() => {
    if (!wantAddAccount || !addAccountUrl.data?.url) return;
    window.open(addAccountUrl.data.url, "_blank");
    setWantAddAccount(false);
  }, [wantAddAccount, addAccountUrl.data]);

  function handlePickColor(color: string) {
    setSingleColor(color);
    setColorMode("single");
    try {
      localStorage.setItem(CALENDAR_COLOR_KEY, color);
      localStorage.setItem(COLOR_MODE_KEY, "single");
    } catch {}
  }

  function handleSetMulti() {
    setColorMode("multi");
    try {
      localStorage.setItem(COLOR_MODE_KEY, "multi");
    } catch {}
  }

  return (
    <div className="border-t border-border px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          My Calendars
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setWantAddAccount(true)}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            title="Add Google account"
          >
            <IconPlus className="h-3.5 w-3.5" />
          </button>
          <Link
            to="/settings"
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            title="Google Calendar settings"
          >
            <IconSettings className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {accounts.map((account) => (
        <div
          key={account.email}
          className="group flex items-center gap-2 py-0.5"
        >
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="shrink-0 cursor-pointer rounded-full p-0.5 hover:ring-2 hover:ring-border"
              >
                {colorMode === "multi" ? (
                  <MultiColorDot
                    className={cn(
                      "h-2.5 w-2.5",
                      isHiddenCalendar("accounts", account.email) &&
                        "opacity-40",
                    )}
                  />
                ) : (
                  <span
                    className={cn(
                      "block h-2.5 w-2.5 rounded-full",
                      isHiddenCalendar("accounts", account.email) &&
                        "opacity-40",
                    )}
                    style={{ backgroundColor: singleColor }}
                  />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent side="right" align="start" className="w-auto p-2">
              <div className="flex flex-wrap gap-1.5" style={{ width: 132 }}>
                {/* Multicolor "by type" option */}
                <Tooltip delayDuration={700}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleSetMulti}
                      className="relative flex h-5 w-5 items-center justify-center rounded-full"
                    >
                      <MultiColorDot className="h-5 w-5" />
                      {colorMode === "multi" && (
                        <IconCheck className="absolute inset-0 m-auto h-3 w-3 text-white drop-shadow" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[160px] text-xs">
                    Color by meeting type (external, internal, 1:1, group, etc.)
                  </TooltipContent>
                </Tooltip>
                {/* Single color options */}
                {CALENDAR_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => handlePickColor(c)}
                    className="relative h-5 w-5 rounded-full"
                    style={{ backgroundColor: c }}
                  >
                    {c === singleColor && colorMode === "single" && (
                      <IconCheck className="absolute inset-0 m-auto h-3 w-3 text-white drop-shadow" />
                    )}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <p
            className={cn(
              "min-w-0 flex-1 truncate text-xs",
              isHiddenCalendar("accounts", account.email)
                ? "text-muted-foreground/40"
                : "text-muted-foreground",
            )}
          >
            {account.email}
          </p>
          <button
            type="button"
            onClick={() => toggleHiddenCalendar("accounts", account.email)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-0 hover:text-foreground group-hover:opacity-100"
          >
            {isHiddenCalendar("accounts", account.email) ? (
              <IconEyeOff className="h-3 w-3" />
            ) : (
              <IconEye className="h-3 w-3" />
            )}
          </button>
        </div>
      ))}
    </div>
  );
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const location = useLocation();
  const {
    selectedDate,
    setSelectedDate,
    setAddCalendarOpen,
    setAddCalendarDefaultTab,
    toggleHiddenCalendar,
    isHiddenCalendar,
  } = useCalendarContext();
  const googleStatus = useGoogleAuthStatus();
  const { session } = useSession();
  const { data: rawOverlayPeople } = useOverlayPeople();
  const overlayPeople = Array.isArray(rawOverlayPeople) ? rawOverlayPeople : [];
  const removePerson = useRemoveOverlayPerson();
  const updatePersonColor = useUpdateOverlayPersonColor();
  const { data: rawExternalCalendars } = useExternalCalendars();
  const externalCalendars = Array.isArray(rawExternalCalendars)
    ? rawExternalCalendars
    : [];
  const removeExternal = useRemoveExternalCalendar();
  const updateExternalColor = useUpdateExternalCalendarColor();
  const isConnected = googleStatus.data?.connected ?? false;
  const isLocalMode = session?.email === "local@localhost";

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

        {/* Google status / connect CTA */}
        {!googleStatus.isLoading && !isConnected && (
          <GoogleConnectSidebarButton />
        )}

        {isConnected && googleStatus.data?.accounts?.length > 0 && (
          <GoogleAccountsSection accounts={googleStatus.data.accounts} />
        )}

        {/* Other Calendars — people overlays + external ICS feeds combined */}
        <div className="border-t border-border px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Other Calendars
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center text-muted-foreground/40 hover:text-muted-foreground cursor-default">
                    <IconInfoCircle className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>
                    View teammates' calendars or subscribe to ICS/webcal feeds
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <button
              type="button"
              onClick={() => {
                setAddCalendarDefaultTab("people");
                setAddCalendarOpen(true);
              }}
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <IconPlus className="h-3.5 w-3.5" />
            </button>
          </div>
          {(overlayPeople.length > 0 || externalCalendars.length > 0) && (
            <div className="mt-1 space-y-0.5">
              {overlayPeople.map((person) => (
                <div
                  key={person.email}
                  className="group flex items-center gap-2 text-xs"
                >
                  <ColorPickerPopover
                    color={person.color}
                    onColorChange={(color) =>
                      updatePersonColor.mutate({ email: person.email, color })
                    }
                  >
                    <button
                      type="button"
                      className="shrink-0 cursor-pointer rounded-full p-0.5 hover:ring-2 hover:ring-border"
                    >
                      <span
                        className={cn(
                          "block h-2.5 w-2.5 rounded-full",
                          isHiddenCalendar("people", person.email) &&
                            "opacity-40",
                        )}
                        style={{ backgroundColor: person.color }}
                      />
                    </button>
                  </ColorPickerPopover>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      isHiddenCalendar("people", person.email)
                        ? "text-muted-foreground/40"
                        : "text-muted-foreground",
                    )}
                  >
                    {person.name || person.email}
                  </span>
                  <div className="flex items-center opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() =>
                        toggleHiddenCalendar("people", person.email)
                      }
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground"
                    >
                      {isHiddenCalendar("people", person.email) ? (
                        <IconEyeOff className="h-3 w-3" />
                      ) : (
                        <IconEye className="h-3 w-3" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => removePerson.mutate(person.email)}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground"
                    >
                      <IconX className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
              {externalCalendars.map((cal) => (
                <div
                  key={cal.id}
                  className="group flex items-center gap-2 text-xs"
                >
                  <ColorPickerPopover
                    color={cal.color}
                    onColorChange={(color) =>
                      updateExternalColor.mutate({ id: cal.id, color })
                    }
                  >
                    <button
                      type="button"
                      className="shrink-0 cursor-pointer rounded-full p-0.5 hover:ring-2 hover:ring-border"
                    >
                      <span
                        className={cn(
                          "block h-2.5 w-2.5 rounded-full",
                          isHiddenCalendar("external", cal.id) && "opacity-40",
                        )}
                        style={{ backgroundColor: cal.color }}
                      />
                    </button>
                  </ColorPickerPopover>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      isHiddenCalendar("external", cal.id)
                        ? "text-muted-foreground/40"
                        : "text-muted-foreground",
                    )}
                  >
                    {cal.name}
                  </span>
                  <div className="flex items-center opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => toggleHiddenCalendar("external", cal.id)}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground"
                    >
                      {isHiddenCalendar("external", cal.id) ? (
                        <IconEyeOff className="h-3 w-3" />
                      ) : (
                        <IconEye className="h-3 w-3" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeExternal.mutate(cal.id)}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground"
                    >
                      <IconX className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sign in prompt for local-mode users */}
        {isLocalMode && (
          <div className="border-t border-border px-3 py-2">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={async () => {
                await fetch("/_agent-native/auth/exit-local-mode", {
                  method: "POST",
                });
                window.location.reload();
              }}
            >
              <IconLogin className="h-3.5 w-3.5" />
              Sign in or create account
            </button>
          </div>
        )}

        {/* Theme toggle */}
        <div className="flex items-center gap-1 border-t border-border px-3 py-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={() =>
                  window.dispatchEvent(new Event("calendar:open-shortcuts"))
                }
              >
                <IconKeyboard className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>
                Keyboard shortcuts{" "}
                <kbd className="ml-1 rounded border border-border bg-muted px-1 font-mono text-[10px]">
                  ?
                </kbd>
              </p>
            </TooltipContent>
          </Tooltip>
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
