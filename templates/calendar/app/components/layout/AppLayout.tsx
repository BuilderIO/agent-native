import { createContext, useContext, useState, useEffect } from "react";
import { useLocation } from "react-router";
import { IconMenu } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { AgentSidebar } from "@agent-native/core/client";
import { Sidebar } from "./Sidebar";
import { AddCalendarDialog } from "@/components/calendar/AddCalendarDialog";
import { GoogleConnectBanner } from "@/components/calendar/GoogleConnectBanner";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { useHiddenCalendars } from "@/hooks/use-hidden-calendars";
import { useIsMobile } from "@/hooks/use-mobile";
import type { CalendarEvent } from "@shared/api";

const EVENT_DETAIL_MODE_KEY = "calendar-event-detail-mode";

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
});

export function useCalendarContext() {
  return useContext(CalendarContext);
}

function NavigationSync() {
  useNavigationState();
  return null;
}

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const isMobile = useIsMobile();
  const location = useLocation();
  const googleStatus = useGoogleAuthStatus();
  const hasAccounts = (googleStatus.data?.accounts?.length ?? 0) > 0;
  const isSettingsPage = location.pathname === "/settings";
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

  // Load preference from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(EVENT_DETAIL_MODE_KEY);
      if (saved === "sidebar") setEventDetailSidebarState(true);
    } catch {}
  }, []);

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
      }}
    >
      <NavigationSync />
      <AddCalendarDialog
        open={addCalendarOpen}
        onOpenChange={setAddCalendarOpen}
        defaultTab={addCalendarDefaultTab}
      />
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <AgentSidebar
          position="right"
          defaultOpen
          emptyStateText="Ask me anything about your calendar"
          suggestions={[
            "What's on my calendar today?",
            "Find a free slot this week",
            "Show me upcoming events",
          ]}
        >
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Mobile header */}
            <div className="flex h-12 items-center border-b border-border px-3 lg:hidden">
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10"
                onClick={() => setSidebarOpen(true)}
              >
                <IconMenu className="h-5 w-5" />
              </Button>
              <span className="ml-2 text-sm font-semibold">Calendar</span>
            </div>

            {/* Show full-page takeover when no accounts connected (except on settings page) */}
            {!googleStatus.isLoading &&
            !googleStatus.isError &&
            !hasAccounts &&
            !isSettingsPage ? (
              <main className="flex-1 overflow-y-auto">
                <GoogleConnectBanner variant="hero" />
              </main>
            ) : (
              <main className="flex-1 overflow-y-auto">{children}</main>
            )}
          </div>
        </AgentSidebar>
      </div>
    </CalendarContext.Provider>
  );
}
