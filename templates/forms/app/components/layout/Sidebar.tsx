import {
  useSendToAgentChat,
  DevDatabaseLink,
  FeedbackButton,
  appPath,
  focusAgentChat,
  navigateWithAgentChatViewTransition,
  useT,
} from "@agent-native/core/client";
import { ExtensionsSidebarSection } from "@agent-native/core/client/extensions";
import { OrgSwitcher } from "@agent-native/core/client/org";
import {
  IconArrowUp,
  IconPlus,
  IconMenu2,
  IconX,
  IconMessageCircle,
  IconSettings,
  IconForms,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
} from "@tabler/icons-react";
import { useState, useRef, useEffect, type MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAgentPromptRun } from "@/hooks/use-agent-prompt-run";
import { useCreateForm } from "@/hooks/use-forms";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const SIDEBAR_COLLAPSE_KEY = "forms.sidebar.collapsed";

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useT();
  const createForm = useCreateForm();
  const { send } = useSendToAgentChat();
  const promptRun = useAgentPromptRun({
    staleMessage: t("sidebar.formGenerationStale"),
  });
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const effectiveCollapsed = collapsed && !isMobile;

  useEffect(() => {
    if (popoverOpen) {
      setPrompt("");
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [popoverOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // Ignore storage failures; the in-memory preference still works.
    }
  }, [collapsed]);

  function handleSkip() {
    setPopoverOpen(false);
    const tempId = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    navigate(`/forms/${tempId}`);
    createForm.mutate(
      { title: t("sidebar.untitledForm") },
      { onSuccess: (form) => navigate(`/forms/${form.id}`, { replace: true }) },
    );
  }

  function handleSubmitPrompt() {
    const trimmed = prompt.trim();
    if (!trimmed || promptRun.isActivePrompt(trimmed)) return;
    setPopoverOpen(false);
    const tabId = send({
      message: `Create a new form based on this description: ${trimmed}`,
      context:
        "Create the form using the create-form script with appropriate title, description, and fields. After creating, tell the user the form name and a summary of the fields.",
    });
    promptRun.trackRun(trimmed, tabId);
  }

  function navigateHomeChat(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    if (isMobile) setMobileOpen(false);
    focusAgentChat();
    navigateWithAgentChatViewTransition(navigate, "/ask");
  }

  function toggleLogoView() {
    if (isMobile) setMobileOpen(false);
    focusAgentChat();
    navigateWithAgentChatViewTransition(navigate, "/ask");
  }

  const newFormButton = (
    <PopoverTrigger asChild>
      <button className="flex min-h-[44px] w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-all hover:bg-accent/50 hover:text-foreground">
        <IconPlus className="h-4 w-4 shrink-0" />
        <span>{t("sidebar.newForm")}</span>
      </button>
    </PopoverTrigger>
  );

  const newFormPopover = (
    <PopoverContent
      side="right"
      align="start"
      sideOffset={8}
      className="w-80 p-0 rounded-xl"
    >
      <div className="p-4 pb-3">
        <p className="text-sm font-semibold">{t("sidebar.newForm")}</p>
        <Textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleSubmitPrompt();
            }
          }}
          placeholder={t("sidebar.describeFormPlaceholder")}
          className="mt-2 w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground/50 border-none shadow-none"
          rows={4}
        />
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
        <div />
        <div className="flex items-center gap-3">
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-muted-foreground"
            onClick={handleSkip}
          >
            {t("sidebar.skipPrompt")}
          </Button>
          <span className="text-[11px] text-muted-foreground/70">
            {/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"}
            {t("sidebar.submitShortcutSuffix")}
          </span>
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7"
            onClick={handleSubmitPrompt}
            disabled={!prompt.trim() || promptRun.isActivePrompt(prompt)}
            aria-label={t("sidebar.sendPrompt")}
          >
            <IconArrowUp size={14} />
          </Button>
        </div>
      </div>
    </PopoverContent>
  );

  const sidebarContent = effectiveCollapsed ? (
    <div className="agent-layout-left-drawer flex h-screen w-12 min-w-0 shrink-0 flex-col items-center overflow-hidden border-e border-border bg-sidebar py-2 transition-[width] duration-200 ease-out">
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground/55 transition-colors hover:bg-accent/50 hover:text-muted-foreground"
              aria-label={t("sidebar.expandSidebar")}
            >
              <IconLayoutSidebarLeftExpand className="h-4 w-4 rtl:-scale-x-100" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {t("sidebar.expandSidebar")}
          </TooltipContent>
        </Tooltip>

        <nav className="mt-1 flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/ask"
                onClick={navigateHomeChat}
                aria-label={t("navigation.askForms")}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-md transition-colors",
                  location.pathname === "/ask" || location.pathname === "/"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <IconMessageCircle className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t("navigation.askForms")}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/forms"
                aria-label={t("navigation.allForms")}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-md transition-colors",
                  location.pathname.startsWith("/forms")
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <IconForms className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t("navigation.allForms")}
            </TooltipContent>
          </Tooltip>

          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("sidebar.newForm")}
                    className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                  >
                    <IconPlus className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">
                {t("sidebar.newForm")}
              </TooltipContent>
            </Tooltip>
            {newFormPopover}
          </Popover>

          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/settings"
                aria-label={t("navigation.settings")}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-md transition-colors",
                  location.pathname === "/settings"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <IconSettings className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t("navigation.settings")}
            </TooltipContent>
          </Tooltip>
        </nav>
      </TooltipProvider>
    </div>
  ) : (
    <div
      className={cn(
        "agent-layout-left-drawer flex h-screen w-60 min-w-0 shrink-0 flex-col overflow-hidden border-e border-border bg-sidebar transition-[width] duration-200 ease-out",
        isMobile && "w-full",
      )}
    >
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <TooltipProvider delayDuration={700}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("sidebar.openAskFullScreen")}
                className="flex min-w-0 items-center gap-2 rounded-md text-base font-semibold tracking-tight text-muted-foreground/80 transition-colors hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={toggleLogoView}
              >
                <img
                  src={appPath("/agent-native-icon-light.svg")}
                  alt=""
                  aria-hidden="true"
                  className="block h-4 w-auto shrink-0 dark:hidden"
                />
                <img
                  src={appPath("/agent-native-icon-dark.svg")}
                  alt=""
                  aria-hidden="true"
                  className="hidden h-4 w-auto shrink-0 dark:block"
                />
                <span className="truncate">{t("navigation.brand")}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t("sidebar.openAskFullScreen")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setMobileOpen(false)}
          >
            <IconX size={18} />
          </Button>
        )}
        {!isMobile && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground/55 hover:bg-accent/50 hover:text-muted-foreground"
                onClick={() => setCollapsed(true)}
                aria-label={t("sidebar.collapseSidebar")}
              >
                <IconLayoutSidebarLeftCollapse className="h-4 w-4 rtl:-scale-x-100" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t("sidebar.collapseSidebar")}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div
          className={cn(
            "grid min-w-0 max-w-full gap-1 overflow-hidden p-2",
            isMobile ? "w-full" : "w-60",
          )}
        >
          <Link
            to="/ask"
            onClick={navigateHomeChat}
            className={cn(
              "flex min-h-[44px] w-full min-w-0 max-w-full items-center gap-2.5 overflow-hidden rounded-md px-3 py-2 text-sm transition-all hover:text-primary",
              location.pathname === "/ask" || location.pathname === "/"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <IconMessageCircle className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 basis-0 truncate">
              {t("navigation.askForms")}
            </span>
          </Link>

          <Link
            to="/forms"
            onClick={() => isMobile && setMobileOpen(false)}
            className={cn(
              "flex min-h-[44px] w-full min-w-0 max-w-full items-center gap-2.5 overflow-hidden rounded-md px-3 py-2 text-sm transition-all hover:text-primary",
              location.pathname.startsWith("/forms")
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <IconForms className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 basis-0 truncate">
              {t("navigation.allForms")}
            </span>
          </Link>

          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            {newFormButton}
            {newFormPopover}
          </Popover>
        </div>
      </ScrollArea>

      {/* Pinned nav + footer */}
      <div className="shrink-0 px-3 py-1.5">
        <Link
          to="/settings"
          onClick={() => isMobile && setMobileOpen(false)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm min-h-[44px]",
            location.pathname === "/settings"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          <IconSettings size={14} className="shrink-0" />
          <span>{t("navigation.settings")}</span>
        </Link>
      </div>

      {/* Tools */}
      <div className="shrink-0 px-1.5 py-1.5">
        <ExtensionsSidebarSection />
      </div>

      {/* Footer */}
      <div className="shrink-0 space-y-2 px-3 py-2">
        <OrgSwitcher />
        <DevDatabaseLink />
        <div className="flex items-center gap-2">
          <FeedbackButton className="min-w-0 flex-1" />
          <ThemeToggle className="h-9 w-9 shrink-0" />
        </div>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          className="fixed top-2 start-2 z-40 h-10 w-10 md:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label={t("sidebar.openSidebar")}
        >
          <IconMenu2 size={20} />
        </Button>
        {mobileOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setMobileOpen(false)}
            />
            <div className="fixed inset-y-0 start-0 z-50 w-72 max-w-[85vw]">
              {sidebarContent}
            </div>
          </>
        )}
      </>
    );
  }

  return sidebarContent;
}
