import { DevDatabaseLink } from "@agent-native/core/client/db-admin";
import { useT } from "@agent-native/core/client/i18n";
import { startWorkspaceProviderOAuth } from "@agent-native/core/client/integrations";
import { openCommandMenu } from "@agent-native/core/client/navigation";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  AppSidebar,
  AppSidebarNavItem,
  FeedbackButton,
  type AppSidebarItemDefinition,
} from "@agent-native/core/client/ui";
import { getWeekdayOrder, getWeekStartsOn } from "@shared/calendar-week";
import {
  IconCalendar,
  IconSettings,
  IconLink,
  IconExternalLink,
  IconChevronUp,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
  IconX,
  IconInfoCircle,
  IconCheck,
  IconEye,
  IconEyeOff,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconSearch,
  IconAlertTriangle,
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
  setMonth,
  setYear,
  getMonth,
  getYear,
} from "date-fns";
import { useState, useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOverlayCalendarStatus } from "@/hooks/use-events";
import {
  useExternalCalendars,
  useRemoveExternalCalendar,
  useUpdateExternalCalendarColor,
} from "@/hooks/use-external-calendars";
import {
  useGoogleAuthStatus,
  useGoogleDesktopAuth,
} from "@/hooks/use-google-auth";
import { useGoogleCalendars } from "@/hooks/use-google-calendars";
import {
  useOverlayPeople,
  useRemoveOverlayPerson,
  useUpdateOverlayPersonColor,
} from "@/hooks/use-overlay-people";
import { useSettings } from "@/hooks/use-settings";
import { useViewPreferences } from "@/hooks/use-view-preferences";
import {
  CALENDAR_COLORS,
  type CalendarColorMode,
} from "@/lib/calendar-view-preferences";
import { EVENT_CATEGORY_COLORS } from "@/lib/event-colors";
import { shouldOfferGoogleOAuthSetup } from "@/lib/google-oauth-setup";
import { cn } from "@/lib/utils";

import { useCalendarContext } from "./AppLayout";

const navItems = [
  { path: "/home", labelKey: "navigation.calendar", icon: IconCalendar },
  {
    path: "/booking-links",
    labelKey: "navigation.bookingLinks",
    icon: IconLink,
  },
];

const bottomNavItems = [
  { path: "/settings", labelKey: "navigation.settings", icon: IconSettings },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function MonthYearPicker({
  viewMonth,
  onPick,
  onClose,
}: {
  viewMonth: Date;
  onPick: (date: Date) => void;
  onClose: () => void;
}) {
  const [year, setYearState] = useState(() => getYear(viewMonth));
  const today = new Date();
  const todayMonth = getMonth(today);
  const todayYear = getYear(today);
  const viewedMonthIdx = getMonth(viewMonth);
  const viewedYear = getYear(viewMonth);
  const t = useT();

  return (
    <div className="w-56 p-2">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setYearState(year - 1)}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("sidebar.previousYear")}
        >
          <IconChevronLeft className="h-3.5 w-3.5 rtl:-scale-x-100" />
        </button>
        <span className="text-sm font-semibold">{year}</span>
        <button
          type="button"
          onClick={() => setYearState(year + 1)}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={t("sidebar.nextYear")}
        >
          <IconChevronRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {MONTH_LABELS.map((label, idx) => {
          const isCurrent = idx === todayMonth && year === todayYear;
          const isSelected = idx === viewedMonthIdx && year === viewedYear;
          return (
            <button
              key={label}
              type="button"
              onClick={() => {
                onPick(setMonth(setYear(viewMonth, year), idx));
                onClose();
              }}
              className={cn(
                "flex h-8 items-center justify-center rounded text-xs",
                isSelected
                  ? "bg-primary text-primary-foreground font-semibold"
                  : isCurrent
                    ? "ring-1 ring-primary text-foreground hover:bg-accent"
                    : "text-foreground hover:bg-accent",
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MiniCalendar({
  selectedDate,
  onDateSelect,
}: {
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selectedDate));
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data: settings } = useSettings();
  const weekStartsOn = getWeekStartsOn(settings?.weekStart);

  // Sync viewMonth when selectedDate changes without undoing explicit month navigation.
  useEffect(() => {
    setViewMonth((currentMonth) =>
      isSameMonth(currentMonth, selectedDate)
        ? currentMonth
        : startOfMonth(selectedDate),
    );
  }, [selectedDate]);

  const days = useMemo(() => {
    const monthStart = startOfMonth(viewMonth);
    const monthEnd = endOfMonth(viewMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn });

    const result: Date[] = [];
    let current = calStart;
    while (current <= calEnd) {
      result.push(current);
      current = addDays(current, 1);
    }
    return result;
  }, [viewMonth, weekStartsOn]);

  const weekdays = getWeekdayOrder(weekStartsOn).map(
    (day) => ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][day],
  );

  return (
    <div className="px-3 py-3">
      {/* Month header with navigation */}
      <div className="mb-2 flex items-center justify-between">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="-ms-1 flex items-center gap-1 rounded px-1 py-0.5 text-xs font-medium text-foreground hover:bg-accent"
            >
              {format(viewMonth, "MMMM yyyy")}
              <IconChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={4} className="w-auto p-0">
            <MonthYearPicker
              viewMonth={viewMonth}
              onPick={(d) => setViewMonth(startOfMonth(d))}
              onClose={() => setPickerOpen(false)}
            />
          </PopoverContent>
        </Popover>
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
  const t = useT();
  const {
    isDesktopGoogleAuth,
    isGoogleDesktopAuthPending,
    startDesktopGoogleAuth,
  } = useGoogleDesktopAuth({
    onError: (issue) =>
      toast.error(issue.message || issue.error || t("settings.googleFailed")),
    onSuccess: () => window.location.reload(),
  });

  function handleConnect() {
    if (isDesktopGoogleAuth) {
      startDesktopGoogleAuth({ previousAccountCount: 0 });
      return;
    }
    const returnPath = `${window.location.pathname}${window.location.search}`;
    startWorkspaceProviderOAuth("google_calendar", {
      appId: "calendar",
      returnPath,
      scope: "user",
    });
  }

  return (
    <div className="p-3">
      <div className="rounded-lg bg-primary/10 p-3">
        <p className="mb-1 text-xs font-semibold text-foreground">
          {t("settings.connectGoogleCalendar")}
        </p>
        <p className="mb-2.5 text-[11px] leading-relaxed text-muted-foreground">
          {t("settings.connectGoogleDescription")}
        </p>
        <Button
          size="sm"
          className="w-full gap-1.5 text-xs font-semibold"
          onClick={handleConnect}
          disabled={isGoogleDesktopAuthPending}
        >
          <IconExternalLink className="h-3 w-3" />
          {isGoogleDesktopAuthPending
            ? t("common.connecting")
            : t("common.connect")}
        </Button>
      </div>
    </div>
  );
}

/** A conic-gradient dot indicating "multiple colors" (by-type mode). */
function MultiColorDot({ className }: { className?: string }) {
  const colors = Object.values(EVENT_CATEGORY_COLORS).slice(0, 4);
  const pct = 100 / colors.length;
  const stops = colors
    .map((color, index) => `${color} ${index * pct}% ${(index + 1) * pct}%`)
    .join(", ");
  return (
    <span
      aria-hidden="true"
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

function GoogleCalendarsSections({
  onClose,
  section = "owned",
}: {
  onClose: () => void;
  section?: "owned" | "other";
}) {
  const t = useT();
  const { setAddCalendarOpen, setAddCalendarDefaultTab } = useCalendarContext();
  const [showAllCalendars, setShowAllCalendars] = useState(false);
  const { data: calendars, enabled } = useGoogleCalendars();
  const {
    prefs: {
      accountColorModes,
      accountColors,
      colorMode,
      googleCalendarColors,
      googleCalendarVisibility,
      singleColor,
    },
    updateAccountColorMode,
    updateGoogleCalendarColor,
    updateGoogleCalendarVisibility,
  } = useViewPreferences();
  const readableCalendars = useMemo(
    () =>
      (calendars ?? []).filter(
        (calendar) => calendar.accessRole !== "freeBusyReader",
      ),
    [calendars],
  );
  const ownedCalendars = readableCalendars.filter(
    (calendar) => calendar.accessRole === "owner",
  );
  const otherCalendars = readableCalendars.filter(
    (calendar) => calendar.accessRole !== "owner",
  );
  function renderCalendarRow(calendar: (typeof readableCalendars)[number]) {
    const preferenceKey = calendar.canonicalKey;
    const displayName =
      section === "owned" && calendar.primary
        ? calendar.accountEmail
        : calendar.name;
    const visible =
      googleCalendarVisibility[preferenceKey] ??
      (calendar.primary || calendar.selected);
    const sourceColor = googleCalendarColors[preferenceKey];
    const mode: CalendarColorMode | undefined = calendar.primary
      ? (accountColorModes[calendar.accountEmail] ?? colorMode)
      : undefined;
    const color =
      sourceColor ??
      (mode === "single"
        ? (accountColors[calendar.accountEmail] ?? singleColor)
        : (calendar.color ?? CALENDAR_COLORS[6]));
    const isDefault = !sourceColor && mode !== "multi";
    return (
      <div
        key={preferenceKey}
        className="group flex min-h-7 items-center gap-2 px-2 text-xs"
      >
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${t("eventForm.color")}: ${displayName}`}
              className="shrink-0 cursor-pointer rounded-full p-0.5 hover:ring-2 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "block size-2.5 rounded-full ring-1 ring-border",
                  !visible && "opacity-40",
                )}
                style={{ backgroundColor: color }}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-auto p-2">
            <div className="mb-1.5 text-xs font-medium">
              {t("eventForm.color")}
            </div>
            <div className="flex max-w-[132px] flex-wrap gap-1.5">
              {calendar.primary && (
                <Tooltip delayDuration={700}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() =>
                        updateAccountColorMode(
                          calendar.accountEmail,
                          "multi",
                          preferenceKey,
                        )
                      }
                      aria-label={t("sidebar.colorByMeetingType")}
                      className="relative flex size-5 items-center justify-center rounded-full"
                    >
                      <MultiColorDot className="size-5" />
                      {mode === "multi" && !sourceColor && (
                        <IconCheck className="absolute inset-0 m-auto size-3 text-primary-foreground drop-shadow" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[160px] text-xs">
                    {t("sidebar.colorByMeetingType")}
                  </TooltipContent>
                </Tooltip>
              )}
              <button
                type="button"
                onClick={() => updateGoogleCalendarColor(preferenceKey, null)}
                aria-label={t("eventForm.default")}
                className="relative size-5 rounded-full ring-1 ring-border"
                style={{
                  backgroundColor: calendar.color || CALENDAR_COLORS[6],
                }}
              >
                {isDefault && (
                  <IconCheck className="absolute inset-0 m-auto size-3 text-primary-foreground drop-shadow" />
                )}
              </button>
              {CALENDAR_COLORS.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() =>
                    updateGoogleCalendarColor(preferenceKey, candidate)
                  }
                  aria-label={candidate}
                  className="relative size-5 rounded-full"
                  style={{ backgroundColor: candidate }}
                >
                  {googleCalendarColors[preferenceKey] === candidate && (
                    <IconCheck className="absolute inset-0 m-auto size-3 text-primary-foreground drop-shadow" />
                  )}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            visible ? "text-muted-foreground" : "text-muted-foreground/40",
          )}
        >
          {displayName}
        </span>
        <button
          type="button"
          onClick={() =>
            updateGoogleCalendarVisibility(preferenceKey, !visible)
          }
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={
            visible ? t("sidebar.hideCalendar") : t("sidebar.showCalendar")
          }
          aria-pressed={visible}
        >
          {visible ? (
            <IconEye className="size-3" />
          ) : (
            <IconEyeOff className="size-3" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="px-1.5 py-1.5">
      {section === "owned" && (
        <div className="mb-1 flex min-h-8 items-center justify-between px-3">
          <div className="flex items-center">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("sidebar.myCalendars")}
            </span>
          </div>
          <div className="flex items-center">
            <button
              type="button"
              aria-label={t("sidebar.addGoogleAccount")}
              onClick={() => {
                setAddCalendarDefaultTab("google");
                setAddCalendarOpen(true);
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <IconPlus className="h-3.5 w-3.5" />
            </button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/settings"
                  onClick={onClose}
                  className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                >
                  <IconSettings className="h-3.5 w-3.5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent>
                {t("sidebar.googleCalendarSettings")}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      {enabled &&
        (section === "owned"
          ? ownedCalendars
          : showAllCalendars
            ? otherCalendars
            : otherCalendars.slice(0, 8)
        ).map(renderCalendarRow)}
      {enabled && section === "other" && otherCalendars.length > 8 && (
        <button
          type="button"
          onClick={() => setShowAllCalendars((current) => !current)}
          className="mx-3 mt-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {
            showAllCalendars
              ? t("common.showLess") // i18n-key-ignore generated calendar catalog
              : t("common.showMore") // i18n-key-ignore generated calendar catalog
          }{" "}
          ({otherCalendars.length - 8})
        </button>
      )}
    </div>
  );
}

export function Sidebar({
  open,
  onClose,
  collapsed = false,
  onCollapsedChange,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const {
    selectedDate,
    setSelectedDate,
    setAddCalendarOpen,
    setAddCalendarDefaultTab,
    toggleHiddenCalendar,
    isHiddenCalendar,
  } = useCalendarContext();
  const googleStatus = useGoogleAuthStatus();
  const { data: rawOverlayPeople } = useOverlayPeople();
  const overlayPeople = Array.isArray(rawOverlayPeople) ? rawOverlayPeople : [];
  const removePerson = useRemoveOverlayPerson();
  const updatePersonColor = useUpdateOverlayPersonColor();
  const overlayEmails = useMemo(
    () => overlayPeople.map((person) => person.email),
    [overlayPeople],
  );
  const overlayStatusByEmail = useOverlayCalendarStatus(overlayEmails);
  const { data: rawExternalCalendars } = useExternalCalendars();
  const externalCalendars = Array.isArray(rawExternalCalendars)
    ? rawExternalCalendars
    : [];
  const removeExternal = useRemoveExternalCalendar();
  const updateExternalColor = useUpdateExternalCalendarColor();
  const isConnected = googleStatus.data?.connected ?? false;
  const canOfferGoogleOAuthSetup = useMemo(
    () => shouldOfferGoogleOAuthSetup(),
    [],
  );
  const [peopleGroupOpen, setPeopleGroupOpen] = useState(
    () => overlayPeople.length <= 2, // i18n-ignore scanner false positive
  );
  const [feedsGroupOpen, setFeedsGroupOpen] = useState(
    () => externalCalendars.length <= 2, // i18n-ignore scanner false positive
  );

  useEffect(() => {
    if (overlayPeople.length <= 2) setPeopleGroupOpen(true);
  }, [overlayPeople.length]);

  useEffect(() => {
    if (externalCalendars.length <= 2) setFeedsGroupOpen(true);
  }, [externalCalendars.length]);

  function handleMiniCalendarDateSelect(date: Date) {
    setSelectedDate(date);
    if (location.pathname !== "/home") {
      void navigate("/home");
    }
    onClose();
  }

  const collapseButton = onCollapsedChange ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          onClick={() => onCollapsedChange(!collapsed)}
          aria-label={
            collapsed
              ? t("sidebar.expandSidebar")
              : t("sidebar.collapseSidebar")
          }
        >
          {collapsed ? (
            <IconLayoutSidebarLeftExpand className="h-4 w-4 rtl:-scale-x-100" />
          ) : (
            <IconLayoutSidebarLeftCollapse className="h-4 w-4 rtl:-scale-x-100" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {collapsed ? t("sidebar.expandSidebar") : t("sidebar.collapseSidebar")}
      </TooltipContent>
    </Tooltip>
  ) : null;
  const searchButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={openCommandMenu}
          aria-label={t("root.commandSearch")}
        >
          <IconSearch className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{t("root.commandSearch")}</TooltipContent>
    </Tooltip>
  );
  const secondaryItems: AppSidebarItemDefinition[] = bottomNavItems.map((item) => ({
    to: item.path,
    label: t(item.labelKey),
    icon: item.icon,
    active: location.pathname.startsWith(item.path),
    onClick: onClose,
  }));

  const feedbackButton = (
    <FeedbackButton
      variant={collapsed ? "icon" : "sidebar"}
      side="right"
    />
  );

  const orgSwitcher = (
    <OrgSwitcher
      compact={collapsed}
    />
  );

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <AppSidebar
        collapsed={collapsed}
        collapsible={Boolean(onCollapsedChange)}
        onCollapsedChange={onCollapsedChange}
        brandName={t("navigation.brand")}
        brandHref="/home"
        secondaryItems={secondaryItems}
        feedback={feedbackButton}
        orgSwitcher={orgSwitcher}
        footerExtras={<DevDatabaseLink />}
        className={cn(
          "calendar-app-sidebar",
          open
            ? "translate-x-0"
            : "-translate-x-full rtl:translate-x-full lg:translate-x-0",
        )}
      >
        {collapsed ? (
          navItems.map((item) => {
            const isActive =
              item.path === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.path);
            return (
              <AppSidebarNavItem
                key={item.path}
                to={item.path}
                label={t(item.labelKey)}
                icon={item.icon}
                active={isActive}
                onClick={onClose}
              />
            );
          })
        ) : (
          <>
            {/* Mini calendar */}
            <MiniCalendar
              selectedDate={selectedDate}
              onDateSelect={handleMiniCalendarDateSelect}
            />

            {/* Nav */}
            <div className="space-y-0.5">
              {navItems.map((item) => {
                const isActive =
                  item.path === "/"
                    ? location.pathname === "/"
                    : location.pathname.startsWith(item.path);

                return (
                  <AppSidebarNavItem
                    key={item.path}
                    to={item.path}
                    label={t(item.labelKey)}
                    icon={item.icon}
                    active={isActive}
                    onClick={onClose}
                  />
                );
              })}
            </div>

              {/* Google status / connect CTA */}
              {!googleStatus.isLoading &&
                !isConnected &&
                (googleStatus.data?.configured === true ||
                  canOfferGoogleOAuthSetup) && <GoogleConnectSidebarButton />}

              {isConnected &&
                (googleStatus.data?.accounts?.length ?? 0) > 0 && (
                  <GoogleCalendarsSections onClose={onClose} />
                )}

              {/* Other Calendars — people overlays + external ICS feeds combined */}
              <div className="px-1.5 py-1.5">
                <div className="flex min-h-8 items-center justify-between px-3">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {t("sidebar.otherCalendars")}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center text-muted-foreground/40 hover:text-muted-foreground cursor-default">
                          <IconInfoCircle className="h-3 w-3" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent
                        side="right"
                        className="pointer-events-none"
                      >
                        <p>{t("sidebar.otherCalendarsDescription")}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <button
                    type="button"
                    aria-label={t("eventForm.addCalendar")}
                    onClick={() => {
                      setAddCalendarDefaultTab("people");
                      setAddCalendarOpen(true);
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  >
                    <IconPlus className="h-3.5 w-3.5" />
                  </button>
                </div>
                {isConnected &&
                  (googleStatus.data?.accounts?.length ?? 0) > 0 && (
                    <GoogleCalendarsSections
                      onClose={onClose}
                      section="other"
                    />
                  )}
                {(overlayPeople.length > 0 || externalCalendars.length > 0) && (
                  <div className="mt-1 space-y-1">
                    {overlayPeople.length > 0 && (
                      <Collapsible
                        open={peopleGroupOpen}
                        onOpenChange={setPeopleGroupOpen}
                      >
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="flex h-7 w-full items-center gap-1 rounded px-3 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                          >
                            {peopleGroupOpen ? (
                              <IconChevronDown className="h-3 w-3" />
                            ) : (
                              <IconChevronRight className="h-3 w-3 rtl:-scale-x-100" />
                            )}
                            <span className="min-w-0 flex-1 text-start">
                              People
                            </span>
                            <span className="text-[10px]">
                              {overlayPeople.length}
                            </span>
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-0.5">
                          {overlayPeople.map((person) => (
                            <div
                              key={person.email}
                              className="group flex min-h-7 items-center gap-2 px-2 text-xs"
                            >
                              <ColorPickerPopover
                                color={person.color}
                                onColorChange={(color) =>
                                  updatePersonColor.mutate({
                                    email: person.email,
                                    color,
                                  })
                                }
                              >
                                <button
                                  type="button"
                                  className="shrink-0 cursor-pointer rounded-full p-0.5 hover:ring-2 hover:ring-border"
                                >
                                  <span
                                    className={cn(
                                      "block h-2.5 w-2.5 rounded-full",
                                      isHiddenCalendar(
                                        "people",
                                        person.email,
                                      ) && "opacity-40",
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
                              {overlayStatusByEmail?.get(
                                person.email.toLowerCase(),
                              )?.status === "error" && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      tabIndex={0}
                                      className="inline-flex shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                      aria-label={t(
                                        "sidebar.overlayCalendarUnavailable",
                                        { email: person.name || person.email },
                                      )}
                                    >
                                      <IconAlertTriangle
                                        className="h-3 w-3 text-muted-foreground/60"
                                        aria-hidden="true"
                                      />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="right">
                                    {t("sidebar.overlayCalendarUnavailable", {
                                      email: person.name || person.email,
                                    })}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              <div className="flex items-center">
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleHiddenCalendar("people", person.email)
                                  }
                                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground group-hover:text-muted-foreground/80"
                                  aria-label={
                                    isHiddenCalendar("people", person.email)
                                      ? t("sidebar.showCalendar")
                                      : t("sidebar.hideCalendar")
                                  }
                                >
                                  {isHiddenCalendar("people", person.email) ? (
                                    <IconEyeOff className="h-3 w-3" />
                                  ) : (
                                    <IconEye className="h-3 w-3" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    removePerson.mutate(person.email)
                                  }
                                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 opacity-0 hover:text-foreground group-hover:opacity-100"
                                >
                                  <IconX className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    )}

                    {externalCalendars.length > 0 && (
                      <Collapsible
                        open={feedsGroupOpen}
                        onOpenChange={setFeedsGroupOpen}
                      >
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="flex h-7 w-full items-center gap-1 rounded px-3 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                          >
                            {feedsGroupOpen ? (
                              <IconChevronDown className="h-3 w-3" />
                            ) : (
                              <IconChevronRight className="h-3 w-3 rtl:-scale-x-100" />
                            )}
                            <span className="min-w-0 flex-1 text-start">
                              Feeds
                            </span>
                            <span className="text-[10px]">
                              {externalCalendars.length}
                            </span>
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-0.5">
                          {externalCalendars.map((cal) => (
                            <div
                              key={cal.id}
                              className="group flex min-h-7 items-center gap-2 px-2 text-xs"
                            >
                              <ColorPickerPopover
                                color={cal.color}
                                onColorChange={(color) =>
                                  updateExternalColor.mutate({
                                    id: cal.id,
                                    color,
                                  })
                                }
                              >
                                <button
                                  type="button"
                                  className="shrink-0 cursor-pointer rounded-full p-0.5 hover:ring-2 hover:ring-border"
                                >
                                  <span
                                    className={cn(
                                      "block h-2.5 w-2.5 rounded-full",
                                      isHiddenCalendar("external", cal.id) &&
                                        "opacity-40",
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
                              <div className="flex items-center">
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleHiddenCalendar("external", cal.id)
                                  }
                                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground group-hover:text-muted-foreground/80"
                                  aria-label={
                                    isHiddenCalendar("external", cal.id)
                                      ? t("sidebar.showCalendar")
                                      : t("sidebar.hideCalendar")
                                  }
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
                                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 opacity-0 hover:text-foreground group-hover:opacity-100"
                                >
                                  <IconX className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
      </AppSidebar>
    </>
  );
}
