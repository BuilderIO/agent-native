import { ReactNode } from "react";
import { AgentSidebar, AgentToggleButton } from "@agent-native/core/client";
import { LibrarySidebar } from "./library-sidebar";
import { CallSearchBar } from "./call-search-bar";

interface LibraryLayoutProps {
  children: ReactNode;
}

export function LibraryLayout({ children }: LibraryLayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <AgentSidebar
        position="right"
        emptyStateText="How can I help with your calls?"
        suggestions={[
          "Summarize the call I just reviewed",
          "Find the moment someone objected to pricing",
          "Create a tracker for competitor mentions",
          "Invite bob@example.com to this workspace",
        ]}
      >
        <div className="flex h-full w-full">
          <LibrarySidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center gap-3 border-b border-border px-5 py-2">
              <CallSearchBar />
              <div className="ml-auto flex items-center gap-2">
                <AgentToggleButton />
              </div>
            </header>
            <main className="flex flex-1 flex-col min-h-0 overflow-hidden">
              {children}
            </main>
          </div>
        </div>
      </AgentSidebar>
    </div>
  );
}
