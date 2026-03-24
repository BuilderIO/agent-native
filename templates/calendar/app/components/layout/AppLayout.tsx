import { createContext, useContext, useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentSidebar, AgentToggleButton } from "@agent-native/core/client";
import { Sidebar } from "./Sidebar";

interface CalendarContextValue {
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
}

const CalendarContext = createContext<CalendarContextValue>({
  selectedDate: new Date(),
  setSelectedDate: () => {},
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

  return (
    <CalendarContext.Provider value={{ selectedDate, setSelectedDate }}>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Mobile header */}
          <div className="flex h-12 items-center border-b border-border px-3 lg:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </Button>
            <AgentToggleButton />
            <span className="ml-2 text-sm font-semibold">Calendar</span>
          </div>

          <AgentSidebar
            position="left"
            defaultOpen
            emptyStateText="Ask me anything about your calendar"
            suggestions={[
              "What's on my calendar today?",
              "Find a free slot this week",
              "Show me upcoming events",
            ]}
          >
            <main className="flex-1 overflow-hidden">{children}</main>
          </AgentSidebar>
        </div>
      </div>
    </CalendarContext.Provider>
  );
}
