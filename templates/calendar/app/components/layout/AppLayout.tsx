import { createContext, useContext, useState, useEffect } from "react";
import { IconMenu } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { AgentSidebar } from "@agent-native/core/client";
import { Sidebar } from "./Sidebar";
import type { CalendarEvent } from "@shared/api";

const EVENT_DETAIL_MODE_KEY = "calendar-event-detail-mode";

interface CalendarContextValue {
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
  peopleSearchOpen: boolean;
  setPeopleSearchOpen: (open: boolean) => void;
  /** Whether to show event details in sidebar instead of popover */
  eventDetailSidebar: boolean;
  setEventDetailSidebar: (sidebar: boolean) => void;
  /** The currently selected event for the sidebar panel */
  sidebarEvent: CalendarEvent | null;
  setSidebarEvent: (event: CalendarEvent | null) => void;
}

const CalendarContext = createContext<CalendarContextValue>({
  selectedDate: new Date(),
  setSelectedDate: () => {},
  peopleSearchOpen: false,
  setPeopleSearchOpen: () => {},
  eventDetailSidebar: false,
  setEventDetailSidebar: () => {},
  sidebarEvent: null,
  setSidebarEvent: () => {},
});

export function useCalendarContext() {
  return useContext(CalendarContext);
}

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [peopleSearchOpen, setPeopleSearchOpen] = useState(false);
  const [eventDetailSidebar, setEventDetailSidebarState] = useState(false);
  const [sidebarEvent, setSidebarEvent] = useState<CalendarEvent | null>(null);

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
        peopleSearchOpen,
        setPeopleSearchOpen,
        eventDetailSidebar,
        setEventDetailSidebar,
        sidebarEvent,
        setSidebarEvent,
      }}
    >
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
                className="h-8 w-8"
                onClick={() => setSidebarOpen(true)}
              >
                <IconMenu className="h-4 w-4" />
              </Button>
              <span className="ml-2 text-sm font-semibold">Calendar</span>
            </div>

            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </AgentSidebar>
      </div>
    </CalendarContext.Provider>
  );
}
