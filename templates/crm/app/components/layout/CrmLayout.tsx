import {
  AgentSidebar,
  AgentToggleButton,
  focusAgentChat,
  isAgentChatHomeHandoffActive,
  navigateWithAgentChatViewTransition,
  useAgentChatHomeHandoff,
  useAgentChatHomeHandoffLinks,
} from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { openCommandMenu } from "@agent-native/core/client/navigation";
import { IconMenu2, IconSearch } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { CrmSidebar } from "@/components/layout/CrmSidebar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { TAB_ID } from "@/lib/tab-id";

export function CrmLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isAskRoute = location.pathname === "/ask";
  const handoffActive = useAgentChatHomeHandoff({
    storageKey: "crm",
    activePath: location.pathname,
    enabled: !isAskRoute,
  });
  const handoffPending = isAgentChatHomeHandoffActive("crm");
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
          aria-label={t("navigation.openNavigation")}
        >
          <IconMenu2 className="size-4" />
        </Button>
        <p className="text-sm font-semibold">CRM</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ms-auto"
          onClick={openCommandMenu}
          aria-label={t("navigation.search")}
        >
          <IconSearch className="size-4" />
        </Button>
        {!isAskRoute ? <AgentToggleButton /> : null}
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
          <SheetTitle className="sr-only">
            {t("navigation.navigation")}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("navigation.navigationDescription")}
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
        chatViewTransitionHandoff={handoffPending}
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
        agentPageHref="/settings/agent"
      >
        {shell}
      </AgentSidebar>
    </div>
  );
}
