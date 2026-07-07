import {
  AgentSidebar,
  AgentToggleButton,
  useAppearanceSync,
  useT,
} from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import type { CalendarEvent, CalendarEventDraft } from "@shared/api";
import { IconMenu } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
} from "react";
import { useLocation } from "react-router";

import { AddCalendarDialog } from "@/components/calendar/AddCalendarDialog";
import { GoogleConnectBanner } from "@/components/calendar/GoogleConnectBanner";
import { KeyboardShortcutsHelp } from "@/components/calendar/KeyboardShortcutsHelp";
import { Button } from "@/components/ui/button";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import { useHiddenCalendars } from "@/hooks/use-hidden-calendars";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { prefetchPeopleContacts } from "@/hooks/use-people";

import { Sidebar } from "./Sidebar";

const EVENT_DETAIL_MODE_KEY = "calendar-event-detail-mode";
const SIDEBAR_COLLAPSE_KEY = "calendar.sidebar.collapsed";

/** Routes that render without the full AppLayout chrome (sidebar, agent panel). */
const BARE_ROUTES = new Set(["/event"]);

/**
 * Routes whose page renders its own toolbar. Layout still mounts Sidebar +
 * AgentSidebar, but skips its own header so there's no double-header.
 */
function pageOwnsToolbar(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname === "/extensions" || pathname.startsWith("/extensions/"))
    return true;
  return false;
}

function readSidebarCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export type ViewMode = "month" | "week" | "day";

interface CalendarContextValue {
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  peopleSearchOpen: boolean;
  setPeopleSearchOpen: (open: boolean) => void;
  addCalendarOpen: boolean;
  setAddCalendarOpen: (open: boolean) => void;
  addCalendarDefaultTab: "people" | "url";
  setAddCalendarDefaultTab: (tab: "people" | "url") => void;
  hiddenCalendars: ReturnType<typeof useHiddenCalendars>["hidden"];
  toggleHiddenCalendar: ReturnType<typeof useHiddenCalendars>["toggle"];
  isHiddenCalendar: ReturnType<typeof useHiddenCalendars>["isHidden"];
  /** Whether to show event details in sidebar instead of popover */
  eventDetailSidebar: boolean;
  setEventDetailSidebar: (sidebar: boolean) => void;
  /** The currently selected event for the sidebar panel */
  sidebarEvent: CalendarEvent | null;
  setSidebarEvent: (event: CalendarEvent | null) => void;
  /** The last-clicked/focused event (for keyboard shortcuts like Delete) */
  focusedEvent: CalendarEvent | null;
  setFocusedEvent: (event: CalendarEvent | null) => void;
  /** The currently open unsent event draft, if any */
  eventDraft: CalendarEventDraft | null;
  setEventDraft: (draft: CalendarEventDraft | null) => void;
  openSidebar: () => void;
}

/**
 * Setter-only slice. Every value here is a stable function reference (state
 * setters, or callbacks with empty/near-empty dep arrays), so this context's
 * value object only needs to be rebuilt when AppLayout itself remounts.
 * Consumers that only dispatch changes (not read current values) should read
 * from this context so they don't re-render on every focus/selection change.
 */
interface CalendarSettersValue {
  setSelectedDate: (date: Date) => void;
  setViewMode: (mode: ViewMode) => void;
  setPeopleSearchOpen: (open: boolean) => void;
  setAddCalendarOpen: (open: boolean) => void;
  setAddCalendarDefaultTab: (tab: "people" | "url") => void;
  toggleHiddenCalendar: ReturnType<typeof useHiddenCalendars>["toggle"];
  setEventDetailSidebar: (sidebar: boolean) => void;
  setSidebarEvent: (event: CalendarEvent | null) => void;
  setFocusedEvent: (event: CalendarEvent | null) => void;
  setEventDraft: (draft: CalendarEventDraft | null) => void;
  openSidebar: () => void;
}

/** Values that change on navigation/preference actions, not on every event interaction. */
interface CalendarRareValuesContextValue {
  selectedDate: Date;
  viewMode: ViewMode;
  peopleSearchOpen: boolean;
  addCalendarOpen: boolean;
  addCalendarDefaultTab: "people" | "url";
  hiddenCalendars: ReturnType<typeof useHiddenCalendars>["hidden"];
  isHiddenCalendar: ReturnType<typeof useHiddenCalendars>["isHidden"];
  eventDetailSidebar: boolean;
}

/** Values that change on nearly every event click/drag — kept separate so
 * rare-value and setter-only consumers don't re-render alongside them. */
interface CalendarHighFrequencyContextValue {
  sidebarEvent: CalendarEvent | null;
  focusedEvent: CalendarEvent | null;
  eventDraft: CalendarEventDraft | null;
}

const noopSetters: CalendarSettersValue = {
  setSelectedDate: () => {},
  setViewMode: () => {},
  setPeopleSearchOpen: () => {},
  setAddCalendarOpen: () => {},
  setAddCalendarDefaultTab: () => {},
  toggleHiddenCalendar: () => {},
  setEventDetailSidebar: () => {},
  setSidebarEvent: () => {},
  setFocusedEvent: () => {},
  setEventDraft: () => {},
  openSidebar: () => {},
};

const CalendarSettersContext = createContext<CalendarSettersValue>(noopSetters);

const CalendarRareValuesContext = createContext<CalendarRareValuesContextValue>(
  {
    selectedDate: new Date(),
    viewMode: "week",
    peopleSearchOpen: false,
    addCalendarOpen: false,
    addCalendarDefaultTab: "people",
    hiddenCalendars: { people: [], external: [], accounts: [] },
    isHiddenCalendar: () => false,
    eventDetailSidebar: false,
  },
);

const CalendarHighFrequencyContext =
  createContext<CalendarHighFrequencyContextValue>({
    sidebarEvent: null,
    focusedEvent: null,
    eventDraft: null,
  });

/**
 * Full merged calendar context, for consumers that need a mix of setters and
 * values. Prefer the narrower `useCalendarSetters`, `useCalendarRareValues`,
 * or `useCalendarHighFrequency` hooks in render-hot components so they only
 * re-render for the slice they actually read.
 */
export function useCalendarContext(): CalendarContextValue {
  const setters = useContext(CalendarSettersContext);
  const rare = useContext(CalendarRareValuesContext);
  const highFrequency = useContext(CalendarHighFrequencyContext);
  return { ...setters, ...rare, ...highFrequency };
}

/** Setter-only slice — safe for components that dispatch but never read focus/selection state. */
export function useCalendarSetters(): CalendarSettersValue {
  return useContext(CalendarSettersContext);
}

/** Rarely-changing slice (view mode, hidden calendars, selected date, dialogs). */
export function useCalendarRareValues(): CalendarRareValuesContextValue {
  return useContext(CalendarRareValuesContext);
}

/** High-frequency slice (focused/sidebar event, in-progress draft). */
export function useCalendarHighFrequency(): CalendarHighFrequencyContextValue {
  return useContext(CalendarHighFrequencyContext);
}

type HeaderControls = {
  left?: ReactNode;
  right?: ReactNode;
};

const HeaderControlsContext = createContext<
  (controls: HeaderControls | null) => void
>(() => {});

export function useAppHeaderControls(controls: HeaderControls | null) {
  const setHeaderControls = useContext(HeaderControlsContext);
  useEffect(() => {
    setHeaderControls(controls);
    return () => setHeaderControls(null);
  }, [controls, setHeaderControls]);
}

function NavigationSync() {
  useNavigationState();
  useAppearanceSync();
  return null;
}

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const t = useT();
  const isMobile = useIsMobile();
  const location = useLocation();
  const queryClient = useQueryClient();
  const googleStatus = useGoogleAuthStatus();
  const hasAccounts = (googleStatus.data?.accounts?.length ?? 0) > 0;
  const isSettingsPage = location.pathname === "/settings";
  const isCalendarPage = location.pathname === "/";
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] =
    useState(readSidebarCollapsed);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>(isMobile ? "day" : "week");
  const [peopleSearchOpen, setPeopleSearchOpen] = useState(false);
  const [addCalendarOpen, setAddCalendarOpen] = useState(false);
  const [addCalendarDefaultTab, setAddCalendarDefaultTab] = useState<
    "people" | "url"
  >("people");
  const {
    hidden: hiddenCalendars,
    toggle: toggleHiddenCalendar,
    isHidden: isHiddenCalendar,
  } = useHiddenCalendars();
  const [eventDetailSidebar, setEventDetailSidebarState] = useState(false);
  const [sidebarEvent, setSidebarEvent] = useState<CalendarEvent | null>(null);
  const [focusedEvent, setFocusedEvent] = useState<CalendarEvent | null>(null);
  const [eventDraft, setEventDraft] = useState<CalendarEventDraft | null>(null);
  const [headerControls, setHeaderControls] = useState<HeaderControls | null>(
    null,
  );
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);

  // Load preference from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(EVENT_DETAIL_MODE_KEY);
      if (saved === "sidebar") setEventDetailSidebarState(true);
    } catch {}
  }, []);

  useEffect(() => {
    if (!hasAccounts) return;
    void prefetchPeopleContacts(queryClient);
  }, [hasAccounts, queryClient]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SIDEBAR_COLLAPSE_KEY,
        sidebarCollapsed ? "1" : "0",
      );
    } catch {
      // Ignore storage failures; the in-memory preference still works.
    }
  }, [sidebarCollapsed]);

  // Global keyboard-shortcuts help: opens via `?` (or shift+/) or the sidebar
  // button on any page, not just the calendar view. Calendar-specific shortcuts
  // (j/k/c/etc.) still live in CalendarView.
  useEffect(() => {
    const openShortcuts = () => setShortcutsHelpOpen(true);
    window.addEventListener("calendar:open-shortcuts", openShortcuts);
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setShortcutsHelpOpen(true);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("calendar:open-shortcuts", openShortcuts);
      window.removeEventListener("keydown", handleKey);
    };
  }, []);

  const setEventDetailSidebar = useCallback((sidebar: boolean) => {
    setEventDetailSidebarState(sidebar);
    try {
      localStorage.setItem(
        EVENT_DETAIL_MODE_KEY,
        sidebar ? "sidebar" : "popover",
      );
    } catch {}
  }, []);

  const openSidebar = useCallback(() => setSidebarOpen(true), []);

  const settersValue = useMemo<CalendarSettersValue>(
    () => ({
      setSelectedDate,
      setViewMode,
      setPeopleSearchOpen,
      setAddCalendarOpen,
      setAddCalendarDefaultTab,
      toggleHiddenCalendar,
      setEventDetailSidebar,
      setSidebarEvent,
      setFocusedEvent,
      setEventDraft,
      openSidebar,
    }),
    [toggleHiddenCalendar, setEventDetailSidebar, openSidebar],
  );

  const rareValuesValue = useMemo<CalendarRareValuesContextValue>(
    () => ({
      selectedDate,
      viewMode,
      peopleSearchOpen,
      addCalendarOpen,
      addCalendarDefaultTab,
      hiddenCalendars,
      isHiddenCalendar,
      eventDetailSidebar,
    }),
    [
      selectedDate,
      viewMode,
      peopleSearchOpen,
      addCalendarOpen,
      addCalendarDefaultTab,
      hiddenCalendars,
      isHiddenCalendar,
      eventDetailSidebar,
    ],
  );

  const highFrequencyValue = useMemo<CalendarHighFrequencyContextValue>(
    () => ({ sidebarEvent, focusedEvent, eventDraft }),
    [sidebarEvent, focusedEvent, eventDraft],
  );

  // Render chromeless for embed/preview routes — all hooks must be called above
  if (BARE_ROUTES.has(location.pathname)) {
    return <>{children}</>;
  }

  return (
    <CalendarSettersContext.Provider value={settersValue}>
      <CalendarRareValuesContext.Provider value={rareValuesValue}>
        <CalendarHighFrequencyContext.Provider value={highFrequencyValue}>
          <NavigationSync />
          <AddCalendarDialog
            open={addCalendarOpen}
            onOpenChange={setAddCalendarOpen}
            defaultTab={addCalendarDefaultTab}
          />
          <KeyboardShortcutsHelp
            open={shortcutsHelpOpen}
            onClose={() => setShortcutsHelpOpen(false)}
          />
          <div className="agent-layout-shell flex h-screen overflow-hidden bg-background">
            <Sidebar
              open={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
              collapsed={!isMobile && sidebarCollapsed}
              onCollapsedChange={setSidebarCollapsed}
            />
            <AgentSidebar
              position="right"
              defaultOpen
              emptyStateText={t("agentSidebar.emptyState")}
              suggestions={[
                t("agentSidebar.suggestions.today"),
                t("agentSidebar.suggestions.findSlot"),
                t("agentSidebar.suggestions.scheduleZoom"),
              ]}
            >
              <div className="flex flex-1 flex-col overflow-hidden">
                {!pageOwnsToolbar(location.pathname) && (
                  <header className="flex h-12 items-center justify-between gap-3 border-b border-border px-3 shrink-0">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 shrink-0 lg:hidden"
                        onClick={() => setSidebarOpen(true)}
                        aria-label={t("calendarView.openNavigation")}
                      >
                        <IconMenu className="h-5 w-5" />
                      </Button>
                      {headerControls?.left ?? (
                        <span className="text-sm font-semibold lg:hidden">
                          {t("navigation.calendar")}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {headerControls?.right}
                      <AgentToggleButton />
                    </div>
                  </header>
                )}

                <HeaderControlsContext.Provider value={setHeaderControls}>
                  <InvitationBanner />

                  {/* Show the full-page Google prompt only on the calendar view. */}
                  {!googleStatus.isLoading &&
                  !googleStatus.isError &&
                  !hasAccounts &&
                  !eventDraft &&
                  isCalendarPage &&
                  !isSettingsPage ? (
                    <main className="agent-native-app-main flex-1 overflow-y-auto">
                      <GoogleConnectBanner variant="hero" />
                    </main>
                  ) : (
                    <main className="agent-native-app-main flex-1 overflow-y-auto">
                      {children}
                    </main>
                  )}
                </HeaderControlsContext.Provider>
              </div>
            </AgentSidebar>
          </div>
        </CalendarHighFrequencyContext.Provider>
      </CalendarRareValuesContext.Provider>
    </CalendarSettersContext.Provider>
  );
}
