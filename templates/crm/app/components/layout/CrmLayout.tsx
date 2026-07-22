import {
  AgentSidebar,
  AgentToggleButton,
  focusAgentChat,
  navigateWithAgentChatViewTransition,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
} from "@agent-native/core/client/agent-chat";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@agent-native/toolkit/ui/sheet";
import { IconMenu2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { CrmSidebar } from "@/components/layout/CrmSidebar";
import { TAB_ID } from "@/lib/tab-id";

export function CrmLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAskRoute = location.pathname === "/ask";
  const handoffActive = useAgentChatHomeHandoff({
    storageKey: "crm",
    activePath: location.pathname,
    enabled: !isAskRoute,
  });
  useAgentChatHomeHandoffLinks({
    storageKey: "crm",
    chatPath: "/ask",
    requireActiveHandoff: false,
  });

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const shell = (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-3 md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setMobileOpen(true)}
          aria-label="Open CRM navigation"
        >
          <IconMenu2 className="size-4" />
        </Button>
        <p className="text-sm font-semibold">CRM</p>
        {!isAskRoute ? <AgentToggleButton className="ms-auto" /> : null}
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {children}
      </main>
    </div>
  );

  const navigation = (
    <>
      <div className="hidden md:block">
        <CrmSidebar />
      </div>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-60 p-0">
          <SheetTitle className="sr-only">CRM navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Navigate CRM records and shared agent work.
          </SheetDescription>
          <CrmSidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );

  if (isAskRoute)
    return (
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        {navigation}
        {shell}
      </div>
    );

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {navigation}
      <AgentSidebar
        position="right"
        storageKey="crm"
        browserTabId={TAB_ID}
        chatViewTransition
        openOnChatRunning={handoffActive}
        onFullscreenRequest={() => {
          focusAgentChat();
          navigateWithAgentChatViewTransition(navigate, "/ask");
        }}
        emptyStateText="Ask CRM about your connected records"
        suggestions={[
          "What needs follow-up?",
          "Summarize this account",
          "Which opportunities need attention?",
        ]}
        agentPageHref="/agent"
      >
        {shell}
      </AgentSidebar>
    </div>
  );
}
