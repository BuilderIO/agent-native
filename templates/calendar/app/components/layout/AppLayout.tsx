import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { useLocation } from "react-router";
import { IconMenu } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  AgentSidebar,
  AgentToggleButton,
  NotificationsBell,
  useAppearanceSync,
} from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { Sidebar } from "./Sidebar";
import { AddCalendarDialog } from "@/components/calendar/AddCalendarDialog";
import { GoogleConnectBanner } from "@/components/calendar/GoogleConnectBanner";
import { KeyboardShortcutsHelp } from "@/components/calendar/KeyboardShortcutsHelp";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { useHiddenCalendars } from "@/hooks/use-hidden-calendars";
import { useIsMobile } from "@/hooks/use-mobile";
import type { CalendarEvent, CalendarEventDraft } from "@shared/api";

const EVENT_DETAIL_MODE_KEY = "calendar-event-detail-mode";

/** Routes that render without the full AppLayout chrome (sidebar, agent panel). */
const BARE_ROUTES = new Set(["/event"]);

/**
 * Routes whose page renders its own toolbar (with NotificationsBell + AgentToggleButton).
 * Layout still mounts Sidebar + AgentSidebar, but skips its own header so
 * there's no double-header.
 */
function pageOwnsToolbar(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname === "/extensions" || pathname.startsWith("/extensions/"))
    return true;
  return false;
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
}

const CalendarContext = createContext<CalendarContextValue>({
  selectedDate: new Date(),
  setSelectedDate: () => {},
  viewMode: "week",
  setViewMode: () => {},
  peopleSearchOpen: false,
  setPeopleSearchOpen: () => {},
  addCalendarOpen: false,
  setAddCalendarOpen: () => {},
  addCalendarDefaultTab: "people",
  setAddCalendarDefaultTab: () => {},
  hiddenCalendars: { people: [], external: [], accounts: [] },
  toggleHiddenCalendar: () => {},
  isHiddenCalendar: () => false,
  eventDetailSidebar: false,
  setEventDetailSidebar: () => {},
  sidebarEvent: null,
  setSidebarEvent: () => {},
  focusedEvent: null,
  setFocusedEvent: () => {},
  eventDraft: null,
  setEventDraft: () => {},
});

export function useCalendarContext() {
  return useContext(CalendarContext);
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
  const isMobile = useIsMobile();
  const location = useLocation();
  const googleStatus = useGoogleAuthStatus();
  const hasAccounts = (googleStatus.data?.accounts?.length ?? 0) > 0;
  const isSettingsPage = location.pathname === "/settings";
  const isCalendarPage = location.pathname === "/";
  const [sidebarOpen, setSidebarOpen] = useState(false);
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

  // Render chromeless for embed/preview routes — all hooks must be called above
  if (BARE_ROUTES.has(location.pathname)) {
    return <>{children}</>;
  }

  const setEventDetailSidebar = (sidebar: boolean) => {
    setEventDetailSidebarState(sidebar);
    try {
      localStorage.setItem(
        EVENT_DETAIL_MODE_KEY,
        sidebar ? "sidebar" : "popover",
      );
    } catch {}
  };

  return (
    <CalendarContext.Provider
      value={{
        selectedDate,
        setSelectedDate,
        viewMode,
        setViewMode,
        peopleSearchOpen,
        setPeopleSearchOpen,
        addCalendarOpen,
        setAddCalendarOpen,
        addCalendarDefaultTab,
        setAddCalendarDefaultTab,
        hiddenCalendars,
        toggleHiddenCalendar,
        isHiddenCalendar,
        eventDetailSidebar,
        setEventDetailSidebar,
        sidebarEvent,
        setSidebarEvent,
        focusedEvent,
        setFocusedEvent,
        eventDraft,
        setEventDraft,
      }}
    >
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
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <AgentSidebar
          position="right"
          defaultOpen
          emptyStateText="Ask me anything about your calendar"
          suggestions={[
            "What's on my calendar today?",
            "Find a 30-min slot with Alice next week",
            "Schedule a Zoom with the team Friday",
          ]}
        >
          <div className="flex flex-1 flex-col overflow-hidden">
            {!pageOwnsToolbar(location.pathname) && (
              <header className="flex h-12 items-center justify-between gap-3 border-b border-border px-3 shrink-0">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {headerControls?.left ?? (
                    <div className="flex items-center lg:hidden">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10"
                        onClick={() => setSidebarOpen(true)}
                      >
                        <IconMenu className="h-5 w-5" />
                      </Button>
                      <span className="ml-2 text-sm font-semibold">
                        Calendar
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {headerControls?.right}
                  <NotificationsBell emptyDescription="Calendar can pop browser alerts while this app is open. Clips desktop handles fuller meeting prompts with one-click notes." />
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
                <main className="flex-1 overflow-y-auto">
                  <GoogleConnectBanner variant="hero" />
                </main>
              ) : (
                <main className="flex-1 overflow-y-auto">{children}</main>
              )}
            </HeaderControlsContext.Provider>
          </div>
        </AgentSidebar>
      </div>
    </CalendarContext.Provider>
  );
}
